// Micrófono de la página de voz del mecánico (/taller/voz).
//
// Funciona como la nota de voz de WhatsApp: graba mientras se mantiene
// presionado, se cancela deslizando el dedo a la izquierda y al soltar envía
// lo transcrito al asistente (public/js/panel-ia.js → window.PanelIA).
//
// La transcripción la hace el propio navegador (SpeechRecognition, gratis;
// Chrome en Android). No se graba ni se sube audio a ningún servidor nuestro.
//
// Lo que aprendimos en Android (por eso el código es así):
//  - El dictado se corta solo tras una pausa o tras la primera frase aunque se
//    pida `continuous`, y a veces el reinicio falla ("aborted", "InvalidState").
//    La grabación la manda el DEDO, no el dictado: mientras el dedo siga
//    abajo, se vuelve a escuchar con reintentos y se juntan los pedazos.
//  - El navegador puede cancelar un puntero (pulsación larga del sistema, aviso
//    de permiso). Con el dedo se usan eventos táctiles con preventDefault, y una
//    cancelación NO cuenta como soltar: solo levantar el dedo detiene.
(function () {
  'use strict';

  const raiz = document.getElementById('pia');
  const mic = document.getElementById('tvMic');
  const campo = document.getElementById('piaCampo');
  const panel = document.getElementById('tvGrabando');
  const tiempo = document.getElementById('tvTiempo');
  const parcial = document.getElementById('tvParcial');
  if (!raiz || !mic) return;

  const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
  const UMBRAL_CANCELAR = 80; // px a la izquierda
  const MIN_MS = 350; // un toque corto no es una nota de voz
  const MAX_MS = 90 * 1000; // tope de una nota
  const ESPERA_REINICIO = 180;

  const nota = (t, aviso) => window.PanelIA && window.PanelIA.nota(t, aviso);

  // Botón de enviar solo cuando hay texto escrito (como WhatsApp).
  const marcarTexto = () => raiz.classList.toggle('tv-con-texto', campo.value.trim().length > 0);
  campo.addEventListener('input', marcarTexto);
  document.getElementById('piaCaja').addEventListener('submit', () => setTimeout(marcarTexto, 0));
  raiz.querySelectorAll('.pia-atajo[data-completar]').forEach((b) => b.addEventListener('click', () => setTimeout(marcarTexto, 0)));

  if (!Reconocimiento) {
    mic.disabled = true;
    mic.setAttribute('aria-label', 'El dictado por voz no está disponible en este navegador');
    setTimeout(() => nota('Este navegador no permite dictar. Escribe la petición (en Android funciona con Chrome).', true), 300);
    return;
  }

  // ── Estado ────────────────────────────────────────────────────────────────
  let sosteniendo = false; // lo manda el dedo
  let cancelar = false;
  let inicioX = 0;
  let inicioT = 0;
  let reloj = null;
  let tope = null;
  let rec = null; // sesión de dictado viva
  let escuchando = false;
  let reintento = null;
  let finales = '';
  let provisional = '';
  let enviarAlTerminar = false;

  const texto = () => `${finales} ${provisional}`.replace(/\s+/g, ' ').trim();

  function pintarTiempo() {
    const s = Math.floor((Date.now() - inicioT) / 1000);
    tiempo.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function pintarCancelar(si) {
    mic.classList.toggle('is-cancelar', si);
    panel.classList.toggle('is-cancelar', si);
  }

  // ── Dictado ───────────────────────────────────────────────────────────────
  function escuchar() {
    clearTimeout(reintento);
    if (!sosteniendo || escuchando) return;
    const r = new Reconocimiento();
    r.lang = 'es-CO';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (ev) => {
      provisional = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finales += ` ${res[0].transcript}`;
        else provisional += ` ${res[0].transcript}`;
      }
      parcial.textContent = texto() || 'Escuchando…';
    };
    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        nota('Sin permiso para usar el micrófono. Actívalo en los ajustes del navegador para este sitio.', true);
        cancelar = true;
        terminar();
      } else if (ev.error === 'network') {
        nota('El dictado necesita internet. Revisa la conexión.', true);
      }
      // 'no-speech', 'aborted', 'audio-capture': se reintenta en onend si el dedo sigue abajo.
    };
    r.onend = () => {
      escuchando = false;
      rec = null;
      // Lo que quedó a medias en esta sesión se conserva para la siguiente.
      if (provisional) { finales += ` ${provisional}`; provisional = ''; }
      if (sosteniendo) {
        reintento = setTimeout(escuchar, ESPERA_REINICIO);
      } else if (enviarAlTerminar) {
        enviarAlTerminar = false;
        enviar();
      }
    };
    try {
      r.start();
      rec = r;
      escuchando = true;
    } catch {
      // Android a veces no deja arrancar de inmediato: se reintenta.
      reintento = setTimeout(escuchar, ESPERA_REINICIO * 2);
    }
  }

  // ── Dedo / mouse ───────────────────────────────────────────────────────────
  async function permisoListo() {
    try {
      if (!navigator.permissions) return true;
      const p = await navigator.permissions.query({ name: 'microphone' });
      if (p.state !== 'prompt') return true;
    } catch {
      return true;
    }
    // Primer uso: el aviso de permiso interrumpe el toque, así que este toque
    // solo pide el permiso y el siguiente ya graba.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      nota('Listo. Ahora mantén presionado el micrófono mientras hablas.');
    } catch {
      nota('Sin permiso para usar el micrófono. Actívalo en los ajustes del navegador para este sitio.', true);
    }
    return false;
  }

  async function empezar(x) {
    if (sosteniendo) return;
    if (window.PanelIA && (window.PanelIA.ocupado() || !window.PanelIA.disponible())) {
      nota(window.PanelIA.ocupado() ? 'Espera a que termine la respuesta anterior.' : 'El asistente no está disponible ahora.', true);
      return;
    }
    sosteniendo = true;
    cancelar = false;
    enviarAlTerminar = false;
    finales = '';
    provisional = '';
    inicioX = x;
    inicioT = Date.now();
    if (!(await permisoListo())) {
      sosteniendo = false;
      return;
    }
    if (!sosteniendo) return; // soltó mientras se revisaba el permiso
    parcial.textContent = 'Escuchando…';
    panel.hidden = false;
    mic.classList.add('is-grabando');
    pintarCancelar(false);
    pintarTiempo();
    reloj = setInterval(pintarTiempo, 250);
    tope = setTimeout(() => soltar(inicioX), MAX_MS);
    if (navigator.vibrate) navigator.vibrate(15);
    escuchar();
  }

  function mover(x) {
    if (!sosteniendo) return;
    pintarCancelar(inicioX - x > UMBRAL_CANCELAR);
  }

  function soltar(x) {
    if (!sosteniendo) return;
    sosteniendo = false;
    if (inicioX - x > UMBRAL_CANCELAR) cancelar = true;
    if (Date.now() - inicioT < MIN_MS) {
      cancelar = true;
      nota('Mantén presionado el micrófono mientras hablas.', true);
    }
    terminar();
  }

  function terminar() {
    sosteniendo = false;
    clearInterval(reloj);
    clearTimeout(tope);
    clearTimeout(reintento);
    parcial.textContent = cancelar ? 'Cancelado' : 'Transcribiendo…';
    if (rec && escuchando) {
      // stop() deja llegar los últimos resultados; el envío ocurre en onend.
      enviarAlTerminar = !cancelar;
      try { rec.stop(); } catch { enviarAlTerminar = false; enviar(); }
      // Por si el navegador nunca avisa el fin.
      setTimeout(() => { if (enviarAlTerminar) { enviarAlTerminar = false; enviar(); } }, 2500);
    } else {
      enviar();
    }
  }

  function enviar() {
    panel.hidden = true;
    mic.classList.remove('is-grabando');
    pintarCancelar(false);
    if (cancelar) return;
    const dicho = texto();
    if (!dicho) {
      nota('No entendí nada. Intenta de nuevo, hablando cerca del celular.', true);
      return;
    }
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
    window.PanelIA.preguntar(dicho);
  }

  // Táctil: eventos de toque con preventDefault (sin menú de pulsación larga ni
  // cancelaciones del navegador). El seguimiento va en window para no perder el
  // final si el dedo se sale del botón.
  let dedo = null;
  mic.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (dedo !== null) return;
    const t = e.changedTouches[0];
    dedo = t.identifier;
    empezar(t.clientX);
  }, { passive: false });
  const buscarDedo = (e) => [...e.changedTouches].find((t) => t.identifier === dedo);
  window.addEventListener('touchmove', (e) => {
    const t = buscarDedo(e);
    if (t) { e.preventDefault(); mover(t.clientX); }
  }, { passive: false });
  const finDedo = (e) => {
    const t = buscarDedo(e);
    if (!t) return;
    dedo = null;
    soltar(t.clientX);
  };
  window.addEventListener('touchend', finDedo);
  // touchcancel solo llega si el sistema roba el toque (llamada, cambio de app):
  // se trata como soltar para no dejar el micrófono abierto.
  window.addEventListener('touchcancel', finDedo);

  // Mouse (computador): punteros que no sean táctiles.
  mic.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    empezar(e.clientX);
  });
  window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') mover(e.clientX); });
  window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') soltar(e.clientX); });
  mic.addEventListener('contextmenu', (e) => e.preventDefault());

  // Si la página se oculta grabando (bloqueo de pantalla, otra app), se cancela.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && sosteniendo) {
      cancelar = true;
      terminar();
    }
  });
})();
