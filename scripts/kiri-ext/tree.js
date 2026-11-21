// Organic tree supports for the Kiri:Moto engine (FRC 5572 Slicer addition, MIT).
// Upstream Kiri has a `sliceSupportTree` option but no implementation; this
// file is copied into the engine by scripts/patch-kiri.mjs at build time.
//
// Written from the publicly described approach of Cura / Orca / Bambu trees
// (no code copied; those projects are AGPL), tuned against a Bambu Studio
// tree-support slice: branch counts, diameters, pads and wall loops measured
// from its G-code.
//
// Top-down over the slice stack (slice.shadow = new unsupported area per layer):
//   1. tips: a grid of thin tips under each new overhang, plus a couple of
//      roof (interface) layers right under the overhang
//   2. each layer down, every branch looks for its nearest neighbor; pairs move
//      toward each other at the preferred angle and merge into one thicker
//      branch (Y-joints). Branches without a partner go straight down.
//   3. branches steer around the part at up to the maximum angle; a branch that
//      runs into the part rests on it
//   4. branch radius ramps from tip to branch size, then grows with length
// Kiri's existing trim step then clips supports away from the part.

import { newPoint } from '../../../../geo/point.js';
import { newPolygon } from '../../../../geo/polygon.js';
import { polygons as POLY } from '../../../../geo/polygons.js';

const DEG = Math.PI / 180;

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
    if (!n && Math.abs(p.area()) >= minArea) out.push({ x: (b.minx + b.maxx) / 2, y: (b.miny + b.maxy) / 2 });
  }
  return out;
}

/** Spatial hash for nearest-neighbor lookups. */
function grid(nodes, cell) {
  const map = new Map();
  for (const n of nodes) {
    const k = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
    const l = map.get(k);
    if (l) l.push(n); else map.set(k, [n]);
  }
  return {
    near(n, reach) {
      const r = Math.ceil(reach / cell), cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell);
      let best = null, bd = reach;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        const l = map.get(`${cx + dx},${cy + dy}`);
        if (!l) continue;
        for (const m of l) {
          if (m === n || m.dead) continue;
          const d = Math.hypot(m.x - n.x, m.y - n.y);
          if (d < bd) { bd = d; best = m; }
        }
      }
      return best ? { node: best, d: bd } : null;
    },
  };
}

export function treeSupports(stack, opt) {
  const { process, sliceHeight, minArea, progress } = opt;
  const h = sliceHeight;
  // Defaults measured from Bambu Studio / Orca tree slices: tips ~0.8 mm,
  // branches 2 mm that stay 2 mm unless they merge, merged trunks thicken at
  // the 5° diameter angle, branches ~5 mm apart (branch distance), 10 mm pads
  // on the first layer, each branch printed as a single wall loop.
  const tipR = 0.4;                                    // tip diameter 0.8 mm
  const branchR = 0.8;                                 // 1.6 mm centerline = 2 mm outside (branch diameter)
  const grow = h * Math.tan(5 * DEG) * 0.5;            // branch diameter angle 5° (merged trunks only)
  const prefMove = h * Math.tan(40 * DEG);             // branch angle when merging (Bambu: single 45° angle)
  const maxMove = h * Math.tan(45 * DEG);              // maximum branch angle
  const rampLayers = Math.max(3, Math.round(1.2 / h)); // tip -> branch size over ~1.2 mm
  const rMax = 2.6;
  const density = Math.max(0.05, process.sliceSupportDensity || 0.15);
  const spacing = Math.max(2.5, Math.min(8, 4.5 * Math.sqrt(0.15 / density))); // tip spacing
  const reach = spacing * 2.5;                         // only neighbors this close pair up
  const xyDist = process.sliceSupportOffset || 0.4;
  const roofLayers = 2;
  const padR = 5;                                      // first-layer base pad radius

  let nodes = [];
  let roofs = [];
  const top = stack.slice().reverse();

  for (let i = 0; i < top.length; i++) {
    const slice = top[i];
    const z = slice.z;
    const part = slice.topPolys() || [];
    const layersLeft = top.length - i;

    // 1. pair with the nearest close neighbor and move toward it; else straight down
    if (nodes.length > 1) {
      const g = grid(nodes, reach);
      for (const n of nodes) {
        n.tx = n.x; n.ty = n.y;
        const hit = g.near(n, reach);
        if (!hit) continue;
        if ((hit.d / 2) / prefMove > layersLeft) continue; // can't meet before the bed
        const dx = hit.node.x - n.x, dy = hit.node.y - n.y, d = hit.d || 1;
        const step = Math.min(prefMove, d / 2);
        n.tx = n.x + dx / d * step; n.ty = n.y + dy / d * step;
      }
      for (const n of nodes) { n.x = n.tx; n.y = n.ty; }
    }

    // 2. merge branches whose centers have met; merged trunks keep the larger diameter
    if (nodes.length > 1) {
      nodes.sort((a, b) => b.r - a.r);
      const g = grid(nodes, reach);
      for (const n of nodes) {
        if (n.dead) continue;
        for (let hit; (hit = g.near(n, Math.max(n.r * 0.5, 0.3))); ) {
          const m = hit.node;
          const w1 = n.r * n.r, w2 = m.r * m.r;
          n.x = (n.x * w1 + m.x * w2) / (w1 + w2);
          n.y = (n.y * w1 + m.y * w2) / (w1 + w2);
          n.r = Math.min(rMax, Math.max(n.r, m.r));
          n.age = Math.max(n.age, m.age);
          n.merged = true;
          m.dead = true;
        }
      }
      nodes = nodes.filter(n => !n.dead);
    }

    // 3. avoid the part (up to the max angle); branches that hit it rest on it
    if (part.length && nodes.length) {
      const keep = [];
      for (const n of nodes) {
        if (inPolys(part, n.x, n.y)) continue;
        const c = closest(part, n.x, n.y);
        const need = xyDist + n.r;
        if (c && c.d < need) {
          const dx = n.x - c.x, dy = n.y - c.y, d = Math.hypot(dx, dy) || 1;
          const push = Math.min(need - c.d, maxMove);
          n.x += dx / d * push; n.y += dy / d * push;
          if (inPolys(part, n.x, n.y)) continue;
        }
        keep.push(n);
      }
      nodes = keep;
    }

    // 4. new overhangs: roof layers + tips
    const fresh = (slice.shadow || []).filter(p => Math.abs(p.area()) >= minArea);
    if (fresh.length) {
      roofs.push({ polys: fresh, left: roofLayers });
      // only add tips where no existing branch already supports the area
      // (sloped surfaces add a thin new strip every layer)
      const g = nodes.length ? grid(nodes, spacing) : null;
      for (const p of sample(fresh, spacing, minArea)) {
        if (g && g.near(p, spacing * 0.8)) continue;
        nodes.push({ x: p.x, y: p.y, r: tipR, age: 0 });
      }
    }

    // 5. this layer's support: branch circles (outline only) + roof areas (dense fill).
    // Roofs are separate polygons listed in slice.treeRoofs so the patched
    // support fill gives them interface density and the branches none.
    const bottom = i === top.length - 1;
    const circles = nodes.map(n => {
      const r = bottom ? Math.max(n.r, padR) : n.r;
      return newPolygon().centerCircle(newPoint(n.x, n.y, z), r, r > 1.5 ? 20 : r > 0.7 ? 12 : 8);
    });
    const roofPolys = roofs.length ? POLY.union(POLY.setZ(roofs.flatMap(f => f.polys.map(p => p.cloneZ(z))), z), minArea * 0.25, true) : [];
    let branches = circles.length ? POLY.union(POLY.setZ(circles, z), minArea * 0.25, true) : [];
    if (roofPolys.length && branches.length) {
      const rem = [];
      POLY.subtract(branches, roofPolys, rem, null, z, minArea * 0.25);
      branches = rem;
    }
    slice.supports = [...branches, ...roofPolys];
    // first-layer base pads are filled solid like roofs (Bambu prints them as discs)
    const filled = bottom ? slice.supports : roofPolys;
    slice.treeRoofs = filled.length ? filled : null;

    // 6. tips ramp up to branch size; only merged trunks keep thickening
    roofs = roofs.filter(f => --f.left > 0);
    for (const n of nodes) {
      n.age++;
      if (n.age <= rampLayers) n.r = Math.max(n.r, tipR + (branchR - tipR) * (n.age / rampLayers));
      else if (n.merged) n.r = Math.min(rMax, n.r + grow);
    }
    if (progress && (i & 7) === 0) progress(i / top.length);
  }
}
