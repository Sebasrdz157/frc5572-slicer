// Renders a list of settings (from schema.js) as label / input / reset rows.

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const same = (a, b) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

function inputHtml(d, v) {
  const id = `set-${d.key}`;
  switch (d.type) {
    case 'bool':
      return `<input type="checkbox" id="${id}" data-key="${d.key}" ${v ? 'checked' : ''}>`;
    case 'select':
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
    const key = e.target.closest('[data-reset]')?.dataset.reset;
    if (key) opts.onReset(key);
  };
}

export function renderTabs(el, tabs, active, onPick) {
  el.innerHTML = tabs.map(t => `<button class="filter-btn ${t.id === active ? 'active' : ''}" data-tab="${t.id}">${escapeHtml(t.label)}</button>`).join('');
  el.onclick = e => {
    const id = e.target.closest('[data-tab]')?.dataset.tab;
    if (id) onPick(id);
  };
}
