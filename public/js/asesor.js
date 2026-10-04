// Burbuja de WhatsApp con asesor de IA (routes/asesor.js, helpers/asesor).
//
// Sin JavaScript la burbuja sigue siendo el enlace a WhatsApp de siempre. Con
// JavaScript, al tocarla abre un panel: WhatsApp primero, y la opción de
// preguntarle a la IA solo si el servidor dice que está disponible (hay clave
// y queda presupuesto del día). WhatsApp nunca queda detrás de la IA.
//
// La conversación vive en sessionStorage (solo esta pestaña) y se reenvía
// completa en cada pregunta. Todo texto del modelo se pinta con textContent:
// es dato no confiable y nunca se interpreta como HTML.
(function () {
  'use strict';

  var fab = document.querySelector('.whatsapp-fab');
  if (!fab || !window.fetch || !window.sessionStorage) return;

  var CLAVE = 'gz-asesor';
  var MAX_PREGUNTAS = 30;
  var MAX_TEXTO = 500;
  var NUMERO = (fab.getAttribute('href').match(/wa\.me\/(\d+)/) || [])[1] || '573213204299';
  var SALUDO =
    'Hola, soy el asistente con IA de Gorillaz Motorbikes. Puedo resolverte dudas de los servicios del taller, ' +
    'la tienda, los cursos y el club. Lo que cotices o agendes te lo confirma el taller por WhatsApp.';
  var SUGERENCIAS = [
    '¿Qué incluye el alistamiento para la tecnomecánica?',
    '¿Cuánto vale un casco?',
    '¿Cómo agendo una cita?',
  ];
  var reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var estado = leer();
  var disponible = null; // null = sin preguntar todavía
  var enviando = false;
  var panel, lista, form, campo, boton, opcionIA, vistaInicio, vistaChat;

  function leer() {
    try {
      var e = JSON.parse(sessionStorage.getItem(CLAVE) || 'null');
      if (e && Array.isArray(e.mensajes)) return { mensajes: e.mensajes, busquedas: e.busquedas || [], extras: e.extras || {} };
    } catch (_) { /* historial corrupto: se empieza de cero */ }
    return { mensajes: [], busquedas: [], extras: {} };
  }

  function guardar() {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (_) { /* sin espacio: sigue en memoria */ }
  }

  function pagina() {
    var p = location.pathname;
    if (/^\/(servicios|mi-orden)/.test(p)) return 'servicios';
    if (/^\/(tienda|carrito|checkout)/.test(p)) return 'tienda';
    if (/^\/cursos/.test(p)) return 'cursos';
    if (/^\/(club|clasificados)/.test(p)) return 'club';
    if (/^\/duplicado-placas/.test(p)) return 'placas';
    return 'sitio';
  }

  function enlaceWhatsapp(texto) {
    return 'https://wa.me/' + NUMERO + (texto ? '?text=' + encodeURIComponent(texto) : '');
  }

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  // Rutas internas del sitio ("/servicios/agendar") como enlaces; todo lo
  // demás, texto plano.
  function pintarTexto(nodo, texto) {
    var partes = texto.split(/(\/[a-z0-9][a-z0-9\-\/]*[a-z0-9])/g);
    for (var i = 0; i < partes.length; i++) {
      if (i % 2 === 1) {
        var a = el('a', null, partes[i]);
        a.href = partes[i];
        nodo.appendChild(a);
      } else if (partes[i]) {
        nodo.appendChild(document.createTextNode(partes[i]));
      }
    }
  }

  function construir() {
    panel = el('div', 'asesor');
    panel.id = 'asesor-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Contacto con Gorillaz Motorbikes');
    panel.hidden = true;

    var cab = el('div', 'asesor-cab');
    var titulo = el('p', 'asesor-titulo');
    titulo.appendChild(el('span', 'asesor-punto'));
    titulo.appendChild(document.createTextNode('Gorillaz Motorbikes'));
    var wa = el('a', 'asesor-wa-cab', 'WhatsApp');
    wa.href = enlaceWhatsapp('');
    wa.target = '_blank';
    wa.rel = 'noopener';
    wa.setAttribute('aria-label', 'Hablar con el taller por WhatsApp');
    var cerrar = el('button', 'asesor-cerrar', '×');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar');
    cerrar.addEventListener('click', ocultar);
    cab.appendChild(titulo);
    cab.appendChild(wa);
    cab.appendChild(cerrar);
    panel.appendChild(cab);

    // Inicio: las dos opciones.
    vistaInicio = el('div', 'asesor-inicio');
    vistaInicio.appendChild(el('p', 'asesor-intro', '¿Cómo te ayudamos?'));
    var opcionWa = el('a', 'asesor-opcion asesor-opcion-wa');
    opcionWa.href = enlaceWhatsapp('');
    opcionWa.target = '_blank';
    opcionWa.rel = 'noopener';
    opcionWa.appendChild(el('strong', null, 'Escribir al taller por WhatsApp'));
    opcionWa.appendChild(el('span', null, 'Te responde una persona del taller.'));
    opcionIA = el('button', 'asesor-opcion asesor-opcion-ia');
    opcionIA.type = 'button';
    opcionIA.hidden = true;
    opcionIA.appendChild(el('strong', null, 'Preguntarle al asistente con IA'));
    opcionIA.appendChild(el('span', null, 'Dudas de servicios, tienda, cursos y club, al instante.'));
    opcionIA.addEventListener('click', abrirChat);
    vistaInicio.appendChild(opcionWa);
    vistaInicio.appendChild(opcionIA);
    panel.appendChild(vistaInicio);

    // Chat.
    vistaChat = el('div', 'asesor-chat');
    vistaChat.hidden = true;
    lista = el('div', 'asesor-lista');
    lista.setAttribute('aria-live', 'polite');
    lista.setAttribute('data-lenis-prevent', '');
    form = el('form', 'asesor-form');
    campo = el('textarea', 'asesor-campo');
    campo.rows = 1;
    campo.maxLength = MAX_TEXTO;
    campo.placeholder = 'Escribe tu pregunta';
    campo.setAttribute('aria-label', 'Tu pregunta');
    boton = el('button', 'asesor-enviar', 'Enviar');
    boton.type = 'submit';
    form.appendChild(campo);
    form.appendChild(boton);
    form.addEventListener('submit', function (ev) { ev.preventDefault(); enviar(campo.value); });
    campo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviar(campo.value); }
    });
    vistaChat.appendChild(lista);
    vistaChat.appendChild(form);
    vistaChat.appendChild(el('p', 'asesor-aviso', 'Respuestas generadas con IA. El taller confirma precios, citas y disponibilidad.'));
    panel.appendChild(vistaChat);

    document.body.appendChild(panel);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !panel.hidden) ocultar(); });
  }

  function mostrar() {
    if (!panel) construir();
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    if (estado.mensajes.length && disponible !== false) abrirChat();
    consultarDisponible();
  }

  function ocultar() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  }

  function consultarDisponible() {
    if (disponible !== null) return;
    fetch('/asesor', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { disponible: false }; })
      .catch(function () { return { disponible: false }; })
      .then(function (d) {
        disponible = !!(d && d.disponible);
        opcionIA.hidden = !disponible;
      });
  }

  function abrirChat() {
    vistaInicio.hidden = true;
    vistaChat.hidden = false;
    if (!lista.childNodes.length) pintarHistorial();
    campo.focus();
  }

  function pintarHistorial() {
    agregarBurbuja('asesor', SALUDO, null, false);
    if (!estado.mensajes.length) {
      var sug = el('div', 'asesor-sugerencias');
      SUGERENCIAS.forEach(function (s) {
        var b = el('button', 'asesor-sugerencia', s);
        b.type = 'button';
        b.addEventListener('click', function () { enviar(s); });
        sug.appendChild(b);
      });
      lista.appendChild(sug);
    }
    estado.mensajes.forEach(function (m, i) {
      agregarBurbuja(m.rol, m.texto, estado.extras[i] || null, false);
    });
    bajar();
  }

  function bajar() { lista.scrollTop = lista.scrollHeight; }

  function agregarBurbuja(rol, texto, extra, animar) {
    var b = el('div', 'asesor-msg asesor-msg-' + rol);
    var cuerpo = el('p', 'asesor-texto');
    b.appendChild(cuerpo);
    lista.appendChild(b);
    var fin = function () {
      cuerpo.textContent = '';
      if (rol === 'asesor') pintarTexto(cuerpo, texto); else cuerpo.textContent = texto;
      if (extra && extra.cifras && extra.cifras.length) b.appendChild(el('span', 'asesor-marca', 'Precio publicado en la tienda'));
      if (extra && extra.whatsapp) {
        var a = el('a', 'asesor-wa', 'Enviárselo a Gorillaz por WhatsApp');
        a.href = enlaceWhatsapp(extra.whatsapp);
        a.target = '_blank';
        a.rel = 'noopener';
        b.appendChild(a);
      }
      bajar();
    };
    if (!animar || reducido) return fin();
    // Efecto de "escribiendo": la respuesta ya pasó la guardia completa en el
    // servidor; aquí solo se revela de a poco.
    var i = 0;
    var paso = Math.max(2, Math.ceil(texto.length / 60));
    (function tick() {
      i += paso;
      if (i >= texto.length) return fin();
      cuerpo.textContent = texto.slice(0, i);
      bajar();
      requestAnimationFrame(tick);
    })();
  }

  function aviso(texto) {
    var b = el('div', 'asesor-msg asesor-msg-sistema');
    b.appendChild(el('p', 'asesor-texto', texto));
    var a = el('a', 'asesor-wa', 'Escribir por WhatsApp');
    a.href = enlaceWhatsapp('');
    a.target = '_blank';
    a.rel = 'noopener';
    b.appendChild(a);
    lista.appendChild(b);
    bajar();
  }

  function preguntasHechas() {
    return estado.mensajes.filter(function (m) { return m.rol === 'usuario'; }).length;
  }

  function enviar(valor) {
    var texto = String(valor || '').trim().slice(0, MAX_TEXTO);
    if (!texto || enviando) return;
    if (preguntasHechas() >= MAX_PREGUNTAS) {
      aviso('Llegaste al máximo de preguntas de esta conversación. Sigue con el taller por WhatsApp.');
      return;
    }
    var sug = lista.querySelector('.asesor-sugerencias');
    if (sug) sug.remove();
    campo.value = '';
    agregarBurbuja('usuario', texto, null, false);
    var mensajes = estado.mensajes.concat([{ rol: 'usuario', texto: texto }]);

    enviando = true;
    boton.disabled = true;
    var escribiendo = el('div', 'asesor-msg asesor-msg-asesor asesor-escribiendo');
    escribiendo.setAttribute('aria-label', 'El asistente está escribiendo');
    escribiendo.appendChild(el('span'));
    escribiendo.appendChild(el('span'));
    escribiendo.appendChild(el('span'));
    lista.appendChild(escribiendo);
    bajar();

    var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
    fetch('/asesor', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ pagina: pagina(), mensajes: mensajes, busquedas: estado.busquedas }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; });
      })
      .catch(function () { return { status: 0, d: {} }; })
      .then(function (res) {
        escribiendo.remove();
        enviando = false;
        boton.disabled = false;
        var d = res.d || {};
        if (res.status === 200 && typeof d.texto === 'string') {
          estado.mensajes = mensajes.concat([{ rol: 'asesor', texto: d.texto }]);
          estado.busquedas = Array.isArray(d.busquedas) ? d.busquedas : estado.busquedas;
          var extra = d.whatsapp || (d.cifras && d.cifras.length) ? { whatsapp: d.whatsapp || null, cifras: d.cifras || [] } : null;
          if (extra) estado.extras[estado.mensajes.length - 1] = extra;
          guardar();
          agregarBurbuja('asesor', d.texto, extra, true);
          return;
        }
        // La pregunta no quedó en el historial: se puede volver a intentar.
        if (res.status === 503) {
          disponible = false;
          aviso('El asistente no está disponible en este momento. Escríbele al taller por WhatsApp y te responden.');
        } else if (res.status === 429) {
          aviso('Hiciste muchas preguntas seguidas. Espera unos minutos o escríbele al taller por WhatsApp.');
        } else if (res.status === 403) {
          aviso('La sesión de la página venció. Recárgala e inténtalo de nuevo, o escríbele al taller por WhatsApp.');
        } else if (res.status === 400 && d.error === 'limite') {
          aviso('Llegaste al máximo de preguntas de esta conversación. Sigue con el taller por WhatsApp.');
        } else {
          aviso('No pude responder ahora. Inténtalo de nuevo o escríbele al taller por WhatsApp.');
        }
      });
  }

  fab.setAttribute('aria-haspopup', 'dialog');
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'asesor-panel');
  fab.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (panel && !panel.hidden) ocultar(); else mostrar();
  });
})();
