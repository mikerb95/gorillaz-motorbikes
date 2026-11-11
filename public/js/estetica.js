// /pintura-detailing-wrap: demostración de la cabina.
// La cabina funciona sola con radios + :has() (estetica.css). Esto solo la
// recorre una vez cuando entra en pantalla (así llega → pintura → detailing →
// wrap en varios acabados) y se detiene en cuanto la persona toca algo.
(function () {
  'use strict';
  var cab = document.querySelector('[data-et-cab]');
  if (!cab || !('IntersectionObserver' in window)) return;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) { return; }

  var seq = [
    ['etf-llega', 1400],
    ['etf-pintura', 1700],
    ['etf-detailing', 2200],
    ['etf-wrap', 0], ['etv-mate', 1500],
    ['etv-carbono', 1500],
    ['etv-camaleon', 1800],
    ['etf-detailing', 0],
  ];
  var timer = null;
  var stopped = false;

  function stop() { stopped = true; clearTimeout(timer); }
  ['pointerdown', 'keydown'].forEach(function (ev) { cab.addEventListener(ev, stop, { once: true }); });

  function step(i) {
    if (stopped || i >= seq.length) return;
    var input = document.getElementById(seq[i][0]);
    if (input) input.checked = true;
    timer = setTimeout(function () { step(i + 1); }, seq[i][1]);
  }

  var io = new IntersectionObserver(function (entries) {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    if (!stopped) timer = setTimeout(function () { step(0); }, 600);
  }, { threshold: 0.5 });
  io.observe(cab);
})();
