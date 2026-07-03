'use strict';
/* Marcas de motos comunes en el mercado colombiano, en el formato oficial a usar */
const MOTORCYCLE_BRANDS = [
  'AKT', 'Auteco', 'Bajaj', 'Benelli', 'BMW Motorrad', 'CFMoto', 'Ducati', 'Hero',
  'Honda', 'Husqvarna', 'Italika', 'Kawasaki', 'Keeway', 'KTM', 'Kymco', 'MD',
  'Royal Enfield', 'Suzuki', 'SYM', 'Triumph', 'TVS', 'UM', 'Vespa', 'Victory', 'Yamaha'
];

/*
 * Modelos vigentes + descontinuados recientes (aún muy comunes en el país) por marca,
 * para el mercado colombiano. Auteco, Italika y MD quedan sin catálogo de modelos:
 * no se pudo confirmar que tengan modelos propios/distribución oficial verificable en Colombia.
 */
const MOTORCYCLE_MODELS = {
  'AKT': [
    'NKD 125', 'CHR 125', 'CR4 125', 'CR4 150', 'CR4 200 PRO', 'CR4 250R',
    'TTR 125', 'TTR 200', 'TT 200', 'TT 200 Rally', 'Flex 125', 'Dynamic 125',
    'Special 110X', 'Jet Evo'
  ],
  'Bajaj': [
    'Pulsar N125', 'Pulsar N160', 'Pulsar NS160', 'Pulsar NS200', 'Pulsar RS200',
    'Pulsar N250', 'Pulsar NS400Z', 'Dominar 250', 'Dominar 400', 'Boxer CT100',
    'Boxer 150X', 'Discover 125', 'Avenger 220'
  ],
  'Benelli': [
    'TNT 135', 'TNT 150', 'TNT 180S', '302S', 'Leoncino 250', 'Leoncino 500 Trail',
    'TRK 251', 'TRK 502', 'TRK 502X'
  ],
  'BMW Motorrad': [
    'S 1000 RR', 'M 1000 RR', 'M 1000 R', 'M 1000 XR', 'S 1000 R', 'F 900 R',
    'G 310 R', 'R 12 nineT', 'R 12 G/S', 'R 18 B', 'G 310 GS', 'F 450 GS',
    'F 800 GS', 'F 900 GS', 'F 900 GS Adventure', 'R 1300 GS', 'R 1300 GS Adventure',
    'S 1000 XR', 'F 900 XR', 'R 1300 RT', 'CE 04', 'C 400 X', 'C 400 GT'
  ],
  'CFMoto': [
    '250SR', '250NK', '300NK', '450NK', '675NK', '300SR', '450SR', '675SR-R',
    '450CLC', '450MT', '700MT', '800MT-X', '1000MT-X', 'Papio'
  ],
  'Ducati': [
    'Monster', 'Scrambler Icon', 'Hypermotard', 'Streetfighter', 'Panigale V2',
    'Panigale V4', 'Desert X', 'Multistrada V4', 'Diavel', 'XDiavel'
  ],
  'Hero': [
    'Splendor XPRO', 'Hunk 125R', 'Hunk 150 XTEC', 'Hunk 160 2V FI', 'Hunk 160 4V',
    'Hunk 160 RS', 'Xpulse 200 4V', 'Xoom 110', 'Eco 100', 'Eco Deluxe', 'Eco T'
  ],
  'Honda': [
    'CB 100', 'CB 125F', 'CB 190R', 'CB 300F', 'XBlade 160', 'CBR 650R',
    'CBR 1000RR-R', 'XR 150L', 'XR 190L', 'XR 300L Tornado', 'CRF 250R', 'CRF 450R',
    'CRF 110F', 'Wave 110S', 'Dio', 'Navi', 'Elite 125', 'PCX 150', 'CMX 500 Rebel',
    'CB 350D Scrambler', 'NC 750XD', 'X-ADV 750', 'NT 1100', 'Gold Wing',
    'Africa Twin CRF 1100L'
  ],
  'Husqvarna': [
    'FE 350', 'FC 250', 'Svartpilen 401', 'Svartpilen 801', 'Norden 901',
    'Vitpilen 401', 'TE', 'TC'
  ],
  'Kawasaki': [
    'Ninja 300', 'Ninja 400', 'Ninja 650', 'Z300', 'Z400', 'Z650', 'Z900',
    'Z900 RS', 'Versys 300', 'Versys 650', 'KLX 150'
  ],
  'Keeway': ['RKV', 'K-Light', 'V302C', 'Superlight'],
  'KTM': [
    'Duke 200', 'Duke 250', 'Duke 390', 'Duke 990', 'Super Duke R 1290', 'RC 200',
    'RC 390', 'RC R 990', 'Adventure 390', 'Adventure 790', 'Adventure 890',
    'Super Adventure 1290', '690 SMC R', '690 Enduro R'
  ],
  'Kymco': [
    'Agility', 'Like 125', 'Sky Town 150', 'People', 'Downtown 350 GT',
    'Xciting 400', 'AK 550', 'Twist'
  ],
  'Royal Enfield': [
    'Classic 350', 'Classic 500', 'Bullet 350', 'Meteor 350', 'Hunter 350',
    'Himalayan 411', 'Himalayan 450', 'Guerrilla 450', 'Scram 411',
    'Interceptor 650', 'Continental GT 650', 'Super Meteor 650', 'Bear 650'
  ],
  'Suzuki': [
    'Gixxer', 'Gixxer SF', 'GSX-S150', 'GSX-R150', 'GSX-R125', 'GSX-8R', 'GSX-8T',
    'GSX-S1000', 'GSX-R1000R', 'Hayabusa', 'V-Strom 160', 'V-Strom 250 SX',
    'V-Strom 800 DE', 'V-Strom 1050 DE', 'SV650', 'DR-Z4S', 'DR 150', 'DR 160X',
    'GN125', 'GN160', 'Viva', 'Address', 'Avenis AX4', 'Burgman 150', 'Best 125',
    'Fiero', 'AX100'
  ],
  'SYM': [
    'NHR 190i', 'NH Trazer 300', 'CROX 125', 'ADXTG 150', 'DRGTB 150', 'NH VFE 185',
    'Jet 14', 'Jet Evo 125', 'Jet X 125', 'Fiddle', 'Symphony ST', 'Cruisym 125',
    'Cruisym 300', 'HD200'
  ],
  'Triumph': [
    'Tiger Sport 660', 'Tiger Sport 800', 'Tiger 900', 'Tiger 1200', 'Trident 660',
    'Street Triple RS 765', 'Speed Triple 1200 RS', 'Bonneville T100',
    'Bonneville T120', 'Bonneville Bobber', 'Speed Twin 900', 'Speed Twin 1200',
    'Scrambler 900', 'Scrambler 1200', 'Speed 400', 'Scrambler 400X', 'Rocket 3',
    'TF 250-X'
  ],
  'TVS': [
    'Apache RTR 160', 'Apache RTR 200', 'Apache RTR 310', 'Raider 125', 'Sport 100',
    'NTorq 125', 'Neo NX 110', 'Ronin 225', 'iQube', 'Star City', 'Phoenix', 'Flame'
  ],
  'UM': [
    'Xpeed 125 ADV', 'Xpeed 150 ADV', 'Rockville 200', 'Rockville 300',
    'Xtreet RS 250', 'Xtreet SS 401', 'DSRX 150', 'Rally 300', 'Renegade Sport 200S',
    'Renegade Commando 300', 'Renegade Freedom', 'Renegade ST 300',
    'Renegade Limited', 'Renegade Classic', 'Renegade Duty S', 'DSR 150'
  ],
  'Vespa': [
    'Primavera 150', 'VXL 150', 'Sprint 150', 'GTS 300', 'GTS 300 Super Sport',
    'GTS Super 300 Tech', 'GTV 300', 'GTS 310'
  ],
  'Victory': [
    'Victory One', 'Venom 250', 'Venom 400', 'MRX 200', 'Bomber 250',
    'Victory Bold', 'Victory Shock'
  ],
  'Yamaha': [
    'FZ', 'FZ25', 'FZ16', 'YBR125', 'Fazer', 'Crypton', 'Libero', 'Vixion', 'Saga',
    'XTZ125', 'XTZ150', 'XTZ250 Lander', 'Ténéré 700', 'MT15', 'MT03', 'MT07',
    'MT09', 'Tracer 9 GT', 'XSR900', 'R15', 'R3', 'R7', 'R9', 'Aerox 155', 'NMax',
    'XMax 300', 'TMax', 'BWs'
  ]
};

(function () {
  function normalize(str) {
    return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function closeDropdown(list) {
    list.innerHTML = '';
    list.hidden = true;
  }

  function findBrandKey(brandText) {
    var query = normalize(brandText.trim());
    if (!query) return null;
    var key = Object.keys(MOTORCYCLE_MODELS).find(function (b) { return normalize(b) === query; });
    if (key) return key;
    return Object.keys(MOTORCYCLE_MODELS).find(function (b) { return normalize(b).indexOf(query) !== -1; }) || null;
  }

  function renderList(list, items) {
    if (!items.length) { closeDropdown(list); return; }
    list.innerHTML = items.map(function (b) {
      return '<li role="option">' + b + '</li>';
    }).join('');
    list.hidden = false;
  }

  function openBrandDropdown(input, list) {
    var query = normalize(input.value.trim());
    if (query.length < 3) { closeDropdown(list); return; }
    renderList(list, MOTORCYCLE_BRANDS.filter(function (b) {
      return normalize(b).indexOf(query) !== -1;
    }).slice(0, 8));
  }

  function openModelDropdown(input, list, brandInput) {
    var brandKey = brandInput && findBrandKey(brandInput.value);
    var models = (brandKey && MOTORCYCLE_MODELS[brandKey]) || [];
    if (!models.length) { closeDropdown(list); return; }

    var query = normalize(input.value.trim());
    var matches = query
      ? models.filter(function (m) { return normalize(m).indexOf(query) !== -1; })
      : models;
    renderList(list, matches.slice(0, 10));
  }

  function wrapWithDropdown(input, className) {
    var wrap = document.createElement('div');
    wrap.className = className;
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var list = document.createElement('ul');
    list.className = className + '-list';
    list.hidden = true;
    wrap.appendChild(list);

    input.setAttribute('autocomplete', 'off');

    list.addEventListener('mousedown', function (e) {
      var li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      input.value = li.textContent;
      closeDropdown(list);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) closeDropdown(list);
    });

    return list;
  }

  function initBrandField(input) {
    if (input.dataset.brandSuggestInit) return;
    input.dataset.brandSuggestInit = '1';

    var list = wrapWithDropdown(input, 'brand-suggest');

    input.addEventListener('input', function () { openBrandDropdown(input, list); });
    input.addEventListener('focus', function () { openBrandDropdown(input, list); });
  }

  function initModelField(input) {
    if (input.dataset.modelSuggestInit) return;
    input.dataset.modelSuggestInit = '1';

    var brandInput = input.form && input.form.querySelector('[data-brand-suggest]');
    var list = wrapWithDropdown(input, 'brand-suggest');

    input.addEventListener('input', function () { openModelDropdown(input, list, brandInput); });
    input.addEventListener('focus', function () { openModelDropdown(input, list, brandInput); });
  }

  function initAll() {
    document.querySelectorAll('input[data-brand-suggest]').forEach(initBrandField);
    document.querySelectorAll('input[data-model-suggest]').forEach(initModelField);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
