
// ---- FRC 5572 Slicer: analytic gyroid infill (appended by scripts/patch-kiri.mjs) ----
// Kiri's gyroid stamps a pre-traced tile across the bed (hundreds of thousands
// of short pieces per layer) and its density formula gives ~5x too little
// plastic. This solves the gyroid surface
//     sin(kx)cos(ky) + sin(ky)cos(kz) + sin(kz)cos(kx) = 0
// directly for each scan line and emits long continuous curves.
//   - if sin²(kz) <= 1/2, every curve is a function y(x):
//       a·cos(ky) + b·sin(ky) = c, a = sin(kx), b = cos(kz), c = -sin(kz)cos(kx)
//       ky = atan2(b, a) ± acos(c / hypot(a, b)) + 2πn
//   - otherwise every curve is a function x(y):
//       a·sin(kx) + b·cos(kx) = c, a = cos(ky), b = sin(kz), c = -sin(ky)cos(kz)
//       kx = asin(c / hypot(a, b)) - atan2(b, a) + 2πn   (and π - asin(...))
// Both branches stay continuous because b never reaches 0 in its band.
// Period from line width so gyroid uses about as much plastic as grid at the
// same density (measured against Kiri's grid fill).
function fillGyroidFast(target) {
    const b = target.bounds();
    const z = target.zValue();
    const density = Math.max(0.02, target.density());
    const period = 1.92 * target.lineWidth() / density;
    const k = Math.PI * 2 / period;
    // chord error stays under ~0.03 mm (curvature radius is ~0.3 x period)
    const step = Math.max(0.3, period / 7);
    const sz = Math.sin(k * z), cz = Math.cos(k * z);
    const alongX = sz * sz <= 0.5;
    const u0 = alongX ? b.min.x : b.min.y, u1 = alongX ? b.max.x : b.max.y;
    const v0 = alongX ? b.min.y : b.min.x, v1 = alongX ? b.max.y : b.max.x;
    const TAU = Math.PI * 2;
    const nMin = Math.floor(k * v0 / TAU) - 1, nMax = Math.ceil(k * v1 / TAU) + 1;
    const clamp = v => v < -1 ? -1 : v > 1 ? 1 : v;
    for (let branch = 0; branch < 2; branch++) {
        for (let n = nMin; n <= nMax; n++) {
            target.newline();
            let inside = false;
            for (let u = u0; ; u += step) {
                const uu = u > u1 ? u1 : u;
                let v;
                if (alongX) {
                    const a = Math.sin(k * uu), c = -sz * Math.cos(k * uu), r = Math.hypot(a, cz);
                    const s = Math.acos(clamp(c / r));
                    v = (Math.atan2(cz, a) + (branch ? -s : s) + TAU * n) / k;
                } else {
                    const a = Math.cos(k * uu), c = -Math.sin(k * uu) * cz, r = Math.hypot(a, sz);
                    const s = Math.asin(clamp(c / r));
                    v = ((branch ? Math.PI - s : s) - Math.atan2(sz, a) + TAU * n) / k;
                }
                if (v < v0 || v > v1) {
                    if (inside) { target.newline(); inside = false; }
                } else {
                    inside = true;
                    if (alongX) target.emit(uu, v); else target.emit(v, uu);
                }
                if (uu >= u1) break;
            }
        }
    }
}
