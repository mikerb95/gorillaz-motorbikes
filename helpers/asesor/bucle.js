'use strict';
// Una vuelta de conversación del asesor con IA: valida lo que manda el
// navegador, llama al modelo, ejecuta sus herramientas y pasa la respuesta por
// la guardia de cifras antes de devolverla.
//
// El servidor no guarda la conversación: el navegador reenvía el historial en
// cada pregunta. Eso abre una puerta: un historial manipulado podría traer una
// "respuesta del asesor" con un precio falso. Por eso del historial solo se
// toma texto, y las búsquedas previas llegan como PEDIDOS que el servidor
// vuelve a ejecutar contra el catálogo: un pedido inventado solo produce
// precios reales.
//
// El modelo se inyecta (`deps.llamarModelo`) para probar el bucle sin red.
// Módulo PURO.

const { verificarCifras } = require('./guardia');
const { sumarUso, USO_CERO } = require('./costo');
const { cifrasPublicas } = require('./conocimiento');
const { MAX_PREGUNTAS, PAGINAS } = require('./prompt');
const h = require('./herramientas');

const MAX_TEXTO_USUARIO = 500;
const MAX_TEXTO_ASESOR = 2000;
const MAX_BUSQUEDAS = 6;
/** Llamadas al modelo por pregunta: una o dos herramientas, la respuesta y un reintento de la guardia. */
const MAX_LLAMADAS = 4;

const RESPALDO =
  'Prefiero no darte una respuesta que no pueda respaldar. Escríbele al taller por WhatsApp y te confirman directamente.';

/**
 * Valida el cuerpo del request. Devuelve la entrada limpia o { error }:
 * 'limite' si se pasó del máximo de preguntas (el navegador lo impide; esto
 * es para quien lo salte), 'formato' para todo lo demás.
 */
function validarEntrada(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { error: 'formato' };
  const permitidas = new Set(['pagina', 'mensajes', 'busquedas']);
  if (Object.keys(cuerpo).some((k) => !permitidas.has(k))) return { error: 'formato' };

  const { pagina, mensajes, busquedas = [] } = cuerpo;
  if (pagina !== undefined && !PAGINAS.includes(pagina)) return { error: 'formato' };
  if (!Array.isArray(mensajes) || !mensajes.length) return { error: 'formato' };
  if (mensajes.length > MAX_PREGUNTAS * 2 - 1) return { error: 'limite' };

  const limpios = [];
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i];
    if (!m || typeof m !== 'object' || Object.keys(m).some((k) => k !== 'rol' && k !== 'texto')) return { error: 'formato' };
    // Alternancia estricta, empezando y terminando en el visitante.
    const rol = i % 2 === 0 ? 'usuario' : 'asesor';
    if (m.rol !== rol || typeof m.texto !== 'string') return { error: 'formato' };
    const texto = m.texto.trim();
    if (!texto || texto.length > (rol === 'usuario' ? MAX_TEXTO_USUARIO : MAX_TEXTO_ASESOR)) return { error: 'formato' };
    limpios.push({ rol, texto });
  }
  if (limpios.at(-1).rol !== 'usuario') return { error: 'formato' };

  if (!Array.isArray(busquedas) || busquedas.length > MAX_BUSQUEDAS) return { error: 'formato' };
  const pedidos = [];
  for (const b of busquedas) {
    if (!b || typeof b !== 'object' || Object.keys(b).some((k) => k !== 'consulta') || typeof b.consulta !== 'string') {
      return { error: 'formato' };
    }
    pedidos.push({ consulta: b.consulta });
  }
  return { pagina, mensajes: limpios, busquedas: pedidos };
}

// Celulares colombianos (3xx xxx xxxx, con o sin +57 y separadores) y
// cualquier tira de 10 o más dígitos (fijos con indicativo, cuentas). Desde
// 10 y no menos para no tapar precios que escriba la persona ("$320.000").
const TELEFONO = /(?:\+?57[\s.-]?)?(?<![\d$])(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}|\d(?:[\s.-]?\d){9,})(?!\d)/g;

/** Tapa números de teléfono (y documentos) antes de mandar el historial al modelo. */
function taparTelefonos(texto) {
  return texto.replace(TELEFONO, '[número omitido]');
}

// Raya media y raya larga, armadas con su código para no tenerlas en el archivo.
const RAYA = `[${String.fromCharCode(0x2013, 0x2014)}]`;
const RANGO_CON_RAYA = new RegExp(`(\\d)\\s*${RAYA}\\s*(?=[$\\d])`, 'g');
const RAYA_SUELTA = new RegExp(`\\s*${RAYA}\\s*`, 'g');

/**
 * Quita las rayas del texto del modelo. El prompt las prohíbe, pero el modelo
 * las pone igual. Un rango numérico pasa a "3 a 5"; cualquier otra raya, a coma.
 */
function sinRayas(texto) {
  return texto.replace(RANGO_CON_RAYA, '$1 a ').replace(RAYA_SUELTA, ', ');
}

function textoDe(r) {
  return (r.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Corre una pregunta completa. Lanza solo si falla la llamada al modelo.
 * `catalogo` = { cursos, productos, categorias } (fuentes del sitio).
 */
async function atender(e, catalogo, deps) {
  // Las búsquedas previas se rehacen; una que ya no encuentre nada (producto
  // retirado) simplemente no aporta precios.
  const busquedas = [];
  const encontrados = [];
  for (const p of e.busquedas) {
    try {
      encontrados.push(...h.buscarProductos(p, catalogo));
      busquedas.push(p);
    } catch {
      // Pedido viejo o manipulado: no aporta cifras.
    }
  }

  const mensajes = e.mensajes.map((m) => ({
    role: m.rol === 'usuario' ? 'user' : 'assistant',
    // Ningún teléfono llega al modelo, en todo el historial: el navegador
    // reenvía los mensajes viejos en cada pregunta.
    content: m.rol === 'usuario' ? taparTelefonos(m.texto) : m.texto,
  }));

  let uso = USO_CERO;
  let whatsapp = null;
  let reintentoGuardia = false;
  // Texto escrito junto a una llamada a herramienta. El modelo suele dar la
  // respuesta completa en el mismo mensaje en que pide preparar WhatsApp, y
  // después cierra sin decir nada más: si ese texto se descartara, se perdería
  // justo la respuesta con el precio.
  let previo = [];
  const permitidas = () => [...new Set([...cifrasPublicas(catalogo), ...h.cifrasDeProductos(encontrados)])];
  const cerrar = (texto, respaldo) => ({
    texto,
    whatsapp,
    busquedas,
    uso,
    cifras: respaldo ? [] : h.cifrasBuscadas(texto, encontrados),
    respaldo,
  });

  for (let vuelta = 0; vuelta < MAX_LLAMADAS; vuelta++) {
    const r = await deps.llamarModelo(mensajes);
    uso = sumarUso(uso, r.usage);
    if (r.stop_reason === 'refusal') return cerrar(RESPALDO, 'negativa');

    const usos = (r.content || []).filter((b) => b.type === 'tool_use');
    if (usos.length) {
      const dicho = textoDe(r);
      if (dicho) previo.push(dicho);
      mensajes.push({ role: 'assistant', content: r.content });
      const resultados = usos.map((u) => {
        const salida = ejecutarHerramienta(u, catalogo, encontrados, busquedas);
        if (salida.whatsapp) whatsapp = salida.whatsapp;
        return { type: 'tool_result', tool_use_id: u.id, content: salida.contenido, is_error: salida.error };
      });
      mensajes.push({ role: 'user', content: resultados });
      continue;
    }

    const texto = sinRayas([...previo, textoDe(r)].filter(Boolean).join('\n\n'));
    if (!texto) return cerrar(RESPALDO, 'vueltas');
    const g = verificarCifras(texto, permitidas());
    if (g.ok) return cerrar(texto, null);
    if (reintentoGuardia) return cerrar(RESPALDO, 'guardia');
    // Una oportunidad de corregir, con las cifras problemáticas a la vista.
    reintentoGuardia = true;
    // El reintento reescribe la respuesta completa: lo dicho antes no se suma.
    previo = [];
    mensajes.push({ role: 'assistant', content: r.content });
    mensajes.push({
      role: 'user',
      content:
        '[Revisión automática del sistema, no del visitante] Tu respuesta menciona cifras de dinero que no salen de ' +
        `buscar_producto ni de los precios publicados de los cursos: ${g.inventadas.map((c) => c.texto).join(', ')}. ` +
        'Reescribe la respuesta completa para el visitante sin esas cifras. Los servicios del taller no tienen precio publicado.',
    });
  }
  return cerrar(RESPALDO, 'vueltas');
}

function ejecutarHerramienta(u, catalogo, encontrados, busquedas) {
  try {
    if (u.name === 'buscar_producto') {
      const productos = h.buscarProductos(u.input, catalogo);
      encontrados.push(...productos);
      // El historial de pedidos se queda con los últimos: el navegador lo
      // reenvía y tiene tope.
      busquedas.push({ consulta: u.input.consulta.trim() });
      if (busquedas.length > MAX_BUSQUEDAS) busquedas.splice(0, busquedas.length - MAX_BUSQUEDAS);
      return { contenido: JSON.stringify(h.resultadoParaModelo(productos)), error: false };
    }
    if (u.name === 'preparar_whatsapp') {
      const p = h.pedidoWhatsapp(u.input);
      return {
        contenido: 'Listo: el botón "Enviárselo a Gorillaz" ya está visible para el visitante debajo de tu respuesta.',
        error: false,
        whatsapp: h.mensajeWhatsapp(p, encontrados),
      };
    }
  } catch (err) {
    if (err instanceof h.EntradaInvalida) return { contenido: `Entrada inválida: ${err.message}`, error: true };
    throw err;
  }
  return { contenido: `Herramienta desconocida: ${u.name}`, error: true };
}

module.exports = {
  MAX_TEXTO_USUARIO,
  MAX_TEXTO_ASESOR,
  MAX_BUSQUEDAS,
  MAX_LLAMADAS,
  RESPALDO,
  validarEntrada,
  taparTelefonos,
  sinRayas,
  atender,
};
