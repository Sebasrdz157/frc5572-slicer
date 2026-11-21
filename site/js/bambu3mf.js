// Packages G-code as a Bambu Lab ".gcode.3mf" (what Bambu printers expect),
// following the layout Bambu Studio 2.7 writes for an A1 plate:
//   [Content_Types].xml, _rels/.rels, 3D/3dmodel.model,
//   Metadata/plate_1.gcode (+ .md5), plate_1.png, plate_1_small.png,
//   model_settings.config (+ rels), slice_info.config, plate_1.json,
//   project_settings.config
// The zip is built here (no library); entries are deflated with the browser's
// CompressionStream, and the G-code checksum is MD5 like Bambu Studio's.

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- MD5 (RFC 1321) ----------
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >> 6) + 1 << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return [...new Uint8Array(out.buffer)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------- zip ----------
async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {{ name: string, data: Uint8Array|string, store?: boolean }[]} files */
export async function zip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const crc = crc32(raw);
    let body = raw, method = 0;
    if (!f.store) {
      const z = await deflateRaw(raw);
      if (z && z.length < raw.length) { body = z; method = 8; }
    }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
}

// ---------- Bambu G-code layout ----------
const fmtTime = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return `${h ? h + 'h ' : ''}${m}m ${s % 60}s`; };

/** Bambu firmware reads the header block at the very top of the file. */
export function bambuGcode(body, info, F) {
  const header = [
    '; HEADER_BLOCK_START',
    '; generated by 5572 Slicer (Kiri:Moto engine)',
    `; model printing time: ${fmtTime(info.seconds)}; total estimated time: ${fmtTime(info.seconds + 360)}`,
    `; total layer number: ${info.layers}`,
    `; total filament length [mm] : ${info.filamentMM.toFixed(2)}`,
    `; total filament volume [cm^3] : ${(info.filamentMM * Math.PI * (F.filament_diameter / 2) ** 2).toFixed(2)}`,
    `; total filament weight [g] : ${info.grams.toFixed(2)}`,
    `; filament_density: ${F.filament_density}`,
    `; filament_diameter: ${F.filament_diameter}`,
    `; max_z_height: ${info.maxZ.toFixed(2)}`,
    '; filament: 1',
    '; HEADER_BLOCK_END',
    '',
  ].join('\n');
  return `${header}\n; EXECUTABLE_BLOCK_START\n${body}\n; EXECUTABLE_BLOCK_END\n`;
}

/** Printer-coordinate XY bounds of all extrusions. */
function extrusionBounds(gcode) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, x = 0, y = 0, started = false;
  for (const l of gcode.split('\n')) {
    if (!started) { if (l.startsWith(';LAYER_CHANGE')) started = true; continue; }
    if (l.charCodeAt(0) !== 71) continue; // 'G'
    const mx = l.match(/ X(-?[\d.]+)/), my = l.match(/ Y(-?[\d.]+)/);
    const nx = mx ? +mx[1] : x, ny = my ? +my[1] : y;
    if (/ E[\d.]/.test(l)) { minx = Math.min(minx, x, nx); maxx = Math.max(maxx, x, nx); miny = Math.min(miny, y, ny); maxy = Math.max(maxy, y, ny); }
    x = nx; y = ny;
  }
  return isFinite(minx) ? [minx, miny, maxx, maxy] : [0, 0, 0, 0];
}

const xml = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * @param {object} o { gcode (already in Bambu layout), info, P, F, S, parts: string[], thumb: Uint8Array, thumbSmall: Uint8Array, color }
 * @returns {Promise<Blob>}
 */
export async function buildGcode3mf(o) {
  const { gcode, info, P, F, S, parts, thumb, thumbSmall } = o;
  const color = o.color || '#E8E8E8';
  const enc = new TextEncoder();
  const gbytes = enc.encode(gcode);
  const bbox = extrusionBounds(gcode);
  const today = new Date().toISOString().slice(0, 10);
  const objects = parts.map((name, i) => `    <object identify_id="${i + 1}" name="${xml(name)}" skipped="false" />`).join('\n');

  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>
 <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>
</Relationships>` },
    { name: '3D/3dmodel.model', data: `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">5572 Slicer</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="CreationDate">${today}</metadata>
 <metadata name="ModificationDate">${today}</metadata>
 <metadata name="Title">${xml(parts.join(', '))}</metadata>
 <resources>
 </resources>
 <build/>
</model>
` },
    { name: 'Metadata/plate_1.png', data: thumb, store: true },
    { name: 'Metadata/plate_1_small.png', data: thumbSmall, store: true },
    { name: 'Metadata/plate_1.json', data: JSON.stringify({
      bbox_all: bbox, bbox_objects: parts.map((name, i) => ({ area: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]), bbox, id: i + 1, layer_height: S.layer_height, name })),
      bed_type: 'textured_plate', filament_colors: [color], filament_ids: [0], first_extruder: 0,
      first_layer_time: info.layerTime?.[0] || 0, is_seq_print: false, nozzle_diameter: P.nozzle_diameter, version: 2,
    }) },
    { name: 'Metadata/project_settings.config', data: JSON.stringify({
      printer_model: 'Bambu Lab A1', printer_settings_id: P.name, print_settings_id: S.name, filament_settings_id: [F.name],
      nozzle_diameter: [String(P.nozzle_diameter)], layer_height: String(S.layer_height), filament_type: [F.filament_type],
      filament_colour: [color], filament_density: [String(F.filament_density)], filament_diameter: [String(F.filament_diameter)],
      nozzle_temperature: [String(F.nozzle_temperature)], nozzle_temperature_initial_layer: [String(F.nozzle_temperature_initial_layer)],
      textured_plate_temp: [String(F.bed_temperature)], textured_plate_temp_initial_layer: [String(F.bed_temperature_initial_layer)],
      curr_bed_type: 'Textured PEI Plate', enable_support: S.enable_support ? '1' : '0',
      version: '02.07.01.62',
    }, null, 4) },
    { name: 'Metadata/plate_1.gcode.md5', data: md5(gbytes) },
    { name: 'Metadata/plate_1.gcode', data: gbytes },
    { name: 'Metadata/_rels/model_settings.config.rels', data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.bambulab.com/package/2021/gcode"/>
</Relationships>
` },
    { name: 'Metadata/model_settings.config', data: `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Auto For Flush"/>
    <metadata key="filament_maps" value="1"/>
    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <metadata key="pattern_bbox_file" value="Metadata/plate_1.json"/>
  </plate>
</config>
` },
    { name: 'Metadata/slice_info.config', data: `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.07.01.62"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="extruder_type" value="0"/>
    <metadata key="nozzle_volume_type" value="0"/>
    <metadata key="printer_model_id" value="N2S"/>
    <metadata key="nozzle_diameters" value="${P.nozzle_diameter}"/>
    <metadata key="timelapse_type" value="0"/>
    <metadata key="prediction" value="${Math.round(info.seconds)}"/>
    <metadata key="weight" value="${info.grams.toFixed(2)}"/>
    <metadata key="first_layer_time" value="${(info.layerTime?.[0] || 0).toFixed(6)}"/>
    <metadata key="outside" value="false"/>
    <metadata key="support_used" value="${S.enable_support ? 'true' : 'false'}"/>
    <metadata key="label_object_enabled" value="false"/>
    <metadata key="filament_maps" value="1"/>
${objects}
    <filament id="1" tray_info_idx="" type="${xml(F.filament_type)}" color="${color}" used_m="${(info.filamentMM / 1000).toFixed(2)}" used_g="${info.grams.toFixed(2)}" group_id="0" nozzle_diameter="${Number(P.nozzle_diameter).toFixed(2)}" volume_type="Standard" used_for_object="true" used_for_support="${S.enable_support ? 'true' : 'false'}"/>
    <nozzle id="0" extruder_id="1" nozzle_diameter="${P.nozzle_diameter}" volume_type="Standard"/>
    <layer_filament_lists>
      <layer_filament_list filament_list="0" layer_ranges="0 ${Math.max(0, info.layers - 1)}" />
    </layer_filament_lists>
  </plate>
</config>
` },
    { name: 'Metadata/filament_sequence.json', data: JSON.stringify({ plate_1: { nozzle_sequence: [0], optimal_assignment: [0], sequence: [1] } }) },
  ];
  return zip(files);
}
