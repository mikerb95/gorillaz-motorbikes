// Menú flotante del KDS: botón único en la esquina inferior derecha que
// despliega 5 acciones del panel de taller sobre la pantalla naranja de cara
// al cliente. El menú se abre libremente; cada acción gatea su propio acceso
// (PIN o sesión de empleado) igual que el resto del KDS — no aquí.
(function () {
  const ACTIONS = [
    { icon: '🔎', label: 'Buscar Placa', run: () => { window.location.href = '/kds/placa'; } },
    { icon: '🧾', label: 'Crear Cotización', run: () => toast('Próximamente') },
    { icon: '📺', label: 'Control remoto TV', run: () => toast('Próximamente') },
    { icon: '🎓', label: 'Capacitaciones', run: () => toast('Próximamente') },
    { icon: '⛶', label: 'Pantalla completa', run: () => { if (window.KdsFullscreen) window.KdsFullscreen.toggle(); } },
  ];

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.kds-fab-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'kds-fab-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 1800);
  }

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
    fab.innerHTML = '<span class="kds-fab-main-icon">🔧</span>';

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
