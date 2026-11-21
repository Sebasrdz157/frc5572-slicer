import { Viewer } from './viewer.js';
import { loadModelFile, ACCEPTED } from './loaders.js';
import { PROCESS, PROCESS_TABS, FILAMENT, FILAMENT_TABS, PRINTER, PRINTER_TABS, RANGE_FIELDS, byKey } from './schema.js';
import { SYSTEM_PRINTERS, SYSTEM_FILAMENTS, systemProcesses, systemFilamentValues, systemPrinterValues, loadUserPresets, saveUserPresets } from './presets.js';
import { toKiri, rangeFieldsToKiri } from './kiri-map.js';
import { postProcess } from './postprocess.js';
import { parseGcode, quickMaxZ, formatDuration, FEATURES, FEATURE_KEYS } from './gcode.js';
import { renderSettings, renderTabs, escapeHtml } from './settings-ui.js';

const $ = id => document.getElementById(id);
const STATE_KEY = 'frc5572-slicer-state-v2';

// ======================================================================
// State
// ======================================================================
let user = loadUserPresets();
let state = loadState();
let lastSlice = null;   // { gcode, info, P, F, S, name }
let slicing = false;
let view = 'prepare';

function loadState() {
  const d = {
    printerId: 'k1c', filamentId: 'pla', processId: 'k1c/0.20',
    edits: { printer: {}, filament: {}, process: {} },
    tab: 'quality', advanced: false, ranges: [], markers: [],
  };
  try {
    const s = { ...d, ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') };
    s.edits = { printer: {}, filament: {}, process: {}, ...s.edits };
    if (!printerBaseExists(s.printerId)) s.printerId = d.printerId;
    return s;
  } catch { return d; }
}
function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify({ ...state, markers: [] })); } catch { /* storage unavailable */ }
}
function printerBaseExists(id) { return !!(SYSTEM_PRINTERS[id] || user.printer[id]); }

const isUser = id => id.startsWith('u:');
const newId = () => 'u:' + Math.random().toString(36).slice(2, 10);

/** The system printer a printer preset descends from (for filament temps, process presets). */
function systemPrinterOf(printerId) {
  return isUser(printerId) ? (user.printer[printerId]?.base || 'k1c') : printerId;
}

function baseValues(scope) {
  if (scope === 'printer') {
    const id = state.printerId;
    return isUser(id) ? { ...user.printer[id].values } : { name: SYSTEM_PRINTERS[id].name, ...systemPrinterValues(id) };
  }
  if (scope === 'filament') {
    const id = state.filamentId;
    return isUser(id) ? { ...user.filament[id].values } : { name: SYSTEM_FILAMENTS[id].name, ...systemFilamentValues(id, systemPrinterOf(state.printerId)) };
  }
  const id = state.processId;
  if (isUser(id)) return { ...user.process[id].values };
  const sys = systemProcesses(systemPrinterOf(state.printerId))[id];
  return { name: sys.name, ...sys.values };
}

const values = scope => ({ ...baseValues(scope), ...state.edits[scope] });
const isModified = scope => Object.keys(state.edits[scope]).length > 0;

function presetName(scope) {
  const id = state[`${scope}Id`];
  if (scope === 'printer') return isUser(id) ? user.printer[id].name : SYSTEM_PRINTERS[id].name;
  if (scope === 'filament') return isUser(id) ? user.filament[id].name : SYSTEM_FILAMENTS[id].name;
  return isUser(id) ? user.process[id].name : systemProcesses(systemPrinterOf(state.printerId))[id]?.name;
}

/** Process presets that belong to the current printer. */
function processChoices() {
  const sysPrinter = systemPrinterOf(state.printerId);
  const sys = Object.entries(systemProcesses(sysPrinter)).map(([id, p]) => [id, p.name]);
  const usr = Object.entries(user.process).filter(([, p]) => p.printer === sysPrinter).map(([id, p]) => [id, p.name]);
  return { sys, usr };
}

function setEdit(scope, key, v) {
  const base = baseValues(scope);
  const same = base[key] === v || (typeof v === 'number' && typeof base[key] === 'number' && Math.abs(base[key] - v) < 1e-9);
  if (same) delete state.edits[scope][key];
  else state.edits[scope][key] = v;
  onSettingsChanged();
}

// ======================================================================
// Sidebar
// ======================================================================
function option(id, label, selected) {
  return `<option value="${escapeHtml(id)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderPresetSelects() {
  const pSel = state.printerId;
  $('printer-select').innerHTML =
    `<optgroup label="System presets">${Object.entries(SYSTEM_PRINTERS).map(([id, p]) => option(id, p.name + (id === pSel && isModified('printer') ? ' (modified)' : ''), id === pSel)).join('')}</optgroup>` +
    (Object.keys(user.printer).length ? `<optgroup label="User presets">${Object.entries(user.printer).map(([id, p]) => option(id, p.name + (id === pSel && isModified('printer') ? ' (modified)' : ''), id === pSel)).join('')}</optgroup>` : '');

  const fSel = state.filamentId;
  $('filament-select').innerHTML =
    `<optgroup label="System presets">${Object.entries(SYSTEM_FILAMENTS).map(([id, f]) => option(id, f.name + (id === fSel && isModified('filament') ? ' (modified)' : ''), id === fSel)).join('')}</optgroup>` +
    (Object.keys(user.filament).length ? `<optgroup label="User presets">${Object.entries(user.filament).map(([id, f]) => option(id, f.name + (id === fSel && isModified('filament') ? ' (modified)' : ''), id === fSel)).join('')}</optgroup>` : '');

  const { sys, usr } = processChoices();
  const sSel = state.processId;
  const mod = id => id === sSel && isModified('process') ? ' (modified)' : '';
  $('process-select').innerHTML =
    `<optgroup label="System presets">${sys.map(([id, n]) => option(id, n + mod(id), id === sSel)).join('')}</optgroup>` +
    (usr.length ? `<optgroup label="User presets">${usr.map(([id, n]) => option(id, n + mod(id), id === sSel)).join('')}</optgroup>` : '');
}

function renderFilamentInfo() {
  const P = values('printer'), F = values('filament');
  $('filament-summary').textContent =
    `${F.filament_type} · nozzle ${F.nozzle_temperature_initial_layer}/${F.nozzle_temperature} °C · bed ${F.bed_temperature_initial_layer}/${F.bed_temperature} °C · fan ${F.fan_speed}%`;
  const warn = [];
  if (F.required_nozzle_hrc && !P.hardened_nozzle) warn.push(`${F.filament_type} needs a hardened nozzle. This printer preset doesn't have one, so the nozzle will wear quickly.`);
  if (F.needs_enclosure && !P.enclosed) warn.push(`${F.filament_type} warps on an open printer. Expect lifting on larger parts.`);
  $('filament-warning').classList.toggle('hidden', !warn.length);
  $('filament-warning').textContent = warn.join(' ');
}

function renderProcessSettings() {
  renderTabs($('process-tabs'), PROCESS_TABS, state.tab, id => { state.tab = id; $('settings-search').value = ''; renderProcessSettings(); saveState(); });
  renderSettings($('process-settings'), PROCESS, {
    values: values('process'), base: baseValues('process'),
    tab: state.tab, advanced: state.advanced, search: $('settings-search').value,
    onChange: (k, v) => setEdit('process', k, v),
    onReset: k => { delete state.edits.process[k]; onSettingsChanged(); },
  });
}

function onSettingsChanged() {
  const P = values('printer');
  viewer.setBed({ x: P.bed_x, y: P.bed_y, z: P.printable_height, originCenter: P.origin_center });
  renderPresetSelects();
  renderFilamentInfo();
  renderProcessSettings();
  renderRanges();
  renderObjects();
  saveState();
  invalidate();
}

$('printer-select').addEventListener('change', e => switchPrinter(e.target.value));
$('filament-select').addEventListener('change', e => {
  if (isModified('filament') && !confirm('Discard unsaved filament changes?')) { renderPresetSelects(); return; }
  state.filamentId = e.target.value; state.edits.filament = {}; onSettingsChanged();
});
$('process-select').addEventListener('change', e => {
  if (isModified('process') && !confirm('Discard unsaved process changes?')) { renderPresetSelects(); return; }
  state.processId = e.target.value; state.edits.process = {}; onSettingsChanged();
});

function switchPrinter(id) {
  if (isModified('printer') && !confirm('Discard unsaved printer changes?')) { renderPresetSelects(); return; }
  const oldSuffix = isUser(state.processId) ? '0.20' : state.processId.split('/')[1];
  state.printerId = id;
  state.edits.printer = {};
  const sys = systemPrinterOf(id);
  // keep the same kind of process preset (and the user's unsaved process edits)
  if (isUser(state.processId) && user.process[state.processId]?.printer === sys) { /* still compatible */ }
  else state.processId = `${sys}/${oldSuffix}`;
  if (!systemProcesses(sys)[state.processId] && !isUser(state.processId)) state.processId = `${sys}/0.20`;
  onSettingsChanged();
}

$('settings-search').addEventListener('input', renderProcessSettings);
$('advanced-toggle').addEventListener('change', e => { state.advanced = e.target.checked; renderProcessSettings(); saveState(); });

// ---------- process preset actions ----------
$('process-save').addEventListener('click', () => savePreset('process', false));
$('process-more').addEventListener('click', e => { e.stopPropagation(); $('process-menu').classList.toggle('hidden'); });
document.addEventListener('click', () => $('process-menu').classList.add('hidden'));
$('process-menu').addEventListener('click', e => {
  const act = e.target.dataset.act;
  if (!act) return;
  if (act === 'save-as') savePreset('process', true);
  if (act === 'reset') { state.edits.process = {}; onSettingsChanged(); }
  if (act === 'delete') deletePreset('process');
  if (act === 'export') exportPresets();
  if (act === 'import') $('import-input').click();
});

function savePreset(scope, asNew) {
  const id = state[`${scope}Id`];
  const store = user[scope];
  const vals = values(scope);
  if (!asNew && isUser(id)) {
    store[id].values = vals;
  } else {
    const suggestion = `${presetName(scope).replace(/ \(modified\)$/, '')} (copy)`;
    const name = prompt(`Name for the new ${scope} preset:`, suggestion);
    if (!name) return;
    const nid = newId();
    store[nid] = { name, values: { ...vals, name } };
    if (scope === 'process') store[nid].printer = systemPrinterOf(state.printerId);
    if (scope === 'printer') store[nid].base = systemPrinterOf(state.printerId);
    state[`${scope}Id`] = nid;
  }
  state.edits[scope] = {};
  saveUserPresets(user);
  onSettingsChanged();
  toast(`Saved ${scope} preset "${presetName(scope)}".`);
}

function deletePreset(scope) {
  const id = state[`${scope}Id`];
  if (!isUser(id)) { toast('System presets can\'t be deleted.'); return; }
  if (!confirm(`Delete the ${scope} preset "${presetName(scope)}"? This can't be undone.`)) return;
  delete user[scope][id];
  saveUserPresets(user);
  if (scope === 'printer') state.printerId = 'k1c';
  if (scope === 'filament') state.filamentId = 'pla';
  if (scope === 'process') state.processId = `${systemPrinterOf(state.printerId)}/0.20`;
  state.edits[scope] = {};
  onSettingsChanged();
}

function exportPresets() {
  const blob = new Blob([JSON.stringify({ format: 'frc5572-slicer-presets', version: 2, presets: user }, null, 2)], { type: 'application/json' });
  download(blob, 'frc5572-slicer-presets.json');
}

$('import-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'frc5572-slicer-presets') throw new Error('not a 5572 Slicer preset file');
    let n = 0;
    for (const scope of ['printer', 'filament', 'process']) {
      for (const [id, p] of Object.entries(data.presets?.[scope] || {})) {
        if (!p?.name || typeof p.values !== 'object') continue;
        user[scope][isUser(id) ? id : newId()] = p; n++;
      }
    }
    saveUserPresets(user);
    onSettingsChanged();
    toast(`Imported ${n} preset${n === 1 ? '' : 's'}.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`, true);
  }
});

// ======================================================================
// Printer / filament editor (modal)
// ======================================================================
let modal = null; // { scope, tab }
function openModal(scope) {
  modal = { scope, tab: scope === 'printer' ? 'basic' : 'filament' };
  $('modal-title').textContent = scope === 'printer' ? 'Printer settings' : 'Filament settings';
  $('settings-overlay').classList.remove('hidden');
  $('settings-modal').classList.remove('hidden');
  renderModal();
}
function closeModal() {
  modal = null;
  $('settings-overlay').classList.add('hidden');
  $('settings-modal').classList.add('hidden');
}
function renderModal() {
  if (!modal) return;
  const { scope } = modal;
  $('modal-intro').textContent = `${presetName(scope)}${isModified(scope) ? ' (modified)' : ''}. Changes apply right away; save them to keep them as a preset.`;
  renderTabs($('modal-tabs'), scope === 'printer' ? PRINTER_TABS : FILAMENT_TABS, modal.tab, id => { modal.tab = id; renderModal(); });
  renderSettings($('modal-settings'), scope === 'printer' ? PRINTER : FILAMENT, {
    values: values(scope), base: baseValues(scope), tab: modal.tab, advanced: true,
    onChange: (k, v) => { setEdit(scope, k, v); renderModal(); },
    onReset: k => { delete state.edits[scope][k]; onSettingsChanged(); renderModal(); },
  });
}
$('edit-printer').addEventListener('click', () => openModal('printer'));
$('edit-filament').addEventListener('click', () => openModal('filament'));
$('modal-close').addEventListener('click', closeModal);
$('settings-overlay').addEventListener('click', closeModal);
$('modal-reset').addEventListener('click', () => { state.edits[modal.scope] = {}; onSettingsChanged(); renderModal(); });
$('modal-save').addEventListener('click', () => { savePreset(modal.scope, false); renderModal(); });
$('modal-save-as').addEventListener('click', () => { savePreset(modal.scope, true); renderModal(); });

// ======================================================================
// Plate: viewer, files, objects
// ======================================================================
const viewer = new Viewer($('viewport'));
window.slicerDebug = { viewer, get slice() { return lastSlice; }, get state() { return state; }, values };

async function addFiles(files) {
  const errs = [];
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED.includes(ext)) { errs.push(`${file.name}: not an STL, 3MF or OBJ file`); continue; }
    try {
      const { geometry, name } = await loadModelFile(file);
      const part = viewer.addPart(geometry, name);
      const s = viewer.partSize(part);
      part.tiny = Math.max(s.x, s.y, s.z) < 12;
    } catch (err) {
      errs.push(`${file.name}: ${err.message}`);
    }
  }
  if (errs.length) toast(errs.join('\n'), true);
}

$('file-input').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
const stage = $('stage');
let dragDepth = 0;
stage.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('drop-overlay').classList.remove('hidden'); });
stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').classList.add('hidden'); } });
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('drop-overlay').classList.add('hidden');
  if (view === 'preview') setView('prepare');
  addFiles([...e.dataTransfer.files]);
});

function renderObjects() {
  const has = viewer.parts.length > 0;
  $('empty-state').classList.toggle('hidden', has || view === 'preview');
  $('objects-panel').classList.toggle('hidden', !has || view === 'preview');
  $('btn-slice').disabled = !has || slicing;
  $('object-count').textContent = viewer.parts.length;
  $('object-list').innerHTML = viewer.parts.map(p => {
    const s = viewer.partSize(p);
    return `<li data-id="${p.id}" class="${p === viewer.selected ? 'sel' : ''} ${p.out ? 'out' : ''}" title="${p.out ? 'Outside the printable area' : ''}">
      <span class="name">${escapeHtml(p.name)}</span><span class="dims">${p.out ? 'off plate · ' : ''}${s.x.toFixed(0)}×${s.y.toFixed(0)}×${s.z.toFixed(0)}</span></li>`;
  }).join('');
  for (const id of ['t-orient', 't-layflat', 't-dup', 't-del']) $(id).disabled = !viewer.selected;
  $('t-arrange').disabled = !has;
  renderInspector();
  const out = viewer.parts.filter(p => p.out).length;
  if (view === 'preview' && lastSlice) return; // preview shows time / weight / cost there instead
  $('topbar-status').textContent = out ? `${out} object${out > 1 ? 's' : ''} outside the printable area` : has ? `${viewer.parts.length} object${viewer.parts.length > 1 ? 's' : ''} on plate` : '';
}

function renderInspector() {
  const p = viewer.selected;
  $('inspector').classList.toggle('hidden', !p);
  if (!p) return;
  const pos = viewer.printerPosition(p), rot = viewer.rotationDeg(p), size = viewer.partSize(p), sc = p.mesh.scale;
  const set = (xf, ax, v, digits) => {
    const el = document.querySelector(`[data-xf="${xf}"][data-ax="${ax}"]`);
    if (el && document.activeElement !== el) el.value = (+v).toFixed(digits);
  };
  set('pos', 'x', pos.x, 2); set('pos', 'y', pos.y, 2);
  for (const ax of ['x', 'y', 'z']) {
    set('rot', ax, rot[ax], 1);
    set('scale', ax, sc[ax] * 100, 1);
    set('size', ax, size[ax], 2);
  }
  $('tiny-hint').classList.toggle('hidden', !(p.tiny && sc.x === 1));
}

$('object-list').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (li) viewer.select(viewer.parts.find(p => p.id === Number(li.dataset.id)));
});

$('inspector').addEventListener('change', e => {
  const p = viewer.selected;
  const { xf, ax } = e.target.dataset;
  if (!p || !xf) return;
  const v = Number(e.target.value);
  if (!Number.isFinite(v)) return renderInspector();
  const uniform = $('uniform-scale').checked;
  if (xf === 'pos') {
    const pos = viewer.printerPosition(p);
    viewer.setPrinterPosition(p, ax === 'x' ? v : pos.x, ax === 'y' ? v : pos.y);
  } else if (xf === 'rot') {
    viewer.setRotationDeg(p, { ...viewer.rotationDeg(p), [ax]: v });
  } else if (xf === 'scale' || xf === 'size') {
    if (v <= 0) return renderInspector();
    const sc = p.mesh.scale.clone();
    const size = viewer.partSize(p);
    // size edits are in world axes; approximate through the current world size ratio
    const factor = xf === 'scale' ? (v / 100) / sc[ax] : v / size[ax];
    const next = uniform ? { x: sc.x * factor, y: sc.y * factor, z: sc.z * factor } : { x: sc.x, y: sc.y, z: sc.z, [ax]: sc[ax] * factor };
    viewer.setScale(p, next);
  }
});
$('btn-inch').addEventListener('click', () => {
  const p = viewer.selected;
  if (p) viewer.setScale(p, { x: p.mesh.scale.x * 25.4, y: p.mesh.scale.y * 25.4, z: p.mesh.scale.z * 25.4 });
});
$('btn-reset-xf').addEventListener('click', () => {
  const p = viewer.selected;
  if (!p) return;
  viewer.setScale(p, { x: 1, y: 1, z: 1 });
  viewer.setRotationDeg(p, { x: 0, y: 0, z: 0 });
});

$('t-arrange').addEventListener('click', () => viewer.arrange());
$('t-orient').addEventListener('click', () => viewer.selected && viewer.autoOrient(viewer.selected));
$('t-layflat').addEventListener('click', () => viewer.setLayFlat(!viewer.layFlatArmed));
$('t-dup').addEventListener('click', () => viewer.selected && viewer.duplicate(viewer.selected));
$('t-del').addEventListener('click', () => viewer.selected && viewer.removePart(viewer.selected));
document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => viewer.resetCamera(b.dataset.cam)));

viewer.addEventListener('change', () => { invalidate(); renderObjects(); });
viewer.addEventListener('drag', renderInspector);
viewer.addEventListener('select', renderObjects);
viewer.addEventListener('layflat', e => $('t-layflat').classList.toggle('active', e.detail));

// ---------- height range modifiers ----------
function renderRanges() {
  const el = $('ranges');
  if (!state.ranges.length) {
    el.innerHTML = '<p class="range-empty">Use different settings for part of the height, e.g. 100% infill around a bearing pocket.</p>';
    return;
  }
  const S = values('process');
  el.innerHTML = state.ranges.map((r, i) => `
    <div class="range-card" data-i="${i}">
      <div class="range-head">
        <span>Z</span><input class="admin-input" type="number" step="0.2" min="0" data-r="from" value="${r.from}">
        <span>to</span><input class="admin-input" type="number" step="0.2" min="0" data-r="to" value="${r.to}">
        <span>mm</span>
        <button class="icon-btn" data-r="remove" title="Remove range" aria-label="Remove range">✕</button>
      </div>
      ${Object.entries(r.fields).map(([k, v]) => {
        const d = byKey[k];
        const input = d.type === 'select'
          ? `<select class="admin-select" data-f="${k}">${Object.entries(d.options).map(([o, l]) => `<option value="${o}" ${o === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`
          : `<input class="admin-input" type="number" data-f="${k}" value="${v}" step="${d.step ?? 1}">`;
        return `<div class="range-field"><span>${escapeHtml(d.label)}${d.unit ? ` (${escapeHtml(d.unit)})` : ''}</span>${input}<button class="icon-btn" data-rm="${k}" aria-label="Remove field">✕</button></div>`;
      }).join('')}
      <select class="admin-select" data-r="add">
        <option value="">+ Add setting…</option>
        ${RANGE_FIELDS.filter(k => !(k in r.fields)).map(k => `<option value="${k}">${escapeHtml(byKey[k].label)}</option>`).join('')}
      </select>
    </div>`).join('');
  el.onchange = e => {
    const card = e.target.closest('.range-card');
    if (!card) return;
    const r = state.ranges[+card.dataset.i];
    if (e.target.dataset.r === 'from' || e.target.dataset.r === 'to') r[e.target.dataset.r] = Math.max(0, Number(e.target.value) || 0);
    else if (e.target.dataset.r === 'add' && e.target.value) r.fields[e.target.value] = S[e.target.value];
    else if (e.target.dataset.f) {
      const d = byKey[e.target.dataset.f];
      r.fields[e.target.dataset.f] = d.type === 'select' ? e.target.value : Number(e.target.value);
    }
    renderRanges(); saveState(); invalidate();
  };
  el.onclick = e => {
    const card = e.target.closest('.range-card');
    if (!card) return;
    const i = +card.dataset.i;
    if (e.target.closest('[data-r="remove"]')) state.ranges.splice(i, 1);
    else if (e.target.closest('[data-rm]')) delete state.ranges[i].fields[e.target.closest('[data-rm]').dataset.rm];
    else return;
    renderRanges(); saveState(); invalidate();
  };
}
$('add-range').addEventListener('click', () => {
  const top = Math.max(0, ...viewer.parts.map(p => viewer.box(p).max.z));
  state.ranges.push({ from: +(top * 0.4).toFixed(1), to: +(top * 0.6).toFixed(1), fields: { sparse_infill_density: 100 } });
  renderRanges(); saveState(); invalidate();
});

/** Convert Z ranges to Kiri's layer-index ranges. */
function kiriRanges(S, F) {
  const h0 = S.initial_layer_print_height, h = S.layer_height;
  const idx = z => Math.max(0, Math.floor((z - h0) / h + 1e-6) + 1);
  return state.ranges.filter(r => r.to > r.from && Object.keys(r.fields).length).map(r => ({
    lo: idx(r.from), hi: Math.max(idx(r.from), idx(r.to) - 1),
    fields: rangeFieldsToKiri(r.fields, { line_width: S.line_width, flow_ratio: F.flow_ratio }),
  }));
}

// ======================================================================
// Slice
// ======================================================================
function invalidate() {
  if (slicing) return;
  if (lastSlice) {
    lastSlice = null;
    state.markers = [];
    $('btn-export').disabled = true;
    $('tab-preview').disabled = true;
    if (view === 'preview') setView('prepare');
  }
}

function setProgress(f, label) {
  $('progress-fill').style.width = `${Math.round(f * 100)}%`;
  $('progress-text').textContent = `${label}… ${Math.round(f * 100)}%`;
}

let slicerModule;
async function runSlice() {
  if (!viewer.parts.length || slicing) return;
  if (viewer.anyOut) { toast('Some objects are outside the printable area (shown yellow). Move them onto the plate first.', true); return; }
  slicing = true;
  $('btn-slice').disabled = true;
  $('progress').classList.remove('hidden');
  setProgress(0, 'Loading slicer');
  const t0 = performance.now();
  try {
    slicerModule ||= await import('./slicer.js');
    const P = values('printer'), F = values('filament'), S = values('process');
    const { device, process } = toKiri(P, F, S);
    process.ranges = kiriRanges(S, F);
    const stl = viewer.exportSTL();
    const raw = await slicerModule.slice({ stl: stl.buffer, center: stl.center, device, process }, setProgress);
    setProgress(1, 'Building preview');
    await new Promise(r => setTimeout(r, 0));
    lastSlice = { raw, P, F, S, parts: viewer.parts.map(p => p.name) };
    state.markers = [];
    finalizeSlice();
    if (!lastSlice.info.layers) throw new Error('The slicer produced no layers. Is the model a closed solid?');
    $('btn-export').disabled = false;
    $('tab-preview').disabled = false;
    setView('preview');
    console.info(`sliced in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    console.error(err);
    lastSlice = null;
    toast(`Slicing failed: ${err?.message || err}`, true);
  } finally {
    slicing = false;
    $('progress').classList.add('hidden');
    $('btn-slice').disabled = !viewer.parts.length;
  }
}

/** Apply post-processing (accel, PA, markers) and re-parse. Fast: no re-slice. */
function finalizeSlice() {
  const { raw, P, F, S } = lastSlice;
  const gcode = postProcess(raw, { P, F, S, maxZ: quickMaxZ(raw), markers: state.markers });
  const info = parseGcode(gcode, {
    bed: { x: P.bed_x, y: P.bed_y }, originCenter: P.origin_center, accel: P.machine_max_acceleration,
    filamentDiameter: F.filament_diameter, density: F.filament_density, cost: F.filament_cost,
  });
  lastSlice.gcode = gcode;
  lastSlice.info = info;
}

function headerFor(sl) {
  const { P, F, S, info } = sl;
  return [
    `; generated by 5572 Slicer (Kiri:Moto engine) ${new Date().toISOString()}`,
    `; printer_settings_id = ${P.name}`,
    `; filament_settings_id = ${F.name}`,
    `; print_settings_id = ${S.name}`,
    `; layer_height = ${S.layer_height}`,
    `; wall_loops = ${S.wall_loops}`,
    `; sparse_infill_density = ${S.sparse_infill_density}%`,
    `; sparse_infill_pattern = ${S.sparse_infill_pattern}`,
    `; enable_support = ${S.enable_support ? 1 : 0}`,
    `; nozzle_temperature = ${F.nozzle_temperature}`,
    `; bed_temperature = ${F.bed_temperature}`,
    `; estimated printing time = ${formatDuration(info.seconds)}`,
    `; filament used [mm] = ${info.filamentMM.toFixed(1)}`,
    `; filament used [g] = ${info.grams.toFixed(2)}`,
    `; filament cost = ${info.cost.toFixed(2)}`,
    `; objects = ${sl.parts.join(', ')}`,
    ...(state.markers.length ? [`; pauses/changes at layers = ${state.markers.map(m => `${m.layer}:${m.type}`).join(', ')}`] : []),
  ].join('\n');
}

$('btn-slice').addEventListener('click', runSlice);
$('btn-export').addEventListener('click', () => {
  if (!lastSlice) return;
  const { P, F, info, parts } = lastSlice;
  const base = parts.length === 1 ? parts[0] : `${parts[0]}+${parts.length - 1}`;
  const name = `${base}_${(SYSTEM_PRINTERS[systemPrinterOf(state.printerId)]?.short || 'printer').replace(/\W+/g, '')}_${F.filament_type}_${formatDuration(info.seconds).replace(/\s/g, '')}.gcode`.replace(/[^\w.+-]/g, '_');
  download(new Blob([headerFor(lastSlice) + '\n' + lastSlice.gcode], { type: 'text/plain' }), name);
});

// ======================================================================
// Preview
// ======================================================================
let range = { lo: 1, hi: 1 };

function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  const preview = v === 'preview' && lastSlice;
  $('plate-toolbar').classList.toggle('hidden', !!preview);
  $('legend-panel').classList.toggle('hidden', !preview);
  $('layer-slider').classList.toggle('hidden', !preview);
  if (preview) {
    viewer.select(null);
    viewer.setLayFlat(false);
    viewer.showToolpaths(lastSlice.info);
    range = { lo: 1, hi: lastSlice.info.layers };
  } else {
    viewer.clearToolpaths();
  }
  renderObjects();
  if (preview) { renderLegend(); renderSlider(); }
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => !b.disabled && setView(b.dataset.view)));

function renderLegend() {
  const { info, F } = lastSlice;
  const mode = $('color-mode').value;
  const total = info.seconds || 1;
  if (mode === 'feature') {
    $('legend-table').innerHTML = `<tr><th>Line type</th><th>Time</th><th>%</th><th>Used</th></tr>` +
      FEATURE_KEYS.filter(k => info.sets[k].positions.length).map(k => {
        const st = info.stats[k], c = FEATURES[k].color.map(v => Math.round(v * 255)).join(',');
        const on = !viewer.hidden.has(k);
        return `<tr class="${on ? '' : 'off'}"><td><label><input type="checkbox" data-feat="${k}" ${on ? 'checked' : ''}>
          <span class="swatch" style="background:rgb(${c})"></span>${FEATURES[k].label}</label></td>
          <td>${formatDuration(st.time)}</td><td>${(st.time / total * 100).toFixed(1)}</td><td>${k === 'travel' ? '' : st.grams.toFixed(1) + ' g'}</td></tr>`;
      }).join('');
    $('gradient-legend').classList.add('hidden');
  } else {
    const r = viewer.colorRange(mode);
    const unit = { speed: 'mm/s', flow: 'mm³/s', z: 'mm' }[mode];
    $('legend-table').innerHTML = '';
    $('gradient-legend').classList.remove('hidden');
    $('grad-min').textContent = `${r.min.toFixed(1)} ${unit}`;
    $('grad-max').textContent = `${r.max.toFixed(1)} ${unit}`;
  }
  $('totals').innerHTML = [
    ['Estimated time', '≈ ' + formatDuration(info.seconds)],
    ['Filament', `${(info.filamentMM / 1000).toFixed(2)} m · ${info.grams.toFixed(1)} g`],
    ['Cost', `$${info.cost.toFixed(2)}`],
    ['Layers', `${info.layers} (top ${info.maxZ.toFixed(2)} mm)`],
    ['Material', `${F.filament_type} ${F.nozzle_temperature}/${F.bed_temperature} °C`],
  ].map(([l, v]) => `<span class="meta-label">${l}</span><span class="meta-value">${escapeHtml(v)}</span>`).join('');
  $('topbar-status').textContent = `≈ ${formatDuration(info.seconds)} · ${info.grams.toFixed(1)} g · $${info.cost.toFixed(2)}`;
}
$('legend-table').addEventListener('change', e => {
  const k = e.target.dataset.feat;
  if (!k) return;
  viewer.setFeatureVisible(k, e.target.checked);
  renderLegend();
});
$('color-mode').addEventListener('change', e => { viewer.setColorMode(e.target.value); renderLegend(); });

// ---------- dual layer slider ----------
function renderSlider() {
  if (!lastSlice) return;
  const { info } = lastSlice;
  const n = info.layers;
  const track = $('slider-track');
  const pct = l => n <= 1 ? 0 : (1 - (l - 1) / (n - 1)) * 100;
  $('thumb-hi').style.top = pct(range.hi) + '%';
  $('thumb-lo').style.top = pct(range.lo) + '%';
  $('slider-fill').style.top = pct(range.hi) + '%';
  $('slider-fill').style.bottom = (100 - pct(range.lo)) + '%';
  const z = l => (info.layerZ[l - 1] ?? 0).toFixed(2);
  $('layer-hi-label').innerHTML = `<strong>${range.hi}</strong> / ${n}<br>${z(range.hi)} mm`;
  $('layer-lo-label').innerHTML = `<strong>${range.lo}</strong><br>${z(range.lo)} mm`;
  $('slider-markers').innerHTML = state.markers.map((m, i) =>
    `<span class="slider-marker" style="top:${pct(m.layer)}%" data-m="${i}" title="Click to remove">${m.type === 'pause' ? '⏸ Pause' : '🎨 Change'} @${m.layer}</span>`).join('');
  viewer.setLayerRange(range.lo, range.hi);
  track.setAttribute('aria-valuenow', range.hi);
}

function bindThumb(thumb, which) {
  thumb.addEventListener('pointerdown', e => {
    e.preventDefault();
    thumb.setPointerCapture(e.pointerId);
    const move = ev => {
      const r = $('slider-track').getBoundingClientRect();
      const n = lastSlice.info.layers;
      const t = 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
      const l = Math.round(t * (n - 1)) + 1;
      if (which === 'hi') range.hi = Math.max(range.lo, l); else range.lo = Math.min(range.hi, l);
      renderSlider();
    };
    const up = () => { thumb.removeEventListener('pointermove', move); thumb.removeEventListener('pointerup', up); };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', up);
  });
  thumb.addEventListener('keydown', e => {
    const d = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation(); // the window-level arrow shortcut would step again
    stepLayer(which, d);
  });
}
function stepLayer(which, d) {
  const n = lastSlice.info.layers;
  if (which === 'hi') range.hi = Math.max(range.lo, Math.min(n, range.hi + d));
  else range.lo = Math.max(1, Math.min(range.hi, range.lo + d));
  renderSlider();
}
bindThumb($('thumb-hi'), 'hi');
bindThumb($('thumb-lo'), 'lo');
$('slider-markers').addEventListener('click', e => {
  const i = e.target.closest('[data-m]')?.dataset.m;
  if (i == null) return;
  state.markers.splice(+i, 1);
  finalizeSlice(); renderLegend(); renderSlider();
});
function addMarker(type) {
  if (!lastSlice) return;
  const layer = range.hi;
  if (layer <= 1) { toast('Move the top slider above the first layer to add a pause.'); return; }
  state.markers = state.markers.filter(m => m.layer !== layer);
  state.markers.push({ layer, type });
  state.markers.sort((a, b) => a.layer - b.layer);
  finalizeSlice(); renderLegend(); renderSlider();
  toast(`${type === 'pause' ? 'Pause' : 'Filament change'} added before layer ${layer} (Z ${lastSlice.info.layerZ[layer - 1]?.toFixed(2)} mm).`);
}
$('add-pause').addEventListener('click', () => addMarker('pause'));
$('add-change').addEventListener('click', () => addMarker('change'));

// ======================================================================
// Misc
// ======================================================================
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let toastTimer;
function toast(msg, error = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), error ? 7000 : 3500);
}

addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea') || modal) { if (e.key === 'Escape' && modal) closeModal(); return; }
  const sel = viewer.selected;
  const k = e.key.toLowerCase();
  if (view === 'preview' && lastSlice) {
    if (k === 'arrowup') { e.preventDefault(); stepLayer('hi', 1); }
    if (k === 'arrowdown') { e.preventDefault(); stepLayer('hi', -1); }
  }
  if ((e.ctrlKey || e.metaKey) && k === 'i') { e.preventDefault(); $('file-input').click(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'd' && sel) { e.preventDefault(); viewer.duplicate(sel); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'r') { e.preventDefault(); runSlice(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((k === 'delete' || k === 'backspace') && sel && view === 'prepare') viewer.removePart(sel);
  else if (k === 'a' && view === 'prepare') viewer.arrange();
  else if (k === 'o' && sel) viewer.autoOrient(sel);
  else if (k === 'f' && sel) viewer.setLayFlat(!viewer.layFlatArmed);
  else if (k === 'escape') { viewer.setLayFlat(false); viewer.select(null); }
  else if (k === '0') viewer.resetCamera('iso');
  else if (k === '1') viewer.resetCamera('top');
  else if (k === '2') viewer.resetCamera('front');
  else if (k === 'tab') { e.preventDefault(); if (lastSlice) setView(view === 'prepare' ? 'preview' : 'prepare'); }
});

// go: drop saved ids that no longer exist (deleted presets, renamed system presets)
if (!SYSTEM_FILAMENTS[state.filamentId] && !user.filament[state.filamentId]) state.filamentId = 'pla';
if (!(isUser(state.processId) ? user.process[state.processId] : systemProcesses(systemPrinterOf(state.printerId))[state.processId])) {
  state.processId = `${systemPrinterOf(state.printerId)}/0.20`;
}
$('advanced-toggle').checked = state.advanced;
onSettingsChanged();
