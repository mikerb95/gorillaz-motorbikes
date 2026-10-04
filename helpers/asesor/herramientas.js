'use strict';
// Herramientas del asesor con IA: buscar un producto en la tienda y preparar
// el mensaje de WhatsApp. Las dos se ejecutan en el servidor con funciones
// puras; el modelo solo elige qué pedir.
//
// No hay herramienta de precios de servicios a propósito: el taller no los
// publica y se cotizan viendo la moto (decisión del dueño, oct 2026).
//
// Módulo PURO: el catálogo llega como parámetro.

const { verificarCifras, extraerCifras } = require('./guardia');
const { pesos } = require('./conocimiento');

const MAX_RESULTADOS = 5;

class EntradaInvalida extends Error {}

/** Minúsculas y sin tildes, para que "baul" encuentre "Baúl". */
function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Precio final como lo muestra la tienda: con el descuento publicado ya aplicado. */
function precioFinal(p) {
  return p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
}

/**
 * Busca en el catálogo. Lanza EntradaInvalida con un mensaje que el modelo
 * puede corregir. Devuelve los productos tal como están (sin stock: la
 * disponibilidad la confirma el taller).
 */
function buscarProductos(pedido, catalogo) {
  const consulta = typeof pedido?.consulta === 'string' ? pedido.consulta.trim() : '';
  if (consulta.length < 2 || consulta.length > 60) throw new EntradaInvalida('"consulta" debe tener entre 2 y 60 letras');
  // Singular aproximado: "cascos" tiene que encontrar "Casco Pro Naked" y
  // "guantes" a "Guante...". Basta con la raíz porque se compara con includes.
  const palabras = normalizar(consulta)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 2)
    .map((w) => (w.length > 5 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  if (!palabras.length) throw new EntradaInvalida('"consulta" no tiene palabras para buscar');
  const nombresCat = Object.fromEntries((catalogo.categorias || []).map((c) => [c.slug, c.name]));
  return (catalogo.productos || [])
    .filter((p) => Number.isFinite(p.price) && p.price > 0)
    .map((p) => {
      const nombre = normalizar(p.name);
      const resto = normalizar([p.brand, nombresCat[p.category], p.category, ...(p.tags || [])].join(' '));
      let puntos = 0;
      for (const w of palabras) {
        if (nombre.includes(w)) puntos += 2;
        else if (resto.includes(w)) puntos += 1;
      }
      return { p, puntos };
    })
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, MAX_RESULTADOS)
    .map(({ p }) => ({ ...p, categoriaNombre: nombresCat[p.category] || null }));
}

/** Lo que vuelve al modelo: nombre, precio y enlace. Nada de stock ni SKU. */
function resultadoParaModelo(productos) {
  if (!productos.length) {
    return { productos: [], nota: 'No hay productos que coincidan en la tienda. No inventes uno: ofrece preguntarle al taller por WhatsApp.' };
  }
  return {
    productos: productos.map((p) => ({
      id: p.id,
      nombre: p.name,
      marca: p.brand || null,
      categoria: p.categoriaNombre,
      precio: pesos(precioFinal(p)),
      ...(p.discount > 0 ? { precioAntes: pesos(p.price) } : {}),
      enlace: `/tienda/${p.id}`,
    })),
    nota: 'Precios publicados en la tienda. La disponibilidad no está confirmada: la confirma el taller por WhatsApp. Copia los precios tal cual.',
  };
}

/** Cifras que un producto permite decir: el precio final y, si tiene descuento, el anterior. */
function cifrasDeProductos(productos) {
  return productos.flatMap((p) => (p.discount > 0 ? [precioFinal(p), p.price] : [p.price]));
}

/** Valida la entrada de preparar_whatsapp. Lanza EntradaInvalida. */
function pedidoWhatsapp(input) {
  const o = input && typeof input === 'object' ? input : {};
  const necesidad = typeof o.necesidad === 'string' ? o.necesidad.trim() : '';
  if (necesidad.length < 3 || necesidad.length > 300) throw new EntradaInvalida('"necesidad" debe tener entre 3 y 300 letras');
  const pendiente = typeof o.pendiente === 'string' ? o.pendiente.trim().slice(0, 300) : '';
  const producto = typeof o.producto_id === 'string' ? o.producto_id.trim() : '';
  return { necesidad, pendiente, producto };
}

/**
 * Mensaje que se precarga en WhatsApp. Lo compone el servidor: el modelo solo
 * aporta qué necesita la persona y qué quedó pendiente, y el precio de un
 * producto sale de una búsqueda de esta conversación, nunca del texto del modelo.
 */
function mensajeWhatsapp(pedido, encontrados) {
  // Si el modelo coló una cifra en el resumen, se descarta ese campo entero:
  // lo que llega a WhatsApp con precio tiene que poder respaldarse.
  const limpio = (s) => (s && verificarCifras(s, []).ok ? s : null);
  const necesidad = limpio(pedido.necesidad);
  const pendiente = limpio(pedido.pendiente);
  const producto = pedido.producto ? encontrados.find((p) => p.id === pedido.producto) : null;
  const lineas = ['Hola, vengo de gorillazmotorbikes.com. Hablé con el asistente de la página y quiero seguir con ustedes.'];
  // Sin etiqueta delante: el modelo ya lo escribe en primera persona.
  if (necesidad) lineas.push('', necesidad);
  if (producto) {
    lineas.push(`Producto: ${producto.name}, ${pesos(precioFinal(producto))} en la tienda (gorillazmotorbikes.com/tienda/${producto.id})`);
  }
  if (pendiente) lineas.push(`Me queda la duda: ${pendiente}`);
  return lineas.join('\n');
}

/**
 * Cifras del texto que salieron de una búsqueda de esta conversación, tal como
 * están escritas. El chat las marca ("Precio de la tienda"); los precios de
 * cursos dichos de memoria no cuentan, porque la marca afirma que hubo búsqueda.
 */
function cifrasBuscadas(texto, encontrados) {
  const buscadas = cifrasDeProductos(encontrados);
  if (!buscadas.length) return [];
  return extraerCifras(texto)
    .filter((c) => buscadas.some((v) => Math.abs(v - c.valor) <= c.tolerancia))
    .map((c) => c.texto);
}

/** Definiciones para la API de Claude. */
function definiciones() {
  return [
    {
      name: 'buscar_producto',
      description:
        'Busca productos en la tienda en línea de Gorillaz (cascos, guantes, indumentaria, repuestos, accesorios, lujos, ' +
        'consumibles, tecnología, carga). Es la ÚNICA fuente de precios de productos: úsala SIEMPRE antes de decir el ' +
        'precio de un producto. "consulta": dos o tres palabras clave en español (por ejemplo "casco naked" o "guantes ' +
        'invierno"). Devuelve hasta 5 productos con nombre, precio y enlace. No confirma disponibilidad. Nunca redondees ' +
        'ni cambies los precios que devuelve.',
      input_schema: {
        type: 'object',
        properties: { consulta: { type: 'string', minLength: 2, maxLength: 60 } },
        required: ['consulta'],
        additionalProperties: false,
      },
    },
    {
      name: 'preparar_whatsapp',
      description:
        'Prepara el botón "Enviárselo a Gorillaz", que abre WhatsApp con un resumen ya escrito para el taller. Úsala ' +
        'cuando la persona quiera agendar, cotizar un servicio, comprar, o pida hablar con alguien del taller. El mensaje ' +
        'lo envía la persona, así que escribe en PRIMERA persona, como si ella le escribiera al taller ("Tengo una Pulsar ' +
        '200 y necesito cambio de aceite...", nunca "Quiere..."). "necesidad": qué necesita, en una o dos frases, con la ' +
        'moto si la mencionó, SIN precios ni cifras de dinero. "pendiente": la duda que le quedó, en primera persona, si ' +
        'la hay. "producto_id": el id de un producto que salió en buscar_producto, si la persona lo quiere comprar (el ' +
        'sistema agrega el precio). No incluyas nombres, teléfonos, correos ni placas.',
      input_schema: {
        type: 'object',
        properties: {
          necesidad: { type: 'string', minLength: 3, maxLength: 300 },
          pendiente: { type: 'string', maxLength: 300 },
          producto_id: { type: 'string', maxLength: 80 },
        },
        required: ['necesidad'],
        additionalProperties: false,
      },
    },
  ];
}

module.exports = {
  EntradaInvalida,
  MAX_RESULTADOS,
  normalizar,
  precioFinal,
  buscarProductos,
  resultadoParaModelo,
  cifrasDeProductos,
  pedidoWhatsapp,
  mensajeWhatsapp,
  cifrasBuscadas,
  definiciones,
};
