// Protector de pantalla del KDS: tras `idleMs` sin interacción muestra logo,
// hora y citas del día; intenta impedir que la tablet se bloquee (Wake Lock).
// Al despertar: si había una operación en curso (mecánico trabajando en una
// orden) simplemente se retoma; si no, la tablet vuelve a modo kiosco con
// check-in de clientes / acceso al panel admin, hasta que alguien la desbloquee.
(function () {
  const cfg = window.KDS_SCREENSAVER || {};
  const IDLE_MS = cfg.idleMs || 30000;
  const hasActiveOperation = !!cfg.hasActiveOperation;
  const CITAS_URL   = cfg.citasUrl   || '/kds/citas-hoy.json';
  const CHECKIN_URL = cfg.checkinUrl || '/kds/checkin';
  const ADMIN_URL   = cfg.adminUrl   || '/kds/login';
  const LOGO_URL    = cfg.logoUrl    || '/images/nobg_logo/logo_transp.png';

  let idleTimer, clockTimer, citasTimer;
  let overlay = null;
  let homeOverlay = null;

  function buildScreensaver() {
    overlay = document.createElement('div');
    overlay.id = 'kdsScreensaver';
    overlay.className = 'kds-screensaver';
    overlay.innerHTML =
      '<div class="kds-ss-badge" id="kdsSsBadge" hidden></div>' +
      '<div class="kds-ss-logo" style="-webkit-mask-image:url(' + LOGO_URL + ');mask-image:url(' + LOGO_URL + ')" role="img" aria-label="Gorillaz Motorbikes"></div>' +
      '<div class="kds-ss-clock" id="kdsSsClock"></div>' +
      '<div class="kds-ss-hint">Toca la pantalla para continuar</div>' +
      '<button type="button" class="kds-ss-fullscreen-btn" id="kdsSsFullscreenBtn" aria-label="Pantalla completa">⛶</button>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', dismissScreensaver);
    overlay.addEventListener('touchstart', dismissScreensaver, { passive: false });
    const fsBtn = document.getElementById('kdsSsFullscreenBtn');
    fsBtn.addEventListener('click', toggleFullscreen);
    fsBtn.addEventListener('touchstart', toggleFullscreen, { passive: false });
  }

  function toggleFullscreen(e) {
    e.preventDefault();
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  function buildHomeOverlay() {
    homeOverlay = document.createElement('div');
    homeOverlay.id = 'kdsHomeSplit';
    homeOverlay.className = 'kds-home-split';
    homeOverlay.innerHTML =
      '<div class="kds-home-grid">' +
        '<a class="kds-home-half kds-home-checkin" href="' + CHECKIN_URL + '">' +
          '<div class="kds-home-icon">🛵</div>' +
          '<div class="kds-home-title">Check-in de clientes</div>' +
          '<div class="kds-home-sub">Toca aquí para registrar tu ingreso al taller</div>' +
        '</a>' +
        '<a class="kds-home-half kds-home-admin" href="' + ADMIN_URL + '">' +
          '<div class="kds-home-icon">🔐</div>' +
          '<div class="kds-home-title">Panel de producción</div>' +
          '<div class="kds-home-sub">Inicia sesión con tu PIN de mecánico</div>' +
        '</a>' +
      '</div>' +
      '<button type="button" class="kds-home-back" id="kdsHomeBack">Volver al tablero (personal del taller)</button>';
    document.body.appendChild(homeOverlay);
    document.getElementById('kdsHomeBack').addEventListener('click', hideHomeOverlay);
  }

  function tickClock() {
    const el = document.getElementById('kdsSsClock');
    if (!el) return;
    el.textContent = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour12: false });
  }

  async function refreshCitas() {
    const badge = document.getElementById('kdsSsBadge');
    if (!badge) return;
    try {
      const res = await fetch(CITAS_URL);
      const data = await res.json();
      const n = Number(data.count) || 0;
      badge.hidden = false;
      badge.textContent = n === 1 ? '1 cita hoy' : n + ' citas hoy';
    } catch { /* red intermitente: se reintenta en el próximo ciclo */ }
  }

  // Wake Lock evita que la tablet se bloquee sola mientras el KDS está abierto.
  // Se libera automáticamente al ocultar la pestaña, así que se reintenta al volver.
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { await navigator.wakeLock.request('screen'); }
    catch { /* algunos navegadores exigen un gesto del usuario antes de concederlo */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
  requestWakeLock();

  function showScreensaver() {
    if (!overlay) buildScreensaver();
    overlay.classList.add('visible');
    tickClock();
    clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 1000);
    refreshCitas();
    clearInterval(citasTimer);
    citasTimer = setInterval(refreshCitas, 60000);
  }

  function hideScreensaver() {
    if (overlay) overlay.classList.remove('visible');
    clearInterval(clockTimer);
    clearInterval(citasTimer);
  }

  function dismissScreensaver(e) {
    e.preventDefault();
    hideScreensaver();
    if (hasActiveOperation) resetIdleTimer();
    else showHomeOverlay();
  }

  function showHomeOverlay() {
    if (!homeOverlay) buildHomeOverlay();
    homeOverlay.classList.add('visible');
  }

  function hideHomeOverlay() {
    if (homeOverlay) homeOverlay.classList.remove('visible');
    resetIdleTimer();
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(showScreensaver, IDLE_MS);
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, () => {
      const ssVisible   = overlay && overlay.classList.contains('visible');
      const homeVisible = homeOverlay && homeOverlay.classList.contains('visible');
      if (ssVisible || homeVisible) return; // esos casos ya tienen su propio manejo de tap
      resetIdleTimer();
    }, { passive: true });
  });

  resetIdleTimer();
})();
