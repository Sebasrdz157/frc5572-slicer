// Parse sliced G-code into preview geometry and print statistics.

export const FEATURES = {
  shells:  { label: 'Walls',   color: [0.93, 0.62, 0.0] },
  solid:   { label: 'Solid',   color: [0.85, 0.30, 0.25] },
  sparse:  { label: 'Infill',  color: [0.62, 0.42, 0.20] },
  support: { label: 'Support', color: [0.18, 0.65, 0.63] },
  brim:    { label: 'Skirt / brim', color: [0.45, 0.55, 0.85] },
  other:   { label: 'Other',   color: [0.55, 0.55, 0.55] },
};

function featureKey(text) {
  if (text.includes('brim') || text.includes('skirt') || text.includes('raft')) return 'brim';
  if (text.includes('shell')) return 'shells';
  if (text.includes('solid')) return 'solid';
  if (text.includes('sparse') || text.includes('infill')) return 'sparse';
  if (text.includes('support')) return 'support';
  return 'other';
}

/**
 * @param {string} gcode
 * @param {object} opts - { bed:{x,y}, originCenter, accel (mm/s^2), filamentDiameter, density }
 */
export function parseGcode(gcode, opts) {
  const ox = opts.originCenter ? 0 : opts.bed.x / 2;
  const oy = opts.originCenter ? 0 : opts.bed.y / 2;
  const accel = opts.accel || 1500;
  const minJunction = 5; // mm/s, rough stand-in for jerk / square corner velocity

  const pos = [];
  const col = [];
  const layerEnds = [];
  let layer = -1;
  let x = 0, y = 0, z = 0, f = 3000 / 60;
  let feature = 'other';
  let extruded = 0;
  let maxZ = 0;
  let time = 0;
  let prevDir = null, prevV = 0;

  const lines = gcode.split('\n');
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === ';') {
      if (line.startsWith(';LAYER_CHANGE')) {
        if (layer >= 0) layerEnds.push(pos.length / 3);
        layer++;
      } else if (line.startsWith('; feature ')) {
        feature = featureKey(line.slice(10));
      }
      continue;
    }
    const code = line.split(';')[0];
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

    // time estimate: trapezoid profile with a crude junction-speed model
    if (dist > 0) {
      const v = f;
      const dir = [dx / dist, dy / dist, dz / dist];
      let vEntry = minJunction;
      if (prevDir) {
        const cos = dir[0] * prevDir[0] + dir[1] * prevDir[1] + dir[2] * prevDir[2];
        vEntry = Math.max(minJunction, Math.min(v, prevV) * (1 + cos) / 2);
      }
      const vExit = vEntry;
      const dAcc = Math.max(0, (v * v - vEntry * vEntry) / (2 * accel));
      const dDec = Math.max(0, (v * v - vExit * vExit) / (2 * accel));
      if (dAcc + dDec <= dist) {
        time += (v - vEntry) / accel + (v - vExit) / accel + (dist - dAcc - dDec) / v;
      } else {
        const vPeak = Math.sqrt(accel * dist + (vEntry * vEntry + vExit * vExit) / 2);
        time += (vPeak - vEntry) / accel + (vPeak - vExit) / accel;
      }
      prevDir = dir; prevV = v;
    } else if (e !== 0) {
      time += Math.abs(e) / f; // retract / unretract
    }

    if (e > 0) extruded += e;
    if (e > 0 && layer >= 0 && (dx || dy)) {
      if (nz > maxZ) maxZ = nz;
      pos.push(x - ox, y - oy, z, nx - ox, ny - oy, nz);
      const c = FEATURES[feature].color;
      col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
    }
    x = nx; y = ny; z = nz;
  }
  if (layer >= 0) layerEnds.push(pos.length / 3);

  const positions = new Float32Array(pos);
  const colors = new Float32Array(col);

  const fd = opts.filamentDiameter || 1.75;
  const grams = extruded * Math.PI * (fd / 2) ** 2 * (opts.density || 1.24) / 1000;
  const kiriTime = +(gcode.match(/print time: (\d+)s/)?.[1] || 0);
  return {
    positions, colors, layerEnds,
    layers: layerEnds.length,
    maxZ,
    filamentMM: extruded,
    grams,
    seconds: Math.round(time),
    kiriSeconds: kiriTime,
  };
}

export function formatDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
