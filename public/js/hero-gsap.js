// Ken Burns + hero content entrance + parallax for home hero
// Requires: gsap.min.js + ScrollTrigger.min.js loaded before this file

window.__gsapHero = true;
document.documentElement.classList.add('gsap-hero');

document.addEventListener('DOMContentLoaded', () => {
  const hero = document.querySelector('.hero[data-slideshow]');
  if (!hero || typeof gsap === 'undefined') return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let slidesSrc;
  try { slidesSrc = JSON.parse(hero.getAttribute('data-slideshow') || '[]'); } catch { slidesSrc = []; }
  if (!slidesSrc.length) return;

  const container = hero.querySelector('.hero-slides');
  const content   = hero.querySelector('.hero-content');

  // Build slide elements
  const slides = slidesSrc.map(src => {
    const el = document.createElement('div');
    el.className = 'hero-slide';
    el.style.cssText = `background-image:url('${src}');opacity:0;transform-origin:center center`;
    container.appendChild(el);
    return el;
  });

  const INTERVAL    = 6;   // seconds between slides
  const FADE_DUR    = 1.2; // crossfade duration
  const KB_SCALE    = 1.07; // Ken Burns end scale

  let current = 0;

  const showSlide = (idx, prevIdx) => {
    const el = slides[idx];
    gsap.killTweensOf(el);
    gsap.set(el, { scale: 1 });
    gsap.to(el, { opacity: 1, duration: FADE_DUR, ease: 'power2.inOut' });
    if (!reduced) {
      gsap.to(el, { scale: KB_SCALE, duration: INTERVAL + FADE_DUR, ease: 'none' });
    }
    if (prevIdx !== null && slides[prevIdx]) {
      gsap.to(slides[prevIdx], { opacity: 0, duration: FADE_DUR, ease: 'power2.inOut' });
    }
  };

  showSlide(0, null);
  setInterval(() => {
    const prev = current;
    current = (current + 1) % slides.length;
    showSlide(current, prev);
  }, INTERVAL * 1000);

  // Hero content entrance
  if (content && !reduced) {
    const heading = content.querySelector('h2');
    const btnRow  = content.querySelector('.btn-row');
    const tl = gsap.timeline({ delay: 0.5 });
    if (heading) tl.fromTo(heading, { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' });
    if (btnRow)  tl.fromTo(btnRow,  { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, '-=0.35');
  } else if (content && reduced) {
    gsap.set(content, { opacity: 1, y: 0 });
  }

  // Parallax: background moves slower than scroll
  if (typeof ScrollTrigger !== 'undefined' && !reduced) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.to(container, {
      yPercent: 18,
      ease: 'none',
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: 'bottom top',
        scrub: true
      }
    });
  }
});
