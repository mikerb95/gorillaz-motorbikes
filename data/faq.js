'use strict';
// Preguntas frecuentes de /faq. El asesor con IA (helpers/asesor) las lee de
// aquí, así lo que dice el chat es lo mismo que está publicado en la página.
// `a` admite enlaces internos (<a href>); el asesor los quita.
module.exports = [
  { q: "¿Qué garantía tienen los servicios y productos?", a: "Todos nuestros servicios cuentan con garantía de satisfacción. Los productos tienen garantía legal y de fabricante según el tipo de artículo. Consulta detalles en <a href=\"/terminos\">Términos</a>." },
  { q: "¿Ofrecen cursos o capacitaciones?", a: "Sí, puedes ver la oferta de cursos técnicos y de conducción en la sección <a href=\"/cursos\">Cursos</a>. Incluimos talleres presenciales y virtuales para todos los niveles." },
  { q: "¿Es seguro comprar y registrarse en el sitio?", a: "Sí, protegemos tus datos con cifrado y no compartimos información personal. Los pagos se procesan en plataformas seguras y confiables." },
  { q: "¿Cómo puedo contactar al taller o soporte?", a: "Puedes escribirnos por WhatsApp usando el botón flotante, llamarnos o enviarnos un mensaje desde el formulario de contacto. También respondemos rápido en redes sociales." },
  { q: "¿Cómo obtengo o renuevo mi membresía del club?", a: "Regístrate o inicia sesión en <a href=\"/club\">Club</a>. Desde tu panel puedes ver tu estado, renovar y acceder a beneficios exclusivos." },
  { q: "¿Recibiré recordatorios de vencimiento de SOAT o tecnomecánica?", a: "Sí, si eres miembro del club y registras tus vehículos, te avisamos antes de que caduquen tus documentos para que siempre estés al día." },
  { q: "¿Tienen servicios rápidos sin cita?", a: "Ofrecemos mecánica rápida para cambios de aceite y ajustes menores. Puedes venir directamente o agendar para asegurar tu espacio." },
  { q: "¿Qué hago si tengo un problema después de un servicio?", a: "Contáctanos de inmediato. Nuestro equipo revisará tu caso y te dará solución prioritaria. La satisfacción y seguridad de tu moto es nuestra prioridad." },
  { q: "¿Cómo agendo una cita para mi moto?", a: "Puedes solicitar agendamiento desde la sección <a href=\"/servicios\">Servicios</a>. Completa el formulario con tus datos, servicio y fecha deseada. Te contactaremos para confirmar." },
  { q: "¿Qué métodos de pago aceptan?", a: "Aceptamos <strong>Nequi</strong>, <strong>Daviplata</strong> y todas las <strong>tarjetas débito y crédito</strong> en la tienda y en el taller." },
  { q: "¿Cómo funciona el Club Gorillaz?", a: "El Club ofrece beneficios como descuentos, lavados y eventos exclusivos. Puedes conocer más y registrarte desde <a href=\"/club\">esta página</a>." },
  { q: "¿Pueden preparar mi moto para la tecnomecánica?", a: "Sí. Ofrecemos alistamiento tecnomecánico, diagnóstico y corrección de fallas. Agenda en <a href=\"/servicios\">Servicios</a>." },
  { q: "¿Hacen envíos de productos?", a: "Sí, realizamos envíos a nivel nacional. El costo y tiempo dependen del destino y se calculan en el checkout." },
  { q: "¿Puedo cambiar o devolver un producto?", a: "Tienes 5 días hábiles para solicitar cambios o devoluciones si el producto está en perfecto estado y con empaque original. Revisa condiciones en <a href=\"/terminos\">Términos</a>." },
];
