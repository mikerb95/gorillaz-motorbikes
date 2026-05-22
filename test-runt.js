'use strict';
require('dotenv').config();

const { consultarHistorialRunt } = require('./helpers/runt');

// Cambia estos valores por una placa y cédula reales para probar
const PLACA = 'ABC123';
const CEDULA = '1234567890';

(async () => {
  console.log(`Consultando RUNT para placa ${PLACA}...`);
  console.log('Se abrirá el navegador. Resuelve el captcha manualmente y espera.\n');

  const resultado = await consultarHistorialRunt(PLACA, CEDULA);
  console.log('Resultado:', JSON.stringify(resultado, null, 2));
})();
