// Renders a list of settings (from schema.js) as label / input / reset rows.

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Small preview icons for pattern pickers (24x24, drawn for this project).
export const PATTERN_ICONS = {
  gyroid: '<path d="M2 6c3-4 5 4 8 0s5 4 8 0 3-2 4-1M2 12c3-4 5 4 8 0s5 4 8 0 3-2 4-1M2 18c3-4 5 4 8 0s5 4 8 0 3-2 4-1"/>',
  grid: '<path d="M2 8 8 2M2 14 14 2M2 20 20 2M8 22 22 8M14 22l8-8M2 2l20 20M8 2l14 14M14 2l8 8M2 8l14 14M2 14l8 8"/>',
  hex: (() => { // flat-top hexagon tiling
    const r = 3.6, dx = 1.5 * r, dy = Math.sqrt(3) * r, d = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const cx = 3 + i * dx, cy = 2 + j * dy + (i % 2 ? dy / 2 : 0);
      const p = [0, 60, 120, 180, 240, 300].map(a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)].map(v => v.toFixed(2)).join(' '));
      d.push(`M${p.join('L')}Z`);
    }
    return `<clipPath id="hexclip"><rect x="2" y="2" width="20" height="20"/></clipPath><path clip-path="url(#hexclip)" d="${d.join('')}"/>`;
  })(),
  triangle: '<path d="M2 20h20M2 13h20M2 6h20M3 22 13 2M11 22 21 2M13 22 3 2M21 22 11 2"/>',
  linear: '<path d="M2 8 8 2M2 14 14 2M2 20 20 2M8 22 22 8M14 22l8-8"/>',
  none: '<rect x="3" y="3" width="18" height="18" rx="1"/>',
  normal: '<path d="M4 3h16M6 3v18M10 3v18M14 3v18M18 3v18M4 21h16"/>',
  tree: '<path d="M12 22V13M12 13 6 7M12 13l6-6M6 7 4 3M6 7l3-4M18 7l-3-4M18 7l2-4M9 22h6"/>',
};
const icon = key => PATTERN_ICONS[key]
  ? `<svg class="pat-icon" viewBox="0 0 24 24" aria-hidden="true">${PATTERN_ICONS[key]}</svg>` : '';

const same = (a, b) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

function inputHtml(d, v) {
  const id = `set-${d.key}`;
  switch (d.type) {
    case 'bool':
      return `<input type="checkbox" id="${id}" data-key="${d.key}" ${v ? 'checked' : ''}>`;
    case 'select':
      if (d.icons) {
        // icon dropdown: button + popup list, value lives on the button
        return `<span class="icon-select" data-key="${d.key}">
          <button type="button" class="admin-select icon-select-btn" id="${id}" data-key="${d.key}" data-value="${escapeHtml(v)}" aria-haspopup="listbox">
            ${icon(v)}<span>${escapeHtml(d.options[v] ?? v)}</span></button>
          <span class="icon-select-menu hidden" role="listbox">${Object.entries(d.options).map(([k, label]) =>
            `<button type="button" role="option" data-pick="${k}" aria-selected="${k === v}">${icon(k)}<span>${escapeHtml(label)}</span></button>`).join('')}
          </span></span>`;
      }
      return `<select class="admin-select" id="${id}" data-key="${d.key}">${Object.entries(d.options)
        .map(([k, label]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`;
    case 'text':
      return `<input class="admin-input" type="text" id="${id}" data-key="${d.key}" value="${escapeHtml(v)}">`;
    case 'gcode':
      return `<textarea id="${id}" data-key="${d.key}" spellcheck="false">${escapeHtml(v)}</textarea>`;
    default:
      return `<input class="admin-input" type="number" id="${id}" data-key="${d.key}" value="${v ?? ''}"
        ${d.step != null ? `step="${d.step}"` : ''} ${d.min != null ? `min="${d.min}"` : ''} ${d.max != null ? `max="${d.max}"` : ''}
        ${d.optional ? 'placeholder="default"' : ''}>${d.unit ? `<span class="unit">${escapeHtml(d.unit)}</span>` : ''}`;
  }
}

/**
 * @param {HTMLElement} el container
 * @param {object[]} defs schema entries
 * @param {object} opts { values, base, tab, advanced, search, onChange(key, value), onReset(key) }
 */
export function renderSettings(el, defs, opts) {
  const { values, base, tab, advanced, search } = opts;
  const q = (search || '').trim().toLowerCase();
  const visible = defs.filter(d => {
    if (q) return (d.label + ' ' + d.section + ' ' + (d.tip || '')).toLowerCase().includes(q);
    if (tab && d.tab !== tab) return false;
    if (d.adv && !advanced) return false;
    if (d.show && !d.show(values)) return false;
    return true;
  });

  if (!visible.length) {
    el.innerHTML = `<p class="set-empty">${q ? 'No settings match.' : 'Nothing here. Turn on Advanced to see more.'}</p>`;
    return;
  }

  const sections = new Map();
  for (const d of visible) {
    const key = q ? `${d.tab ? d.tab[0].toUpperCase() + d.tab.slice(1) + ' › ' : ''}${d.section}` : d.section;
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(d);
  }

  el.innerHTML = [...sections].map(([name, list]) => `
    <div class="set-section">
      <div class="section-heading">${escapeHtml(name)}</div>
      ${list.map(d => {
        const v = values[d.key];
        const modified = base && !same(v, base[d.key]);
        if (d.type === 'gcode') {
          return `<div class="set-row gcode ${modified ? 'modified' : ''}">${inputHtml(d, v)}</div>`;
        }
        return `<div class="set-row ${modified ? 'modified' : ''}" ${d.tip ? `title="${escapeHtml(d.tip)}"` : ''}>
          <label class="set-label" for="set-${d.key}">${escapeHtml(d.label)}${d.tip ? '<span class="tip">ⓘ</span>' : ''}</label>
          <span class="set-input">${inputHtml(d, v)}</span>
          <button class="set-reset" data-reset="${d.key}" title="Reset to preset value" aria-label="Reset ${escapeHtml(d.label)}">↺</button>
        </div>`;
      }).join('')}
    </div>`).join('');

  el.onchange = e => {
    const key = e.target.dataset.key;
    if (!key) return;
    const d = defs.find(x => x.key === key);
    let v;
    if (d.type === 'bool') v = e.target.checked;
    else if (d.type === 'number') {
      if (e.target.value === '' && d.optional) v = null;
      else {
        v = Number(e.target.value);
        if (!Number.isFinite(v)) { e.target.value = values[key] ?? ''; return; }
        if (d.min != null) v = Math.max(d.min, v);
        if (d.max != null) v = Math.min(d.max, v);
      }
    } else v = e.target.value;
    opts.onChange(key, v);
  };
  el.onclick = e => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const key = pick.closest('.icon-select').dataset.key;
      opts.onChange(key, pick.dataset.pick);
      return;
    }
    const btn = e.target.closest('.icon-select-btn');
    if (btn) {
      const menu = btn.nextElementSibling;
      const open = menu.classList.contains('hidden');
      el.querySelectorAll('.icon-select-menu').forEach(m => m.classList.add('hidden'));
      menu.classList.toggle('hidden', !open);
      if (open) {
        // fixed positioning so the sidebar's scroll area can't clip the menu
        const r = btn.getBoundingClientRect(), h = menu.offsetHeight, w = menu.offsetWidth;
        menu.style.left = `${Math.max(8, r.right - w)}px`;
        menu.style.top = `${r.bottom + 3 + h > innerHeight ? Math.max(8, r.top - 3 - h) : r.bottom + 3}px`;
        menu.querySelector('[aria-selected="true"]')?.focus();
      }
      e.stopPropagation();
      return;
    }
    const key = e.target.closest('[data-reset]')?.dataset.reset;
    if (key) opts.onReset(key);
  };
}

// close icon dropdowns on outside click / Escape
document.addEventListener('click', e => {
  if (!e.target.closest('.icon-select')) document.querySelectorAll('.icon-select-menu').forEach(m => m.classList.add('hidden'));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.icon-select-menu').forEach(m => m.classList.add('hidden'));
});

export function renderTabs(el, tabs, active, onPick) {
  el.innerHTML = tabs.map(t => `<button class="filter-btn ${t.id === active ? 'active' : ''}" data-tab="${t.id}">${escapeHtml(t.label)}</button>`).join('');
  el.onclick = e => {
    const id = e.target.closest('[data-tab]')?.dataset.tab;
    if (id) onPick(id);
  };
}
