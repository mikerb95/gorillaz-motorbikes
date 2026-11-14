// Cliente del asistente con IA del panel admin (routes/admin-asistente.js).
//
// Seguridad: todo se pinta con nodos y textContent, NUNCA innerHTML (el modelo
// lee textos de terceros y podría devolver HTML). Los enlaces solo se aceptan
// si son rutas relativas del panel (/admin/...).
(function () {
  'use strict';

  const raiz = document.getElementById('pia');
  if (!raiz) return;

  const $ = (sel) => raiz.querySelector(sel);
  const hilo = $('#piaHilo');
  const form = $('#piaCaja');
  const campo = $('#piaCampo');
  const enviarBtn = $('#piaEnviar');
  const nota = $('#piaNota');
  const listaResultados = $('#piaResultados');
  const listaRecientes = $('#piaRecientes');
  const chkTodas = $('#piaTodas');
  const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  const NOTA_BASE = 'Enter para preguntar · Shift+Enter para otra línea. Los cambios siempre piden tu aprobación.';
  const PASOS = {
    resumen_ordenes: 'Revisando cómo va el taller',
    buscar_ordenes: 'Buscando órdenes',
    ver_orden: 'Abriendo la orden',
    buscar_productos: 'Buscando en la tienda',
    ver_producto: 'Abriendo el producto',
    listar_mecanicos: 'Revisando los mecánicos',
    catalogo_servicios: 'Revisando el catálogo de servicios',
    citas_de_hoy: 'Revisando las citas',
    buscar_en_panel: 'Buscando en el menú del panel',
  };

  const estado = { id: null, ocupado: false, iaDisponible: true, soloLectura: false, tarjetaAbierta: null };

  // ── Utilidades de DOM ──────────────────────────────────────────────────────
  function el(tag, attrs, hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    [].concat(hijos || []).flat(Infinity).forEach((h) => {
      if (h === null || h === undefined || h === false) return;
      n.append(h instanceof Node ? h : document.createTextNode(String(h)));
    });
    return n;
  }

  const rutaSegura = (r) => typeof r === 'string' && /^\/admin(?:[/?#][\w\-./?=&#%]*)?$/.test(r);

  // Mini parser: párrafos, listas "- ", **negrita** y [texto](/admin/...).
  function enLinea(texto) {
    const out = [];
    const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let ultimo = 0;
    let m;
    while ((m = re.exec(texto))) {
      if (m.index > ultimo) out.push(texto.slice(ultimo, m.index));
      if (m[1] !== undefined) out.push(el('strong', { text: m[1] }));
      else if (rutaSegura(m[3])) out.push(el('a', { href: m[3], text: m[2] }));
      else out.push(m[2]);
      ultimo = re.lastIndex;
    }
    if (ultimo < texto.length) out.push(texto.slice(ultimo));
    return out;
  }

  function pintarTexto(contenedor, texto) {
    contenedor.replaceChildren();
    const bloques = String(texto || '').split(/\n{2,}/);
    for (const b of bloques) {
      const lineas = b.split('\n');
      if (lineas.every((l) => /^\s*[-•]\s+/.test(l))) {
        contenedor.append(el('ul', {}, lineas.map((l) => el('li', {}, enLinea(l.replace(/^\s*[-•]\s+/, ''))))));
      } else {
        const p = el('p');
        lineas.forEach((l, i) => {
          if (i) p.append(el('br'));
          p.append(...enLinea(l));
        });
        contenedor.append(p);
      }
    }
  }

  function ponerNota(texto, aviso) {
    nota.textContent = texto || NOTA_BASE;
    nota.classList.toggle('is-aviso', !!aviso);
  }

  function ocupar(si) {
    estado.ocupado = si;
    campo.disabled = si || estado.soloLectura;
    enviarBtn.disabled = si || estado.soloLectura;
    raiz.querySelectorAll('.pia-atajo').forEach((b) => { b.disabled = si; });
  }

  function modoChat() {
    raiz.classList.add('is-chat');
  }

  // ── Turnos ────────────────────────────────────────────────────────────────
  function nuevoTurno(pregunta) {
    modoChat();
    const t = {
      nodo: el('div', { class: 'pia-turno' }),
      pasos: el('div', { class: 'pia-pasos' }),
      respuesta: el('div', { class: 'pia-respuesta' }),
      texto: '',
    };
    if (pregunta) t.nodo.append(el('div', { class: 'pia-pregunta', text: pregunta }));
    t.nodo.append(t.pasos, t.respuesta);
    hilo.append(t.nodo);
    return t;
  }

  function escribiendo(t, si) {
    const previo = t.respuesta.querySelector('.pia-escribiendo');
    if (si && !previo && !t.texto) t.respuesta.append(el('span', { class: 'pia-escribiendo', 'aria-label': 'Pensando' }, [el('i'), el('i'), el('i')]));
    if (!si && previo) previo.remove();
  }

  function agregarPaso(t, texto) {
    t.pasos.querySelectorAll('.is-actual').forEach((n) => n.classList.remove('is-actual'));
    t.pasos.append(el('div', { class: 'pia-paso is-actual', text: texto }));
  }

  function fijarRespuesta(t, texto, error) {
    escribiendo(t, false);
    t.texto = texto;
    t.respuesta.classList.toggle('is-error', !!error);
    pintarTexto(t.respuesta, texto);
    t.pasos.querySelectorAll('.is-actual').forEach((n) => n.classList.remove('is-actual'));
  }

  // ── Tarjeta de aprobación ────────────────────────────────────────────────────
  function valor(v, clase) {
    return v === null || v === undefined || v === ''
      ? el('span', { class: `${clase} pia-vacio`, text: 'vacío' })
      : el('span', { class: clase }, clase === 'pia-despues' ? el('mark', { text: v }) : v);
  }

  function tarjeta(p, { soloLectura } = {}) {
    const v = p.vista || {};
    const pie = el('div', { class: 'pia-tarjeta-pie' });
    const nodo = el('div', { class: 'pia-tarjeta', role: 'group', 'aria-label': v.rotulo || 'Propuesta' }, [
      el('div', { class: 'pia-tarjeta-cab' }, [
        el('div', { class: 'pia-tarjeta-rotulo', text: v.rotulo || 'Propuesta de cambio' }),
        el('div', { class: 'pia-tarjeta-titulo', text: v.titulo || p.origen }),
        v.contexto ? el('div', { class: 'pia-tarjeta-contexto', text: v.contexto }) : null,
      ]),
      el('table', { class: 'pia-cambios' }, el('tbody', {}, (v.cambios || []).map((c) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: c.campo }),
          el('td', {}, [c.antes !== null && c.antes !== undefined ? valor(c.antes, 'pia-antes') : null, valor(c.despues, 'pia-despues')]),
        ])))),
      (v.avisos || []).length ? el('div', { class: 'pia-avisos' }, v.avisos.map((a) => el('div', { class: 'pia-aviso', text: a }))) : null,
      pie,
    ]);
    if (soloLectura) {
      pie.append(el('span', { class: 'pia-tarjeta-nota', text: 'Propuesta pendiente de quien hizo la pregunta. Solo lectura.' }));
      return nodo;
    }
    const aprobar = el('button', { type: 'button', class: 'pia-boton is-principal', text: v.boton || 'Aprobar y guardar' });
    const descartar = el('button', { type: 'button', class: 'pia-boton', text: 'Descartar' });
    pie.append(el('span', { class: 'pia-tarjeta-nota', text: v.nota || 'Nada se guarda hasta que apruebes. También puedes escribir abajo qué cambiar.' }), descartar, aprobar);
    const sellar = (texto, clase) => {
      pie.replaceChildren(el('span', { class: `pia-sello ${clase}`, text: texto }));
      estado.tarjetaAbierta = null;
      ponerNota();
    };
    nodo.sellar = sellar;
    aprobar.addEventListener('click', () => decidir(true, nodo));
    descartar.addEventListener('click', () => decidir(false, nodo));
    estado.tarjetaAbierta = nodo;
    ponerNota('Hay una propuesta abierta: apruébala, descártala o escribe qué cambiar.');
    return nodo;
  }

  const horaCorta = () => new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });

  // ── SSE ─────────────────────────────────────────────────────────────────
  async function transmitir(url, cuerpo, t, { alDecidir } = {}) {
    ocupar(true);
    escribiendo(t, true);
    let terminado = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, Accept: 'text/event-stream' },
        body: JSON.stringify(cuerpo),
        credentials: 'same-origin',
      });
      if (!res.ok || !res.body) {
        let msg = 'No se pudo enviar la pregunta.';
        try { msg = (await res.json()).error || msg; } catch { /* no era JSON */ }
        if (res.status === 403) msg = 'La sesión o el token de seguridad expiró. Recarga la página.';
        fijarRespuesta(t, msg, true);
        return;
      }
      const lector = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await lector.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let corte;
        while ((corte = buffer.indexOf('\n\n')) >= 0) {
          const crudo = buffer.slice(0, corte);
          buffer = buffer.slice(corte + 2);
          const linea = crudo.split('\n').find((l) => l.startsWith('data: '));
          if (!linea) continue;
          let ev;
          try { ev = JSON.parse(linea.slice(6)); } catch { continue; }
          if (manejar(ev, t, alDecidir)) terminado = true;
        }
      }
    } catch {
      // Si la conexión se cae, la conversación igual termina en el servidor.
    } finally {
      escribiendo(t, false);
      ocupar(false);
      if (!terminado) {
        const ver = estado.id
          ? el('a', { href: `/admin?c=${encodeURIComponent(estado.id)}`, text: 'Ver el resultado' })
          : null;
        t.respuesta.append(el('p', { class: 'pia-vacia' }, ['Se cortó la conexión. ', ver]));
      }
      cargarRecientes();
      if (!estado.ocupado && !estado.soloLectura) campo.focus();
    }
  }

  // Devuelve true cuando el turno quedó cerrado (fin, error o tarjeta).
  function manejar(ev, t, alDecidir) {
    switch (ev.tipo) {
      case 'conversacion':
        estado.id = ev.id;
        history.replaceState(null, '', `/admin?c=${encodeURIComponent(ev.id)}`);
        return false;
      case 'paso':
        agregarPaso(t, PASOS[ev.herramienta] || 'Consultando el panel');
        return false;
      case 'avance':
        agregarPaso(t, ev.texto);
        return false;
      case 'texto':
        fijarRespuesta(t, ev.texto);
        return false;
      case 'aprobacion':
        escribiendo(t, false);
        t.pasos.querySelectorAll('.is-actual').forEach((n) => n.classList.remove('is-actual'));
        t.nodo.append(tarjeta(ev));
        return true;
      case 'decision':
        if (alDecidir) alDecidir(ev);
        return false;
      case 'fin':
        if (ev.estado === 'fallida') fijarRespuesta(t, ev.error || 'No pude terminar la respuesta.', true);
        else if (!t.texto) fijarRespuesta(t, ev.respuesta || 'Listo.');
        return true;
      case 'error':
        fijarRespuesta(t, ev.mensaje || 'Algo falló.', true);
        if (ev.motivo === 'sin_clave' || ev.motivo === 'sin_presupuesto') {
          estado.iaDisponible = false;
          ponerNota('La IA no está disponible ahora; la caja sigue buscando en el panel.', true);
        }
        if (ev.motivo === 'nueva' || ev.motivo === 'no_encontrada') estado.id = null;
        return true;
      default:
        return false;
    }
  }

  // ── Acciones ───────────────────────────────────────────────────────────────
  function preguntar(texto) {
    const pregunta = String(texto || '').trim();
    if (!pregunta || estado.ocupado || estado.soloLectura) return;
    if (!estado.iaDisponible) {
      ponerNota('La IA no está disponible ahora. Usa los resultados del buscador.', true);
      return;
    }
    cerrarResultados();
    if (estado.tarjetaAbierta) estado.tarjetaAbierta.sellar('Pediste cambios', 'is-no');
    campo.value = '';
    ajustarAlto();
    const t = nuevoTurno(pregunta);
    t.nodo.scrollIntoView({ block: 'start', behavior: 'smooth' });
    transmitir('/admin/asistente', { pregunta, id: estado.id }, t);
  }

  function decidir(aprobado, nodoTarjeta) {
    if (estado.ocupado || !estado.id) return;
    nodoTarjeta.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const t = nuevoTurno(null);
    transmitir('/admin/asistente/decision', { id: estado.id, aprobado }, t, {
      alDecidir(ev) {
        if (!aprobado) nodoTarjeta.sellar('Descartado', 'is-no');
        else if (ev.ok) nodoTarjeta.sellar(`Aprobado, ${horaCorta()}`, 'is-ok');
        else nodoTarjeta.sellar('No se pudo guardar', 'is-error');
      },
    }).then(() => {
      // Si el servidor rechazó la decisión (ya decidida, sin permiso), se sella igual.
      if (nodoTarjeta.querySelector('button')) nodoTarjeta.sellar('Sin cambios', 'is-no');
    });
  }

  // ── Buscador sin IA ───────────────────────────────────────────────────────
  let temporizador = null;
  let activo = -1;
  function cerrarResultados() {
    listaResultados.hidden = true;
    listaResultados.replaceChildren();
    activo = -1;
  }
  async function buscar(q) {
    if (q.length < 2 || estado.ocupado) return cerrarResultados();
    let datos;
    try {
      const r = await fetch(`/admin/asistente/buscar?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
      datos = await r.json();
    } catch {
      return;
    }
    if (campo.value.trim() !== q) return;
    const items = (datos.resultados || []).filter((x) => rutaSegura(x.enlace)).map((x) =>
      el('a', { class: 'pia-resultado', href: x.enlace }, [
        el('span', { class: 'pia-resultado-tipo', text: x.tipo }),
        el('span', { class: 'pia-resultado-titulo', text: x.titulo }),
        x.detalle ? el('span', { class: 'pia-resultado-detalle', text: x.detalle }) : null,
      ]));
    if (estado.iaDisponible && !estado.soloLectura) {
      items.unshift(el('a', { class: 'pia-resultado is-ia', href: '#', onclick: (e) => { e.preventDefault(); preguntar(campo.value); } }, [
        el('span', { class: 'pia-resultado-tipo', text: 'Asistente' }),
        el('span', { class: 'pia-resultado-titulo', text: 'Preguntarle al asistente' }),
        el('span', { class: 'pia-resultado-detalle', text: 'Enter' }),
      ]));
    }
    listaResultados.replaceChildren(...items);
    listaResultados.hidden = items.length === 0 || (items.length === 1 && estado.iaDisponible);
    activo = -1;
  }

  function moverActivo(delta) {
    const items = [...listaResultados.querySelectorAll('.pia-resultado')];
    if (listaResultados.hidden || !items.length) return false;
    activo = (activo + delta + items.length) % items.length;
    items.forEach((n, i) => n.classList.toggle('is-activo', i === activo));
    return true;
  }

  function ajustarAlto() {
    campo.style.height = 'auto';
    campo.style.height = `${Math.min(campo.scrollHeight, 160)}px`;
  }

  campo.addEventListener('input', () => {
    ajustarAlto();
    clearTimeout(temporizador);
    const q = campo.value.trim();
    if (estado.tarjetaAbierta || raiz.classList.contains('is-chat')) return cerrarResultados();
    temporizador = setTimeout(() => buscar(q), 180);
  });
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && moverActivo(1)) return e.preventDefault();
    if (e.key === 'ArrowUp' && moverActivo(-1)) return e.preventDefault();
    if (e.key === 'Escape') return cerrarResultados();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const elegido = listaResultados.querySelector('.pia-resultado.is-activo');
      if (elegido) return elegido.click();
      if (!estado.iaDisponible) {
        const primero = listaResultados.querySelector('.pia-resultado');
        if (primero) return primero.click();
      }
      preguntar(campo.value);
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    preguntar(campo.value);
  });
  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) cerrarResultados();
  });
  raiz.querySelectorAll('.pia-atajo').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.completar) {
      campo.value = b.dataset.completar;
      ajustarAlto();
      campo.focus();
      return;
    }
    preguntar(b.textContent);
  }));

  // ── Recientes ─────────────────────────────────────────────────────────────
  async function cargarRecientes() {
    try {
      const r = await fetch(`/admin/asistente/recientes${chkTodas && chkTodas.checked ? '?todas=1' : ''}`, { credentials: 'same-origin' });
      const { recientes } = await r.json();
      if (!recientes.length) {
        listaRecientes.replaceChildren(el('li', { class: 'pia-vacia', text: 'Todavía no hay conversaciones.' }));
        return;
      }
      listaRecientes.replaceChildren(...recientes.map((c) => el('li', {}, el('a', { href: `/admin?c=${encodeURIComponent(c.id)}` }, [
        el('span', { class: 'pia-reciente-texto', text: c.pregunta }),
        c.estado === 'esperando_aprobacion' ? el('span', { class: 'pia-chip-espera', text: 'Por aprobar' }) : null,
        chkTodas && chkTodas.checked ? el('span', { class: 'pia-reciente-meta', text: c.usuarioNombre }) : null,
      ]))));
    } catch {
      listaRecientes.replaceChildren(el('li', { class: 'pia-vacia', text: 'No se pudieron cargar las conversaciones.' }));
    }
  }
  if (chkTodas) chkTodas.addEventListener('change', cargarRecientes);

  // ── Retomar por ?c= ───────────────────────────────────────────────────────
  async function retomar(id) {
    let c;
    try {
      const r = await fetch(`/admin/asistente/conversacion/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      c = await r.json();
    } catch {
      ponerNota('No encontré esa conversación.', true);
      return;
    }
    estado.id = c.id;
    estado.soloLectura = c.soloLectura;
    for (const turno of c.turnos) {
      const t = nuevoTurno(turno.pregunta);
      turno.pasos.forEach((p) => { if (PASOS[p]) t.pasos.append(el('div', { class: 'pia-paso', text: PASOS[p] })); });
      if (turno.respuesta) fijarRespuesta(t, turno.respuesta);
    }
    const ultimo = hilo.lastElementChild;
    if (c.propuesta && ultimo) ultimo.append(tarjeta(c.propuesta, { soloLectura: c.soloLectura }));
    if (c.estado === 'fallida' && c.error) {
      const t = nuevoTurno(null);
      fijarRespuesta(t, `${c.error} Para seguir, empieza una conversación nueva.`, true);
      estado.id = null;
    }
    if (c.soloLectura) {
      ponerNota(`Conversación de ${c.autor || 'otro admin'}: solo lectura.`, true);
      campo.disabled = true;
      enviarBtn.disabled = true;
    }
  }

  // ── Consumo y topes ─────────────────────────────────────────────────────────
  const consumo = $('#piaConsumo');
  const fmtUsd = (n) => `US$${(Number(n) || 0).toFixed(2).replace('.', ',')}`;
  async function cargarConsumo() {
    if (!consumo) return;
    let d;
    try {
      const r = await fetch('/admin/asistente/consumo', { credentials: 'same-origin' });
      d = await r.json();
      if (!r.ok) throw new Error(d.error);
    } catch {
      consumo.replaceChildren(el('p', { class: 'pia-vacia', text: 'No se pudo leer el consumo.' }));
      return;
    }
    const medidor = (etiqueta, usado, tope) => el('div', { class: 'pia-medidor' }, [
      el('span', {}, [etiqueta, ': ', el('strong', { text: fmtUsd(usado) }), ` de ${fmtUsd(tope)}`]),
      el('div', { class: 'pia-barra' }, el('i', { style: `width:${tope > 0 ? Math.min(100, (usado / tope) * 100) : 100}%` })),
    ]);
    const inEmpresa = el('input', { type: 'number', min: '0', max: '50', step: '0.5', value: d.topes.empresaUsd, 'aria-label': 'Tope diario de todos (USD)' });
    const inUsuario = el('input', { type: 'number', min: '0', max: '50', step: '0.5', value: d.topes.usuarioUsd, 'aria-label': 'Tope diario por admin (USD)' });
    const msg = el('span', { class: 'pia-vacia' });
    const guardar = el('button', { type: 'button', class: 'pia-boton', text: 'Guardar topes' });
    guardar.addEventListener('click', async () => {
      guardar.disabled = true;
      try {
        const r = await fetch('/admin/asistente/topes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ empresaUsd: Number(inEmpresa.value), usuarioUsd: Number(inUsuario.value) }),
          credentials: 'same-origin',
        });
        const j = await r.json();
        msg.textContent = r.ok ? 'Guardado.' : j.error;
        if (r.ok) cargarConsumo();
      } catch {
        msg.textContent = 'No se pudo guardar.';
      } finally {
        guardar.disabled = false;
      }
    });
    const mesTotal = d.porUsuario.reduce((s, u) => s + u.usd, 0);
    consumo.replaceChildren(
      medidor('Hoy, todos', d.hoy.total, d.topes.empresaUsd),
      medidor('Hoy, tú', d.hoy.usuario, d.topes.usuarioUsd),
      el('p', { class: 'pia-vacia', text: `Este mes: ${fmtUsd(mesTotal)} estimado${d.porUsuario.length ? ' (' + d.porUsuario.map((u) => `${u.nombre || 'Admin'} ${fmtUsd(u.usd)}`).join(', ') + ')' : ''}.` }),
      el('div', { class: 'pia-topes' }, [
        el('label', {}, ['Tope diario, todos (USD)', inEmpresa]),
        el('label', {}, ['Tope diario por admin (USD)', inUsuario]),
        guardar,
        msg,
      ]),
    );
  }

  // ── Arranque ──────────────────────────────────────────────────────────────
  (async function iniciar() {
    ponerNota();
    try {
      const r = await fetch('/admin/asistente/estado', { credentials: 'same-origin' });
      const s = await r.json();
      estado.iaDisponible = !!s.disponible;
      if (!s.disponible) {
        ponerNota(s.motivo === 'sin_clave'
          ? 'Por ahora la caja solo busca: falta configurar la clave de la IA.'
          : 'Se alcanzó el tope de gasto de hoy: la caja solo busca hasta mañana.', true);
      }
    } catch { /* se intentará al preguntar */ }
    const c = new URLSearchParams(location.search).get('c');
    if (c) await retomar(c);
    cargarRecientes();
    cargarConsumo();
    if (!estado.soloLectura) campo.focus({ preventScroll: true });
  })();
})();
