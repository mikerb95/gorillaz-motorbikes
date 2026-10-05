# Técnicas y tropiezos

Recetas probadas en producción para las piezas típicas de una landing con motion, y los
errores concretos que costaron tiempo. Léelo al empezar a construir; vuelve a la sección
de tropiezos cuando una captura muestre algo raro.

## Índice
1. Piezas centrales que funcionaron
2. Recetas GSAP
3. WebGL sin librerías
4. Maquetación estable
5. Tropiezos conocidos (con arreglo)

---

## 1. Piezas centrales que funcionaron

Elige según la promesa de la página, no según lo vistoso.

| Promesa | Pieza | Idea clave |
|---|---|---|
| "Este sitio se mide a sí mismo" | Terreno de isolíneas WebGL | El cursor levanta un pico, un clic emite un pulso, el scroll lo aplana hasta una línea que continúa en una cinta de datos reales. |
| "Yo la construyo, tú la usas" | Celular que arma un sitio | Dos capas iguales (esqueleto gris y sitio real); un cursor de diseñador destapa pieza por pieza con clip-path; al final llegan avisos de mensajes de clientes. Varios negocios de ejemplo, uno por perfil de público. |
| "IA en el trabajo, no en una demo" | Mesa de trabajo | Entrada, criterio de la empresa, borrador que se genera palabra a palabra (blur a nítido) y revisión humana que tacha una frase, escribe la corrección y aprueba. |
| Muchos proyectos, pocas capturas | Índice cinético | Lista tipográfica grande; una ventana flotante sigue al cursor con inercia y muestra la captura, o una portada generativa con semilla del slug. En táctil, miniaturas fijas. |
| Proceso en pasos | Pipeline fijado o ventana fija con escenas | El scroll mueve un paquete de luz por la pista; cada etapa pasa por "en cola", "en curso" y "listo". Variante: ventana fija que cambia de escena mientras los pasos pasan al lado. |
| Proceso en el tiempo | Línea de tiempo horizontal fijada | La sección se fija y el scroll vertical desplaza las fases en horizontal sobre una regla de días con un contador grande. |
| Trabajo real | Marco de navegador con captura que se recorre | Captura de página completa con el dominio real; el scroll la desplaza por dentro. Varias tarjetas apiladas (sticky) que se hunden al taparse. |
| Producto con varias vistas | Pestañas con avance automático | Barra de progreso que se pausa al apuntar o enfocar, teclado con flechas, cambio con barrido de clip-path. |
| Beneficios o perfiles | Una pantalla por tarjeta | Cada tarjeta con su mini animación que demuestra el beneficio (búsqueda que sube al primer puesto, chat con "escribiendo", maqueta que se acomoda al celular, lista que se completa). |
| "Nos defendemos, con evidencia" | Filtro de capas (lienzo 2D) | Puntos que cruzan membranas con física de onda; todos grises hasta la capa que los inspecciona, y cada tipo termina donde el sistema lo deja de verdad. Reparte agregados reales; lo que no se mide se dice. Cursor = leer un punto con el tiempo casi detenido; clic = sondeo simulado. |
| "Verificable": experimentos con veredicto | Banco de ensayo | Emisores, defensas y máquina de estados; el guion sale de correr un modelo en memoria que importa la regla real (p. ej. `canTransition`), así el veredicto animado no puede divergir del código. El selector elige entre resultados guardados, no la animación. Fichas por carriles (el hueco entre columnas), nunca encima del texto. |
| Hallazgos corregidos | Línea de commits que cierra | Un nodo por commit real; cada tarjeta pasa de "vulnerable" a "corregido" (rótulo tachado con fondo de 1 px que crece, corrección destapada con clip-path). El servidor pinta todo corregido. |

## 2. Recetas GSAP

- **Titulares.** `new SplitText(el, { type: 'words' | 'lines', mask: 'words' | 'lines' })` y
  `gsap.from(split.words, { yPercent: 110, stagger })`. Si el texto usa degradado con
  `background-clip: text`, reasigna la clase del degradado a cada línea o palabra creada:
  el recorte no llega a los hijos transformados y el texto queda transparente.
- **Botón magnético.** `gsap.quickTo(el, 'x')` e `y`, más un texto interior que se mueve un
  45 % de lo que se mueve la píldora (dos capas, sensación de volumen). Mide el centro
  restando la traslación propia (`gsap.getProperty(el, 'x')`) o el botón se
  retroalimenta y tiembla. Radio de atracción algo mayor que el botón.
- **Luz que sigue al cursor.** Un solo listener en la rejilla escribe `--fx` y `--fy` en
  cada tarjeta; en CSS, `::before` con `radial-gradient` enmascarado al borde
  (`mask-composite: exclude`) y `::after` con un tinte interior tenue. Así el halo asoma
  también en las tarjetas vecinas.
- **Inclinación 3D.** `rotationX` y `rotationY` con `quickTo`, máximo 2 a 5 grados; más
  deforma el texto.
- **Odómetro.** Cada dígito en una columna de 1.1em con una tira "0123456789" repetida
  dos veces; se anima `yPercent` hasta `-(10 + dígito) / 20 * 100` con `expo.out` y
  retraso por columna. Conserva el texto original en `aria-label`.
- **Descifrado.** `ScrambleTextPlugin` para datos que cambian (un dato que "llega"
  descifrándose en vez de un fundido).
- **Entradas por rejilla.** `gsap.from(rejilla.children, { y, opacity, stagger,
  clearProps: 'transform,opacity', scrollTrigger })`. `clearProps` devuelve el control al
  CSS de hover al terminar.
- **Bucles de pantalla.** Una timeline con `repeat: -1, paused: true` por pantalla y un
  IntersectionObserver que hace `play()` y `pause()`: fuera de pantalla no se gasta ni un
  fotograma.
- **Secuencias por fases.** Timeline con `.call()` para cambiar estados (clases) en
  puntos exactos; los estados visuales en CSS con transiciones cortas.
- **Escritorio y móvil distintos.** `gsap.matchMedia()` con dos condiciones y función de
  limpieza; la variante de escritorio puede fijar secciones y la de móvil no.
- **Sección fijada con pista horizontal.** `gsap.to(pista, { x: () => -(pista.scrollWidth
  - ventana.clientWidth), scrollTrigger: { pin, scrub, end: () => '+=' + recorrido,
  invalidateOnRefresh: true, onUpdate } })`. El modo horizontal lo activa el script con
  una clase; la maqueta por defecto es una rejilla.
- **Escenas por paso.** Un `ScrollTrigger` por paso con `onToggle` que activa la escena
  correspondiente. En móvil, mide por el centro del paso (`start: 'center 92%'`) porque
  el texto va centrado en su caja y la caja asoma antes.

## 3. WebGL sin librerías

- `getContext('webgl2')` dentro de try; si devuelve null o falla la compilación, devuelve
  null y deja el respaldo de CSS. Una decoración que puede romper la página no se monta.
- Superficie a pantalla completa: un triángulo que cubre el lienzo
  (`[-1,-1, 3,-1, -1,3]`), sin la costura de dos triángulos.
- Ruido: hash entero (PCG 2D) en vez de senos, que se degradan con coordenadas grandes;
  interpolación quíntica para que las isolíneas no hagan codos; fbm de 4 octavas con
  rotación entre ellas.
- Isolíneas antialiasadas: `d = 0.5 - abs(fract(v) - 0.5)` y
  `1 - smoothstep(0, fwidth(v) * grosor, d)`. Donde `fwidth(v)` pasa de ~0.3, desvanece
  las líneas en vez de dejar moiré.
- Terreno en perspectiva: malla desplazada en el vertex shader con la MISMA función de
  altura que usa el fragment para las curvas. Para que el pico caiga bajo el cursor,
  corta el rayo a la altura de la cima, no en el suelo.
- Resolución adaptativa: empieza en `min(devicePixelRatio, 2)` y baja de a 0.25 si la
  media de 40 fotogramas pasa de ~24 ms.
- Pausa con IntersectionObserver y `visibilitychange`; `WEBGL_lose_context` al destruir.
- Muchas miniaturas: un solo contexto WebGL que pinta cada una y la copia a un canvas
  2D (los navegadores tiran contextos pasada la decena).
- Transiciones entre estados: interpola los parámetros del shader (semillas, colores) en
  vez de cambiar de golpe.

## 4. Maquetación estable

- **El marcado del servidor es el estado final.** Sin JS o con movimiento reducido, se ve
  la versión terminada. El script fija el estado inicial y anima hacia el final.
- **Capas apiladas.** Varias variantes de una pieza en la misma celda (`grid-area: 1 / 1`):
  el contenedor mide la más alta y no salta al cambiar de una a otra.
- **Estados por clase.** `data-estado` o clases en CSS; el script solo las cambia.
- **Titulares con reparto equilibrado.** `text-wrap: balance` en cada línea evita una
  palabra sola en la última línea en móvil.
- **Nombres sin espacios** (nombres de repositorio con guiones): `<wbr>` después de cada
  guion en vez de `hyphens: auto`, que parte donde no debe.
- **Capturas cortas** en un marco con proporción fija: `height: 100%; object-fit: cover;
  object-position: center top` para que llenen el marco en vez de flotar.
- **Bordes de una pista horizontal**: `mask-image` con degradado lateral para que el
  panel que entra asome en vez de verse cortado.

## 5. Tropiezos conocidos (con arreglo)

- **`gsap.to(el, { filter: 'brightness(.5)' })` desde `filter: none`** arranca en
  `brightness(0)` y deja el elemento negro. Usa `fromTo` con `brightness(1)`.
- **GSAP no interpola `calc()`.** Usa porcentajes o píxeles.
- **`scaleY` en una línea SVG de ancho cero** la desplaza fuera del lienzo (no tiene caja
  de la que sacar el origen). Anima el atributo (`attr: { y1 }`).
- **Colores como `var(--color)` en un tween** no se interpolan. Usa hex.
- **`gsap.from` dentro de un `onEnter`** pinta un fotograma en el sitio final antes de
  saltar al inicio. Fija el estado inicial con `gsap.set` antes de crear el trigger.
- **`clip-path` mezclando % y px** salta a mitad de la animación. Todo en porcentajes
  (puedes usar negativos, p. ej. `inset(-20% ...)`, para no recortar sombras).
- **Texto con fondo en línea** (la barra gris de un esqueleto detrás del texto real)
  asoma por encima de la caja del bloque. Tápala con `box-shadow: 0 0 0 4px <fondo>`.
- **Especificidad**: una regla con `:nth-child` pisa la del modo esqueleto; iguala o sube
  la especificidad del esqueleto.
- **Astro recorta el espacio** entre un elemento y una expresión que le sigue
  (`</a>\n{texto}` queda pegado). Pon `{' '}` explícito.
- **`astro:assets` con calidad por defecto** puede inflar una captura WebP de 200 KB a
  500 KB. Fija `quality` (75 a 80).
- **Medidas antes de cargar las fuentes** desplazan cursores y centros. Vuelve a medir en
  `document.fonts.ready` y en `ResizeObserver`.
- **Hover con `transform` en CSS y entrada con GSAP** en el mismo elemento se pelean.
  `clearProps` al terminar la entrada, o no uses la clase de hover que transforma.
- **Rejilla de una sola columna en móvil que se sale por la derecha**: sin
  `grid-template-columns` explícito, la columna implícita mide el min-content, y un texto
  con `white-space: nowrap` dentro la ensancha más que la pantalla. Declara
  `grid-cols-[minmax(0,1fr)]` en el caso base, no solo en el de escritorio.
- **Paneles flotantes cerrados** (`visibility: hidden`) siguen ocupando caja y ensanchan la
  página: `overflow-x: clip` en un envoltorio de ancho completo (no `hidden`, que crea un
  contenedor de scroll) y corrimiento horizontal calculado al abrir.
- **Pruebas:** en Astro 7 dentro de un agente, `astro dev --ignore-lock` falla;
  arranca en segundo plano solo y se apaga con `astro dev stop`. Con Lenis,
  `window.scrollTo` no mueve nada (usa la rueda); una pestaña en segundo plano tiene
  `requestAnimationFrame` a 0; el servidor de desarrollo recarga la página al descubrir
  una dependencia nueva, así que repite la captura antes de concluir que algo falla; los
  sitios con video se capturan mejor con Brave que con el Chromium de Playwright.
- **`once: true` en ScrollTrigger** se autodestruye al disparar; si cae dentro del
  refresh de otro trigger deja colgado el bucle interno y secciones enteras nunca
  entran. Usa un ayudante con bandera (`let hecho = false`) en `onEnter`.
- **Cámara lenta al apuntar + clic en la misma escena**: tras el clic el cursor sigue
  encima y congela justo lo que el clic lanzó. Desactiva la pausa unos segundos después
  de cada clic.
- **Tooltip centrado en la última barra** de un gráfico sale de la página y abre scroll
  horizontal en móvil. Alinea hacia dentro los de los extremos. En emulación móvil,
  `innerWidth` crece con el desborde: compara `scrollWidth` con el ancho pedido.
- **Límite SQL en un desglose que alimenta la animación** (`limit(8)` con 10
  categorías) hace desaparecer justo la categoría pequeña con color propio. Revisa los
  topes de las consultas que la pieza reparte.
- **Medir nodos para dibujar cables** con `getBoundingClientRect` mientras la pieza está
  inclinada o desplazada (entrada de GSAP) deja los cables torcidos para siempre. Mide con
  `offsetLeft/offsetTop` sumados hasta el contenedor: son medidas de maquetación, ignoran
  los transforms.
- **Nodos de fuera alineados con las franjas de una caja** (diagrama de sistema):
  `grid-template-rows: subgrid` y los nodos externos en las filas de la rejilla padre;
  las columnas externas con `display: contents`. Así los cables salen rectos.
- **Varias escenas apiladas con barrido de `clip-path`** y scroll rápido: `killTweensOf(el,
  'clipPath')` + `fromTo` con `delay` dejó escenas congeladas en el estado inicial. Guarda
  el tween de cada escena en un `WeakMap` y mátalo tú; al activar una, cierra TODAS las
  demás con `set`, no solo la anterior.
- **Ventana fija con escenas de altura distinta** apiladas en una celda: `align-content:
  start` en cada escena (si no, la rejilla estira sus filas a la altura de la más alta) y
  `align-self: center` en la pila.
- **Pasos del verificador**: dentro de UN paso, `esperar` corre antes que `scrollA`.
  Para fotografiar una animación disparada por el scroll, el scroll va en un paso y
  `esperar` + `foto` en el siguiente; si no, todas las fotos salen "congeladas" y
  parece un bug de GSAP.
- **Franjas de KPIs con separadores de 1 px** (fondo del contenedor + `gap: 1px`): no
  pongas entrada escalonada a los hijos, se ve la franja vacía mientras entran. El
  odómetro ya es la entrada.
- **Cifras que asoman en el borde del primer pantallazo** con odómetro: un "00%" quieto se
  lee como el dato. Adelanta su disparo (`start: 'top bottom'`).
- **Descifrado (ScrambleText) en celdas de cifras** con texto mixto ("1 de 2") deja
  lecturas intermedias creíbles ("1 de55"). Descifra solo palabras; las cifras cambian de
  golpe con un destello de color.
- **Puntos que migran entre cajas** (ciclo abierto → cerrado): `Flip.getState`, mueve los
  nodos a su caja real y `Flip.from` con stagger; el color lo da la caja, y un
  `data-vuelo` conserva el de origen hasta aterrizar.
- **Portadas generativas en lienzos bajos o pequeños** (bandas de 130 px, miniaturas): el
  shader dibuja en unidades de la altura del lienzo, así que las isolíneas se agrandan y la
  portada se ve estática. Pinta el canvas al 200-260 % del marco y recórtalo con
  `overflow: hidden`.
- **Pausas de un carrusel automático**: que detengan solo el reloj que pasa a la
  siguiente, no la representación de la actual. Si el botón "siguiente" recibe el foco y
  el foco pausa, una timeline creada en pausa deja la carta nueva invisible.
- **Flip con `absolute: true` al filtrar una lista**: las que salen dejan de ocupar sitio
  al instante y el pie de página sube a media pantalla. Anima el alto del contenedor del
  viejo al nuevo en paralelo (`fromTo height` + `clearProps`).
- **Bucle de lienzo que espera datos asíncronos**: si la condición de "seguir animando" es
  "hay un escaneo en curso" y el escaneo solo empieza en un fotograma visible, los datos que
  llegan con el lienzo fuera de pantalla dejan el bucle parado para siempre. Cuenta el
  "escaneo pendiente" como animación. En escritorio no se ve (el lienzo suele estar visible
  al llegar los datos); en móvil sí.
- **API lenta en local** (datos de terceros sin CDN): para verificar, sirve una respuesta real
  guardada con `context.route(...)` desde un script propio; `capturar.mjs` no intercepta
  peticiones.
- **Medir un elemento justo después de `rueda`** con Lenis da coordenadas de un elemento
  que todavía se está desplazando: la foto recortada con esas medidas sale corrida. Espera
  ~1 s después de la rueda antes de medir, o fotografía la ventana entera y recorta
  después.
- **Trazo que se "dibuja" con `pathLength` + `stroke-dashoffset`** en un SVG con
  `preserveAspectRatio="none"` y `vector-effect: non-scaling-stroke`: Chrome pinta el trazo
  entero desde el principio. Destápalo con `clip-path: inset(...)` en el `<svg>`.
- **Simulacros sobre datos reales**: si la página promete que un mecanismo funciona (un
  vigilante, una alarma), el simulacro llama a las funciones de producción, no a una copia,
  y respeta su orden real (p. ej. "se revisa antes de anotar la corrida"). Así el momento
  en que la animación avisa es el momento en que avisaría de verdad, y los tests lo fijan.
- **Tween de un índice para recorrer elementos** (`{ k: 0 }` hasta N y `lista[k]`): `k`
  es fraccionario y `lista[1.5]` es `undefined`. Redondea antes de indexar.
- **Captura por elemento después de un hover** (`locator.screenshot()`): al desplazarse
  para encuadrar el elemento, el puntero deja de estar encima y el `pointerleave` borra
  justo el estado que se quería fotografiar. Encuadra primero, apunta después y fotografía
  la ventana.
- **Piezas que el servidor pinta y el navegador repinta** (una cinta de la página y la misma en una
  calculadora): genera el marcado con una función pura que devuelve texto y úsala en los dos
  lados (`set:html` en Astro, `innerHTML` en el cliente), con los estilos `is:global`. Dos
  plantillas terminan contando cosas distintas.
- **Piezas atenuadas con `opacity` sobre un trazo SVG que pasa por debajo**: la línea se ve a
  través y parece un tachón sobre el nombre. Atenúa con color y borde, con fondo opaco.
- **Guion que depende de código con secretos operativos** (un clasificador con rutas señuelo):
  calcúlalo en el servidor o en el build y manda al navegador solo el recorrido, con un
  test que busque en el JSON los identificadores que no deben viajar.
