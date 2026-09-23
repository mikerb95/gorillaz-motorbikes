// Núcleo de motion compartido entre páginas.
//
// Cualquier página que quiera animaciones importa de aquí en vez de copiar
// utilidades: detección de movimiento reducido, bucles que se pausan solos,
// y el contrato fail-open.
//
// CONTRATO FAIL-OPEN
// El HTML del servidor es el estado final y legible. El CSS solo esconde algo
// (para animarlo después) bajo `.motion-ok .is-armed`, y esas dos clases las
// pone JavaScript justo antes de construir la animación. Si un componente
// lanza un error, `mount` le quita `is-armed` y limpia los estilos en línea de
// los nodos marcados con [data-m], así que lo que quedó a medio esconder
// vuelve a verse. Sin JS o con prefers-reduced-motion nunca se esconde nada.

export const MQ = {
  reduced: '(prefers-reduced-motion: reduce)',
  desktop: '(min-width: 1024px) and (prefers-reduced-motion: no-preference)',
  mobile: '(max-width: 1023.98px) and (prefers-reduced-motion: no-preference)',
};

export const prefersReduced = () => window.matchMedia(MQ.reduced).matches;

/** GSAP y ScrollTrigger vienen como scripts clásicos (vendor fijado). */
export function getGsap() {
  const gsap = window.gsap;
  if (!gsap) return null;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  return gsap;
}

const RESET_PROPS = ['opacity', 'transform', 'visibility', 'clip-path', 'filter', 'translate', 'rotate', 'scale', 'stroke-dashoffset'];

/** Devuelve la visibilidad a todo lo que un componente pudo haber escondido. */
export function disarm(root) {
  root.classList.remove('is-armed');
  root.querySelectorAll('[data-m]').forEach((el) => {
    RESET_PROPS.forEach((p) => el.style.removeProperty(p));
  });
}

/**
 * Monta un componente en cada nodo que cumpla `selector`. El componente
 * recibe el nodo y devuelve (opcional) { destroy }. Cualquier error, síncrono
 * o de una promesa, deja la sección en su estado final del servidor.
 */
export function mount(selector, init, ctx = {}) {
  const apis = [];
  document.querySelectorAll(selector).forEach((root) => {
    const fail = (err) => {
      console.warn('[motion] se desactiva', selector, err);
      try {
        apis.find((a) => a.root === root)?.api?.destroy?.();
      } catch {}
      disarm(root);
      root.dataset.motion = 'failed';
    };
    try {
      const api = init(root, { ...ctx, fail: (e) => fail(e) });
      if (api && typeof api.then === 'function') api.catch(fail);
      else apis.push({ root, api });
      root.dataset.motion = 'on';
    } catch (err) {
      fail(err);
    }
  });
  return apis;
}

/**
 * Bucle requestAnimationFrame que solo corre cuando `el` está en pantalla y
 * la pestaña está visible. `tick(now, dt)` puede devolver false para dormir
 * (p. ej. un péndulo que ya se quedó quieto); `wake()` lo despierta.
 */
export function createLoop(el, tick, { rootMargin = '120px 0px' } = {}) {
  let raf = 0;
  let last = 0;
  let visible = false;
  let wanted = true;
  let destroyed = false;

  const frame = (now) => {
    raf = 0;
    const dt = last ? now - last : 16.7;
    last = now;
    if (tick(now, dt) === false) wanted = false;
    schedule();
  };
  function schedule() {
    if (destroyed) return;
    const run = visible && wanted && !document.hidden;
    if (run && !raf) raf = requestAnimationFrame(frame);
    if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (!run) last = 0;
  }
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting);
      schedule();
    },
    { rootMargin },
  );
  io.observe(el);
  const onVis = () => schedule();
  document.addEventListener('visibilitychange', onVis);

  return {
    get running() {
      return !!raf;
    },
    get visible() {
      return visible;
    },
    wake() {
      wanted = true;
      schedule();
    },
    destroy() {
      destroyed = true;
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/**
 * Pausa una línea de tiempo de GSAP mientras su sección no se ve o la pestaña
 * está oculta. Para animaciones en bucle (no para las atadas al scroll, que ya
 * están quietas si no hay scroll).
 */
export function pauseOffscreen(el, timeline, { rootMargin = '80px 0px' } = {}) {
  let visible = false;
  const apply = () => (visible && !document.hidden ? timeline.resume() : timeline.pause());
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    apply();
  }, { rootMargin });
  io.observe(el);
  document.addEventListener('visibilitychange', apply);
  timeline.pause();
  return () => {
    io.disconnect();
    document.removeEventListener('visibilitychange', apply);
  };
}

/** Promesa que se resuelve cuando la imagen está decodificada (o falla). */
export function imageReady(img) {
  if (!img) return Promise.resolve(null);
  if (img.complete && img.naturalWidth) return img.decode ? img.decode().then(() => img, () => img) : Promise.resolve(img);
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(img), { once: true });
    img.addEventListener('error', () => resolve(null), { once: true });
  });
}
