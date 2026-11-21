// Tree supports for the Kiri:Moto engine (FRC 5572 Slicer addition, MIT).
// Upstream Kiri has a `sliceSupportTree` option but no implementation; this
// file is copied into the engine by scripts/patch-kiri.mjs at build time.
//
// Works top-down on the slice stack Kiri already computed overhangs for
// (slice.shadow = new unsupported area at that layer):
//   1. new overhangs get a grid of branch tips plus a few full interface layers
//   2. going down, branches drift toward their neighbors (max branch angle)
//      and merge, growing thicker
//   3. branches steer around the part; a branch that runs into it rests on it
//   4. each layer's support area = union of branch circles + interface areas
// Kiri's existing trim step then clips supports away from the part.

import { newPoint } from '../../../../geo/point.js';
import { newPolygon } from '../../../../geo/polygon.js';
import { polygons as POLY } from '../../../../geo/polygons.js';

function inRing(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function inPolys(polys, x, y) {
  for (const p of polys) {
    if (inRing(p.points, x, y) && !(p.inner || []).some(h => inRing(h.points, x, y))) return true;
  }
  return false;
}

/** Nearest point on any polygon edge (outer or hole). */
function closest(polys, x, y) {
  let bx = 0, by = 0, bd = Infinity;
  const visit = pts => {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L)) : 0;
      const px = a.x + dx * t, py = a.y + dy * t, d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; bx = px; by = py; }
    }
  };
  for (const p of polys) { visit(p.points); (p.inner || []).forEach(h => visit(h.points)); }
  return bd < Infinity ? { x: bx, y: by, d: Math.sqrt(bd) } : null;
}

function bounds(pts) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) {
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
  }
  return { minx, miny, maxx, maxy };
}

/** Staggered grid of points inside the polygons; tiny islands get one point. */
function sample(polys, spacing, minArea) {
  const out = [];
  for (const p of polys) {
    const b = bounds(p.points);
    let n = 0, row = 0;
    for (let y = b.miny + spacing / 2; y < b.maxy; y += spacing * 0.866, row++) {
      for (let x = b.minx + spacing / 2 + (row & 1 ? spacing / 2 : 0); x < b.maxx; x += spacing) {
        if (inPolys([p], x, y)) { out.push({ x, y }); n++; }
      }
    }
    if (!n && Math.abs(p.area()) >= minArea) {
      out.push({ x: (b.minx + b.maxx) / 2, y: (b.miny + b.maxy) / 2 });
    }
  }
  return out;
}

export function treeSupports(stack, opt) {
  const { process, lineWidth, sliceHeight, minArea, progress } = opt;
  const h = sliceHeight;
  const maxMove = h * Math.tan(40 * Math.PI / 180);          // branch angle
  const growth = h * Math.tan(5 * Math.PI / 180);            // diameter growth per layer
  const density = Math.max(0.05, process.sliceSupportDensity || 0.15);
  const spacing = Math.max(2.5, Math.min(6, lineWidth * 1.2 / density));
  const rTip = Math.max(0.8, lineWidth * 1.8);
  const rMax = 4;
  const xyDist = process.sliceSupportOffset || 0.4;
  const attract = spacing * 3;
  const interfaceLayers = 3;

  let nodes = [];
  let iface = []; // [{ polys, left }]
  const top = stack.slice().reverse();

  for (let i = 0; i < top.length; i++) {
    const slice = top[i];
    const z = slice.z;
    const part = slice.topPolys() || [];

    // 1. drift toward neighbors (weighted by size), limited by branch angle
    if (nodes.length > 1) {
      const moved = nodes.map(n => {
        let sx = 0, sy = 0, sw = 0;
        for (const m of nodes) {
          const d = Math.hypot(m.x - n.x, m.y - n.y);
          if (d > attract) continue;
          const w = m.r * m.r;
          sx += m.x * w; sy += m.y * w; sw += w;
        }
        const tx = sx / sw - n.x, ty = sy / sw - n.y, d = Math.hypot(tx, ty);
        const s = d > maxMove ? maxMove / d : 1;
        return { ...n, x: n.x + tx * s, y: n.y + ty * s };
      });
      nodes = moved;
    }

    // 2. avoid the part; branches that run into it rest on it
    if (part.length && nodes.length) {
      const keep = [];
      for (const n of nodes) {
        if (inPolys(part, n.x, n.y)) continue; // lands on the part here
        const c = closest(part, n.x, n.y);
        const need = xyDist + n.r;
        if (c && c.d < need) {
          const dx = n.x - c.x, dy = n.y - c.y, d = Math.hypot(dx, dy) || 1;
          const push = Math.min(need - c.d, maxMove * 1.5);
          n.x += dx / d * push; n.y += dy / d * push;
          if (inPolys(part, n.x, n.y)) continue;
        }
        keep.push(n);
      }
      nodes = keep;
    }

    // 3. merge branches that touch
    nodes.sort((a, b) => b.r - a.r);
    const merged = [];
    for (const n of nodes) {
      const m = merged.find(o => Math.hypot(o.x - n.x, o.y - n.y) < (o.r + n.r) * 0.8);
      if (m) {
        const w1 = m.r * m.r, w2 = n.r * n.r;
        m.x = (m.x * w1 + n.x * w2) / (w1 + w2);
        m.y = (m.y * w1 + n.y * w2) / (w1 + w2);
        m.r = Math.min(rMax, Math.max(m.r, n.r) + 0.25 * Math.min(m.r, n.r));
      } else merged.push(n);
    }
    nodes = merged;

    // 4. new overhangs: tips + interface layers
    const fresh = (slice.shadow || []).filter(p => Math.abs(p.area()) >= minArea);
    if (fresh.length) {
      iface.push({ polys: fresh, left: interfaceLayers });
      for (const p of sample(fresh, spacing, minArea)) nodes.push({ x: p.x, y: p.y, r: rTip });
    }

    // 5. this layer's support area
    const polys = nodes.map(n => newPolygon().centerCircle(newPoint(n.x, n.y, z), n.r, n.r > 2 ? 20 : 12));
    for (const f of iface) polys.push(...f.polys.map(p => p.cloneZ(z)));
    slice.supports = polys.length ? POLY.union(POLY.setZ(polys, z), minArea, true) : [];

    // 6. advance
    iface = iface.filter(f => --f.left > 0);
    for (const n of nodes) n.r = Math.min(rMax, n.r + growth);
    if (progress && (i & 7) === 0) progress(i / top.length);
  }
}
