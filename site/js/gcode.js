// Parse sliced G-code into preview geometry (one line set per feature type)
// and statistics (time / filament per feature, per layer).

export const FEATURES = {
  wall:    { label: 'Wall',          color: [1.00, 0.55, 0.20] },
  solid:   { label: 'Solid infill',  color: [0.80, 0.25, 0.70] },
  sparse:  { label: 'Sparse infill', color: [0.69, 0.19, 0.19] },
  support: { label: 'Support',       color: [0.20, 0.75, 0.40] },
  brim:    { label: 'Skirt / brim',  color: [0.00, 0.53, 0.53] },
  travel:  { label: 'Travel',        color: [0.25, 0.45, 0.95] },
};
export const FEATURE_KEYS = Object.keys(FEATURES);

function featureKey(text) {
  if (text.includes('brim') || text.includes('skirt') || text.includes('raft')) return 'brim';
  if (text.includes('shell')) return 'wall';
  if (text.includes('solid')) return 'solid';
  if (text.includes('sparse') || text.includes('infill')) return 'sparse';
  if (text.includes('support')) return 'support';
  return 'wall';
}

/**
 * @param {string} gcode
 * @param {object} o { bed:{x,y}, originCenter, accel, filamentDiameter, density, cost }
 */
export function parseGcode(gcode, o) {
  const ox = o.originCenter ? 0 : o.bed.x / 2;
  const oy = o.originCenter ? 0 : o.bed.y / 2;
  const fArea = Math.PI * ((o.filamentDiameter || 1.75) / 2) ** 2;
  const maxAccel = o.accel || 1500;
  let accel = maxAccel;
  const minJunction = 5;

  const sets = {};
  for (const k of FEATURE_KEYS) sets[k] = { pos: [], speed: [], flow: [], ends: [] };
  const stats = {};
  for (const k of FEATURE_KEYS) stats[k] = { time: 0, filament: 0 };
  const layerZ = [];
  const layerTime = [];
  let layer = -1;
  let x = 0, y = 0, z = 0, f = 50;
  let feature = 'wall';
  let extruded = 0, time = 0, maxZ = 0;
  let prevDir = null, prevV = 0;
  let layerStartTime = 0;

  const closeLayer = () => {
    if (layer < 0) return;
    for (const k of FEATURE_KEYS) sets[k].ends.push(sets[k].pos.length / 3);
    layerTime.push(time - layerStartTime);
  };

  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === ';') {
      if (line.startsWith(';LAYER_CHANGE')) {
        closeLayer();
        layer++;
        layerStartTime = time;
        layerZ.push(null);
      } else if (line.startsWith(';Z:') && layer >= 0) {
        layerZ[layer] = parseFloat(line.slice(3));
      } else if (line.startsWith('; feature ')) {
        feature = featureKey(line.slice(10));
      }
      continue;
    }
    const code = line.split(';')[0].trim();
    if (code.startsWith('SET_VELOCITY_LIMIT')) {
      const m = code.match(/ACCEL=(\d+(?:\.\d+)?)/);
      if (m) accel = Math.min(maxAccel, +m[1]);
      continue;
    }
    if (code.startsWith('M204')) {
      const m = code.match(/[PS](\d+(?:\.\d+)?)/);
      if (m) accel = Math.min(maxAccel, +m[1]);
      continue;
    }
    if (!(code.startsWith('G0') || code.startsWith('G1')) || /^G1\d/.test(code)) continue;

    let nx = x, ny = y, nz = z, e = 0;
    for (const tok of code.split(/\s+/).slice(1)) {
      const v = parseFloat(tok.slice(1));
      switch (tok[0]) {
        case 'X': nx = v; break;
        case 'Y': ny = v; break;
        case 'Z': nz = v; break;
        case 'E': e = v; break;
        case 'F': f = v / 60; break;
      }
    }
    const dx = nx - x, dy = ny - y, dz = nz - z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // time: trapezoid profile with a simple junction-speed model
    let dt = 0;
    if (dist > 0) {
      const v = f;
      const dir = [dx / dist, dy / dist, dz / dist];
      let vj = minJunction;
      if (prevDir) {
        const cos = dir[0] * prevDir[0] + dir[1] * prevDir[1] + dir[2] * prevDir[2];
        vj = Math.max(minJunction, Math.min(v, prevV) * (1 + cos) / 2);
      }
      const dAcc = Math.max(0, (v * v - vj * vj) / (2 * accel));
      if (2 * dAcc <= dist) dt = 2 * (v - vj) / accel + (dist - 2 * dAcc) / v;
      else dt = 2 * (Math.sqrt(accel * dist + vj * vj) - vj) / accel;
      prevDir = dir; prevV = v;
    } else if (e !== 0) {
      dt = Math.abs(e) / f;
    }
    time += dt;

    const printing = e > 0 && (dx || dy);
    if (e > 0) extruded += e;
    if (layer >= 0) {
      const key = printing ? feature : (dist > 0 && (dx || dy) ? 'travel' : null);
      if (key) {
        const s = sets[key];
        s.pos.push(x - ox, y - oy, z, nx - ox, ny - oy, nz);
        const flow = printing ? (e * fArea) / dist * f : 0; // mm^3/s
        s.speed.push(f, f);
        s.flow.push(flow, flow);
        stats[key].time += dt;
        if (printing) { stats[key].filament += e; if (nz > maxZ) maxZ = nz; }
      }
    }
    x = nx; y = ny; z = nz;
  }
  closeLayer();

  const out = {};
  for (const k of FEATURE_KEYS) {
    const s = sets[k];
    out[k] = { positions: new Float32Array(s.pos), speed: new Float32Array(s.speed), flow: new Float32Array(s.flow), layerEnds: s.ends };
  }
  // fill missing Z labels from the geometry
  for (let i = 0; i < layerZ.length; i++) if (layerZ[i] == null) layerZ[i] = i ? layerZ[i - 1] : 0;

  const grams = extruded * fArea * (o.density || 1.24) / 1000;
  for (const k of FEATURE_KEYS) stats[k].grams = stats[k].filament * fArea * (o.density || 1.24) / 1000;
  return {
    sets: out,
    stats,
    layers: layerZ.length,
    layerZ,
    layerTime,
    maxZ,
    filamentMM: extruded,
    grams,
    cost: grams / 1000 * (o.cost || 0),
    seconds: Math.round(time),
  };
}

export function quickMaxZ(gcode) {
  let max = 0;
  for (const m of gcode.matchAll(/^;Z:([\d.]+)/gm)) max = Math.max(max, +m[1]);
  return max;
}

export function formatDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
