'use strict';
// Guías del blog (mantenimiento, revisión técnico-mecánica, cuidado por tipo de
// moto). Se editan en /admin/guias y se guardan en app_settings('guides').
// El cuerpo usa un Markdown mínimo (títulos, párrafos, listas, negrita y
// enlaces) que se convierte a HTML escapando todo lo demás.

const settings = require('./settings');

function allGuides() {
  const list = settings.get('guides');
  return Array.isArray(list) ? list : [];
}

const publishedGuides = () => allGuides()
  .filter((g) => g && g.status === 'published' && g.slug && g.title)
  .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

const findGuide = (slug) => allGuides().find((g) => g.slug === slug) || null;

async function saveGuides(list) {
  await settings.set('guides', list);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Enlaces: solo rutas internas (/...) o https.
function inline(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^\s)]*)\)/g, (m, label, href) => {
      const ext = href.startsWith('https://');
      return `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
    });
}

function renderMarkdown(src) {
  const blocks = String(src || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  const out = [];
  for (const block of blocks) {
    const b = block.trim();
    if (!b) continue;
    const h = b.match(/^(#{2,3})\s+(.+)$/);
    if (h && !b.includes('\n')) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const lines = b.split('\n');
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`);
      continue;
    }
    if (lines.every((l) => /^\d+\.\s+/.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
      continue;
    }
    out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

module.exports = { allGuides, publishedGuides, findGuide, saveGuides, renderMarkdown };
