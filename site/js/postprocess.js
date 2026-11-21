// G-code post-processing for features the Kiri engine doesn't do itself:
// per-feature acceleration, pressure advance, pause / filament change at a
// layer, and %%TOP+N%% placeholders in machine G-code.

function featureOf(comment) {
  const t = comment.slice(10);
  if (t.includes('shell')) return 'wall';
  if (t.includes('solid')) return 'solid';
  if (t.includes('sparse') || t.includes('infill')) return 'sparse';
  if (t.includes('support')) return 'support';
  return 'other';
}

function accelCommand(flavor, a) {
  return flavor === 'klipper' ? `SET_VELOCITY_LIMIT ACCEL=${a}` : `M204 P${a}`;
}

const num = (line, axis) => {
  const m = line.match(new RegExp(`\\s${axis}(-?\\d*\\.?\\d+)`));
  return m ? parseFloat(m[1]) : null;
};

/**
 * Spiral vase: Kiri prints one wall per layer at a fixed Z. Above the bottom
 * layers, ramp Z continuously along each layer's wall (like Orca/Prusa
 * "spiral vase") and drop the per-layer Z steps, retracts and Z hops.
 */
export function spiralize(lines, bottomLayers) {
  const out = [];
  let layer = 0, block = null, prevTop = 0, curTop = 0;
  const flush = () => {
    if (!block) return;
    if (layer <= bottomLayers || !block.length) { out.push(...block.lines); prevTop = curTop; block = null; return; }
    // total XY length of extrusion moves in this layer
    let x = block.x0, y = block.y0, total = 0;
    for (const l of block.lines) {
      if (!/^G[01] /.test(l)) continue;
      const nx = num(l, 'X') ?? x, ny = num(l, 'Y') ?? y;
      if (num(l, 'E') > 0) total += Math.hypot(nx - x, ny - y);
      x = nx; y = ny;
    }
    x = block.x0; y = block.y0;
    let done = 0;
    const h = curTop - prevTop;
    for (const l of block.lines) {
      if (/^G[01] /.test(l)) {
        const nx = num(l, 'X'), ny = num(l, 'Y'), e = num(l, 'E');
        if (nx === null && ny === null) continue; // Z-only moves, retracts, unretracts
        const tx = nx ?? x, ty = ny ?? y;
        if (e > 0) done += Math.hypot(tx - x, ty - y);
        const z = prevTop + h * (total ? done / total : 1);
        out.push(l.replace(/\sZ-?\d*\.?\d+/, '') .replace(/^(G[01])/, `$1 Z${z.toFixed(3)}`));
        x = tx; y = ty;
        continue;
      }
      out.push(l);
    }
    prevTop = curTop;
    block = null;
  };
  let lx = 0, ly = 0, ended = false;
  for (const line of lines) {
    if (ended) { out.push(line); continue; }
    if (line.startsWith('; MACHINE_END_GCODE')) { flush(); ended = true; out.push(line); continue; }
    if (line.startsWith(';LAYER_CHANGE')) {
      flush();
      layer++;
      block = { lines: [], x0: lx, y0: ly, length: 0 };
      block.lines.push(line);
      continue;
    }
    if (line.startsWith(';Z:') && block) curTop = parseFloat(line.slice(3));
    if (/^G[01] /.test(line)) { lx = num(line, 'X') ?? lx; ly = num(line, 'Y') ?? ly; if (block) block.length++; }
    if (block && !line.startsWith('; --- filament used')) { block.lines.push(line); continue; }
    flush();
    out.push(line);
  }
  flush();
  return out;
}

/**
 * @param {string} gcode raw engine output (\n line endings)
 * @param {object} o { P, F, S, maxZ, markers: [{layer, type:'pause'|'change'}] }
 * @returns {string}
 */
export function postProcess(gcode, { P, F, S, maxZ, markers = [] }) {
  let lines = gcode.split('\n');
  if (S.spiral_mode) lines = spiralize(lines, S.bottom_shell_layers);
  const out = [];
  const cap = v => Math.min(v, P.machine_max_acceleration || v);
  const accel = S.accel_control ? {
    wall: cap(S.wall_acceleration), solid: cap(S.solid_infill_acceleration), sparse: cap(S.sparse_infill_acceleration),
    support: cap(S.support_acceleration), other: cap(S.default_acceleration), first: cap(S.initial_layer_acceleration),
  } : null;
  const markerAt = new Map();
  for (const m of markers) {
    const list = markerAt.get(m.layer) || [];
    list.push(m.type);
    markerAt.set(m.layer, list);
  }

  let layer = 0; // 1-based once printing starts
  let currentAccel = null;
  let paDone = false;
  const setAccel = a => {
    if (a && a !== currentAccel) { out.push(accelCommand(P.gcode_flavor, a)); currentAccel = a; }
  };

  for (const line of lines) {
    if (line.startsWith(';LAYER_CHANGE')) {
      if (!paDone) {
        paDone = true;
        if (F.enable_pressure_advance) {
          out.push(P.gcode_flavor === 'klipper'
            ? `SET_PRESSURE_ADVANCE ADVANCE=${F.pressure_advance} ; filament pressure advance`
            : `M900 K${F.pressure_advance} ; filament linear advance`);
        }
      }
      layer++;
      for (const type of markerAt.get(layer) || []) {
        out.push(`; ${type === 'pause' ? 'PAUSE' : 'FILAMENT CHANGE'} before layer ${layer}`);
        out.push(...(type === 'pause' ? P.pause_gcode : P.change_filament_gcode || P.pause_gcode).split('\n'));
      }
      out.push(line);
      if (accel && layer === 1) setAccel(accel.first);
      if (accel && layer === 2) setAccel(accel.other);
      continue;
    }
    if (accel && layer >= 2 && line.startsWith('; feature ')) {
      out.push(line);
      setAccel(accel[featureOf(line)]);
      continue;
    }
    out.push(line);
  }

  const zCap = P.printable_height;
  return out.join('\n').replace(/%%TOP\+(\d+(?:\.\d+)?)%%/g, (_, n) => Math.min(zCap, maxZ + Number(n)).toFixed(2));
}
