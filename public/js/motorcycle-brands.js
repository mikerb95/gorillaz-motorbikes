'use strict';
/* Marcas de motos comunes en el mercado colombiano, en el formato oficial a usar */
const MOTORCYCLE_BRANDS = [
  'AKT', 'Auteco', 'Bajaj', 'Benelli', 'BMW Motorrad', 'CFMoto', 'Ducati', 'Hero',
  'Honda', 'Husqvarna', 'Italika', 'Kawasaki', 'Keeway', 'KTM', 'Kymco', 'MD',
  'Royal Enfield', 'Suzuki', 'SYM', 'Triumph', 'TVS', 'UM', 'Vespa', 'Victory', 'Yamaha'
];

(function () {
  function normalize(str) {
    return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function closeDropdown(list) {
    list.innerHTML = '';
    list.hidden = true;
  }

  function openDropdown(input, list) {
    var query = normalize(input.value.trim());
    if (query.length < 3) { closeDropdown(list); return; }

    var matches = MOTORCYCLE_BRANDS.filter(function (b) {
      return normalize(b).indexOf(query) !== -1;
    }).slice(0, 8);

    if (!matches.length) { closeDropdown(list); return; }

    list.innerHTML = matches.map(function (b) {
      return '<li role="option">' + b + '</li>';
    }).join('');
    list.hidden = false;
  }

  function initField(input) {
    if (input.dataset.brandSuggestInit) return;
    input.dataset.brandSuggestInit = '1';

    var wrap = document.createElement('div');
    wrap.className = 'brand-suggest';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var list = document.createElement('ul');
    list.className = 'brand-suggest-list';
    list.hidden = true;
    wrap.appendChild(list);

    input.setAttribute('autocomplete', 'off');

    input.addEventListener('input', function () { openDropdown(input, list); });
    input.addEventListener('focus', function () { openDropdown(input, list); });

    list.addEventListener('mousedown', function (e) {
      var li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      input.value = li.textContent;
      closeDropdown(list);
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) closeDropdown(list);
    });
  }

  function initAll() {
    document.querySelectorAll('input[data-brand-suggest]').forEach(initField);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
