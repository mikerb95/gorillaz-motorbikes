// Resolución adaptativa para WebGL (sin DOM).
//
// Un shader a pantalla completa cuesta por píxel. En un portátil viejo o un
// móvil barato, dibujar a devicePixelRatio 2 puede bajar a 30 fps. Este
// gobernador mide el tiempo entre cuadros y baja la escala del canvas cuando
// va lento, y la sube despacio cuando sobra margen. La histéresis (bajar
// rápido, subir lento, enfriamiento tras cada cambio) evita que la imagen
// "respire" cambiando de nitidez cada segundo.

export function createResolutionGovernor({
  min = 0.5,
  max = 2,
  start = max,
  targetMs = 1000 / 58,
  windowSize = 24,
  step = 0.15,
  cooldown = 45,
} = {}) {
  let scale = Math.min(max, Math.max(min, start));
  let samples = [];
  let wait = 0;

  return {
    get scale() {
      return scale;
    },
    /**
     * Registra el tiempo de un cuadro. Devuelve la escala nueva si cambió,
     * o null si se mantiene. Ignora cuadros absurdos (pestaña en segundo
     * plano, pausa del depurador) para no castigar la resolución por ellos.
     */
    sample(dtMs) {
      if (!(dtMs > 0) || dtMs > 250) return null;
      samples.push(dtMs);
      if (samples.length > windowSize) samples.shift();
      if (wait > 0) {
        wait--;
        return null;
      }
      if (samples.length < windowSize) return null;
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      let next = scale;
      if (avg > targetMs * 1.2) next = Math.max(min, scale - step);
      else if (avg < targetMs * 0.75) next = Math.min(max, scale + step / 2);
      if (Math.abs(next - scale) < 1e-6) return null;
      scale = Math.round(next * 100) / 100;
      samples = [];
      wait = cooldown;
      return scale;
    },
  };
}
