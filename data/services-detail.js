'use strict';
// Ficha pública de cada servicio del taller: /servicios, /servicios/:slug y el
// asesor con IA (helpers/asesor/conocimiento.js) la leen de aquí.
//
// `includes` resume en etiquetas lo que ya dicen `details` (o, para lavado,
// cascos y detailing, sus páginas en views/services/): /servicios las muestra
// como cintas de rotuladora. `realPhoto` solo existe donde hay foto propia del
// taller; el resto de /servicios usa la herramienta ilustrada, no fotos de banco.
module.exports = [
  {
    slug: 'mecanica', realPhoto: { src: '/images/servicios/mecanica-elevadores.webp', alt: 'Dos motos sobre los elevadores del taller' }, includes: ['Frenos', 'Transmisión', 'Refrigeración', 'Motor'],
    title: 'Mecánica Especializada y Mantenimiento',
    desc: 'Diagnóstico, mantenimiento preventivo y correctivo. Trabajamos con control de calidad para que tu moto rinda al máximo.',
    img: '/images/services/mecanica.webp',
    details: 'Nuestro servicio de <strong>mecánica para motos</strong> incluye una revisión completa de sistemas de frenos, transmisión, refrigeración y motor. Contamos con herramientas especializadas y protocolos de calidad que garantizan que tu moto salga lista para la ruta o la ciudad de forma segura.'
  },
  {
    slug: 'pintura', includes: ['Rayones', 'Abolladuras', 'Color original', 'Pintura personalizada', 'Barniz protector'],
    title: 'Pintura y Restauración Estética',
    desc: 'Acabados profesionales, retoques y protección. Cuidamos el detalle y la durabilidad.',
    img: '/images/services/pintura.webp',
    details: 'Reparamos rayones, abolladuras y restauramos el color original o aplicamos pintura personalizada según tus requerimientos. Usamos pinturas de alta resistencia y acabados con barniz protector de la mayor durabilidad.'
  },
  {
    slug: 'alistamiento-tecnomecanica', includes: ['Gases', 'Frenos', 'Luces', 'Llantas', 'Nivel sonoro'],
    title: 'Alistamiento Tecnomecánica',
    desc: 'Revisión integral y ajustes previos a la inspección para evitar sorpresas y rechazos.',
    img: '/images/services/alisamiento.webp',
    details: 'Realizamos inspección de gases, frenos, luces, desgaste de llantas y nivel sonoro. Garantizamos que tu moto apruebe la revisión técnico mecánica reglamentaria al primer intento.'
  },
  {
    slug: 'electricidad', realPhoto: { src: '/images/servicios/electricidad-cargador.webp', alt: 'Cargador de batería conectado a una moto en el taller' }, includes: ['Cortos circuitos', 'Exploradoras', 'Batería', 'Estatores'],
    title: 'Servicio de Electricidad',
    desc: 'Sistema de carga, arranque e iluminación. Diagnóstico electrónico confiable.',
    img: '/images/services/electricidad.webp',
    details: 'Arreglamos cortos circuitos, adaptaciones de exploradoras, problemas en la batería y estatores. Tu seguridad nocturna y el encendido de la moto están garantizados.'
  },
  {
    slug: 'torno', includes: ['Bujes', 'Ejes', 'Roscas', 'Soldadura'],
    title: 'Torno y Fresado',
    desc: 'Fabricación y ajuste de componentes a medida según especificación.',
    img: '/images/services/torno.webp',
    details: 'Diseñamos y reparamos bujes, ejes, roscas dañadas y realizamos soldaduras especializadas. Si una pieza ya no se consigue, nosotros la fabricamos.' //
  },
  {
    slug: 'prensa', includes: ['Rodamientos', 'Cunas de dirección', 'Pasadores'],
    title: 'Servicio de Prensa',
    desc: 'Montaje y desmontaje seguro de rodamientos y piezas a presión.',
    img: '/images/services/prensa.webp',
    details: 'Extraemos rodamientos, cunas de dirección y pasadores empleando prensas hidráulicas, con lo que evitamos golpear y deformar tu moto.'
  },
  {
    slug: 'mecanica-rapida', includes: ['Cambio de aceite', 'Pastillas de freno', 'Tensado de cadena', 'Lubricación'],
    title: 'Mecánica Rápida (Express)',
    desc: 'Servicios ágiles como cambios de aceite y ajustes menores con cita.',
    img: '/images/services/mecanica-rapida.webp',
    details: 'Cambio de aceite, pastillas de freno, tensado y lubricación de cadena en tiempo récord para que sigas rodando sin perder tu día.'
  },
  {
    slug: 'escaneo-de-motos', includes: ['Testigos del motor', 'Inyectores', 'Sensor TPS', 'Módulo ABS'],
    title: 'Escaneo de Motos (Inyección)',
    desc: 'Diagnóstico computarizado para detectar fallas electrónicas con precisión.',
    img: '/images/services/scaneo.webp',
    details: 'Contamos con escáneres multimarca para apagar testigos de motor, chequear valores en tiempo real de inyectores, sensores TPS y módulos ABS.'
  },
  // Servicios que usan sus propias vistas personalizadas
  { slug: 'lavado-motos', includes: ['Cuida la pintura', 'Plásticos', 'Componentes electrónicos'], title: 'Lavado de motos', desc: 'Limpieza profunda con productos especializados para cuidar la pintura y componentes de tu máquina.', img: '/images/services/lavado-motos.png' },
  { slug: 'lavado-cascos', includes: ['Ozono', 'Hipoalergénico', 'Tapizado', 'Sin malos olores'], title: 'Lavado de cascos', desc: 'Desinfección y limpieza interna y externa para mantener tu seguridad y confort al rodar.', img: '/images/services/lavado-cascos.webp' },
  { slug: 'detailing-motos', includes: ['Corrección de barniz', 'Pulido de metales', 'Sellador cerámico', 'Plásticos negros'], title: 'Detailing de motos', desc: 'Restauración estética detallada, polichado y protección cerámica para un brillo único.', img: '/images/services/detailing-motos.webp' }
];
