// Chaleco del club: coser y descoser parches (views/partials/club/vest.ejs).
//
// Mecanismo propio: la PUNTADA. Cada parche baja grande y ladeado, se asienta
// sobre el cuero (como cuando se prensa antes de coser) y después la tapa del
// color del parche se recorre en sentido horario y destapa las puntadas, como
// si la máquina diera la vuelta al borde. Las insignias no ganadas quedan con
// la marca de tiza que el servidor ya pinta.
//
// Lo que se esconde va en nodos [data-m]: si algo falla, disarm() de core.mjs
// les quita los estilos en línea y el chaleco vuelve al estado del servidor.

export function patchParts(patch) {
  return {
    body: patch.querySelector('.cl-patch-body'),
    cover: patch.querySelector('.cl-patch-cover'),
  };
}

/** Deja un parche sin coser (solo la tiza). */
export function unstitch(gsap, patch) {
  const { body, cover } = patchParts(patch);
  if (!body) return;
  gsap.killTweensOf([body, cover]);
  gsap.set(body, { opacity: 0, scale: 1.4, rotation: -14, transformOrigin: '50% 50%' });
  if (cover) gsap.set(cover, { strokeDashoffset: 0 });
}

/** Cose un parche. Devuelve la línea de tiempo (para encadenar o esperar). */
export function stitch(gsap, patch, { delay = 0, speed = 1 } = {}) {
  const { body, cover } = patchParts(patch);
  const tl = gsap.timeline({ delay });
  if (!body) return tl;
  tl.fromTo(body,
    { opacity: 0, scale: 1.4, rotation: -14, transformOrigin: '50% 50%' },
    { opacity: 1, scale: 1, rotation: 0, duration: 0.32 / speed, ease: 'power3.in' });
  // El golpe del prensado: un rebote corto al tocar el cuero.
  tl.to(body, { scale: 0.94, duration: 0.07 / speed, ease: 'power1.out' });
  tl.to(body, { scale: 1, duration: 0.18 / speed, ease: 'back.out(3)' });
  if (cover) tl.fromTo(cover, { strokeDashoffset: 0 }, { strokeDashoffset: -100, duration: 0.55 / speed, ease: 'none' }, '-=0.12');
  return tl;
}

/** Cambia la pestaña de nivel (texto y color). */
export function setLevelTab(vest, { text, color }) {
  const label = vest.querySelector('.cl-lvl-text');
  const fill = vest.querySelector('.cl-lvl-fill');
  if (label && text != null && label.textContent !== text) label.textContent = text;
  if (fill && color) fill.style.fill = color;
}
