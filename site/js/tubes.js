// Renders extrusion segments as solid "filament" (flattened 6-sided tubes)
// with GPU instancing: one prism mesh, one instance per G-code segment. The
// vertex shader places each instance between its start and end points, sized
// to the line width and layer height, so millions of segments stay one draw call.
import * as THREE from 'three';

// cross-section: hexagon squashed to an ellipse; x = sideways, y = up
const RING = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

function prism() {
  const g = new THREE.InstancedBufferGeometry();
  const pos = [], nrm = [], idx = [];
  for (const t of [0, 1]) for (const [x, y] of RING) { pos.push(x, y, t); nrm.push(x, y, 0); }
  // end caps (center vertices) so segment ends aren't hollow
  pos.push(0, 0, 0, 0, 0, 1); nrm.push(0, 0, -1, 0, 0, 1);
  const n = RING.length, c0 = 2 * n, c1 = 2 * n + 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + i, j, n + j, n + i);
    idx.push(c0, j, i, c1, n + i, n + j);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

const vertexShader = /* glsl */`
  attribute vec3 iStart;
  attribute vec3 iEnd;
  attribute vec3 iColor;
  attribute float iLayer;
  attribute float iHeight;
  uniform float uWidth;
  uniform float uLo;
  uniform float uHi;
  uniform float uTop;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    if (iLayer < uLo || iLayer > uHi) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 d = iEnd - iStart;
    float len = length(d);
    vec3 dir = len > 1e-6 ? d / len : vec3(1.0, 0.0, 0.0);
    vec3 side = normalize(cross(dir, vec3(0.0, 0.0, 1.0)) + vec3(1e-6, 0.0, 0.0));
    vec3 up = cross(side, dir);
    float hw = uWidth * 0.5;
    float hh = iHeight * 0.5;
    // extend each end by half a width so corners join without gaps
    vec3 along = mix(iStart - dir * hw * 0.5, iEnd + dir * hw * 0.5, position.z);
    vec3 p = along + side * position.x * hw + up * (position.y * hh - hh);
    vec3 n = normalize(side * normal.x / hw + up * normal.y / hh + dir * normal.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * n);
    vView = -mv.xyz;
    // current top layer slightly brighter, like Orca
    vColor = iColor * (iLayer == uTop ? 1.15 : 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */`
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    vec3 l1 = normalize(vec3(-0.35, 0.45, 0.8));   // in view space
    vec3 l2 = normalize(vec3(0.6, -0.2, 0.4));
    float diff = max(dot(n, l1), 0.0) * 0.75 + max(dot(n, l2), 0.0) * 0.25;
    float spec = pow(max(dot(reflect(-l1, n), v), 0.0), 24.0) * 0.25;
    vec3 c = vColor * (0.32 + 0.78 * diff) + spec;
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * @param {Float32Array} positions pairs of points (x,y,z, x,y,z) per segment
 * @param {number[]} layerEnds vertex counts at the end of each layer
 * @param {number[]} layerZ top Z of each layer
 * @param {number} width line width (mm)
 */
export function makeTubes(positions, layerEnds, layerZ, width) {
  const n = positions.length / 6;
  const g = prism();
  const start = new Float32Array(n * 3), end = new Float32Array(n * 3);
  const layer = new Float32Array(n), height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    start[i * 3] = positions[i * 6]; start[i * 3 + 1] = positions[i * 6 + 1]; start[i * 3 + 2] = positions[i * 6 + 2];
    end[i * 3] = positions[i * 6 + 3]; end[i * 3 + 1] = positions[i * 6 + 4]; end[i * 3 + 2] = positions[i * 6 + 5];
  }
  let seg = 0;
  for (let L = 0; L < layerEnds.length; L++) {
    const last = layerEnds[L] / 2;
    const h = Math.max(0.05, L ? layerZ[L] - layerZ[L - 1] : layerZ[0]) || 0.2;
    for (; seg < last; seg++) { layer[seg] = L + 1; height[seg] = h; }
  }
  g.setAttribute('iStart', new THREE.InstancedBufferAttribute(start, 3));
  g.setAttribute('iEnd', new THREE.InstancedBufferAttribute(end, 3));
  g.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('iLayer', new THREE.InstancedBufferAttribute(layer, 1));
  g.setAttribute('iHeight', new THREE.InstancedBufferAttribute(height, 1));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: { uWidth: { value: width }, uLo: { value: 1 }, uHi: { value: 1e9 }, uTop: { value: -1 } },
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function setTubeLayers(mesh, lo, hi) {
  mesh.material.uniforms.uLo.value = lo;
  mesh.material.uniforms.uHi.value = hi;
  mesh.material.uniforms.uTop.value = hi;
}
