// 3D build plate: parts, selection, dragging, orientation tools and toolpath preview.
// Scene units are mm, Z is up, and the bed center is the origin.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const COLORS = {
  light: { bg: 0xe9e8e4, bed: 0xfbfbf9, grid: 0xd2d0c8, edge: 0x9a988f, vol: 0xb9b7ae, part: 0xe8a000, sel: 0xffc233, out: 0xd8443c },
  dark:  { bg: 0x1a1a19, bed: 0x2a2a28, grid: 0x3a3a37, edge: 0x6d6b64, vol: 0x4a4945, part: 0xe8a000, sel: 0xffc84a, out: 0xff5a50 },
};

let nextId = 1;

export class Viewer extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.parts = [];
    this.selected = null;
    this.bed = { x: 220, y: 220, z: 250 };
    this.mode = 'edit';
    this.layFlatArmed = false;
    this.dark = matchMedia('(prefers-color-scheme: dark)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6a65, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
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

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      this.dark = e.matches;
      this.setBed(this.bed);
      this._recolor();
    });

    new ResizeObserver(() => this._resize()).observe(container);
    this._resize();
    this.setBed(this.bed);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  get colors() { return this.dark ? COLORS.dark : COLORS.light; }

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
    const c = this.colors;
    this.scene.background = new THREE.Color(c.bg);
    this.bedGroup.clear();

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(bed.x, bed.y),
      new THREE.MeshStandardMaterial({ color: c.bed, roughness: 0.95 })
    );
    plate.position.z = -0.05;
    this.bedGroup.add(plate);

    const grid = [];
    for (let x = 0; x <= bed.x / 2; x += 10) grid.push(x, -bed.y / 2, 0, x, bed.y / 2, 0, -x, -bed.y / 2, 0, -x, bed.y / 2, 0);
    for (let y = 0; y <= bed.y / 2; y += 10) grid.push(-bed.x / 2, y, 0, bed.x / 2, y, 0, -bed.x / 2, -y, 0, bed.x / 2, -y, 0);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    this.bedGroup.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: c.grid })));

    const box = new THREE.BoxGeometry(bed.x, bed.y, bed.z);
    box.translate(0, 0, bed.z / 2);
    const vol = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: c.vol, transparent: true, opacity: 0.6 }));
    this.bedGroup.add(vol);

    const rim = new THREE.EdgesGeometry(new THREE.PlaneGeometry(bed.x, bed.y));
    this.bedGroup.add(new THREE.LineSegments(rim, new THREE.LineBasicMaterial({ color: c.edge })));

    // front marker so people know which side faces them
    const tri = new THREE.Shape();
    tri.moveTo(-6, -bed.y / 2 - 4); tri.lineTo(6, -bed.y / 2 - 4); tri.lineTo(0, -bed.y / 2 - 12);
    const marker = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshBasicMaterial({ color: c.edge }));
    this.bedGroup.add(marker);

    if (resized) this.resetCamera();
    this._checkBounds();
  }

  resetCamera() {
    const { x, y, z } = this.bed;
    const r = Math.max(x, y, z);
    this.camera.position.set(0, -r * 1.55, r * 1.05);
    this.controls.target.set(0, 0, z * 0.12);
    this.controls.update();
  }

  // ---------- parts ----------
  addPart(geometry, name) {
    geometry = geometry.index ? geometry.toNonIndexed() : geometry;
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry.computeVertexNormals();
    geometry.center();
    geometry.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ color: this.colors.part, roughness: 0.55, metalness: 0.05 });
    const mesh = new THREE.Mesh(geometry, mat);
    const part = { id: nextId++, name, mesh, scale: 1 };
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

  clear() {
    for (const p of [...this.parts]) this.removePart(p);
  }

  duplicate(part) {
    const geo = part.mesh.geometry.clone();
    const mat = part.mesh.material.clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.quaternion.copy(part.mesh.quaternion);
    mesh.scale.copy(part.mesh.scale);
    mesh.position.copy(part.mesh.position);
    const copy = { id: nextId++, name: part.name, mesh, scale: part.scale };
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

  rotate(part, axis, deg) {
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0),
      THREE.MathUtils.degToRad(deg)
    );
    part.mesh.quaternion.premultiply(q);
    this._dropToBed(part);
    this._changed();
  }

  setScale(part, factor) {
    part.scale = factor;
    part.mesh.scale.setScalar(factor);
    this._dropToBed(part);
    if (this._overlaps(part)) this._placeFree(part);
    this._changed();
  }

  /** Rotate so the given world-space normal points straight down. */
  layOnNormal(part, worldNormal) {
    const q = new THREE.Quaternion().setFromUnitVectors(worldNormal.clone().normalize(), new THREE.Vector3(0, 0, -1));
    part.mesh.quaternion.premultiply(q);
    this._dropToBed(part);
    this._changed();
  }

  /** Put the largest flat area (summed over coplanar-ish faces) on the bed. */
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

  arrange() {
    const gap = 6;
    const items = this.parts.map(p => {
      const box = new THREE.Box3().setFromObject(p.mesh, true);
      const size = box.getSize(new THREE.Vector3());
      return { p, box, w: size.x, d: size.y };
    }).sort((u, v) => v.d - u.d);
    // shelf packing, then center the whole layout on the bed
    let x = 0, y = 0, rowD = 0, maxW = 0;
    const W = this.bed.x - 10;
    for (const it of items) {
      if (x > 0 && x + it.w > W) { x = 0; y += rowD + gap; rowD = 0; }
      it.x = x; it.y = y;
      x += it.w + gap; rowD = Math.max(rowD, it.d); maxW = Math.max(maxW, x - gap);
    }
    const totalD = y + rowD;
    for (const it of items) {
      const cx = it.x + it.w / 2 - maxW / 2;
      const cy = -(it.y + it.d / 2 - totalD / 2);
      const bc = it.box.getCenter(new THREE.Vector3());
      it.p.mesh.position.x += cx - bc.x;
      it.p.mesh.position.y += cy - bc.y;
    }
    this._changed();
  }

  partSize(part) {
    return new THREE.Box3().setFromObject(part.mesh, true).getSize(new THREE.Vector3());
  }

  _dropToBed(part) {
    part.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(part.mesh, true);
    part.mesh.position.z -= box.min.z;
  }

  _overlaps(part) {
    part.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(part.mesh, true);
    return this.parts.some(p => p !== part && new THREE.Box3().setFromObject(p.mesh, true).intersectsBox(box));
  }

  /** Move a new part next to the existing ones instead of on top of them. */
  _placeFree(part) {
    const others = this.parts.filter(p => p !== part);
    if (!others.length) { part.mesh.position.x = 0; part.mesh.position.y = 0; return; }
    const size = this.partSize(part);
    const taken = others.map(p => new THREE.Box3().setFromObject(p.mesh, true));
    const step = 5;
    const half = new THREE.Vector3(size.x / 2 + 3, size.y / 2 + 3, 0);
    for (let r = 0; r < Math.max(this.bed.x, this.bed.y); r += step) {
      for (let k = 0; k < Math.max(8, r); k++) {
        const ang = (k / Math.max(8, r)) * Math.PI * 2;
        const cx = Math.cos(ang) * r, cy = Math.sin(ang) * r;
        const box = new THREE.Box3(new THREE.Vector3(cx - half.x, cy - half.y, -1), new THREE.Vector3(cx + half.x, cy + half.y, 1e4));
        if (taken.some(t => t.intersectsBox(box))) continue;
        part.mesh.position.x = cx; part.mesh.position.y = cy;
        part.mesh.updateMatrixWorld(true);
        const bc = new THREE.Box3().setFromObject(part.mesh, true).getCenter(new THREE.Vector3());
        part.mesh.position.x += cx - bc.x; part.mesh.position.y += cy - bc.y;
        return;
      }
    }
  }

  _checkBounds() {
    const { x, y, z } = this.bed, eps = 0.01;
    let anyOut = false;
    for (const p of this.parts) {
      p.mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(p.mesh, true);
      p.out = b.min.x < -x / 2 - eps || b.max.x > x / 2 + eps || b.min.y < -y / 2 - eps || b.max.y > y / 2 + eps || b.max.z > z + eps;
      anyOut ||= p.out;
    }
    this.anyOut = anyOut;
    this._recolor();
  }

  _recolor() {
    const c = this.colors;
    for (const p of this.parts) {
      p.mesh.material.color.setHex(p.out ? c.out : p === this.selected ? c.sel : c.part);
      p.mesh.material.emissive.setHex(p === this.selected ? 0x332200 : 0x000000);
    }
  }

  _changed() {
    this._checkBounds();
    this.dispatchEvent(new Event('change'));
  }

  // ---------- pointer: select, drag, lay-on-face ----------
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
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        this.layOnNormal(part, n);
        this.setLayFlat(false);
        this.select(part);
        down = null; // the part moved; don't treat pointerup as a click on empty space
        return;
      }
      this.select(part);
      const pt = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.bedPlane, pt);
      drag = { part, off: pt.sub(part.mesh.position) };
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
      this._checkBounds();
    });
    el.addEventListener('pointerup', ev => {
      if (drag) {
        drag = null;
        this.controls.enabled = true;
        this._changed();
      } else if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 4 && this.mode === 'edit') {
        // a click (not an orbit) on empty space clears the selection
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

  // ---------- export ----------
  /** Merge all parts (with transforms) into one binary STL. Returns { buffer, center }. */
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
      for (let i = 0; i < pos.count; i += 3) {
        off += 12; // normal (zeros; slicer recomputes)
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, i + k).applyMatrix4(p.mesh.matrixWorld);
          all.expandByPoint(v);
          dv.setFloat32(off, v.x, true); dv.setFloat32(off + 4, v.y, true); dv.setFloat32(off + 8, v.z, true);
          off += 12;
        }
        off += 2;
      }
    }
    const center = all.getCenter(new THREE.Vector3());
    return { buffer: buf, center: { x: center.x, y: center.y }, triangles: tris };
  }

  // ---------- toolpath preview ----------
  showToolpaths(preview) {
    this.clearToolpaths();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(preview.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(preview.colors, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
    lines.frustumCulled = false;
    this.pathGroup.add(lines);
    this.paths = { lines, layerEnds: preview.layerEnds };
    this.partGroup.visible = false;
    this.mode = 'preview';
    this.setLayer(preview.layerEnds.length);
  }

  setLayer(n) {
    if (!this.paths) return;
    const ends = this.paths.layerEnds;
    const idx = Math.max(0, Math.min(ends.length, n)) - 1;
    this.paths.lines.geometry.setDrawRange(0, idx >= 0 ? ends[idx] : 0);
  }

  clearToolpaths() {
    if (this.paths) {
      this.paths.lines.geometry.dispose();
      this.paths.lines.material.dispose();
      this.pathGroup.clear();
      this.paths = null;
    }
    this.partGroup.visible = true;
    this.mode = 'edit';
  }
}
