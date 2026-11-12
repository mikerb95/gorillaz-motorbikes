'use strict';
// Landing de estética: pintura, detailing y wrap (/pintura-detailing-wrap).
// La vista (views/estetica.ejs) y el asesor con IA (helpers/asesor/conocimiento.js)
// leen de aquí. Sin precios: todo se cotiza tras ver la moto o sus fotos.
// Pintura y detailing conservan su ficha en /servicios/<slug>; el wrap solo
// vive en esta página.

const services = [
  {
    id: 'pintura',
    name: 'Pintura',
    title: 'Pintura y restauración',
    lead: 'Para rayones que llegan al primer, golpes, piezas reparadas o cuando quieres un color nuevo de verdad.',
    includes: ['Rayones profundos', 'Abolladuras', 'Color original', 'Pintura personalizada', 'Barniz protector'],
    bestFor: 'Daño que ya atravesó el barniz o un cambio de color definitivo.',
    detailHref: '/servicios/pintura',
    tool: 'sv-t-pintura',
    agendar: 'Pintura',
  },
  {
    id: 'detailing',
    name: 'Detailing',
    title: 'Detailing y corrección',
    lead: 'Devolvemos el brillo a la pintura que tienes: quitamos micro rayas y opacidad, pulimos metales y sellamos.',
    includes: ['Corrección de barniz', 'Pulido de metales', 'Sellador cerámico', 'Plásticos negros'],
    bestFor: 'Pintura sana pero opaca, con marcas de lavado o remolinos.',
    detailHref: '/servicios/detailing-motos',
    tool: 'sv-t-detailing-motos',
    agendar: 'Detailing de motos',
  },
  {
    id: 'wrap',
    name: 'Wrap',
    title: 'Wrap (forrado en vinilo)',
    lead: 'Cambia el color o el acabado de tu moto sin tocar la pintura original. El vinilo la protege y se puede retirar.',
    includes: ['Cambio de color', 'Mate y satinado', 'Fibra de carbono', 'Franjas y detalles', 'Se puede retirar'],
    bestFor: 'Un look nuevo sin pintar, o proteger la pintura de fábrica.',
    detailHref: null,
    tool: 'et-t-wrap',
    agendar: 'Wrap (forrado)',
  },
];

// Qué tiene la moto → qué servicio le sirve. Orienta; la valoración decide.
const diagnosis = [
  { problem: 'Se le ven remolinos y micro rayas al sol', fix: 'detailing', note: 'Corrección de barniz con pulidora.' },
  { problem: 'La pintura está opaca o sin brillo', fix: 'detailing', note: 'Pulido y sellado para recuperar el reflejo.' },
  { problem: 'Un rayón que se siente con la uña', fix: 'pintura', note: 'Si pasó el barniz, se retoca y se repinta la zona.' },
  { problem: 'Golpe, abolladura o pieza fisurada', fix: 'pintura', note: 'Se repara la pieza y luego se pinta.' },
  { problem: 'Quiero otro color sin perder el original', fix: 'wrap', note: 'El vinilo cambia el color y se puede retirar.' },
  { problem: 'Moto nueva: quiero cuidarle la pintura', fix: 'wrap', note: 'Vinilo o sellador cerámico, según el uso que le des.' },
];

const steps = [
  { title: 'Valoración', text: 'Nos mandas fotos por WhatsApp o traes la moto. Vemos el estado de la pintura y lo que quieres lograr.' },
  { title: 'Cotización', text: 'Te decimos qué trabajo recomendamos, cuánto cuesta y cuánto se demora. Nada empieza sin tu aprobación.' },
  { title: 'Preparación', text: 'Desarmamos lo necesario, lavamos y descontaminamos. En pintura, lijamos y aplicamos fondo.' },
  { title: 'Aplicación', text: 'Pintura en cabina, pulido por etapas o instalación del vinilo pieza por pieza, según el trabajo.' },
  { title: 'Entrega', text: 'Revisamos contigo el resultado con buena luz y te explicamos cómo cuidarlo.' },
];

// Acabados de vinilo que muestra el selector de la cabina. Solo nombres del
// tipo de acabado (no marcas de vinilo): el inventario lo confirma el taller.
const wrapFinishes = [
  { id: 'mate', name: 'Mate' },
  { id: 'satinado', name: 'Satinado' },
  { id: 'carbono', name: 'Fibra de carbono' },
  { id: 'camaleon', name: 'Camaleón' },
];

const wrapParts = ['Tanque', 'Carenaje completo', 'Guardabarros', 'Tapas laterales', 'Franjas en rines', 'Detalles y logos'];

const care = [
  {
    id: 'pintura',
    title: 'Después de pintar',
    tips: [
      'Las primeras semanas lava a mano, con agua y champú neutro.',
      'No apliques cera ni pulas hasta que el taller te diga que el barniz curó.',
      'Evita dejarla al sol fuerte o bajo árboles que suelten resina mientras cura.',
    ],
  },
  {
    id: 'detailing',
    title: 'Después del detailing',
    tips: [
      'Seca con microfibra limpia: un trapo sucio vuelve a hacer remolinos.',
      'Usa champú de pH neutro para no quitar el sellador.',
      'Un repaso de mantenimiento cada tanto alarga el brillo.',
    ],
  },
  {
    id: 'wrap',
    title: 'Con wrap',
    tips: [
      'Si usas hidrolavadora, mantenla lejos y nunca apuntes a los bordes del vinilo.',
      'Nada de ceras con solventes ni pulidora sobre el vinilo mate.',
      'Combustible o grasa sobre el vinilo: límpialos pronto.',
    ],
  },
];

const faq = [
  {
    q: '¿Cuánto cuesta pintar, hacer detailing o forrar mi moto?',
    a: 'Depende del tamaño de la moto, cuántas piezas son y el estado de la pintura. Mándanos fotos por WhatsApp y te damos un valor estimado; el valor final lo confirmamos al ver la moto, antes de empezar.',
  },
  {
    q: '¿El wrap daña la pintura original?',
    a: 'No, si la pintura está sana y el vinilo se instala y se retira bien. Al contrario: mientras está puesto la protege del sol y de rayones leves. Si la pintura ya está pelada o repintada de mala calidad, te lo decimos en la valoración.',
  },
  {
    q: '¿Puedo forrar solo una parte, como el tanque?',
    a: 'Sí. Se puede forrar una sola pieza, hacer combinaciones (por ejemplo tanque en carbono y el resto en mate) o solo franjas y detalles.',
  },
  {
    q: '¿Cuánto se demora cada trabajo?',
    a: 'Un detailing suele estar en el día o al siguiente. Pintura y wrap completos tardan más porque hay que desarmar, preparar y, en pintura, dejar curar. En la cotización te damos la fecha de entrega.',
  },
  {
    q: '¿Pueden igualar el color original de mi moto?',
    a: 'Sí, buscamos el color de fábrica de tu moto para retoques y piezas sueltas. Si quieres un color distinto, también podemos hacerlo.',
  },
  {
    q: '¿Qué hago si solo tiene un rayón pequeño?',
    a: 'Pasa la uña por encima: si no se engancha, casi siempre sale con pulido (detailing). Si se engancha, llegó al color o al primer y hay que retocar con pintura.',
  },
];

// Cotizador por pasos (public/js/estetica.js): arma el mensaje y abre WhatsApp.
// No guarda nada en el servidor. Los `id` de las piezas son los data-part de
// la silueta de la moto en views/estetica.ejs.
const quote = {
  services: [
    { id: 'pintura', name: 'Pintura' },
    { id: 'detailing', name: 'Detailing' },
    { id: 'wrap', name: 'Wrap (forrado)' },
    { id: 'asesoria', name: 'No sé, asesórenme' },
  ],
  parts: [
    { id: 'tanque', name: 'Tanque' },
    { id: 'frontal', name: 'Carenaje frontal' },
    { id: 'guardabarros-del', name: 'Guardabarros delantero' },
    { id: 'guardabarros-tras', name: 'Guardabarros trasero' },
    { id: 'colin', name: 'Colín' },
    { id: 'tapas', name: 'Tapas laterales' },
    { id: 'rines', name: 'Rines' },
  ],
  paintGoals: ['Mismo color (retoque o reparación)', 'Cambiar de color', 'Diseño personalizado'],
  detailingSigns: ['Pintura opaca', 'Remolinos y micro rayas', 'Rayones leves', 'Metales sin brillo', 'Plásticos descoloridos'],
  wrapFinishes: wrapFinishes.map((f) => f.name).concat(['Brillante', 'Metalizado', 'Aún no sé']),
};

module.exports = { services, diagnosis, steps, wrapFinishes, wrapParts, care, faq, quote };
