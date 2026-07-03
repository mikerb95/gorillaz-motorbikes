'use strict';

// Estados que un empleado puede fijar desde los portales del taller (/taller y /kds).
// No incluye "entregado" ni "facturado": eso queda reservado al admin.
const EMP_STATUS = [
  { v: 'ingreso_taller',   l: 'Ingreso a taller' },
  { v: 'trabajo_en_curso', l: 'Trabajo en curso' },
  { v: 'en_pausa',         l: 'En pausa'          },
  { v: 'trabajo_completo', l: 'Trabajo completo'  },
];
const ALLOWED_STATUS = EMP_STATUS.map(s => s.v);

module.exports = { EMP_STATUS, ALLOWED_STATUS };
