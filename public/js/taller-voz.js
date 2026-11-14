// Micrófono de la página de voz del mecánico (/taller/voz).
//
// Funciona como la nota de voz de WhatsApp: graba mientras se mantiene
// presionado, se cancela deslizando el dedo a la izquierda y al soltar envía
// lo transcrito al asistente (public/js/panel-ia.js → window.PanelIA).
//
// La transcripción la hace el propio navegador (SpeechRecognition, gratis;
// Chrome en Android). No se graba ni se sube audio a ningún servidor nuestro.
// Si el navegador no lo soporta, el mecánico puede escribir.
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

  let rec = null;
  let grabando = false;
  let cancelado = false;
  let inicioX = 0;
  let inicioT = 0;
  let reloj = null;
  let finales = '';
  let provisional = '';

  function texto() {
    return `${finales} ${provisional}`.replace(/\s+/g, ' ').trim();
  }

  function pintarTiempo() {
    const s = Math.floor((Date.now() - inicioT) / 1000);
    tiempo.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function mostrarGrabando(si) {
    panel.hidden = !si;
    mic.classList.toggle('is-grabando', si);
    if (!si) {
      mic.classList.remove('is-cancelar');
      panel.classList.remove('is-cancelar');
    }
  }

  function empezar(e) {
    if (grabando) return;
    if (window.PanelIA && (window.PanelIA.ocupado() || !window.PanelIA.disponible())) {
      nota(window.PanelIA.ocupado() ? 'Espera a que termine la respuesta anterior.' : 'El asistente no está disponible ahora.', true);
      return;
    }
    e.preventDefault();
    try { mic.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    grabando = true;
    cancelado = false;
    finales = '';
    provisional = '';
    inicioX = e.clientX;
    inicioT = Date.now();
    parcial.textContent = 'Escuchando…';
    mostrarGrabando(true);
    pintarTiempo();
    reloj = setInterval(pintarTiempo, 250);
    if (navigator.vibrate) navigator.vibrate(15);

    rec = new Reconocimiento();
    rec.lang = 'es-CO';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      provisional = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finales += ` ${r[0].transcript}`;
        else provisional += ` ${r[0].transcript}`;
      }
      parcial.textContent = texto() || 'Escuchando…';
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        nota('Sin permiso para usar el micrófono. Actívalo en los ajustes del navegador para este sitio.', true);
        cancelado = true;
      } else if (ev.error === 'no-speech') {
        nota('No te escuché. Mantén presionado y habla cerca del celular.', true);
      } else if (ev.error === 'network') {
        nota('El dictado necesita internet. Revisa la conexión.', true);
        cancelado = true;
      }
    };
    rec.onend = alTerminar;
    try {
      rec.start();
    } catch {
      terminarUi();
      nota('No se pudo iniciar el micrófono. Intenta de nuevo.', true);
    }
  }

  function mover(e) {
    if (!grabando) return;
    const cancelar = inicioX - e.clientX > UMBRAL_CANCELAR;
    mic.classList.toggle('is-cancelar', cancelar);
    panel.classList.toggle('is-cancelar', cancelar);
  }

  function soltar(e) {
    if (!grabando) return;
    try { mic.releasePointerCapture(e.pointerId); } catch { /* ya liberada */ }
    const dur = Date.now() - inicioT;
    if (inicioX - e.clientX > UMBRAL_CANCELAR || e.type === 'pointercancel') cancelado = true;
    if (dur < MIN_MS) {
      cancelado = true;
      nota('Mantén presionado el micrófono mientras hablas.', true);
    }
    grabando = false;
    clearInterval(reloj);
    parcial.textContent = cancelado ? 'Cancelado' : 'Transcribiendo…';
    // stop() deja que lleguen los últimos resultados; el envío ocurre en onend.
    try { rec.stop(); } catch { alTerminar(); }
    setTimeout(() => { if (rec) alTerminar(); }, 2500);
  }

  function terminarUi() {
    grabando = false;
    clearInterval(reloj);
    mostrarGrabando(false);
  }

  function alTerminar() {
    if (!rec) return;
    if (grabando) {
      // El navegador cortó solo (silencio largo): se vuelve a escuchar
      // mientras el dedo siga presionando.
      try { rec.start(); return; } catch { /* sigue abajo */ }
    }
    rec = null;
    terminarUi();
    const dicho = texto();
    if (cancelado) return;
    if (!dicho) {
      nota('No entendí nada. Intenta de nuevo, hablando cerca del celular.', true);
      return;
    }
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
    window.PanelIA.preguntar(dicho);
  }

  mic.addEventListener('pointerdown', empezar);
  mic.addEventListener('pointermove', mover);
  mic.addEventListener('pointerup', soltar);
  mic.addEventListener('pointercancel', soltar);
  mic.addEventListener('contextmenu', (e) => e.preventDefault());
})();
