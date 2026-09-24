// Hero: la cortina metálica del taller se enrolla y descubre el taller real.
//
// POR QUÉ UNA CORTINA: en Bogotá cada taller abre subiendo su cortina. Es la
// forma más directa de decir "esto es un taller de verdad" antes de mostrar la
// foto propia (no de banco de imágenes). La cortina lleva el gorila pintado
// con esténcil, como hacen los locales con su logo.
//
// CÓMO SE DIBUJA: WebGL2 directo, un solo shader a pantalla completa (sin
// Three.js). Por píxel decide si está en la caja del tambor, en la cortina o
// ya en el interior (la foto). Las láminas no son una textura: su perfil
// convexo se calcula en el shader y se ilumina con una luz de arriba, así que
// el brillo recorre cada lámina mientras sube, como el metal real.
//
// EL TEXTO VIVE DETRÁS DE LA CORTINA: el bloque de texto (DOM, accesible) se
// recorta con clip-path en el borde inferior de la cortina. No hay un fundido
// genérico: el texto aparece porque la cortina deja de taparlo.
//
// Rendimiento: el bucle solo corre durante la apertura o mientras hay scroll
// dentro del hero; fuera de pantalla o con la pestaña oculta se detiene
// (createLoop). La resolución se adapta al tiempo de cuadro.
// Fail-open: si WebGL no existe o algo falla, se quita la cortina CSS de
// espera y queda la foto del servidor con su texto.

import { createLoop, getGsap, imageReady } from '../motion/core.mjs?v=1';
import { openingCurve, shutterLayout, shutterEdge, textClipTop } from '../motion/lib/shutter.mjs?v=1';
import { createResolutionGovernor } from '../motion/lib/adaptive.mjs?v=1';

const INTRO_MS = 2600;
const STENCIL_SRC = '/images/landing/cortina-estencil.png';

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;        // tamaño del canvas en píxeles del dispositivo
uniform float uScale;     // píxeles del canvas por píxel CSS
uniform float uEdge;      // borde inferior de la cortina (px CSS desde arriba)
uniform float uHousing;   // borde inferior de la caja del tambor
uniform float uSlat;      // alto de lámina
uniform float uRail;      // alto del perfil inferior
uniform sampler2D uPhoto;
uniform vec2 uPhotoSize;
uniform float uPhotoY;    // object-position vertical de la foto
uniform float uZoom;      // acercamiento con el scroll
uniform sampler2D uStencil;
uniform vec3 uLogo;       // x centro, altura del centro sobre el borde, alto del logo
uniform float uLight;     // lámparas del taller: 0 apagadas, 1 encendidas
uniform float uNarrow;    // 1 en móvil: menos sombra lateral
uniform float uGrainSeed;
out vec4 outColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

vec3 photo(vec2 p, vec2 view) {
  float s = max(view.x / uPhotoSize.x, view.y / uPhotoSize.y) * uZoom;
  vec2 size = uPhotoSize * s;
  vec2 off = (view - size) * vec2(0.5, uPhotoY);
  vec3 c = texture(uPhoto, clamp((p - off) / size, 0.0, 1.0)).rgb;
  // Misma sombra que .lp-hero-shade para que el texto se lea igual con o sin WebGL.
  float ty = p.y / view.y;
  float top = 0.55 * (1.0 - smoothstep(0.0, 0.26, ty));
  float bottom = 0.82 * smoothstep(0.52, 1.0, ty);
  float side = 0.6 * (1.0 - smoothstep(0.0, 0.62, p.x / view.x)) * (1.0 - 0.6 * uNarrow);
  c *= (1.0 - top) * (1.0 - bottom) * (1.0 - side);
  return c;
}

vec3 housing(vec2 p) {
  float t = p.y / uHousing;
  vec3 c = mix(vec3(0.075, 0.08, 0.09), vec3(0.17, 0.18, 0.2), t);
  float lip = smoothstep(uHousing - 5.0, uHousing - 2.0, p.y) * (1.0 - smoothstep(uHousing - 2.0, uHousing, p.y));
  c += vec3(0.28) * lip;
  vec2 r = vec2(mod(p.x, 160.0) - 80.0, p.y - (uHousing - 14.0));
  c += vec3(0.22) * (1.0 - smoothstep(2.2, 3.6, length(r)));
  return c;
}

vec3 curtain(vec2 p, float u, vec2 view) {
  vec3 L = normalize(vec3(-0.28, 0.78, 0.56));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  vec3 base = vec3(0.6, 0.63, 0.67);
  vec3 n;
  float ao = 1.0;
  float plate = 0.0;

  if (u < uRail) {
    // Perfil inferior: plano con chaflán arriba y labio abajo, más oscuro.
    float r = u / uRail;
    float ny = r > 0.82 ? 1.3 : (r < 0.14 ? -1.5 : 0.08);
    n = normalize(vec3(0.0, ny, 1.0));
    base = vec3(0.33, 0.35, 0.38);
    // Platinas de los candados y la manija central.
    float w = view.x;
    for (int i = 0; i < 3; i++) {
      float cx = w * (i == 0 ? 0.18 : (i == 1 ? 0.5 : 0.82));
      float hw = i == 1 ? 38.0 : 22.0;
      vec2 d = abs(vec2(p.x - cx, u - uRail * 0.48)) - vec2(hw, uRail * 0.3);
      float inside = 1.0 - smoothstep(-1.0, 0.5, max(d.x, d.y));
      plate = max(plate, inside);
    }
  } else {
    float v = (u - uRail) / uSlat;
    float idx = floor(v);
    float f = fract(v);
    // Junta entre láminas: una ranura oscura.
    float groove = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.92, 1.0, f));
    // Perfil convexo: la mitad de abajo mira al piso (oscura), la de arriba al
    // cielo (clara). Más una costilla central pequeña.
    float slope = -cos(3.14159 * f) + 0.32 * sin(12.566 * f);
    // Abolladuras: cada lámina se comba un poco distinto a lo ancho.
    slope += (noise(vec2(p.x * 0.0045, idx * 1.7)) - 0.5) * 0.55;
    n = normalize(vec3((noise(vec2(p.x * 0.01, idx)) - 0.5) * 0.25, slope * 1.15, 1.0));
    ao = mix(0.3, 1.0, groove);
    base *= 0.92 + 0.12 * hash(vec2(idx, 3.1));
  }

  // Luz de calle: más fuerte hacia el centro-izquierda, cae hacia los lados.
  float key = 0.78 + 0.32 * (1.0 - smoothstep(0.0, 0.75, abs(p.x / view.x - 0.42)));
  float diff = max(dot(n, L), 0.0) * key;
  float spec = pow(max(dot(n, H), 0.0), 70.0) * key;

  // Esténcil pintado: se mueve con la cortina porque vive en coordenadas de la cortina.
  vec2 suv = vec2((p.x - uLogo.x) / (uLogo.z * 4.0 / 3.0) + 0.5, (uLogo.y - u) / uLogo.z + 0.5);
  float inBox = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
  float paint = texture(uStencil, suv).r * inBox;
  paint = smoothstep(0.32, 0.7, paint + (noise(p * 0.45) - 0.5) * 0.3);
  paint *= step(0.14, noise(p * 0.06 + 11.0));

  vec3 metal = base * (0.26 + 0.92 * diff) * ao + vec3(spec * 0.6 * ao);
  vec3 painted = vec3(0.93, 0.34, 0.03) * (0.38 + 0.72 * diff) * ao + vec3(spec * 0.1);
  vec3 c = mix(metal, painted, paint);
  c = mix(c, vec3(0.12, 0.13, 0.14) * (0.5 + diff), plate * 0.85);

  // Mugre: más abajo (las láminas que tocan el piso) y chorreones verticales.
  float grime = (1.0 - smoothstep(0.0, uSlat * 5.0, u)) * 0.3 + noise(vec2(p.x * 0.011, u * 0.0025)) * 0.1;
  // Chorreones de óxido: pocos, desde abajo, de ancho irregular.
  float streak = smoothstep(0.8, 0.95, noise(vec2(p.x * 0.045, 7.0))) * (1.0 - smoothstep(0.0, uSlat * 9.0, u));
  c = mix(c, c * vec3(0.72, 0.5, 0.36), streak * 0.55);
  c *= 1.0 - grime;
  c += smoothstep(0.985, 1.0, noise(vec2(p.x * 0.006, u * 0.8))) * 0.18;
  // Sombra de la caja sobre las primeras láminas.
  c *= mix(0.45, 1.0, smoothstep(uHousing, uHousing + 22.0, p.y));
  return c;
}

void main() {
  vec2 view = uRes / uScale;
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec3 c;
  if (p.y < uHousing) {
    c = housing(p);
  } else if (p.y < uEdge) {
    c = curtain(p, uEdge - p.y, view);
  } else {
    c = photo(p, view);
    // Interior en penumbra hasta que se encienden las lámparas.
    c *= mix(0.14, 1.0, uLight);
    // Sombra del borde de la cortina sobre lo que hay detrás.
    c *= mix(0.3, 1.0, smoothstep(0.0, 40.0, p.y - uEdge));
  }
  c += (hash(p * 1.37 + uGrainSeed) - 0.5) * 0.03;
  outColor = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  return sh;
}

function texture(gl, unit, source) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  return tex;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('no cargó ' + src));
    img.src = src;
  });
}

/**
 * Curva de las lámparas fluorescentes al encender: dos titileos suaves y luego
 * encendidas. Contraste bajo y solo 2 destellos (< 3 por segundo, WCAG 2.3.1).
 */
function lampsAt(ms) {
  if (ms <= 0) return 0;
  const keys = [[0, 0], [60, 0.45], [140, 0.22], [220, 0.7], [330, 0.5], [620, 1]];
  for (let i = 1; i < keys.length; i++) {
    if (ms <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + (v1 - v0) * ((ms - t0) / (t1 - t0));
    }
  }
  return 1;
}

export default async function initHero(root, { fail }) {
  const html = document.documentElement;
  const canvas = root.querySelector('.lp-hero-canvas');
  const content = root.querySelector('.lp-hero-content');
  const cue = root.querySelector('.lp-hero-cue');
  const cover = root.querySelector('.lp-hero-cover');
  const img = root.querySelector('.lp-hero-photo img');
  const pending = html.classList.contains('lp-shutter-pending');

  const releaseCover = (lift) => {
    clearTimeout(window.__lpShutterTimer);
    if (!html.classList.contains('lp-shutter-pending')) return;
    if (lift && cover) {
      // Sin WebGL: la cortina CSS sube de una vez (una transición, sin shader).
      cover.classList.add('is-lifting');
      cover.addEventListener('transitionend', () => cover.classList.remove('is-lifting'), { once: true });
    }
    html.classList.remove('lp-shutter-pending');
  };

  const gl = canvas && canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) {
    releaseCover(true);
    return { destroy() {} };
  }

  let stencilImg;
  try {
    [stencilImg] = await Promise.all([loadImage(STENCIL_SRC), imageReady(img)]);
  } catch (err) {
    releaseCover(true);
    throw err;
  }
  const photoImg = img && img.naturalWidth ? img : null;
  if (!photoImg) {
    releaseCover(true);
    return { destroy() {} };
  }

  // ── Programa ─────────────────────────────────────────────────────────
  // Si el shader no compila en este equipo, la cortina CSS de espera se
  // levanta ya (no a los 3,5 s del temporizador) y queda la foto.
  const prog = gl.createProgram();
  try {
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
  } catch (err) {
    releaseCover(true);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw err;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  ['uRes', 'uScale', 'uEdge', 'uHousing', 'uSlat', 'uRail', 'uPhoto', 'uPhotoSize', 'uPhotoY', 'uZoom', 'uStencil', 'uLogo', 'uLight', 'uNarrow', 'uGrainSeed']
    .forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));
  texture(gl, 0, photoImg);
  texture(gl, 1, stencilImg);
  gl.uniform1i(U.uPhoto, 0);
  gl.uniform1i(U.uStencil, 1);
  gl.uniform2f(U.uPhotoSize, photoImg.naturalWidth, photoImg.naturalHeight);

  // ── Estado ───────────────────────────────────────────────────────────
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const governor = createResolutionGovernor({ min: 0.5, max: Math.min(dpr, 1.75), start: Math.min(dpr, 1.5) });
  const state = {
    w: 0, h: 0, layout: null,
    introStart: pending ? -1 : null, // -1 = arranca en el primer cuadro
    open: pending ? 0 : 1,
    lampsFrom: pending ? null : -1e9,
    scroll: 0,
    lastDraw: 0,
    contentBox: null,
  };

  const headerOffset = () => parseFloat(getComputedStyle(html).getPropertyValue('--header-offset')) || 92;

  function measure() {
    const r = root.getBoundingClientRect();
    state.w = Math.round(r.width);
    state.h = Math.round(r.height);
    state.layout = shutterLayout({ height: state.h, headerOffset: headerOffset() });
    state.contentBox = { top: content.offsetTop, height: content.offsetHeight };
    state.cueTop = cue ? cue.offsetTop : Infinity;
    resize();
  }

  function resize() {
    const s = governor.scale;
    const cw = Math.max(1, Math.round(state.w * s));
    const ch = Math.max(1, Math.round(state.h * s));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    gl.viewport(0, 0, cw, ch);
  }

  const objectY = () => {
    const pos = getComputedStyle(img).objectPosition.split(' ')[1] || '42%';
    return parseFloat(pos) / 100 || 0.42;
  };
  let photoY = objectY();

  function draw(now) {
    const L = state.layout;
    const retract = Math.min(1, state.scroll * 2.5);
    const edge = shutterEdge(state.open, { height: state.h, ...L }, retract);
    const lamps = state.lampsFrom === null ? 0 : lampsAt(now - state.lampsFrom);
    const narrow = state.w < 700 ? 1 : 0;
    // Logo pintado: centrado, con su centro a media altura de la cortina cerrada.
    const logoH = Math.min(state.h * 0.46, state.w * 0.52);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uScale, canvas.width / state.w);
    gl.uniform1f(U.uEdge, edge);
    gl.uniform1f(U.uHousing, L.housing);
    gl.uniform1f(U.uSlat, L.slat);
    gl.uniform1f(U.uRail, L.rail);
    gl.uniform1f(U.uPhotoY, photoY);
    gl.uniform1f(U.uZoom, 1 + state.scroll * 0.14);
    gl.uniform3f(U.uLogo, state.w / 2, (state.h - L.housing) * 0.52, logoH);
    gl.uniform1f(U.uLight, lamps);
    gl.uniform1f(U.uNarrow, narrow);
    gl.uniform1f(U.uGrainSeed, (now % 1000) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // El texto y la pista de scroll viven detrás de la cortina.
    const cb = state.contentBox;
    const clip = textClipTop(edge, cb.top, cb.height);
    content.style.clipPath = clip > 0 ? `inset(${clip}px 0 0 0)` : '';
    if (cue) cue.style.visibility = edge > state.cueTop + 4 ? 'hidden' : '';
    return { edge, lamps };
  }

  let wantsScrollFrame = true;
  const loop = createLoop(root, (now, dt) => {
    if (state.introStart === -1) {
      state.introStart = now;
      try {
        sessionStorage.setItem('lp-cortina', '1');
      } catch {}
    }
    let animating = false;
    if (state.introStart !== null) {
      const t = (now - state.introStart) / INTRO_MS;
      state.open = openingCurve(t);
      // Las lámparas se encienden cuando la cortina pasa el pecho.
      if (state.lampsFrom === null && state.open > 0.4) state.lampsFrom = now;
      if (t >= 1) {
        state.introStart = null;
        state.open = 1;
      } else animating = true;
    }
    const { lamps } = draw(now);
    if (lamps < 1) animating = true;
    if (animating || wantsScrollFrame) {
      const changed = governor.sample(dt);
      if (changed) resize();
    }
    wantsScrollFrame = false;
    return animating;
  });

  measure();
  const ro = new ResizeObserver(() => {
    measure();
    photoY = objectY();
    loop.wake();
  });
  ro.observe(root);
  // Montserrat llega después del primer cálculo y cambia el alto del bloque de
  // texto, del que depende el recorte "detrás de la cortina".
  document.fonts?.ready.then(() => {
    measure();
    loop.wake();
  });

  // Primer cuadro dibujado: se muestra el canvas y se quita la cortina CSS.
  requestAnimationFrame((now) => {
    try {
      draw(now);
      canvas.classList.add('is-live');
      releaseCover(false);
    } catch (err) {
      fail(err);
    }
  });

  // Scroll dentro del hero: la cortina termina de meterse en su caja, la foto
  // se acerca y el bloque de texto sube un poco más lento que la página.
  const gsap = getGsap();
  let st = null;
  if (gsap && window.ScrollTrigger) {
    st = window.ScrollTrigger.create({
      trigger: root,
      start: 'top top',
      end: 'bottom top',
      onUpdate(self) {
        state.scroll = self.progress;
        wantsScrollFrame = true;
        // Parallax del texto con un set directo: un tween "scrub" quedaría
        // pausado para siempre en la línea de tiempo global y no dejaría
        // dormir al ticker de GSAP.
        gsap.set(content, { yPercent: -16 * self.progress });
        // Si el visitante hace scroll durante la apertura, no lo hacemos esperar.
        if (state.introStart !== null && state.introStart !== -1 && self.progress > 0.02) {
          state.introStart -= 120;
        }
        loop.wake();
      },
    });
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    loop.destroy();
    canvas.classList.remove('is-live');
    content.style.clipPath = '';
  });

  return {
    destroy() {
      loop.destroy();
      ro.disconnect();
      st?.kill();
      gsap?.set(content, { clearProps: 'transform' });
      canvas.classList.remove('is-live');
      content.style.clipPath = '';
      if (cue) cue.style.visibility = '';
      releaseCover(false);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
