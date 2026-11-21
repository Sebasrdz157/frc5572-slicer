// Printer, material and quality definitions for the team's printers.
//
// Start/end G-code is adapted from OrcaSlicer's system profiles
// (resources/profiles/{Creality,Flashforge,Prusa}/machine/*.json), with Orca's
// [placeholders] swapped for Kiri:Moto's {variables}:
//   {temp} nozzle temp, {bed_temp} bed temp, {layers} layer count,
//   {progress} percent done, {remain_time} minutes left.
// %%TOP+N%% is filled in by app.js after slicing: top of the print + N mm (capped at bed height).
// Kiri also supports ";; IF { expr }" / ";; ELSE" / ";; END" blocks.

export const PRINTERS = {
  k1c: {
    name: 'Creality K1C',
    short: 'K1C',
    accel: 10000, // for time estimates; firmware sets real limits
    bed: { x: 220, y: 220, z: 250 },
    originCenter: false,
    nozzle: 0.4,
    enclosed: true,
    // Orca: retraction 0.8 mm @ 40 mm/s
    retract: { dist: 0.8, speed: 40, zhop: 0.2 },
    speed: { print: 200, outer: 150, first: 50, firstFill: 60, travel: 300, maxFlow: 22 },
    device: {
      gcodePre: [
        'START_PRINT EXTRUDER_TEMP={temp} BED_TEMP={bed_temp}',
        'M204 S2000',
        'M109 S{temp}',
        'G1 Z3 F600',
        'M83',
        'G92 E0',
        'G1 Z1 F600',
      ],
      gcodePost: ['END_PRINT'],
      gcodeLayer: [';LAYER_CHANGE', ';Z:{z}'],
      gcodeTrack: [],
    },
  },

  ad5m: {
    name: 'Flashforge Adventurer 5M Pro',
    short: 'AD5M Pro',
    accel: 10000,
    bed: { x: 220, y: 220, z: 220 },
    // Flashforge firmware uses a center origin (-110..110)
    originCenter: true,
    nozzle: 0.4,
    enclosed: true,
    // Orca: retraction 0.8 mm @ 35 mm/s
    retract: { dist: 0.8, speed: 35, zhop: 0.2 },
    speed: { print: 200, outer: 150, first: 50, firstFill: 60, travel: 300, maxFlow: 22 },
    device: {
      gcodePre: [
        '; HEADER_BLOCK_START',
        '; total layer number: {layers}',
        '; max_z_height: %%TOP+0%%',
        '; HEADER_BLOCK_END',
        '; EXECUTABLE_BLOCK_START',
        'M190 S{bed_temp}',
        'M109 S{temp}',
        'G90',
        'M83',
        'G1 Z5 F6000',
        'G1 E-0.2 F800',
        'G1 X110 Y-110 F6000',
        'G1 E2 F800',
        'G1 Y-110 X55 Z0.25 F4800',
        'G1 X-55 E8 F2400',
        'G1 Y-109.6 F2400',
        'G1 X55 E5 F2400',
        'G1 Y-110 X55 Z0.45 F4800',
        'G1 X-55 E8 F2400',
        'G1 Y-109.6 F2400',
        'G1 X55 E5 F2400',
        'G92 E0',
      ],
      gcodePost: [
        'G1 E-3 F3600',
        'G0 X50 Y50 F30000',
        'M104 S0 ; turn off temperature',
        'M140 S0',
        'M107',
        '; EXECUTABLE_BLOCK_END',
      ],
      gcodeLayer: [';LAYER_CHANGE', ';Z:{z}'],
      gcodeTrack: [],
    },
  },

  mk3s: {
    name: 'Prusa i3 MK3S+',
    short: 'MK3S+',
    accel: 1250,
    bed: { x: 250, y: 210, z: 210 },
    originCenter: false,
    nozzle: 0.4,
    enclosed: false,
    // Orca: retraction 0.8 mm @ 35 mm/s
    retract: { dist: 0.8, speed: 35, zhop: 0.2 },
    speed: { print: 80, outer: 35, first: 20, firstFill: 30, travel: 180, maxFlow: 12 },
    device: {
      gcodePre: [
        'M862.3 P "MK3S" ; printer model check',
        'M862.1 P0.4 ; nozzle diameter check',
        'M115 U3.13.0 ; tell printer latest fw version',
        'G90 ; use absolute coordinates',
        'M83 ; extruder relative mode',
        'M104 S{temp} ; set extruder temp',
        'M140 S{bed_temp} ; set bed temp',
        'M190 S{bed_temp} ; wait for bed temp',
        'M109 S{temp} ; wait for extruder temp',
        'G28 W ; home all without mesh bed level',
        'G80 ; mesh bed leveling',
        'G1 Z0.2 F720',
        'G1 Y-3 F1000 ; go outside print area',
        'G92 E0',
        'G1 X60 E9 F1000 ; intro line',
        'G1 X100 E12.5 F1000 ; intro line',
        'G92 E0',
        'M221 S95',
      ],
      gcodePost: [
        'G1 Z%%TOP+1%% F720 ; move print head up',
        'G1 X0 Y200 F3600 ; park',
        'G1 Z%%TOP+50%% F720 ; move print head further up',
        'G4 ; wait',
        'M221 S100 ; reset flow',
        'M900 K0 ; reset LA',
        'M104 S0 ; turn off temperature',
        'M140 S0 ; turn off heatbed',
        'M107 ; turn off fan',
        'M84 ; disable motors',
      ],
      gcodeLayer: [';LAYER_CHANGE', ';Z:{z}'],
      gcodeTrack: ['M73 P{progress} R{remain_time}'],
    },
  },
};

// Temperatures per printer (nozzle / bed), fan 0-100 %, flow cap mm^3/s.
export const MATERIALS = {
  pla: {
    name: 'PLA', density: 1.24, fan: 100, flowScale: 1,
    temps: { k1c: [220, 55], ad5m: [220, 55], mk3s: [215, 60] },
  },
  petg: {
    name: 'PETG', density: 1.27, fan: 40, flowScale: 0.7,
    temps: { k1c: [240, 70], ad5m: [240, 70], mk3s: [240, 85] },
  },
  abs: {
    name: 'ABS / ASA', density: 1.05, fan: 0, flowScale: 0.8, needsEnclosure: true,
    temps: { k1c: [260, 100], ad5m: [255, 100], mk3s: [255, 105] },
  },
  tpu: {
    name: 'TPU (95A)', density: 1.21, fan: 100, flowScale: 0.18, slow: true,
    temps: { k1c: [225, 45], ad5m: [225, 45], mk3s: [230, 50] },
  },
};

export const QUALITIES = {
  fine:     { name: '0.12 mm Fine',     layer: 0.12, first: 0.2 },
  optimal:  { name: '0.16 mm Optimal',  layer: 0.16, first: 0.2 },
  standard: { name: '0.20 mm Standard', layer: 0.20, first: 0.2 },
  draft:    { name: '0.28 mm Draft',    layer: 0.28, first: 0.28 },
};

// Strength presets set walls / top+bottom layers / infill; users can then tweak.
export const STRENGTHS = {
  light:    { name: 'Light (prototype)',  walls: 2, top: 4, bottom: 3, infill: 15, pattern: 'grid' },
  standard: { name: 'Standard',           walls: 3, top: 5, bottom: 4, infill: 25, pattern: 'gyroid' },
  strong:   { name: 'Strong (robot part)', walls: 4, top: 6, bottom: 5, infill: 40, pattern: 'gyroid' },
  solid:    { name: 'Solid',              walls: 6, top: 8, bottom: 8, infill: 100, pattern: 'linear' },
};

export const INFILL_PATTERNS = {
  gyroid: 'Gyroid', grid: 'Grid', hex: 'Honeycomb', triangle: 'Triangles', cubic: 'Cubic', linear: 'Lines',
};

/**
 * Build Kiri:Moto device + process settings from the UI selections.
 * @param {object} s - { printer, material, quality, walls, top, bottom, infill, pattern,
 *                       supports, supportAngle, adhesion, brimLoops, flow, speedScale }
 */
export function buildSettings(s) {
  const p = PRINTERS[s.printer];
  const m = MATERIALS[s.material];
  const q = QUALITIES[s.quality];
  const [nozzleTemp, bedTemp] = m.temps[s.printer];
  const speedScale = (s.speedScale ?? 100) / 100;
  const slow = m.slow ? 0.2 : 1;
  const lineWidth = 0.45;
  // Kiri computes extrusion from an ellipse (pi/4 * w * h). Orca/Prusa use a
  // rounded rectangle ((w - h) * h + pi * h^2 / 4), which is 10-20% more plastic.
  // Scale Kiri's output so line volume matches Orca's for this layer height.
  const h = q.layer;
  const orcaArea = (lineWidth - h) * h + Math.PI * h * h / 4;
  const kiriArea = Math.PI / 4 * lineWidth * h;
  const flow = (orcaArea / kiriArea) * (s.flow ?? 100) / 100;

  const device = {
    mode: 'FDM',
    deviceName: p.name,
    bedWidth: p.bed.x,
    bedDepth: p.bed.y,
    maxHeight: p.bed.z,
    originCenter: p.originCenter,
    bedRound: false,
    bedBelt: false,
    fwRetract: false,
    extrudeAbs: false,
    gcodeFExt: 'gcode',
    gcodeFan: ['M106 S{fan_speed}'],
    gcodeFeature: [],
    gcodeChange: [],
    extruders: [{ extFilament: 1.75, extNozzle: p.nozzle, extOffsetX: 0, extOffsetY: 0 }],
    ...structuredClone(p.device),
  };

  const process = {
    processName: `${p.short} ${m.name} ${q.name}`,
    // layers
    sliceHeight: q.layer,
    firstSliceHeight: q.first,
    sliceLineWidth: lineWidth,
    sliceShells: s.walls,
    sliceShellOrder: 'in-out',
    sliceTopLayers: s.top,
    sliceBottomLayers: s.bottom,
    sliceSolidMinArea: 1,
    sliceDetectThin: 'basic',
    sliceLayerStart: 'last',
    // infill
    sliceFillSparse: Math.min(1, s.infill / 100),
    sliceFillType: s.infill >= 100 ? 'linear' : s.pattern,
    sliceFillAngle: 45,
    sliceFillOverlap: 0.3,
    // supports
    sliceSupportType: s.supports ? 'automatic' : 'disabled',
    sliceSupportAngle: s.supportAngle,
    sliceSupportDensity: 0.2,
    sliceSupportOffset: 0.4,
    sliceSupportGap: true,
    sliceSupportOutline: true,
    sliceSupportTree: false,
    // adhesion: Kiri's "skirt" with 0 offset touches the part, i.e. a brim
    outputBrimCount: s.adhesion === 'brim' ? s.brimLoops : s.adhesion === 'skirt' ? 1 : 0,
    outputBrimOffset: s.adhesion === 'brim' ? 0 : 3,
    outputRaft: s.adhesion === 'raft',
    outputRaftSpacing: 0.2,
    // temps / cooling
    outputTemp: nozzleTemp,
    outputBedTemp: bedTemp,
    firstLayerNozzleTemp: nozzleTemp,
    firstLayerBedTemp: bedTemp,
    outputFanSpeed: Math.round((m.fan / 100) * 255),
    firstLayerFanSpeed: 0,
    outputFanLayer: 2,
    outputMinLayerTime: 6,
    // speeds (mm/s)
    outputFeedrate: Math.round(p.speed.print * speedScale * slow),
    outputFinishrate: Math.round(p.speed.outer * speedScale * slow),
    outputSeekrate: p.speed.travel,
    firstLayerRate: Math.round(p.speed.first * (m.slow ? 0.5 : 1)),
    firstLayerFillRate: Math.round(p.speed.firstFill * (m.slow ? 0.5 : 1)),
    outputMinSpeed: 5,
    outputMaxFlowrate: +(p.speed.maxFlow * m.flowScale).toFixed(1),
    // extrusion
    outputShellMult: +flow.toFixed(3),
    outputFillMult: +flow.toFixed(3),
    outputSparseMult: +flow.toFixed(3),
    // retraction
    outputRetractDist: m.slow ? 0.4 : p.retract.dist,
    outputRetractSpeed: p.retract.speed,
    outputRetractWipe: 0,
    outputRetractDwell: 0,
    outputCoastDist: 0,
    zHopDistance: p.retract.zhop,
    outputLayerRetract: false,
    outputAvoidGaps: true,
    outputShortPoly: 0,
    antiBacklash: 0,
    arcTolerance: 0,
    outputScarfLength: 0,
  };

  return { device, process, nozzleTemp, bedTemp, material: m, printer: p };
}
