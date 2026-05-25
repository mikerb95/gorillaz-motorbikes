'use strict';
/* Departamentos y municipios de Colombia — DANE 2024 (1102 municipios) */
const COLOMBIA_DATA = [
  ['Bogotá D.C.', ['Bogotá']],
  ['Amazonas', ['Leticia','Puerto Nariño']],
  ['Antioquia', [
    'Abejorral','Abriaquí','Alejandría','Amagá','Amalfi','Andes','Angelópolis','Angostura',
    'Anorí','Anzá','Apartadó','Arboletes','Argelia','Armenia','Barbosa','Bello','Betania',
    'Betulia','Briceño','Buriticá','Cáceres','Caicedo','Caldas','Campamento','Cañasgordas',
    'Caracolí','Caramanta','Carepa','El Carmen de Viboral','Carolina del Príncipe','Caucasia',
    'Chigorodó','Cisneros','Ciudad Bolívar','Cocorná','Concepción','Concordia','Copacabana',
    'Dabeiba','Don Matías','Ebéjico','El Bagre','Entrerríos','Envigado','Fredonia','Frontino',
    'Giraldo','Girardota','Gómez Plata','Granada','Guadalupe','Guarne','Guatapé','Heliconia',
    'Hispania','Itagüí','Ituango','Jardín','Jericó','La Ceja del Tambo','La Estrella',
    'La Pintada','La Unión','Liborina','Maceo','Marinilla','Medellín','Montebello','Murindó',
    'Mutatá','Nariño','Necoclí','Nechí','Olaya','El Peñol','Peque','Pueblorrico',
    'Puerto Berrío','Puerto Nare','Puerto Triunfo','Remedios','El Retiro','Rionegro',
    'Sabanalarga','Sabaneta','Salgar','San Andrés de Cuerquia','San Carlos','San Francisco',
    'San Jerónimo','San José de la Montaña','San Juan de Urabá','San Luis','San Pedro',
    'San Pedro de Urabá','San Rafael','San Roque','San Vicente Ferrer','Santa Bárbara',
    'Santa Rosa de Osos','Santo Domingo','Santuario','Segovia','Sonsón','Sopetrán',
    'Támesis','Tarazá','Tarso','Titiribí','Toledo','Turbo','Uramita','Urrao','Valdivia',
    'Valparaíso','Vegachí','Venecia','Vigía del Fuerte','Yalí','Yarumal','Yolombó',
    'Yondó','Zaragoza'
  ]],
  ['Arauca', ['Arauca','Arauquita','Cravo Norte','Fortul','Puerto Rondón','Saravena','Tame']],
  ['Atlántico', [
    'Barranquilla','Baranoa','Campo de la Cruz','Candelaria','Galapa','Juan de Acosta',
    'Luruaco','Malambo','Manatí','Palmar de Varela','Piojó','Polonuevo','Ponedera',
    'Puerto Colombia','Repelón','Sabanagrande','Sabanalarga','Santa Lucía','Santo Tomás',
    'Soledad','Suan','Tubará','Usiacurí'
  ]],
  ['Bolívar', [
    'Cartagena','Achí','Altos del Rosario','Arenal','Arjona','Arroyohondo',
    'Barranco de Loba','Calamar','Cantagallo','Cicuco','Clemencia','Córdoba',
    'El Carmen de Bolívar','El Guamo','El Peñón','Hatillo de Loba','Magangué',
    'Mahates','Margarita','María la Baja','Mompós','Montecristo','Morales','Norosí',
    'Pinillos','Regidor','Río Viejo','San Cristóbal','San Estanislao','San Fernando',
    'San Jacinto','San Jacinto del Cauca','San Juan Nepomuceno','San Martín de Loba',
    'San Pablo','Santa Catalina','Santa Rosa','Santa Rosa del Sur','Simití',
    'Soplaviento','Talaigua Nuevo','Tiquisio','Turbaco','Turbaná','Villanueva','Zambrano'
  ]],
  ['Boyacá', [
    'Tunja','Almeida','Aquitania','Arcabuco','Belén','Berbeo','Betéitiva','Boavita',
    'Boyacá','Briceño','Buenavista','Busbanzá','Caldas','Campohermoso','Cerinza',
    'Chinavita','Chiquinquirá','Chíquiza','Chiscas','Chita','Chitaraque','Chivatá',
    'Ciénega','Cómbita','Coper','Corrales','Covarachía','Cubará','Cucaita','Cuítiva',
    'Duitama','El Cocuy','El Espino','Firavitoba','Floresta','Gachantivá','Gámeza',
    'Garagoa','Guacamayas','Guateque','Guayatá','Güicán de la Sierra','Iza','Jenesano',
    'Jericó','La Capilla','La Uvita','La Victoria','Labranzagrande','Macanal','Maripí',
    'Miraflores','Mongua','Monguí','Moniquirá','Motavita','Muzo','Nobsa','Nuevo Colón',
    'Oicatá','Otanche','Pachavita','Páez','Paipa','Pajarito','Panqueba','Pauna','Paya',
    'Paz de Río','Pesca','Pisba','Puerto Boyacá','Quípama','Ramiriquí','Ráquira',
    'Rondón','Saboyá','Sáchica','Samacá','San Eduardo','San José de Pare',
    'San Luis de Gaceno','San Mateo','San Miguel de Sema','San Pablo de Borbur',
    'Santa María','Santa Rosa de Viterbo','Santa Sofía','Santana','Sativanorte',
    'Sativasur','Siachoque','Soatá','Socotá','Socha','Sogamoso','Somondoco','Sora',
    'Soracá','Sotaquirá','Susacón','Sutamarchán','Sutatenza','Tasco','Tenza','Tibaná',
    'Tibasosa','Tinjacá','Tipacoque','Toca','Togüí','Tópaga','Tota','Turmequé','Tuta',
    'Tutazá','Úmbita','Ventaquemada','Villa de Leyva','Viracachá','Zetaquira'
  ]],
  ['Caldas', [
    'Manizales','Aguadas','Anserma','Aranzazu','Belalcázar','Chinchiná','Filadelfia',
    'La Dorada','La Merced','Manzanares','Marmato','Marquetalia','Marulanda','Neira',
    'Norcasia','Pácora','Palestina','Pensilvania','Riosucio','Risaralda','Salamina',
    'Samaná','San José','Supía','Victoria','Villamaría','Viterbo'
  ]],
  ['Caquetá', [
    'Florencia','Albania','Belén de los Andaquíes','Cartagena del Chairá','Curillo',
    'El Doncello','El Paujíl','La Montañita','Milán','Morelia','Puerto Rico',
    'San José del Fragua','San Vicente del Caguán','Solano','Solita','Valparaíso'
  ]],
  ['Casanare', [
    'Yopal','Aguazul','Chámeza','Hato Corozal','La Salina','Maní','Monterrey','Nunchía',
    'Orocué','Paz de Ariporo','Pore','Recetor','Sabanalarga','Sácama',
    'San Luis de Palenque','Támara','Tauramena','Trinidad','Villanueva'
  ]],
  ['Cauca', [
    'Popayán','Almaguer','Argelia','Balboa','Bolívar','Buenos Aires','Cajibío','Caldono',
    'Caloto','Corinto','El Tambo','Florencia','Guachené','Guapí','Inzá','Jambaló',
    'La Sierra','La Vega','López de Micay','Mercaderes','Miranda','Morales','Padilla',
    'Páez','Patía','Piamonte','Piendamó','Puerto Tejada','Puracé','Rosas',
    'San Sebastián','Santa Rosa','Santander de Quilichao','Silvia','Sotara','Suárez',
    'Sucre','Timbío','Timbiquí','Toribío','Totoró','Villa Rica'
  ]],
  ['Cesar', [
    'Valledupar','Aguachica','Agustín Codazzi','Astrea','Becerril','Bosconia',
    'Chimichagua','Chiriguaná','Curumaní','El Copey','El Paso','Gamarra','González',
    'La Gloria','La Jagua de Ibirico','La Paz','Manaure Balcón del Cesar','Pailitas',
    'Pelaya','Pueblo Bello','Río de Oro','San Alberto','San Diego','San Martín',
    'Tamalameque'
  ]],
  ['Chocó', [
    'Quibdó','Acandí','Alto Baudó','Atrato','Bagadó','Bahía Solano','Bajo Baudó',
    'Bojayá','Cértegui','Condoto','El Cantón del San Pablo','El Carmen de Atrato',
    'El Litoral del San Juan','Istmina','Juradó','Lloró','Medio Atrato','Medio Baudó',
    'Medio San Juan','Nóvita','Nuquí','Río Iro','Río Quito','Riosucio',
    'San José del Palmar','Sipí','Tadó','Unguía','Unión Panamericana'
  ]],
  ['Córdoba', [
    'Montería','Ayapel','Buenavista','Canalete','Cereté','Chimá','Chinú',
    'Ciénaga de Oro','Cotorra','La Apartada','Lorica','Los Córdobas','Momil',
    'Montelíbano','Moñitos','Planeta Rica','Pueblo Nuevo','Puerto Escondido',
    'Puerto Libertador','Purísima de la Concepción','Sahagún','San Andrés de Sotavento',
    'San Antero','San Bernardo del Viento','San Carlos','San José de Uré','San Pelayo',
    'Tierralta','Tuchín','Valencia'
  ]],
  ['Cundinamarca', [
    'Agua de Dios','Albán','Anapoima','Anolaima','Arbeláez','Beltrán','Bituima',
    'Bojacá','Cabrera','Cachipay','Cajicá','Caparrapí','Cáqueza','Carmen de Carupa',
    'Chaguaní','Chía','Chipaque','Choachí','Chocontá','Cogua','Cota','Cucunubá',
    'El Colegio','El Peñón','El Rosal','Facatativá','Fomeque','Fosca','Funza',
    'Fúquene','Fusagasugá','Gachalá','Gachancipá','Gachetá','Gama','Girardot',
    'Granada','Guachetá','Guaduas','Guasca','Guataquí','Guatavita',
    'Guayabal de Síquima','Guayabetal','Gutiérrez','Jerusalén','Junín','La Calera',
    'La Mesa','La Palma','La Peña','La Vega','Lenguazaque','Macheta','Madrid','Manta',
    'Medina','Mosquera','Nariño','Nemocón','Nilo','Nimaima','Nocaima','Pacho','Paime',
    'Pandi','Paratebueno','Pasca','Puerto Salgar','Pulí','Quebradanegra','Quetame',
    'Quipile','Ricaurte','San Antonio del Tequendama','San Bernardo','San Cayetano',
    'San Francisco','San Juan de Río Seco','Sasaima','Sesquilé','Sibaté','Silvania',
    'Simijaca','Soacha','Sopó','Subachoque','Suesca','Supatá','Susa','Sutatausa',
    'Tabio','Tausa','Tena','Tibacuy','Tibirita','Tocaima','Tocancipá','Topaipí',
    'Ubalá','Ubaque','Villa de San Diego de Ubaté','Une','Útica','Venecia','Vergara',
    'Vianí','Villagómez','Villapinzón','Villeta','Viotá','Yacopí','Zipacón','Zipaquirá'
  ]],
  ['Guainía', ['Inírida','Barranco Minas','Cacahual','La Guadalupe','Mapiripana','Morichal Nuevo','Pana Pana','Puerto Colombia','San Felipe']],
  ['Guaviare', ['San José del Guaviare','Calamar','El Retorno','Miraflores']],
  ['Huila', [
    'Neiva','Acevedo','Agrado','Aipe','Algeciras','Altamira','Baraya','Campoalegre',
    'Colombia','Elías','Garzón','Gigante','Guadalupe','Hobo','Íquira','Isnos',
    'La Argentina','La Plata','Nátaga','Oporapa','Paicol','Palermo','Palestina',
    'Pital','Pitalito','Rivera','Saladoblanco','San Agustín','Santa María','Suaza',
    'Tarqui','Tello','Teruel','Tesalia','Timaná','Villavieja','Yaguará'
  ]],
  ['La Guajira', [
    'Riohacha','Albania','Barrancas','Dibulla','Distracción','El Molino','Fonseca',
    'Hatonuevo','La Jagua del Pilar','Maicao','Manaure','San Juan del Cesar','Uribia',
    'Urumita','Villanueva'
  ]],
  ['Magdalena', [
    'Santa Marta','Algarrobo','Aracataca','Ariguaní','Cerro de San Antonio','Chivolo',
    'Ciénaga','Concordia','El Banco','El Piñón','El Retén','Fundación','Guamal',
    'Nueva Granada','Pedraza','Pijiño del Carmen','Pivijay','Plato','Puebloviejo',
    'Remolino','Sabanas de San Ángel','Salamina','San Sebastián de Buenavista',
    'San Zenón','Santa Ana','Santa Bárbara de Pinto','Sitionuevo','Tenerife',
    'Zapayán','Zona Bananera'
  ]],
  ['Meta', [
    'Villavicencio','Acacías','Barranca de Upía','Cabuyaro','Castilla la Nueva',
    'Cubarral','Cumaral','El Calvario','El Castillo','El Dorado','Fuente de Oro',
    'Granada','Guamal','La Macarena','Lejanías','Mapiripán','Mesetas','La Uribe',
    'Puerto Concordia','Puerto Gaitán','Puerto Lleras','Puerto López','Puerto Rico',
    'Restrepo','San Carlos de Guaroa','San Juan de Arama','San Juanito','San Martín',
    'Vista Hermosa'
  ]],
  ['Nariño', [
    'Pasto','Albán','Aldana','Ancuya','Arboleda','Barbacoas','Belén','Buesaco',
    'Chachagüí','Colón','Consacá','Contadero','Córdoba','Cuaspud','Cumbal','Cumbitara',
    'El Charco','El Peñol','El Rosario','El Tablón de Gómez','El Tambo',
    'Francisco Pizarro','Funes','Guachucal','Guaitarilla','Gualmatán','Iles','Imués',
    'Ipiales','La Cruz','La Florida','La Llanada','La Tola','La Unión','Leiva',
    'Linares','Los Andes','Magüí','Mallama','Mosquera','Nariño','Olaya Herrera',
    'Ospina','Policarpa','Potosí','Providencia','Puerres','Pupiales','Ricaurte',
    'Roberto Payán','Samaniego','San Bernardo','San Lorenzo','San Pablo',
    'San Pedro de Cartago','Sandoná','Santa Bárbara','Santacruz','Sapuyes','Taminango',
    'Tangua','Tumaco','Túquerres','Yacuanquer'
  ]],
  ['Norte de Santander', [
    'Cúcuta','Ábrego','Arboledas','Bochalema','Bucarasica','Cácota','Cachirá',
    'Chinácota','Chitagá','Convención','Cucutilla','Durania','El Carmen','El Tarra',
    'El Zulia','Gramalote','Hacarí','Herrán','La Esperanza','La Playa','Labateca',
    'Los Patios','Lourdes','Mutiscua','Ocaña','Pamplona','Pamplonita',
    'Puerto Santander','Ragonvalia','Salazar','San Calixto','San Cayetano','Santiago',
    'Sardinata','Silos','Teorama','Tibú','Toledo','Villa Caro','Villa del Rosario'
  ]],
  ['Putumayo', [
    'Mocoa','Colón','Leguízamo','Orito','Puerto Asís','Puerto Caicedo','Puerto Guzmán',
    'San Francisco','San Miguel','Santiago','Sibundoy','Valle del Guamuez','Villagarzón'
  ]],
  ['Quindío', [
    'Armenia','Buenavista','Calarcá','Circasia','Córdoba','Filandia','Génova',
    'La Tebaida','Montenegro','Pijao','Quimbaya','Salento'
  ]],
  ['Risaralda', [
    'Pereira','Apía','Balboa','Belén de Umbría','Dosquebradas','Guática','La Celia',
    'La Virginia','Marsella','Mistrató','Palestina','Quinchía','Santa Rosa de Cabal',
    'Santuario'
  ]],
  ['San Andrés y Providencia', ['San Andrés','Providencia y Santa Catalina']],
  ['Santander', [
    'Bucaramanga','Aguada','Albania','Aratoca','Barbosa','Barichara','Barrancabermeja',
    'Betulia','Bolívar','Cabrera','California','Capitanejo','Carcasí','Cepitá',
    'Cerrito','Charalá','Charta','Chima','Chipatá','Cimitarra','Confines','Contratación',
    'Coromoro','Curití','El Carmen de Chucurí','El Guacamayo','El Peñón','El Playón',
    'Encino','Enciso','Florián','Floridablanca','Gálan','Gambita','Girón','Guaca',
    'Guadalupe','Guapotá','Guavatá','Güepsa','Hato','Jesús María','La Belleza',
    'La Paz','Landázuri','Lebríja','Los Santos','Macaravita','Málaga','Matanza',
    'Mogotes','Molagavita','Ocamonte','Oiba','Onzaga','Palmar','Palmas del Socorro',
    'Páramo','Piedecuesta','Pinchote','Puente Nacional','Puerto Parra','Puerto Wilches',
    'Rionegro','Sabana de Torres','San Andrés','San Benito','San Gil','San Joaquín',
    'San José de Miranda','San Miguel','San Vicente de Chucurí','Santa Bárbara',
    'Santa Helena del Opón','Simacota','Socorro','Suaita','Sucre','Suratá','Tona',
    'Valle de San José','Vélez','Vetas','Villanueva','Zapatoca'
  ]],
  ['Sucre', [
    'Sincelejo','Buenavista','Caimito','Chalán','Colosó','Corozal','Coveñas',
    'El Roble','Galeras','Guaranda','La Unión','Los Palmitos','Majagual','Morroa',
    'Ovejas','Palmito','Sampués','San Benito Abad','San Juan de Betulia','San Marcos',
    'San Onofre','San Pedro','Santiago de Tolú','Sincé','Sucre','Tolú Viejo'
  ]],
  ['Tolima', [
    'Ibagué','Alpujarra','Alvarado','Ambalema','Anzoátegui','Ataco','Cajamarca',
    'Carmen de Apicalá','Casabianca','Chaparral','Coello','Coyaima','Cunday','Dolores',
    'Espinal','Falan','Flandes','Fresno','Guamo','Herveo','Honda','Icononzo','Lérida',
    'Líbano','Mariquita','Melgar','Murillo','Natagaima','Ortega','Palocabildo',
    'Piedras','Planadas','Prado','Purificación','Rioblanco','Roncesvalles','Rovira',
    'Saldaña','San Antonio','San Luis','Santa Isabel','Suárez','Valle de San Juan',
    'Venadillo','Villahermosa','Villarrica'
  ]],
  ['Valle del Cauca', [
    'Cali','Alcalá','Andalucía','Ansermanuevo','Argelia','Bolívar','Buenaventura',
    'Guadalajara de Buga','Bugalagrande','Caicedonia','Calima','Candelaria','Cartago',
    'Dagua','El Águila','El Cairo','El Cerrito','El Dovio','Florida','Ginebra',
    'Guacarí','Jamundí','La Cumbre','La Unión','La Victoria','Obando','Palmira',
    'Pradera','Restrepo','Riofrío','Roldanillo','San Pedro','Sevilla','Toro','Trujillo',
    'Tuluá','Ulloa','Versalles','Vijes','Yotoco','Yumbo','Zarzal'
  ]],
  ['Vaupés', ['Mitú','Carurú','Taraira']],
  ['Vichada', ['Puerto Carreño','Cumaribo','La Primavera','Santa Rosalía']],
];

(function () {
  function buildCityOptions(cities, selected) {
    var html = '<option value="">— Municipio —</option>';
    cities.forEach(function (c) {
      html += '<option value="' + c + '"' + (c === selected ? ' selected' : '') + '>' + c + '</option>';
    });
    return html;
  }

  function buildDeptOptions(selected) {
    var html = '<option value="">— Departamento —</option>';
    COLOMBIA_DATA.forEach(function (d) {
      html += '<option value="' + d[0] + '"' + (d[0] === selected ? ' selected' : '') + '>' + d[0] + '</option>';
    });
    return html;
  }

  function findEntry(deptName) {
    return COLOMBIA_DATA.find(function (d) { return d[0] === deptName; }) || null;
  }

  function getDeptForCity(city) {
    for (var i = 0; i < COLOMBIA_DATA.length; i++) {
      if (COLOMBIA_DATA[i][1].indexOf(city) !== -1) return COLOMBIA_DATA[i][0];
    }
    return '';
  }

  /* Collect groups: { groupKey → { depts:[], cities:[] } } */
  function collectGroups() {
    var groups = {};
    document.querySelectorAll('.dept-select[data-location-group]').forEach(function (el) {
      var g = el.dataset.locationGroup;
      if (!groups[g]) groups[g] = { depts: [], cities: [] };
      groups[g].depts.push(el);
    });
    document.querySelectorAll('.city-select[data-location-group]').forEach(function (el) {
      var g = el.dataset.locationGroup;
      if (!groups[g]) groups[g] = { depts: [], cities: [] };
      groups[g].cities.push(el);
    });
    return groups;
  }

  function initGroup(group) {
    /* Build dept options if not done yet */
    group.depts.forEach(function (deptSel) {
      if (!deptSel.dataset.built) {
        var currentCity = (group.cities[0] && group.cities[0].dataset.current) || '';
        var currentDept = deptSel.dataset.currentDept || (currentCity ? getDeptForCity(currentCity) : '');
        deptSel.innerHTML = buildDeptOptions(currentDept);
        deptSel.dataset.built = '1';

        /* Pre-populate city selects if a dept is already known */
        if (currentDept) {
          var entry = findEntry(currentDept);
          if (entry) {
            group.cities.forEach(function (citySel) {
              citySel.innerHTML = buildCityOptions(entry[1], citySel.dataset.current || '');
            });
          }
        }
      }

      /* Attach change listener only once */
      if (!deptSel.dataset.listenerAdded) {
        deptSel.dataset.listenerAdded = '1';
        deptSel.addEventListener('change', function () {
          var entry = findEntry(this.value);
          group.cities.forEach(function (citySel) {
            citySel.innerHTML = entry
              ? buildCityOptions(entry[1], '')
              : '<option value="">— Seleccione un departamento —</option>';
          });
          /* Keep all dept selects in the group in sync */
          group.depts.forEach(function (d) { if (d !== deptSel) d.value = deptSel.value; });
        });
      }
    });
  }

  function initAll() {
    var groups = collectGroups();
    Object.keys(groups).forEach(function (key) { initGroup(groups[key]); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  /* Re-init when modals open (selects may have been in a collapsed/hidden section) */
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-modal-open]')) setTimeout(initAll, 0);
  });
  /* Re-init when admin inline-edit rows toggle */
  document.addEventListener('click', function (e) {
    if (e.target.closest('[onclick*="toggleEdit"]')) setTimeout(initAll, 50);
  });
})();
