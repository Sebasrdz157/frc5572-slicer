import { Viewer } from './viewer.js';
import { loadModelFile, ACCEPTED } from './loaders.js';
import { PRINTERS, MATERIALS, QUALITIES, STRENGTHS, INFILL_PATTERNS, buildSettings } from './printers.js';
import { parseGcode, formatDuration, FEATURES } from './gcode.js';

const $ = id => document.getElementById(id);
const STORE_KEY = 'frc5572-slicer-settings-v1';

const DEFAULTS = {
  printer: 'k1c', material: 'pla', quality: 'standard', strength: 'standard',
  walls: 3, top: 5, bottom: 4, infill: 25, pattern: 'gyroid',
  supports: false, supportAngle: 50, adhesion: 'skirt', brimLoops: 5,
  speedScale: 100, flow: 100,
};

const NUMERIC = ['walls', 'top', 'bottom', 'infill', 'supportAngle', 'brimLoops', 'speedScale', 'flow'];
const FIELDS = ['material', 'quality', 'strength', 'pattern', 'adhesion', ...NUMERIC];

let state = loadState();
let lastGcode = null;
let slicing = false;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// ---------- viewer ----------
const viewer = new Viewer($('viewport'));
// handy for debugging from the browser console
window.slicerDebug = { viewer, get gcode() { return lastGcode; }, get state() { return state; } };

// ---------- settings form ----------
function fillSelect(id, entries) {
  $(id).innerHTML = Object.entries(entries).map(([k, v]) => `<option value="${k}">${v.name ?? v}</option>`).join('');
}
fillSelect('material', MATERIALS);
fillSelect('quality', QUALITIES);
fillSelect('strength', { ...STRENGTHS, custom: { name: 'Custom' } });
fillSelect('pattern', INFILL_PATTERNS);

function renderPrinters() {
  $('printer-pick').innerHTML = Object.entries(PRINTERS).map(([k, p]) => `
    <button class="printer-opt" role="radio" aria-checked="${state.printer === k}" data-printer="${k}">
      <span>${p.name}</span><small>${p.bed.x}×${p.bed.y}×${p.bed.z}</small>
    </button>`).join('');
}
$('printer-pick').addEventListener('click', e => {
  const btn = e.target.closest('[data-printer]');
  if (!btn) return;
  state.printer = btn.dataset.printer;
  onSettingsChanged();
});

function writeForm() {
  for (const k of FIELDS) $(k).value = state[k];
  $('supports').checked = state.supports;
}

function readForm() {
  for (const k of FIELDS) state[k] = NUMERIC.includes(k) ? Number($(k).value) : $(k).value;
  state.supports = $('supports').checked;
}

function applyStrength() {
  const s = STRENGTHS[state.strength];
  if (!s) return;
  Object.assign(state, { walls: s.walls, top: s.top, bottom: s.bottom, infill: s.infill, pattern: s.pattern });
}

function matchStrength() {
  const hit = Object.entries(STRENGTHS).find(([, s]) =>
    s.walls === state.walls && s.top === state.top && s.bottom === state.bottom && s.infill === state.infill && s.pattern === state.pattern);
  state.strength = hit ? hit[0] : 'custom';
}

function onSettingsChanged() {
  const p = PRINTERS[state.printer];
  const m = MATERIALS[state.material];
  renderPrinters();
  viewer.setBed(p.bed);
  writeForm();
  $('support-angle-field').hidden = !state.supports;
  $('brim-field').hidden = state.adhesion !== 'brim';

  const warn = [];
  if (m.needsEnclosure && !p.enclosed) warn.push(`${m.name} warps easily on an open printer like the ${p.short}. Expect lifting on larger parts.`);
  if (m.slow) warn.push(`${m.name} prints slowly; speeds are reduced automatically.`);
  $('material-warning').hidden = !warn.length;
  $('material-warning').textContent = warn.join(' ');

  const [t, b] = m.temps[state.printer];
  $('temp-readout').textContent = `${p.short} + ${m.name}: nozzle ${t} °C, bed ${b} °C.`;
  saveState();
  invalidate();
}

document.querySelector('.sidebar').addEventListener('change', e => {
  if (!e.target.id || e.target.id === 'btn-reset') return;
  readForm();
  if (e.target.id === 'strength') applyStrength();
  else if (['walls', 'top', 'bottom', 'infill', 'pattern'].includes(e.target.id)) matchStrength();
  onSettingsChanged();
});

$('btn-reset').addEventListener('click', () => {
  state = { ...DEFAULTS, printer: state.printer };
  onSettingsChanged();
});

// ---------- files ----------
async function addFiles(files) {
  const errs = [];
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED.includes(ext)) { errs.push(`${file.name}: not an STL, 3MF or OBJ file`); continue; }
    try {
      const { geometry, name } = await loadModelFile(file);
      const part = viewer.addPart(geometry, name);
      const size = viewer.partSize(part);
      // FRC CAD is often exported in inches: a 2"-long part shows up as 2 mm
      if (Math.max(size.x, size.y, size.z) < 12) part.tinyHint = true;
    } catch (err) {
      errs.push(`${file.name}: ${err.message}`);
    }
  }
  showError(errs.join('\n'));
}

$('file-input').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });

const stage = document.querySelector('.stage');
let dragDepth = 0;
stage.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; });
stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  addFiles([...e.dataTransfer.files]);
});

// ---------- parts panel ----------
function renderParts() {
  const has = viewer.parts.length > 0;
  $('empty-state').hidden = has;
  $('parts-panel').hidden = !has || viewer.mode === 'preview';
  $('btn-slice').disabled = !has || slicing;
  $('parts-list').innerHTML = viewer.parts.map(p => {
    const s = viewer.partSize(p);
    return `<li data-id="${p.id}" class="${p === viewer.selected ? 'sel' : ''} ${p.out ? 'out' : ''}">
      <span>${escapeHtml(p.name)}</span><small>${p.out ? 'off bed' : `${s.x.toFixed(0)}×${s.y.toFixed(0)}×${s.z.toFixed(0)}`}</small></li>`;
  }).join('');
  const sel = viewer.selected;
  $('part-tools').hidden = !sel;
  if (sel) {
    const s = viewer.partSize(sel);
    $('part-scale').value = Math.round(sel.scale * 100);
    $('part-size').textContent = `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm` +
      (sel.tinyHint && sel.scale === 1 ? ' — very small, was it exported in inches?' : '');
  }
  const out = viewer.parts.filter(p => p.out).length;
  $('out-warning').hidden = !out;
  $('out-warning').textContent = out ? `${out} part${out > 1 ? 's are' : ' is'} outside the ${PRINTERS[state.printer].short} build area (shown red).` : '';
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('parts-list').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (li) viewer.select(viewer.parts.find(p => p.id === Number(li.dataset.id)));
});
document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => {
  if (viewer.selected) viewer.rotate(viewer.selected, b.dataset.rot, 90);
}));
$('btn-layflat').addEventListener('click', () => viewer.setLayFlat(!viewer.layFlatArmed));
$('btn-autoflat').addEventListener('click', () => viewer.selected && viewer.autoOrient(viewer.selected));
$('part-scale').addEventListener('change', e => {
  const v = Number(e.target.value);
  if (viewer.selected && v > 0) viewer.setScale(viewer.selected, v / 100);
});
$('btn-inch').addEventListener('click', () => viewer.selected && viewer.setScale(viewer.selected, viewer.selected.scale * 25.4));
$('btn-dup').addEventListener('click', () => viewer.selected && viewer.duplicate(viewer.selected));
$('btn-del').addEventListener('click', () => viewer.selected && viewer.removePart(viewer.selected));
$('btn-arrange').addEventListener('click', () => viewer.arrange());
$('btn-clear').addEventListener('click', () => { exitPreview(); viewer.clear(); });

addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && viewer.selected && viewer.mode === 'edit') viewer.removePart(viewer.selected);
  if (e.key === 'Escape') { viewer.setLayFlat(false); viewer.select(null); }
});

viewer.addEventListener('change', () => { invalidate(); renderParts(); });
viewer.addEventListener('select', renderParts);
viewer.addEventListener('layflat', e => $('btn-layflat').classList.toggle('active', e.detail));

// ---------- slicing ----------
function invalidate() {
  if (slicing) return;
  lastGcode = null;
  $('btn-download').hidden = true;
  $('result').hidden = true;
  $('btn-slice').textContent = 'Slice';
  if (viewer.mode === 'preview') exitPreview();
}

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
}

function setProgress(f, label) {
  $('progress-fill').style.width = `${Math.round(f * 100)}%`;
  $('progress-text').textContent = `${label}… ${Math.round(f * 100)}%`;
}

let slicerModule;
async function runSlice() {
  if (!viewer.parts.length || slicing) return;
  if (viewer.anyOut) { showError('Move the red parts inside the build area first.'); return; }
  showError('');
  slicing = true;
  $('btn-slice').disabled = true;
  $('btn-download').hidden = true;
  $('result').hidden = true;
  $('progress').hidden = false;
  setProgress(0, 'Loading slicer');
  const t0 = performance.now();
  try {
    slicerModule ||= await import('./slicer.js');
    const settings = buildSettings(state);
    const stl = viewer.exportSTL();
    const gcode = await slicerModule.slice({ stl: stl.buffer, center: stl.center, device: settings.device, process: settings.process }, setProgress);
    setProgress(1, 'Building preview');
    const p = settings.printer;
    const info = parseGcode(gcode, { bed: p.bed, originCenter: p.originCenter, accel: p.accel, density: settings.material.density });
    if (!info.layers) throw new Error('The slicer produced no layers. Is the model a closed solid?');
    lastGcode = { text: withSummary(gcode, info, settings), info, settings };
    $('r-time').textContent = '≈ ' + formatDuration(info.seconds);
    $('r-weight').textContent = `${info.grams.toFixed(0)} g`;
    $('r-layers').textContent = info.layers;
    $('result').hidden = false;
    $('btn-download').hidden = false;
    $('btn-slice').textContent = 'Re-slice';
    enterPreview(info);
    console.info(`sliced in ${Math.round(performance.now() - t0)} ms`, info);
  } catch (err) {
    console.error(err);
    showError(`Slicing failed: ${err?.message || err}`);
  } finally {
    slicing = false;
    $('progress').hidden = true;
    $('btn-slice').disabled = !viewer.parts.length;
  }
}

function withSummary(gcode, info, settings) {
  const s = state;
  const head = [
    `; Sliced with FRC 5572 Slicer (Kiri:Moto engine) on ${new Date().toISOString()}`,
    `; printer: ${settings.printer.name}`,
    `; material: ${settings.material.name} @ ${settings.nozzleTemp}/${settings.bedTemp} C`,
    `; layer: ${s.quality} | walls ${s.walls} | top ${s.top} | bottom ${s.bottom} | infill ${s.infill}% ${s.pattern}`,
    `; supports: ${s.supports ? `on (${s.supportAngle} deg)` : 'off'} | adhesion: ${s.adhesion}`,
    `; estimated time: ${formatDuration(info.seconds)} | filament: ${(info.filamentMM / 1000).toFixed(2)} m / ${info.grams.toFixed(1)} g`,
    `; parts: ${viewer.parts.map(p => p.name).join(', ')}`,
  ];
  // fill in %%TOP+N%% placeholders from the printer profiles
  const zCap = settings.printer.bed.z;
  const body = gcode.replace(/%%TOP\+(\d+(?:\.\d+)?)%%/g, (_, n) => Math.min(zCap, info.maxZ + Number(n)).toFixed(2));
  return head.join('\n') + '\n' + body;
}

function enterPreview(info) {
  viewer.select(null);
  viewer.showToolpaths(info);
  $('layer-range').max = info.layers;
  $('layer-range').value = info.layers;
  $('layer-total').textContent = info.layers;
  $('layer-num').textContent = info.layers;
  $('legend').innerHTML = Object.values(FEATURES).filter(f => f.label !== 'Other').map(f =>
    `<span><i style="background: rgb(${f.color.map(c => Math.round(c * 255)).join(',')})"></i>${f.label}</span>`).join('');
  $('preview-bar').hidden = false;
  renderParts();
}

function exitPreview() {
  viewer.clearToolpaths();
  $('preview-bar').hidden = true;
  renderParts();
}

$('layer-range').addEventListener('input', e => {
  const n = Number(e.target.value);
  $('layer-num').textContent = n;
  viewer.setLayer(n);
});
$('btn-back').addEventListener('click', exitPreview);
$('btn-slice').addEventListener('click', runSlice);

$('btn-download').addEventListener('click', () => {
  if (!lastGcode) return;
  const base = viewer.parts.length === 1 ? viewer.parts[0].name : `${viewer.parts[0].name}+${viewer.parts.length - 1}`;
  const p = lastGcode.settings.printer.short.replace(/\W+/g, '');
  const m = lastGcode.settings.material.name.split(' ')[0];
  const name = `${base}_${p}_${m}_${formatDuration(lastGcode.info.seconds).replace(/\s/g, '')}.gcode`.replace(/[^\w.+-]/g, '_');
  const url = URL.createObjectURL(new Blob([lastGcode.text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

// ---------- go ----------
onSettingsChanged();
renderParts();
