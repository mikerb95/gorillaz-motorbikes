// Péndulo amortiguado (sin DOM).
//
// Las etiquetas de precio de la tienda cuelgan de un gancho. Cuando el
// visitante hace scroll rápido, la "inercia" las empuja y se mecen hasta
// quedarse quietas. Es física de verdad (no un tween) para que un scroll
// suave las mueva poco y uno brusco las haga oscilar más.

/**
 * Un paso de integración semi-implícita de Euler (estable con dt variable).
 * state = { angle (rad), velocity (rad/s) }; push = aceleración externa (rad/s²).
 */
export function stepPendulum(state, { dt, push = 0, stiffness = 38, damping = 3.2, maxAngle = 0.5 }) {
  const h = Math.min(Math.max(dt, 0), 1 / 20);
  let velocity = state.velocity + (-stiffness * Math.sin(state.angle) - damping * state.velocity + push) * h;
  let angle = state.angle + velocity * h;
  if (angle > maxAngle) {
    angle = maxAngle;
    velocity = Math.min(0, velocity);
  } else if (angle < -maxAngle) {
    angle = -maxAngle;
    velocity = Math.max(0, velocity);
  }
  return { angle, velocity };
}

/** ¿Está prácticamente quieto? Sirve para detener el bucle y ahorrar batería. */
export function atRest(state, eps = 1e-3) {
  return Math.abs(state.angle) < eps && Math.abs(state.velocity) < eps;
}
