// Load STL / 3MF / OBJ files into three.js BufferGeometry (one per file).
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Flatten every mesh in an object tree into one non-indexed geometry in world space. */
function flatten(object) {
  const geos = [];
  object.updateMatrixWorld(true);
  object.traverse(o => {
    if (!o.isMesh) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
  });
  if (!geos.length) throw new Error('No meshes found in file');
  return geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
}

export async function loadModelFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const data = await file.arrayBuffer();
  let geometry;
  if (ext === 'stl') {
    geometry = new STLLoader().parse(data);
  } else if (ext === '3mf') {
    geometry = flatten(new ThreeMFLoader().parse(data));
  } else if (ext === 'obj') {
    geometry = flatten(new OBJLoader().parse(new TextDecoder().decode(data)));
  } else {
    throw new Error(`Unsupported file type: .${ext}`);
  }
  const count = geometry.attributes.position?.count || 0;
  if (count < 3) throw new Error('File has no triangles');
  return { geometry, name: file.name.replace(/\.[^.]+$/, '') };
}

export const ACCEPTED = ['stl', '3mf', 'obj'];
