'use strict';
// Siembra 20 productos demo en la tienda para ver el catálogo lleno.
//
// Todos quedan con is_demo=1: en producción no se publican salvo que
// SHOW_DEMO_PRODUCTS=1 (ver helpers/catalog.js → isPublic). En el admin
// aparecen bajo el filtro "Demo". Sus ids empiezan por "demo-".
//
// Uso:
//   node scripts/seed-demo-products.js            → inserta los que falten
//   node scripts/seed-demo-products.js --remove   → borra los productos demo-*
//
// Apunta a la base definida por TURSO_URL/TURSO_TOKEN en .env.

require('dotenv').config();
const { db, initDb } = require('../db');
const repo = require('../helpers/shop/repo');

const spec = (label, value) => ({ label, value });

const PRODUCTS = [
  { id: 'demo-casco-integral-ls2', name: 'Casco integral LS2 Stream II', brand: 'LS2', sku: 'DM-CAS-001', category: 'cascos',
    price: 459000, discount: 10, clubDiscount: 5, featured: true, bikeTypes: ['naked', 'sport', 'urbana'], tags: ['casco', 'integral', 'certificado'],
    description: 'Casco integral con casquete en policarbonato, visor solar interno y forro desmontable lavable. Certificación ECE 22.06.',
    specs: [spec('Certificación', 'ECE 22.06'), spec('Peso', '1.450 g'), spec('Visor', 'Antirayas con pinlock ready')],
    variants: [{ size: 'S', stock: 3 }, { size: 'M', stock: 5 }, { size: 'L', stock: 4 }, { size: 'XL', stock: 2 }] },
  { id: 'demo-casco-abatible-shaft', name: 'Casco abatible Shaft 3910', brand: 'Shaft', sku: 'DM-CAS-002', category: 'cascos',
    price: 389000, bikeTypes: ['touring', 'urbana'], tags: ['casco', 'abatible'],
    description: 'Casco modular con mentonera abatible, doble visor y cierre micrométrico. Ideal para recorridos urbanos y viajes.',
    variants: [{ color: 'Negro mate', size: 'M', stock: 4 }, { color: 'Negro mate', size: 'L', stock: 3 }, { color: 'Gris', size: 'M', stock: 2 }] },
  { id: 'demo-guantes-cuero-alpinestars', name: 'Guantes de cuero SP-8', brand: 'Alpinestars', sku: 'DM-GUA-001', category: 'guantes',
    price: 289000, discount: 15, bikeTypes: ['sport', 'naked'], tags: ['guantes', 'cuero', 'protección'],
    description: 'Guantes deportivos en cuero vacuno con protección rígida en nudillos y refuerzo en palma.',
    variants: [{ size: 'M', stock: 6 }, { size: 'L', stock: 5 }, { size: 'XL', stock: 0 }] },
  { id: 'demo-guantes-impermeables', name: 'Guantes impermeables Touring', brand: 'Gorillaz', sku: 'DM-GUA-002', category: 'guantes',
    price: 129000, stock: 18, bikeTypes: ['touring', 'adventure'], tags: ['guantes', 'lluvia'],
    description: 'Guantes con membrana impermeable y forro térmico para lluvia y frío de páramo. Compatibles con pantalla táctil.' },
  { id: 'demo-chaqueta-adventure', name: 'Chaqueta Adventure 4 estaciones', brand: 'Gorillaz', sku: 'DM-IND-001', category: 'indumentaria',
    price: 649000, clubDiscount: 10, featured: true, bikeTypes: ['adventure', 'touring'], tags: ['chaqueta', 'impermeable', 'protección'],
    description: 'Chaqueta textil con protecciones CE nivel 2 en hombros y codos, membrana impermeable y forro térmico desmontable.',
    includes: '- Protecciones de hombro y codo\n- Bolsillo para protector de espalda\n- Forro térmico desmontable',
    variants: [{ size: 'M', stock: 3 }, { size: 'L', stock: 3 }, { size: 'XL', stock: 2 }] },
  { id: 'demo-impermeable-dos-piezas', name: 'Impermeable dos piezas reflectivo', brand: 'Gorillaz', sku: 'DM-IND-002', category: 'indumentaria',
    price: 89000, discount: 20, stock: 40, bikeTypes: ['urbana', 'scooter'], tags: ['impermeable', 'lluvia', 'reflectivo'],
    description: 'Chaqueta y pantalón en PVC con costuras selladas y franjas reflectivas. Se guarda en su propio estuche.' },
  { id: 'demo-botas-sport', name: 'Botas deportivas Racing', brand: 'Gorillaz', sku: 'DM-IND-003', category: 'indumentaria',
    price: 520000, bikeTypes: ['sport'], tags: ['botas', 'protección'],
    description: 'Botas con slider de puntera reemplazable, protección de tobillo y suela antideslizante.',
    variants: [{ size: '40', stock: 2 }, { size: '41', stock: 3 }, { size: '42', stock: 3 }, { size: '43', stock: 1 }] },
  { id: 'demo-aceite-motul-7100', name: 'Aceite Motul 7100 10W40 sintético 1 L', brand: 'Motul', sku: 'DM-CON-001', category: 'consumibles',
    price: 62000, stock: 60, clubDiscount: 8, installable: true, installMinutes: 30, featured: true, bikeTypes: ['naked', 'sport', 'adventure', 'touring'],
    tags: ['aceite', 'sintético', '4T'], description: '100 % sintético para motores 4T. Norma JASO MA2, apto para embrague húmedo.',
    specs: [spec('Viscosidad', '10W40'), spec('Norma', 'API SP / JASO MA2'), spec('Contenido', '1 litro')] },
  { id: 'demo-lubricante-cadena', name: 'Lubricante de cadena Chain Lube', brand: 'Motul', sku: 'DM-CON-002', category: 'consumibles',
    price: 38000, stock: 35, tags: ['cadena', 'lubricante'],
    description: 'Lubricante en spray de alta adherencia para cadenas con o-ring. No salpica a alta velocidad.' },
  { id: 'demo-kit-arrastre', name: 'Kit de arrastre reforzado', brand: 'DID', sku: 'DM-REP-001', category: 'repuestos',
    price: 245000, installable: true, installPrice: 45000, installMinutes: 60, bikeTypes: ['naked', 'sport'], tags: ['cadena', 'piñón', 'transmisión'],
    description: 'Cadena con o-ring, piñón y corona en acero tratado. Incluye candado de cadena.', stock: 9 },
  { id: 'demo-pastillas-freno', name: 'Pastillas de freno sinterizadas', brand: 'EBC', sku: 'DM-REP-002', category: 'repuestos',
    price: 98000, discount: 5, stock: 22, installable: true, installPrice: 25000, installMinutes: 30, tags: ['frenos', 'pastillas'],
    description: 'Pastillas sinterizadas para mayor frenada en mojado y menor desgaste. Juego para una mordaza.' },
  { id: 'demo-llanta-mixta', name: 'Llanta mixta trasera 130/80-17', brand: 'Pirelli', sku: 'DM-REP-003', category: 'repuestos',
    price: 410000, stock: 0, installable: true, installMinutes: 45, bikeTypes: ['enduro', 'adventure'], tags: ['llanta', 'offroad'],
    description: 'Llanta de uso mixto 70/30 on/off road con compuesto de alta durabilidad.' },
  { id: 'demo-farola-led-auxiliar', name: 'Farolas LED auxiliares 40 W (par)', brand: 'Gorillaz', sku: 'DM-ILU-001', category: 'iluminacion',
    price: 185000, discount: 12, stock: 14, installable: true, installPrice: 60000, installMinutes: 90, bikeTypes: ['adventure', 'touring'],
    tags: ['farolas', 'led', 'exploradoras'], description: 'Par de exploradoras LED con haz combinado, carcasa en aluminio IP67 e interruptor al manubrio.',
    includes: '- 2 farolas LED\n- Arnés con relé\n- Interruptor de manubrio\n- Soportes universales' },
  { id: 'demo-bombillo-led-h4', name: 'Bombillo LED H4 alta/baja', brand: 'Philips', sku: 'DM-ILU-002', category: 'iluminacion',
    price: 75000, stock: 30, installable: true, installMinutes: 15, tags: ['bombillo', 'led'],
    description: 'Bombillo LED H4 con disipador activo. Luz blanca de 6.000 K sin encandilar.' },
  { id: 'demo-espejos-rizoma', name: 'Espejos retrovisores aluminio CNC', brand: 'Gorillaz', sku: 'DM-ESP-001', category: 'espejos',
    price: 149000, stock: 10, installable: true, installMinutes: 20, bikeTypes: ['naked', 'sport'], tags: ['espejos', 'cnc'],
    description: 'Par de espejos en aluminio mecanizado con rosca universal M10. Lente antirreflejo.' },
  { id: 'demo-candado-disco-alarma', name: 'Candado de disco con alarma', brand: 'Gorillaz', sku: 'DM-SEG-001', category: 'seguridad',
    price: 79000, discount: 25, stock: 28, tags: ['candado', 'alarma', 'antirrobo'],
    description: 'Candado de disco en acero endurecido con alarma de 110 dB y cable recordatorio.' },
  { id: 'demo-intercomunicador-bt', name: 'Intercomunicador Bluetooth para casco', brand: 'Cardo', sku: 'DM-TEC-001', category: 'tecnologia',
    price: 349000, clubDiscount: 7, stock: 7, featured: true, tags: ['intercomunicador', 'bluetooth'],
    description: 'Intercomunicador con alcance de 1,2 km entre dos motos, música compartida y control por voz.' },
  { id: 'demo-soporte-celular', name: 'Soporte de celular con cargador USB', brand: 'Gorillaz', sku: 'DM-TEC-002', category: 'tecnologia',
    price: 69000, stock: 50, installable: true, installPrice: 20000, installMinutes: 30, tags: ['soporte', 'celular', 'usb'],
    description: 'Soporte en aluminio con anclaje antivibración y cargador USB-C de carga rápida.' },
  { id: 'demo-baul-45l', name: 'Baúl trasero 45 L', brand: 'Shad', sku: 'DM-CAR-001', category: 'carga',
    price: 399000, discount: 10, stock: 6, installable: true, installMinutes: 40, bikeTypes: ['scooter', 'urbana', 'touring'], tags: ['baúl', 'equipaje'],
    description: 'Baúl con capacidad para dos cascos integrales, respaldo acolchado y base universal.' },
  { id: 'demo-kit-limpieza', name: 'Kit de limpieza y brillo', brand: 'Gorillaz', sku: 'DM-CUI-001', category: 'cuidado-limpieza',
    price: 95000, stock: 25, tags: ['limpieza', 'brillo', 'cera'],
    description: 'Shampoo para moto, desengrasante de cadena, cera de acabado y paño de microfibra.' },
];

async function seed() {
  const existing = new Set((await db.execute('SELECT id FROM products')).rows.map((r) => r.id));
  let created = 0;
  for (const p of PRODUCTS) {
    if (existing.has(p.id)) continue;
    await repo.saveProduct({
      ...p,
      slug: p.id.replace(/^demo-/, ''),
      ownStock: p.variants ? null : (p.stock ?? null),
      variants: (p.variants || []).map((v, i) => ({ ...v, sku: `${p.sku}-${i + 1}` })),
      status: 'active',
      isDemo: true,
    });
    created++;
  }
  console.log(`Productos demo creados: ${created} (ya existían ${PRODUCTS.length - created}).`);
}

async function remove() {
  const ids = (await db.execute("SELECT id FROM products WHERE id LIKE 'demo-%' AND is_demo = 1")).rows.map((r) => r.id);
  const stmts = [];
  for (const id of ids) {
    for (const t of ['product_variants', 'product_images', 'product_compat']) stmts.push({ sql: `DELETE FROM ${t} WHERE product_id = ?`, args: [id] });
    stmts.push({ sql: 'DELETE FROM products WHERE id = ?', args: [id] });
  }
  if (stmts.length) await db.batch(stmts, 'write');
  console.log(`Productos demo borrados: ${ids.length}.`);
}

(async () => {
  await initDb();
  await (process.argv.includes('--remove') ? remove() : seed());
})().catch((err) => { console.error(err); process.exit(1); });
