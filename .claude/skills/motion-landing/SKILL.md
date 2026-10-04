---
name: motion-landing
description: Método para convertir una landing o página de marketing en una experiencia interactiva de nivel motion graphics (hero con pieza central animada, secciones que muestran lo que dicen, scroll coreografiado, microinteracciones), verificada con capturas reales antes de entregar. Úsala siempre que el usuario pida que una página sea "más interactiva", "más viva", "más profesional", "como la de un profesional en motion graphics", que rediseñe un hero o una landing con animaciones, que aplique GSAP, WebGL, scroll animado o efectos de cursor a un sitio, o que "itere" otra página con lo que se hizo en la portada, aunque no nombre la skill. No es para arreglar una sola transición CSS ni para gráficas de datos.
---

# Motion landing

El objetivo no es "agregar animaciones": es que cada sección de la página demuestre lo
que su texto afirma, con un solo lenguaje visual, y que el resultado se haya visto
funcionando antes de darlo por bueno. Lo que hunde este tipo de trabajo es entregar algo
simplista (una línea que se mueve, fundidos genéricos, el mismo efecto en todas las
secciones) o algo que nunca se miró renderizado. Este método existe para evitar las dos
cosas.

Entradas que conviene tener (si faltan, dedúcelas del código y los textos antes de
preguntar):
- Qué página o sección.
- Quién la visita y qué debe hacer al final (escribir, comprar, agendar, confiar).
- Trabajo real que se pueda mostrar (sitios de clientes, producto, capturas).

## Método

Sigue este orden. Cada paso alimenta al siguiente, y saltarse el diagnóstico o la
verificación es justo lo que produce resultados pobres.

### 1. Diagnóstico
Lee la página, sus componentes, estilos y textos (y el sistema de i18n si existe), el
motion que ya tiene y las reglas del proyecto (CLAUDE.md, CSP, dependencias permitidas).
Levanta el servidor y mírala renderizada. Dile al usuario con honestidad qué se ve de
plantilla, qué está vacío o roto y qué se repite. Un diagnóstico concreto es lo que
justifica todo lo demás.

### 2. Investigación
Revisa referencias actuales (Awwwards, Codrops, portfolios premiados del año) y el estado
de las librerías; confirma lo que ya está instalado. Preferencias, en este orden:
- Lo ya instalado y el código propio: GSAP con todos sus plugins (gratuitos desde la
  3.13: SplitText, ScrambleText, DrawSVG, Flip…), Lenis, WebGL2 directo.
- Nada que cargue scripts de terceros si la CSP lo impide o si el proyecto prefiere
  desarrollo propio.
- Three.js solo si hay modelos 3D de verdad; una superficie de shader no lo necesita.

### 3. Concepto
Propón UNA idea central que salga de la promesa de la página, no de un efecto de moda, y
un lenguaje visual común para toda la página. Pregúntate: ¿qué afirma cada sección y cómo
se vería esa afirmación ocurriendo? Ejemplos que funcionaron: un sitio que se mide a
sí mismo con un terreno de isolíneas y señales; una landing de diseño web con un celular
que arma la página de un negocio; una de capacitación en IA con una mesa de trabajo donde
el borrador termina en revisión humana.

Ajusta el lenguaje al público: a un cliente no técnico, la estética de ingeniería no le
dice nada; a un público técnico, las metáforas de oficina tampoco. Si la página es
comercial y se visita desde el celular, prioriza móvil y peso bajo (SVG y GSAP antes que
WebGL).

### 4. Decisiones
Pregunta solo las 2 o 3 decisiones que cambian el resultado (la pieza central, el formato
de la sección principal, si se usan datos del visitante o trabajos reales de clientes),
con vista previa ASCII de cada opción y tu recomendación primero. Todo lo demás decídelo
tú: preguntar de más cansa y no mejora nada.

### 5. Construcción pieza por pieza
Un componente por pieza grande, con comentarios que expliquen el porqué. Después de CADA
pieza, verifícala con capturas (sección Verificación) antes de pasar a la siguiente:
corregir sobre la marcha es barato, descubrir cinco problemas al final no.

Para recetas concretas (SplitText, botones magnéticos, luz que sigue al cursor, odómetro,
secciones fijadas, pista horizontal, shaders de isolíneas, vitrinas con capturas) y la
lista de tropiezos conocidos, lee `references/tecnicas.md` al empezar a construir.

## Principios

- **Mostrar, no decir.** Cada pieza prueba lo que dice su texto. El texto sigue siendo el
  contenido; la animación es la evidencia.
- **Honestidad.** Los ejemplos ficticios llevan la etiqueta "Ejemplo ilustrativo". Nada de
  cifras, testimonios o resultados inventados presentados como reales. Si hay trabajo
  real, úsalo en lugar de marcadores de posición: capturas propias de los sitios
  publicados, convertidas a WebP, enlazando al sitio.
- **Fail-open.** El marcado del servidor es el estado final legible. Sin JS o con
  `prefers-reduced-motion`, todo se ve completo y quieto. Los modos avanzados (pista
  horizontal, sección fijada) los activa el script con una clase; si algo falla, se
  devuelve la visibilidad de lo que pudo quedar escondido.
- **Rendimiento.** Las animaciones se pausan fuera de pantalla y con la pestaña oculta;
  WebGL con resolución adaptativa y un solo contexto cuando hay muchas miniaturas. Mide el
  JS nuevo comprimido y repórtalo.
- **Móvil de verdad.** Sin desbordamiento horizontal. Lo fijado o en horizontal, solo en
  escritorio; en móvil, una versión pensada para móvil, no la de escritorio encogida.
- **Accesibilidad.** Lo decorativo con `aria-hidden`; pestañas y acordeones operables con
  teclado; nada que cambie bajo el cursor mientras alguien lo lee (pausa al apuntar).
- **Un solo lenguaje.** Mismo vocabulario de color, ritmo y gestos en toda la página; el
  motion compartido entre páginas va en un módulo común, no copiado.
- **Textos donde viven los textos.** Todo en el sistema de i18n del proyecto, con paridad
  entre idiomas. Los datos (marcas, nombres de ejemplo, cifras de una maqueta) van en el
  componente, no en el diccionario.
- **Lógica pura con tests.** Geometría, semillas, estados de una secuencia: módulos sin
  DOM, con pruebas.

## Verificación

Nada se entrega sin haberlo visto. Usa `scripts/capturar.mjs` (ejecútalo desde la raíz
del proyecto, que debe tener Playwright instalado):

```bash
node ~/.claude/skills/motion-landing/scripts/capturar.mjs pasos.json <carpeta-salida>
```

El JSON de pasos admite: `url`, `viewport`, `dpr`, `mobile`, `touch`, `reduced`,
`locale`, `navegador` (ruta a un Chromium alternativo, p. ej. Brave para sitios con
video), `localStorage` (mapa clave-valor para cerrar modales) y una lista `pasos` con
`esperar`, `mover`, `clic`, `rueda`, `scrollA`, `eval` y `foto` (con `clip` o
`completa`). Imprime el renderizador WebGL al inicio y los errores de consola al final.
Mira el comentario de cabecera del script para el formato exacto.

Qué verificar, con evidencia:
- **GPU real.** Si el renderizador sale como SwiftShader, las animaciones van a ~1 fps y
  las capturas engañan; cambia las banderas de ANGLE (en Linux funcionó
  `--use-angle=gl-egl --ignore-gpu-blocklist`, que es el valor por defecto del script).
- **Secuencias, no solo el estado final.** Varias fotos a intervalos durante cada
  animación; júntalas en hojas de contacto con `scripts/hoja.py` para verlas de un
  vistazo.
- **Interacción.** Hover, clic y teclado en lo que responda a ellos.
- **Escritorio 1440x900 y móvil 390x844**, midiendo que `scrollWidth` sea igual al ancho
  del viewport.
- **Movimiento reducido.** Ningún texto oculto y ninguna sección fijada.
- **Cada idioma** de la página.
- **Datos.** Si una sección depende de datos que no hay en local, siembra una base
  desechable. Nunca toques producción.
- Al final: tests, type-check y build en verde.

Tropiezos del entorno de pruebas: si el sitio usa Lenis, desplázate con la rueda,
porque `scrollTo` no mueve nada; una pestaña del navegador en segundo plano congela
`requestAnimationFrame`; el servidor de desarrollo puede recargar la página la primera
vez que descubre una dependencia, así que repite la captura antes de concluir que algo
falla.

## Al terminar

- Actualiza la documentación viva del proyecto si existe (requisitos, planes).
- Guarda en memoria las decisiones y los trucos que sirvan para la próxima vez.
- Reporta al usuario sección por sección qué cambió, qué verificaste y cómo, qué no
  pudiste verificar, el peso del JS nuevo y cualquier inconsistencia de contenido que
  hayas encontrado. No corrijas contenido dudoso por tu cuenta si no sabes cuál versión
  es la real: señálalo y deja la decisión al usuario.
