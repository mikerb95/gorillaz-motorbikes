// Menú flotante del KDS: botón único en la esquina inferior derecha que
// despliega 5 acciones del panel de taller sobre la pantalla naranja de cara
// al cliente. El menú se abre libremente; cada acción gatea su propio acceso
// (PIN o sesión de empleado) igual que el resto del KDS — no aquí.
(function () {
  // Páginas que embeben el FAB pueden registrar handlers reales antes de que
  // este script corra (window.KdsFab.cotizacion = fn, .tv = fn, .capacitaciones
  // = fn); sin handler registrado, la acción muestra "Próximamente".
  function runHook(name) {
    const hooks = window.KdsFab || {};
    if (typeof hooks[name] === 'function') return hooks[name]();
    toast('Próximamente');
  }

  // Iconos de trazo propios (los emojis cambian de dibujo según la tablet y
  // se ven de juguete). Todos en una rejilla de 24 px con el mismo trazo.
  const svg = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICONS = {
    search: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>'),
    receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
    tv: svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    cap: svg('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.4 2.7 3 6 3s6-1.6 6-3v-5"/>'),
    expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    wrench: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a1.4 1.4 0 0 0 0 2l1 1a1.4 1.4 0 0 0 2 0l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.3-.5-.5-2.3z"/>'),
  };

  const ACTIONS = [
    { icon: ICONS.search, label: 'Buscar Placa', run: () => { window.location.href = '/kds/placa'; } },
    { icon: ICONS.receipt, label: 'Crear Cotización', run: () => runHook('cotizacion') },
    { icon: ICONS.tv, label: 'Control remoto TV', run: () => runHook('tv') },
    { icon: ICONS.cap, label: 'Capacitaciones', run: () => runHook('capacitaciones') },
    { icon: ICONS.expand, label: 'Pantalla completa', run: () => { if (window.KdsFullscreen) window.KdsFullscreen.toggle(); } },
  ];

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.kds-fab-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'kds-fab-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 1800);
  }
  window.KdsFabToast = toast;

  function build() {
    const wrap = document.createElement('div');
    wrap.className = 'kds-fab-wrap';

    const backdrop = document.createElement('div');
    backdrop.className = 'kds-fab-backdrop';

    const menu = document.createElement('div');
    menu.className = 'kds-fab-menu';
    // Se agregan en orden 5→1: el último en el DOM (1, Buscar Placa) queda
    // más cerca del botón principal y el menú se despliega hacia arriba.
    ACTIONS.slice().reverse().forEach((action, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kds-fab-item';
      btn.style.transitionDelay = (i * 25) + 'ms';
      btn.innerHTML = '<span class="kds-fab-icon">' + action.icon + '</span><span class="kds-fab-label">' + action.label + '</span>';
      btn.addEventListener('click', () => {
        close();
        action.run();
      });
      menu.appendChild(btn);
    });

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'kds-fab-main';
    fab.setAttribute('aria-label', 'Panel de taller');
    fab.innerHTML = '<span class="kds-fab-main-icon">' + ICONS.wrench + '</span>';

    function open() { wrap.classList.add('open'); }
    function close() { wrap.classList.remove('open'); }
    function toggle() { wrap.classList.toggle('open'); }

    fab.addEventListener('click', toggle);
    backdrop.addEventListener('click', close);

    wrap.appendChild(backdrop);
    wrap.appendChild(menu);
    wrap.appendChild(fab);
    document.body.appendChild(wrap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
