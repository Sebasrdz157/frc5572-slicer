// 3D build plate: parts, selection, dragging, orientation tools and toolpath preview.
// Scene units are mm, Z is up, and the bed center is the origin.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FEATURES, FEATURE_KEYS } from './gcode.js';
import { makeTubes, setTubeLayers } from './tubes.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// matches the Parts Tracker palette (board.css)
const C = {
  bg: 0x0b0d11, bed: 0x1a1d23, grid: 0x2d3139, grid10: 0x3a3f4a, edge: 0x8b8fa8, vol: 0x2d3139,
  part: 0xb9bfcc, sel: 0xf0645b, out: 0xe3b341,
};

let nextId = 1;

export class Viewer extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.parts = [];
    this.selected = null;
    this.bed = { x: 220, y: 220, z: 250, originCenter: false };
    this.mode = 'edit';
    this.layFlatArmed = false;
    this.hidden = new Set(['travel']);
    this.colorMode = 'feature';

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(C.bg);
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404552, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-200, -300, 500);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(300, 200, 100);
    this.scene.add(fill);

    this.bedGroup = new THREE.Group();
    this.partGroup = new THREE.Group();
    this.pathGroup = new THREE.Group();
    this.scene.add(this.bedGroup, this.partGroup, this.pathGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bedPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this._bindPointer();

    new ResizeObserver(() => this._resize()).observe(container);
    this._resize();
    this.setBed(this.bed);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- bed ----------
  setBed(bed) {
    const resized = bed.x !== this.bed.x || bed.y !== this.bed.y || bed.z !== this.bed.z || !this.bedGroup.children.length;
    this.bed = { ...bed };
    this.bedGroup.clear();

    const plate = new THREE.Mesh(new THREE.PlaneGeometry(bed.x, bed.y), new THREE.MeshStandardMaterial({ color: C.bed, roughness: 0.95 }));
    plate.position.z = -0.05;
    this.bedGroup.add(plate);

    // grid lines every 10 mm from the printer's origin, brighter every 50 mm
    const minor = [], major = [];
    const x0 = -bed.x / 2, y0 = -bed.y / 2;
    for (let i = 0; i <= bed.x; i += 10) (i % 50 ? minor : major).push(x0 + i, y0, 0, x0 + i, -y0, 0);
    for (let j = 0; j <= bed.y; j += 10) (j % 50 ? minor : major).push(x0, y0 + j, 0, -x0, y0 + j, 0);
    for (const [pts, color] of [[minor, C.grid], [major, C.grid10]]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.bedGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color })));
    }

    const box = new THREE.BoxGeometry(bed.x, bed.y, bed.z);
    box.translate(0, 0, bed.z / 2);
    this.bedGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: C.vol })));
    this.bedGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(bed.x, bed.y)), new THREE.LineBasicMaterial({ color: C.edge })));

    // origin marker (X red, Y green) at the printer's 0,0
    const o = bed.originCenter ? [0, 0] : [x0, y0];
    const axis = (dx, dy, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([o[0], o[1], 0.05, o[0] + dx, o[1] + dy, 0.05], 3));
      this.bedGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })));
    };
    axis(20, 0, 0xf85149); axis(0, 20, 0x2ea043);

    if (resized) this.resetCamera();
    this._checkBounds();
  }

  resetCamera(view = 'iso') {
    const { x, y, z } = this.bed;
    const r = Math.max(x, y, z);
    const t = this.controls.target.set(0, 0, view === 'top' ? 0 : z * 0.12);
    const pos = { iso: [0, -r * 1.55, r * 1.05], top: [0, -0.01, r * 2.2], front: [0, -r * 2, z * 0.3], left: [-r * 2, 0, z * 0.3], right: [r * 2, 0, z * 0.3] }[view];
    this.camera.position.set(...pos);
    this.camera.lookAt(t);
    this.controls.update();
  }

  // ---------- parts ----------
  addPart(geometry, name) {
    geometry = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const k of Object.keys(geometry.attributes)) if (k !== 'position') geometry.deleteAttribute(k);
    geometry.computeVertexNormals();
    geometry.center();
    geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: C.part, roughness: 0.5, metalness: 0.05 }));
    const part = { id: nextId++, name, mesh, triangles: geometry.attributes.position.count / 3 };
    mesh.userData.part = part;
    this.partGroup.add(mesh);
    this.parts.push(part);
    this._dropToBed(part);
    this._placeFree(part);
    this.select(part);
    this._changed();
    return part;
  }

  removePart(part) {
    this.partGroup.remove(part.mesh);
    part.mesh.geometry.dispose();
    part.mesh.material.dispose();
    this.parts = this.parts.filter(p => p !== part);
    if (this.selected === part) this.select(null);
    this._changed();
  }

  clear() { for (const p of [...this.parts]) this.removePart(p); }

  duplicate(part) {
    const mesh = new THREE.Mesh(part.mesh.geometry.clone(), part.mesh.material.clone());
    mesh.quaternion.copy(part.mesh.quaternion);
    mesh.scale.copy(part.mesh.scale);
    mesh.position.copy(part.mesh.position);
    const copy = { id: nextId++, name: part.name, mesh, triangles: part.triangles };
    mesh.userData.part = copy;
    this.partGroup.add(mesh);
    this.parts.push(copy);
    this._placeFree(copy);
    this.select(copy);
    this._changed();
    return copy;
  }

  select(part) {
    this.selected = part;
    this._recolor();
    this.dispatchEvent(new CustomEvent('select', { detail: part }));
  }

  // ---------- transforms ----------
  box(part) {
    part.mesh.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(part.mesh, true);
  }
  partSize(part) { return this.box(part).getSize(new THREE.Vector3()); }

  /** Position in printer coordinates (bed corner or center origin), of the part's bounding-box center. */
  printerPosition(part) {
    const c = this.box(part).getCenter(new THREE.Vector3());
    return this.bed.originCenter ? { x: c.x, y: c.y } : { x: c.x + this.bed.x / 2, y: c.y + this.bed.y / 2 };
  }

  setPrinterPosition(part, x, y) {
    const cur = this.printerPosition(part);
    part.mesh.position.x += x - cur.x;
    part.mesh.position.y += y - cur.y;
    this._changed();
  }

  rotationDeg(part) {
    const e = new THREE.Euler().setFromQuaternion(part.mesh.quaternion, 'XYZ');
    return { x: THREE.MathUtils.radToDeg(e.x), y: THREE.MathUtils.radToDeg(e.y), z: THREE.MathUtils.radToDeg(e.z) };
  }

  setRotationDeg(part, r) {
    const c = this.box(part).getCenter(new THREE.Vector3());
    part.mesh.quaternion.setFromEuler(new THREE.Euler(...['x', 'y', 'z'].map(k => THREE.MathUtils.degToRad(r[k])), 'XYZ'));
    this._recenter(part, c);
    this._dropToBed(part);
    this._changed();
  }

  rotate(part, axis, deg) {
    const c = this.box(part).getCenter(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(+(axis === 'x'), +(axis === 'y'), +(axis === 'z')), THREE.MathUtils.degToRad(deg));
    part.mesh.quaternion.premultiply(q);
    this._recenter(part, c);
    this._dropToBed(part);
    this._changed();
  }

  /** Scale factors per axis (1 = 100 %), in the part's own axes. */
  setScale(part, s) {
    const c = this.box(part).getCenter(new THREE.Vector3());
    part.mesh.scale.set(s.x, s.y, s.z);
    this._recenter(part, c);
    this._dropToBed(part);
    if (this._overlaps(part)) this._placeFree(part);
    this._changed();
  }

  layOnNormal(part, worldNormal) {
    const c = this.box(part).getCenter(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromUnitVectors(worldNormal.clone().normalize(), new THREE.Vector3(0, 0, -1));
    part.mesh.quaternion.premultiply(q);
    this._recenter(part, c);
    this._dropToBed(part);
    this._changed();
  }

  /** Put the largest flat area (summed over near-coplanar faces) on the bed. */
  autoOrient(part) {
    part.mesh.updateMatrixWorld(true);
    const pos = part.mesh.geometry.attributes.position;
    const nm = new THREE.Matrix3().getNormalMatrix(part.mesh.matrixWorld);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n = new THREE.Vector3(), ac = new THREE.Vector3();
    const buckets = new Map();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      n.subVectors(b, a).cross(ac.subVectors(c, a));
      const area = n.length() / 2;
      if (area < 1e-6) continue;
      n.normalize().applyMatrix3(nm).normalize();
      const key = `${Math.round(n.x * 20)},${Math.round(n.y * 20)},${Math.round(n.z * 20)}`;
      const e = buckets.get(key);
      if (e) { e.area += area; e.n.addScaledVector(n, area); }
      else buckets.set(key, { area, n: n.clone().multiplyScalar(area) });
    }
    let best = null;
    for (const e of buckets.values()) if (!best || e.area > best.area) best = e;
    if (best) this.layOnNormal(part, best.n.normalize());
  }

  arrange(spacing = 6) {
    const items = this.parts.map(p => {
      const box = this.box(p), size = box.getSize(new THREE.Vector3());
      return { p, box, w: size.x, d: size.y };
    }).sort((u, v) => v.d - u.d);
    let x = 0, y = 0, rowD = 0, maxW = 0;
    const W = this.bed.x - 10;
    for (const it of items) {
      if (x > 0 && x + it.w > W) { x = 0; y += rowD + spacing; rowD = 0; }
      it.x = x; it.y = y;
      x += it.w + spacing; rowD = Math.max(rowD, it.d); maxW = Math.max(maxW, x - spacing);
    }
    const totalD = y + rowD;
    for (const it of items) {
      const bc = it.box.getCenter(new THREE.Vector3());
      it.p.mesh.position.x += it.x + it.w / 2 - maxW / 2 - bc.x;
      it.p.mesh.position.y += -(it.y + it.d / 2 - totalD / 2) - bc.y;
    }
    this._changed();
  }

  _recenter(part, center) {
    const now = this.box(part).getCenter(new THREE.Vector3());
    part.mesh.position.x += center.x - now.x;
    part.mesh.position.y += center.y - now.y;
  }

  _dropToBed(part) { part.mesh.position.z -= this.box(part).min.z; }

  _overlaps(part) {
    const box = this.box(part);
    return this.parts.some(p => p !== part && this.box(p).intersectsBox(box));
  }

  _placeFree(part) {
    const others = this.parts.filter(p => p !== part);
    const size = this.partSize(part);
    const center = (cx, cy) => {
      part.mesh.position.x = cx; part.mesh.position.y = cy;
      this._recenter(part, new THREE.Vector3(cx, cy, 0));
    };
    if (!others.length) return center(0, 0);
    const taken = others.map(p => this.box(p));
    const hx = size.x / 2 + 3, hy = size.y / 2 + 3;
    for (let r = 0; r < Math.max(this.bed.x, this.bed.y); r += 5) {
      const steps = Math.max(8, r);
      for (let k = 0; k < steps; k++) {
        const ang = (k / steps) * Math.PI * 2;
        const cx = Math.cos(ang) * r, cy = Math.sin(ang) * r;
        const box = new THREE.Box3(new THREE.Vector3(cx - hx, cy - hy, -1), new THREE.Vector3(cx + hx, cy + hy, 1e4));
        if (!taken.some(t => t.intersectsBox(box))) return center(cx, cy);
      }
    }
  }

  _checkBounds() {
    const { x, y, z } = this.bed, eps = 0.01;
    let anyOut = false;
    for (const p of this.parts) {
      const b = this.box(p);
      p.out = b.min.x < -x / 2 - eps || b.max.x > x / 2 + eps || b.min.y < -y / 2 - eps || b.max.y > y / 2 + eps || b.max.z > z + eps;
      anyOut ||= p.out;
    }
    this.anyOut = anyOut;
    this._recolor();
  }

  _recolor() {
    for (const p of this.parts) {
      p.mesh.material.color.setHex(p.out ? C.out : p === this.selected ? C.sel : C.part);
      p.mesh.material.emissive.setHex(p === this.selected ? 0x2a0503 : 0x000000);
    }
  }

  _changed() {
    this._checkBounds();
    this.dispatchEvent(new Event('change'));
  }

  // ---------- pointer ----------
  _ray(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    let drag = null, down = null;
    el.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || this.mode !== 'edit') return;
      down = { x: ev.clientX, y: ev.clientY };
      this._ray(ev);
      const hit = this.raycaster.intersectObjects(this.parts.map(p => p.mesh), false)[0];
      if (!hit) return;
      const part = hit.object.userData.part;
      if (this.layFlatArmed) {
        this.layOnNormal(part, hit.face.normal.clone().transformDirection(hit.object.matrixWorld));
        this.setLayFlat(false);
        this.select(part);
        down = null;
        return;
      }
      this.select(part);
      const pt = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.bedPlane, pt);
      drag = { part, off: pt.sub(part.mesh.position), moved: false };
      this.controls.enabled = false;
      el.setPointerCapture(ev.pointerId);
    });
    el.addEventListener('pointermove', ev => {
      if (!drag) return;
      this._ray(ev);
      const pt = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.bedPlane, pt)) return;
      drag.part.mesh.position.x = pt.x - drag.off.x;
      drag.part.mesh.position.y = pt.y - drag.off.y;
      drag.moved = true;
      this._checkBounds();
      this.dispatchEvent(new Event('drag'));
    });
    el.addEventListener('pointerup', ev => {
      if (drag) {
        const moved = drag.moved;
        drag = null;
        this.controls.enabled = true;
        if (moved) this._changed();
      } else if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 4 && this.mode === 'edit') {
        this._ray(ev);
        if (!this.raycaster.intersectObjects(this.parts.map(p => p.mesh), false).length) this.select(null);
      }
      down = null;
    });
  }

  setLayFlat(on) {
    this.layFlatArmed = on;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
    this.dispatchEvent(new CustomEvent('layflat', { detail: on }));
  }

  /**
   * Render the parts (not toolpaths) to a square PNG, framed like Bambu's plate
   * thumbnails. Returns PNG bytes.
   */
  async snapshot(size = 512) {
    const r = this.renderer, cam = this.camera.clone();
    const prev = { w: r.domElement.width, h: r.domElement.height, ratio: r.getPixelRatio(), parts: this.partGroup.visible, paths: this.pathGroup.visible, bed: this.bedGroup.visible, bg: this.scene.background };
    const box = new THREE.Box3();
    for (const p of this.parts) box.union(this.box(p));
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const rad = Math.max(s.x, s.y, s.z) * 0.75 || 50;
    cam.aspect = 1; cam.fov = 30;
    cam.position.set(c.x + rad * 1.6, c.y - rad * 2.6, c.z + rad * 2.2);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    this.partGroup.visible = true; this.pathGroup.visible = false; this.bedGroup.visible = false;
    this.scene.background = null;
    for (const p of this.parts) p.mesh.material.color.setHex(0xc8ccd6);
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    r.setClearColor(0x000000, 0);
    r.render(this.scene, cam);
    const blob = await new Promise(res => r.domElement.toBlob(res, 'image/png'));
    // restore
    r.setClearColor(0x000000, 1);
    this.scene.background = prev.bg;
    this.partGroup.visible = prev.parts; this.pathGroup.visible = prev.paths; this.bedGroup.visible = prev.bed;
    r.setPixelRatio(prev.ratio);
    this._resize();
    this._recolor();
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ---------- export ----------
  exportSTL() {
    let tris = 0;
    for (const p of this.parts) tris += p.mesh.geometry.attributes.position.count / 3;
    const buf = new ArrayBuffer(84 + tris * 50);
    const dv = new DataView(buf);
    dv.setUint32(80, tris, true);
    let off = 84;
    const v = new THREE.Vector3();
    const all = new THREE.Box3();
    for (const p of this.parts) {
      p.mesh.updateMatrixWorld(true);
      const pos = p.mesh.geometry.attributes.position;
      // mirrored scale flips winding; swap two vertices to keep normals outward
      const flip = p.mesh.matrixWorld.determinant() < 0;
      for (let i = 0; i < pos.count; i += 3) {
        off += 12;
        for (const k of flip ? [0, 2, 1] : [0, 1, 2]) {
          v.fromBufferAttribute(pos, i + k).applyMatrix4(p.mesh.matrixWorld);
          all.expandByPoint(v);
          dv.setFloat32(off, v.x, true); dv.setFloat32(off + 4, v.y, true); dv.setFloat32(off + 8, v.z, true);
          off += 12;
        }
        off += 2;
      }
    }
    const c = all.getCenter(new THREE.Vector3());
    return { buffer: buf, center: { x: c.x, y: c.y }, triangles: tris };
  }

  // ---------- toolpath preview ----------
  /** @param info parsed G-code, @param opts { width } line width for filament rendering */
  showToolpaths(info, opts = {}) {
    this.clearToolpaths(false);
    this.paths = { info, lines: {} };
    for (const k of FEATURE_KEYS) {
      const s = info.sets[k];
      if (!s.positions.length) continue;
      let obj;
      if (k === 'travel') {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(s.positions.length), 3));
        obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }));
      } else {
        obj = makeTubes(s.positions, s.layerEnds, info.layerZ, opts.width || 0.42);
      }
      obj.frustumCulled = false;
      obj.visible = !this.hidden.has(k);
      this.pathGroup.add(obj);
      this.paths.lines[k] = obj;
    }
    this.partGroup.visible = false;
    this.mode = 'preview';
    this.setColorMode(this.colorMode);
    this.setLayerRange(1, info.layers);
  }

  setColorMode(mode) {
    this.colorMode = mode;
    if (!this.paths) return;
    const { info } = this.paths;
    const range = this.colorRange(mode);
    for (const [k, obj] of Object.entries(this.paths.lines)) {
      const s = info.sets[k];
      const base = FEATURES[k].color;
      const segs = s.positions.length / 6;
      const tube = k !== 'travel';
      const attr = tube ? obj.geometry.attributes.iColor : obj.geometry.attributes.color;
      const col = attr.array;
      for (let i = 0; i < segs; i++) {
        let c = base;
        if (mode !== 'feature' && tube) {
          const val = mode === 'speed' ? s.speed[i * 2] : mode === 'flow' ? s.flow[i * 2] : s.positions[i * 6 + 5];
          c = gradient((val - range.min) / (range.max - range.min || 1));
        }
        if (tube) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
        else for (const o of [i * 6, i * 6 + 3]) { col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
      }
      attr.needsUpdate = true;
    }
  }

  colorRange(mode) {
    if (!this.paths || mode === 'feature') return null;
    let min = Infinity, max = -Infinity;
    for (const k of FEATURE_KEYS) {
      if (k === 'travel') continue;
      const s = this.paths.info.sets[k];
      const arr = mode === 'speed' ? s.speed : mode === 'flow' ? s.flow : null;
      const n = s.positions.length / 3;
      for (let i = 0; i < n; i++) {
        const v = arr ? arr[i] : s.positions[i * 3 + 2];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 1 };
  }

  setFeatureVisible(k, on) {
    if (on) this.hidden.delete(k); else this.hidden.add(k);
    if (this.paths?.lines[k]) this.paths.lines[k].visible = on;
  }

  /** Show layers lo..hi (1-based, inclusive). */
  setLayerRange(lo, hi) {
    if (!this.paths) return;
    for (const [k, obj] of Object.entries(this.paths.lines)) {
      if (k !== 'travel') { setTubeLayers(obj, lo, hi); continue; }
      const ends = this.paths.info.sets[k].layerEnds;
      const start = lo >= 2 ? ends[lo - 2] : 0;
      const end = hi >= 1 ? ends[Math.min(hi, ends.length) - 1] : 0;
      obj.geometry.setDrawRange(start, Math.max(0, end - start));
    }
  }

  clearToolpaths(toEdit = true) {
    if (this.paths) {
      for (const l of Object.values(this.paths.lines)) { l.geometry.dispose(); l.material.dispose(); }
      this.pathGroup.clear();
      this.paths = null;
    }
    if (toEdit) {
      this.partGroup.visible = true;
      this.mode = 'edit';
    }
  }
}

// blue -> cyan -> green -> yellow -> red, like Orca's speed legend
const STOPS = [[0.16, 0.33, 0.85], [0.1, 0.75, 0.85], [0.2, 0.75, 0.3], [0.95, 0.8, 0.15], [0.9, 0.2, 0.15]];
export function gradient(t) {
  t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
