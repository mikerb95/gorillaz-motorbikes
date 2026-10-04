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

  // Burbuja doble, como la de codebymike.net: el verde y el logo siguen
  // diciendo WhatsApp, y el círculo oscuro con la chispa dice que adentro
  // también hay un asistente con IA. Se arma aquí y no en el HTML porque sin
  // JavaScript la burbuja es solo el enlace a WhatsApp; si la IA resulta no
  // estar disponible, el círculo se quita.
  function burbujaDoble(si) {
    var ia = fab.querySelector('.wa-fab-ia');
    if (!si) {
      if (ia) { ia.remove(); fab.querySelector('.wa-fab-raya').remove(); }
      fab.removeAttribute('data-ia');
      fab.setAttribute('aria-label', 'Contactar por WhatsApp');
      return;
    }
    if (ia) return;
    var raya = el('span', 'wa-fab-raya');
    raya.setAttribute('aria-hidden', 'true');
    ia = el('span', 'wa-fab-ia');
    ia.setAttribute('aria-hidden', 'true');
    ia.innerHTML =
      '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor">' +
      '<path class="wa-chispa-grande" d="M10.5 5.5C11.1 9.4 13.6 12.4 18 13 13.6 13.6 11.1 16.6 10.5 20.5 9.9 16.6 7.4 13.6 3 13 7.4 12.4 9.9 9.4 10.5 5.5Z"></path>' +
      '<path class="wa-chispa-chica" d="M18.5 2.5C18.8 4 19.3 5.2 21.5 5.5 19.3 5.8 18.8 7 18.5 8.5 18.2 7 17.7 5.8 15.5 5.5 17.7 5.2 18.2 4 18.5 2.5Z"></path>' +
      '</svg>';
    fab.appendChild(raya);
    fab.appendChild(ia);
    fab.setAttribute('data-ia', '');
    fab.setAttribute('aria-label', 'Contacto: WhatsApp o asistente con IA');
  }

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
  // demás, texto plano. La ruta tiene que empezar por letra y venir después de
  // un espacio o paréntesis, para que "04/10/2026" no se vuelva enlace.
  function pintarTexto(nodo, texto) {
    var re = /(^|[\s(])(\/[a-z][a-z0-9\-\/]*[a-z0-9])/g;
    var desde = 0;
    var m;
    while ((m = re.exec(texto))) {
      var inicio = m.index + m[1].length;
      nodo.appendChild(document.createTextNode(texto.slice(desde, inicio)));
      var a = el('a', null, m[2]);
      a.href = m[2];
      nodo.appendChild(a);
      desde = inicio + m[2].length;
    }
    nodo.appendChild(document.createTextNode(texto.slice(desde)));
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
    ocultarGlobo(true);
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

  var consulta = null;
  function consultarDisponible() {
    if (!consulta) {
      consulta = fetch('/asesor', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { disponible: false }; })
        .catch(function () { return { disponible: false }; })
        .then(function (d) {
          disponible = !!(d && d.disponible);
          return disponible;
        });
    }
    return consulta.then(function (si) {
      if (opcionIA) opcionIA.hidden = !si;
      return si;
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
      if (extra && extra.orden) b.appendChild(extra.resultado ? tarjetaOrden(extra.resultado) : formularioOrden(extra));
      if (extra && extra.whatsapp) {
        var a = el('a', 'asesor-wa', 'Enviárselo a Gorillaz por WhatsApp');
        a.href = enlaceWhatsapp(extra.whatsapp);
        a.target = '_blank';
        a.rel = 'noopener';
        b.appendChild(a);
      }
      bajar();
    };
    if (!animar || reducido) { fin(); return b; }
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
    return b;
  }

  // ── Estado de la moto (POST /asesor/orden) ─────────────────────────────
  // La placa y el celular van directo al servidor, nunca a la IA. El
  // resultado se guarda en el extra del mensaje para repintarlo al volver.

  function csrf() {
    return (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  }

  function pesos(n) {
    return '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
  }

  function formularioOrden(extra) {
    var f = el('form', 'asesor-orden');
    var placa = el('input', 'asesor-orden-placa');
    placa.name = 'placa';
    placa.placeholder = 'Placa (ABC12D)';
    placa.maxLength = 7;
    placa.autocomplete = 'off';
    placa.setAttribute('autocapitalize', 'characters');
    placa.setAttribute('aria-label', 'Placa de la moto');
    placa.required = true;
    var digitos = el('input', 'asesor-orden-digitos');
    digitos.name = 'digitos';
    digitos.placeholder = 'Últimos 4 del celular';
    digitos.maxLength = 4;
    digitos.inputMode = 'numeric';
    digitos.pattern = '[0-9]{4}';
    digitos.autocomplete = 'off';
    digitos.setAttribute('aria-label', 'Últimos 4 dígitos del celular registrado en el taller');
    digitos.required = true;
    var ir = el('button', 'asesor-orden-ir', 'Consultar');
    ir.type = 'submit';
    var error = el('p', 'asesor-orden-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    f.appendChild(placa);
    f.appendChild(digitos);
    f.appendChild(ir);
    f.appendChild(error);

    function fallar(texto) {
      error.textContent = texto;
      error.hidden = false;
      ir.disabled = false;
      ir.textContent = 'Consultar';
      bajar();
    }

    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      error.hidden = true;
      ir.disabled = true;
      ir.textContent = 'Consultando…';
      fetch('/asesor/orden', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf() },
        body: JSON.stringify({ placa: placa.value, digitos: digitos.value }),
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; });
        })
        .catch(function () { return { status: 0, d: {} }; })
        .then(function (res) {
          if (res.status === 200 && res.d && res.d.estado) {
            extra.resultado = res.d;
            guardar();
            f.replaceWith(tarjetaOrden(res.d));
            bajar();
            return;
          }
          if (res.status === 404) fallar('No encontramos una orden con esa placa y esos dígitos. Revísalos o escríbele al taller.');
          else if (res.status === 400 && res.d.error === 'placa') fallar('Revisa la placa: son 3 letras y 3 caracteres, por ejemplo ABC12D.');
          else if (res.status === 400) fallar('Escribe los últimos 4 dígitos del celular que diste en el taller.');
          else if (res.status === 429) fallar('Hiciste muchos intentos. Espera 15 minutos o escríbele al taller por WhatsApp.');
          else if (res.status === 403) fallar('La sesión de la página venció. Recárgala e inténtalo de nuevo.');
          else fallar('No pude consultar ahora. Inténtalo de nuevo o escríbele al taller por WhatsApp.');
        });
    });
    return f;
  }

  function tarjetaOrden(o) {
    var c = el('div', 'asesor-orden-card');
    var cab = el('div', 'asesor-orden-cab');
    cab.appendChild(el('span', 'asesor-orden-label', o.orden || 'Tu orden'));
    var estadoClase = o.listo ? ' es-listo' : o.entregado ? ' es-entregado' : '';
    cab.appendChild(el('span', 'asesor-orden-estado' + estadoClase, o.estado));
    c.appendChild(cab);
    if (o.moto) c.appendChild(el('p', 'asesor-orden-moto', o.moto));
    if (o.trabajos && o.trabajos.length) {
      var ul = el('ul', 'asesor-orden-trabajos');
      o.trabajos.forEach(function (t) {
        ul.appendChild(el('li', null, t.nombre + (t.cantidad > 1 ? ' × ' + t.cantidad : '')));
      });
      c.appendChild(ul);
    }
    if (o.comentarios) {
      var nota = el('p', 'asesor-orden-nota');
      nota.appendChild(el('strong', null, 'Comentarios del taller: '));
      nota.appendChild(document.createTextNode(o.comentarios));
      c.appendChild(nota);
    }
    var total = (Number(o.total) || 0) + (o.parqueadero ? o.parqueadero.valor : 0);
    if (o.parqueadero) {
      c.appendChild(el('p', 'asesor-orden-fila', 'Parqueadero: ' + o.parqueadero.dias + ' día' + (o.parqueadero.dias === 1 ? '' : 's') + ', ' + pesos(o.parqueadero.valor)));
    }
    if (total > 0) {
      var fila = el('p', 'asesor-orden-total');
      fila.appendChild(document.createTextNode('Total: '));
      fila.appendChild(el('strong', null, pesos(total)));
      c.appendChild(fila);
    }
    if (o.diasGratisRestantes) {
      c.appendChild(el('p', 'asesor-orden-fila', 'Te quedan ' + o.diasGratisRestantes + ' día' + (o.diasGratisRestantes === 1 ? '' : 's') + ' de parqueadero sin costo.'));
    }
    return c;
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
    var burbuja = agregarBurbuja('usuario', texto, null, false);
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
          var extra = d.whatsapp || d.orden || (d.cifras && d.cifras.length)
            ? { whatsapp: d.whatsapp || null, cifras: d.cifras || [], orden: !!d.orden }
            : null;
          if (extra) estado.extras[estado.mensajes.length - 1] = extra;
          guardar();
          agregarBurbuja('asesor', d.texto, extra, true);
          return;
        }
        // La pregunta no quedó en el historial: vuelve al campo para reintentar.
        burbuja.remove();
        if (!campo.value) campo.value = texto;
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

  // Globo de invitación al asistente, como el de codebymike.net: sale de la
  // burbuja a los 6 s y se va solo a los 8 s (con el puntero encima espera).
  // Solo si la IA está disponible, la persona no está conversando y no lo
  // cerró con la X en esta pestaña. Con la pestaña oculta espera a que vuelva.
  var CLAVE_GLOBO = 'gz-asesor-globo';
  var GLOBO_TEXTO = '¿Dudas con tu moto? Pregúntale a nuestro asistente con IA';
  var GLOBO_ESPERA = 6000;
  var GLOBO_VISIBLE = 8000;
  var globo = null;
  var globoReloj = null;

  function globoCerradoAntes() {
    try { return sessionStorage.getItem(CLAVE_GLOBO) === '1'; } catch (_) { return false; }
  }

  function construirGlobo() {
    globo = el('div', 'asesor-globo');
    globo.hidden = true;
    var abrir = el('button', 'asesor-globo-texto');
    abrir.type = 'button';
    abrir.setAttribute('aria-label', GLOBO_TEXTO);
    var palabras = el('span');
    palabras.setAttribute('aria-hidden', 'true');
    GLOBO_TEXTO.split(' ').forEach(function (p, i) {
      var s = el('span', 'asesor-globo-palabra', p);
      s.style.setProperty('--i', i);
      palabras.appendChild(s);
      palabras.appendChild(document.createTextNode(' '));
    });
    abrir.appendChild(palabras);
    abrir.addEventListener('click', function () {
      mostrar();
      if (disponible) abrirChat();
    });
    var cerrar = el('button', 'asesor-globo-cerrar', '×');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar el aviso');
    cerrar.addEventListener('click', function () {
      try { sessionStorage.setItem(CLAVE_GLOBO, '1'); } catch (_) { /* sin almacenamiento: solo esta vez */ }
      ocultarGlobo(false);
    });
    globo.appendChild(abrir);
    globo.appendChild(cerrar);
    globo.addEventListener('pointerenter', function () { clearTimeout(globoReloj); });
    globo.addEventListener('pointerleave', function () {
      if (!globo.hidden && !globo.hasAttribute('data-saliendo')) programarSalidaGlobo(3000);
    });
    document.body.appendChild(globo);
  }

  function programarSalidaGlobo(ms) {
    clearTimeout(globoReloj);
    globoReloj = setTimeout(function () { ocultarGlobo(false); }, ms);
  }

  function mostrarGlobo() {
    if (document.hidden) {
      document.addEventListener('visibilitychange', function () { setTimeout(mostrarGlobo, 1500); }, { once: true });
      return;
    }
    if ((panel && !panel.hidden) || estado.mensajes.length || globoCerradoAntes()) return;
    if (getComputedStyle(fab).display === 'none') return;
    consultarDisponible().then(function (si) {
      if (!si || (panel && !panel.hidden)) return;
      if (!globo) construirGlobo();
      globo.hidden = false;
      fab.setAttribute('data-globo', '');
      programarSalidaGlobo(GLOBO_VISIBLE);
    });
  }

  /** `ya`: sin animación de salida, porque lo reemplaza el panel. */
  function ocultarGlobo(ya) {
    clearTimeout(globoReloj);
    if (!globo || globo.hidden) return;
    fab.removeAttribute('data-globo');
    if (ya || reducido) {
      globo.hidden = true;
      globo.removeAttribute('data-saliendo');
      return;
    }
    globo.setAttribute('data-saliendo', '');
    setTimeout(function () {
      globo.hidden = true;
      globo.removeAttribute('data-saliendo');
    }, 220);
  }

  burbujaDoble(true);
  consultarDisponible().then(burbujaDoble);
  setTimeout(mostrarGlobo, GLOBO_ESPERA);
})();
