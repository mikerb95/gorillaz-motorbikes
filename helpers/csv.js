'use strict';
// CSV mínimo (RFC 4180): comillas, comillas dobles escapadas y saltos de línea
// dentro de campos. Detecta el separador (coma o punto y coma: Excel en
// español exporta con punto y coma). Sin dependencias.

function detectDelimiter(text) {
  const first = String(text).split(/\r?\n/, 1)[0] || '';
  const count = (ch) => first.split(ch).length - 1;
  return count(';') > count(',') ? ';' : ',';
}

function parseCSV(text, delimiter) {
  const src = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === d) { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

// Filas como objetos usando la primera fila de encabezados (normalizados).
function parseCSVObjects(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_'));
  return rows.slice(1).map((r, idx) => {
    const o = { __line: idx + 2 };
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

function toCSV(rows, delimiter = ';') {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(esc).join(delimiter)).join('\r\n')}\r\n`;
}

module.exports = { detectDelimiter, parseCSV, parseCSVObjects, toCSV };
