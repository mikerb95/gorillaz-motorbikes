'use strict';
// Modelo SIMULADO del asistente del panel, para Playwright y pruebas manuales
// sin gastar API. Lo activa PANEL_IA_MODELO_FALSO=1 y solo fuera de producción
// (motor.js lo ignora en Vercel). Responde con guiones fijos según la pregunta:
//
//  - "ingreso ... placa X" → propone crear_orden_servicio con un ítem fijo.
//  - "comenta ..."        → buscar_ordenes y propone comentar_orden en la primera.
//  - "precio ... a N"     → buscar_productos y propone editar_precio_producto.
//  - cualquier otra cosa  → resumen_ordenes y responde con un conteo.
//
// Devuelve mensajes con la misma forma que la API (content, stop_reason, usage).

let contador = 0;
const id = () => `toolu_falso_${Date.now().toString(36)}_${++contador}`;
const USO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

const texto = (t) => ({ role: 'assistant', content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: USO });
const herramienta = (name, input, previo = 'Reviso el panel.') => ({
  role: 'assistant',
  content: [{ type: 'text', text: previo }, { type: 'tool_use', id: id(), name, input }],
  stop_reason: 'tool_use',
  usage: USO,
});

function preguntaDelTurno(mensajes) {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const t = m.content.find((b) => b.type === 'text');
    if (t && !t.text.startsWith('[')) return t.text;
  }
  return '';
}

function ultimoUso(mensajes) {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const u = m.content.find((b) => b.type === 'tool_use');
      if (u) return u;
    }
  }
  return null;
}

async function llamar(mensajes) {
  const ultimo = mensajes[mensajes.length - 1];
  const pregunta = preguntaDelTurno(mensajes).toLowerCase();
  const resultado = Array.isArray(ultimo.content) ? ultimo.content.find((b) => b.type === 'tool_result') : null;

  if (!resultado) {
    if (pregunta.includes('ingreso')) {
      const placa = (pregunta.match(/placa\s+([a-z0-9 ]{5,8}?)(?:,|\s|$)/) || [])[1] || 'AAA11A';
      return herramienta('crear_orden_servicio', {
        placa: placa.replace(/\s/g, '').toUpperCase(),
        moto: 'Moto de prueba',
        items: [{ nombre: 'Cambio de aceite', tipo: 'service', precio: 45000, cantidad: 1 }],
      }, 'Preparé el ingreso.');
    }
    if (pregunta.includes('comenta')) return herramienta('buscar_ordenes', {}, 'Busco la orden.');
    if (pregunta.includes('precio')) {
      const m = pregunta.match(/precio de(l)?\s+(.+?)\s+a\s+/);
      return herramienta('buscar_productos', { texto: m ? m[2] : '' }, 'Busco el producto.');
    }
    return herramienta('resumen_ordenes', {});
  }

  const uso = ultimoUso(mensajes);
  if (resultado.is_error) {
    if (String(resultado.content).includes('no aprobó')) return texto('Entendido, no hice el cambio. ¿Qué quieres ajustar?');
    return texto(`No pude completarlo: ${resultado.content}`);
  }
  const datos = JSON.parse(resultado.content);

  switch (uso && uso.name) {
    case 'resumen_ordenes': {
      const total = (datos.porEstado || []).reduce((s, e) => s + e.cantidad, 0);
      return texto(`Hay **${total}** órdenes en el panel. [Ver órdenes](${datos.enlace})`);
    }
    case 'buscar_ordenes': {
      const o = (datos.ordenes || [])[0];
      if (!o) return texto('No encontré órdenes.');
      const comentario = pregunta.replace(/^.*?comenta(r)?( que)?\s*/, '') || 'Comentario de prueba';
      return herramienta('comentar_orden', { orden: o.id, comentario }, 'Te dejo el comentario para aprobar.');
    }
    case 'buscar_productos': {
      const p = (datos.productos || [])[0];
      if (!p) return texto('No encontré ese producto.');
      const n = pregunta.match(/a\s+([\d.]+)\s*$/);
      const precio = n ? Number(n[1].replace(/\./g, '')) : p.precio.valor + 1000;
      return herramienta('editar_precio_producto', { producto: p.id, precio }, 'Preparé el cambio de precio.');
    }
    default:
      if (datos && datos.hecho) return texto(`Listo: ${datos.resumen} [Abrir](${datos.enlace})`);
      return texto('Hecho.');
  }
}

module.exports = { llamar };
