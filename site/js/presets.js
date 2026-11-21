// Built-in system presets plus the user's own presets (saved in this browser,
// exportable as JSON). Values come from OrcaSlicer's system profiles for each
// printer unless noted.
//
// Machine G-code uses Kiri:Moto variables: {temp} {bed_temp} (initial layer),
// {layer} {layers} {z} {progress} {remain_time}, ";; IF {expr}" blocks, plus
// %%TOP+N%% which the app fills in after slicing (top of print + N mm).

import { A1_START, A1_END } from './machines/bambu-a1.js';

const lines = (...l) => l.join('\n');

export const SYSTEM_PRINTERS = {
  k1c: {
    name: 'Creality K1C 0.4 nozzle', short: 'K1C',
    bed_x: 220, bed_y: 220, printable_height: 250, origin_center: false,
    gcode_flavor: 'klipper', enclosed: true, hardened_nozzle: true,
    nozzle_diameter: 0.4, retraction_length: 0.8, retraction_speed: 40, z_hop: 0.4, wipe_distance: 2, deretraction_dwell: 0,
    machine_max_acceleration: 20000, machine_max_speed: 600, hotend_max_flow: 24,
    machine_start_gcode: lines(
      'START_PRINT EXTRUDER_TEMP={temp} BED_TEMP={bed_temp}',
      'M204 S2000',
      'M109 S{temp}',
      'G1 Z3 F600',
      'M83',
      'G92 E0',
      'G1 Z1 F600'),
    machine_end_gcode: 'END_PRINT',
    layer_change_gcode: lines(';LAYER_CHANGE', ';Z:{z}'),
    progress_gcode: '',
    pause_gcode: 'PAUSE',
    change_filament_gcode: 'PAUSE',
    process: { line_width: 0.42, outer_wall_speed: 200, print_speed: 250, initial_layer_speed: 60, initial_layer_infill_speed: 60,
      travel_speed: 500, default_acceleration: 10000, wall_acceleration: 3000, solid_infill_acceleration: 10000,
      sparse_infill_acceleration: 10000, support_acceleration: 10000, initial_layer_acceleration: 1000, accel_control: true,
      bottom_shell_layers: 3, top_shell_layers: 5 },
  },

  ad5m: {
    name: 'Flashforge Adventurer 5M Pro 0.4 nozzle', short: 'AD5M Pro',
    bed_x: 220, bed_y: 220, printable_height: 220, origin_center: true,
    gcode_flavor: 'klipper', enclosed: true, hardened_nozzle: false,
    nozzle_diameter: 0.4, retraction_length: 0.8, retraction_speed: 35, z_hop: 0.4, wipe_distance: 2, deretraction_dwell: 0,
    machine_max_acceleration: 20000, machine_max_speed: 600, hotend_max_flow: 22,
    machine_start_gcode: lines(
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
      'G92 E0'),
    machine_end_gcode: lines(
      'G1 E-3 F3600',
      'G0 X50 Y50 F30000',
      'M104 S0 ; turn off temperature',
      'M140 S0',
      'M107',
      '; EXECUTABLE_BLOCK_END'),
    layer_change_gcode: lines(';LAYER_CHANGE', ';Z:{z}'),
    progress_gcode: '',
    pause_gcode: 'M25',
    change_filament_gcode: 'M25',
    process: { line_width: 0.42, outer_wall_speed: 200, print_speed: 270, initial_layer_speed: 50, initial_layer_infill_speed: 80,
      travel_speed: 500, default_acceleration: 10000, wall_acceleration: 5000, solid_infill_acceleration: 10000,
      sparse_infill_acceleration: 10000, support_acceleration: 10000, initial_layer_acceleration: 500, accel_control: true,
      bottom_shell_layers: 3, top_shell_layers: 5 },
  },

  mk3s: {
    name: 'Prusa i3 MK3S+ 0.4 nozzle', short: 'MK3S+',
    bed_x: 250, bed_y: 210, printable_height: 210, origin_center: false,
    gcode_flavor: 'marlin', enclosed: false, hardened_nozzle: false,
    nozzle_diameter: 0.4, retraction_length: 0.8, retraction_speed: 35, z_hop: 0.2, wipe_distance: 0, deretraction_dwell: 0,
    machine_max_acceleration: 1250, machine_max_speed: 200, hotend_max_flow: 12,
    machine_start_gcode: lines(
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
      'M221 S95'),
    machine_end_gcode: lines(
      'G1 Z%%TOP+1%% F720 ; move print head up',
      'G1 X0 Y200 F3600 ; park',
      'G1 Z%%TOP+50%% F720 ; move print head further up',
      'G4 ; wait',
      'M221 S100 ; reset flow',
      'M900 K0 ; reset LA',
      'M104 S0 ; turn off temperature',
      'M140 S0 ; turn off heatbed',
      'M107 ; turn off fan',
      'M84 ; disable motors'),
    layer_change_gcode: lines(';LAYER_CHANGE', ';Z:{z}'),
    progress_gcode: 'M73 P{progress} R{remain_time}',
    pause_gcode: 'M601',
    change_filament_gcode: 'M600',
    process: { line_width: 0.45, outer_wall_speed: 35, print_speed: 60, initial_layer_speed: 20, initial_layer_infill_speed: 30,
      travel_speed: 180, default_acceleration: 1000, wall_acceleration: 800, solid_infill_acceleration: 1000,
      sparse_infill_acceleration: 1000, support_acceleration: 1000, initial_layer_acceleration: 800, accel_control: false,
      bottom_shell_layers: 4, top_shell_layers: 5 },
  },

  // Values from a Bambu Studio 2.7 A1 slice (0.4 nozzle, textured PEI plate).
  // Machine G-code is Bambu's own A1 sequence; see machines/bambu-a1.js.
  a1: {
    name: 'Bambu Lab A1 0.4 nozzle', short: 'A1',
    bed_x: 256, bed_y: 256, printable_height: 256, origin_center: false,
    gcode_flavor: 'marlin', enclosed: false, hardened_nozzle: false,
    nozzle_diameter: 0.4, retraction_length: 0.8, retraction_speed: 30, z_hop: 0.4, wipe_distance: 2, deretraction_dwell: 0,
    machine_max_acceleration: 12000, machine_max_speed: 500, hotend_max_flow: 28,
    machine_start_gcode: lines(
      '; HEADER_BLOCK_START',
      '; total layer number: {layers}',
      '; max_z_height: %%TOP+0%%',
      '; HEADER_BLOCK_END',
      A1_START),
    machine_end_gcode: A1_END,
    layer_change_gcode: lines(
      ';LAYER_CHANGE', ';Z:{z}',
      '; layer num/total_layer_count: {layer+1}/{layers}',
      'M73 L{layer+1}',
      'M991 S0 P{layer} ;notify layer change'),
    progress_gcode: 'M73 P{progress} R{remain_time}',
    pause_gcode: 'M400 U1',
    change_filament_gcode: 'M400 U1',
    process: { line_width: 0.42, outer_wall_speed: 200, print_speed: 230, initial_layer_speed: 50, initial_layer_infill_speed: 105,
      travel_speed: 700, default_acceleration: 6000, wall_acceleration: 5000, solid_infill_acceleration: 6000,
      sparse_infill_acceleration: 6000, support_acceleration: 6000, initial_layer_acceleration: 500, accel_control: true,
      bottom_shell_layers: 3, top_shell_layers: 5 },
  },
};

const FILAMENT_BASE = {
  filament_diameter: 1.75, flow_ratio: 0.98, enable_pressure_advance: false, pressure_advance: 0.04,
  close_fan_the_first_x_layers: 1, slow_down_layer_time: 6,
  filament_retraction_length: null, filament_retraction_speed: null, filament_z_hop: null,
  required_nozzle_hrc: false, needs_enclosure: false,
};

// temps: [nozzle initial, nozzle, bed initial, bed]; per-printer overrides in `printers`
export const SYSTEM_FILAMENTS = {
  pla: { name: 'Generic PLA', filament_type: 'PLA', filament_density: 1.24, filament_cost: 20, max_volumetric_speed: 21,
    temps: [220, 220, 55, 55], fan_speed: 100, printers: { mk3s: { temps: [215, 210, 60, 60], max_volumetric_speed: 15 }, a1: { temps: [220, 220, 65, 65] } } },
  petg: { name: 'Generic PETG', filament_type: 'PETG', filament_density: 1.27, filament_cost: 22, max_volumetric_speed: 12, flow_ratio: 0.95,
    temps: [240, 240, 70, 70], fan_speed: 40, close_fan_the_first_x_layers: 3, slow_down_layer_time: 8,
    printers: { mk3s: { temps: [240, 250, 85, 90], max_volumetric_speed: 8 } } },
  abs: { name: 'Generic ABS', filament_type: 'ABS', filament_density: 1.04, filament_cost: 22, max_volumetric_speed: 16, flow_ratio: 0.95,
    temps: [260, 260, 100, 100], fan_speed: 10, close_fan_the_first_x_layers: 3, slow_down_layer_time: 12, needs_enclosure: true,
    printers: { mk3s: { temps: [255, 255, 100, 110], max_volumetric_speed: 11 } } },
  asa: { name: 'Generic ASA', filament_type: 'ASA', filament_density: 1.07, filament_cost: 28, max_volumetric_speed: 16, flow_ratio: 0.95,
    temps: [260, 260, 100, 100], fan_speed: 20, close_fan_the_first_x_layers: 3, slow_down_layer_time: 12, needs_enclosure: true,
    printers: { mk3s: { temps: [260, 260, 105, 110], max_volumetric_speed: 11 } } },
  tpu: { name: 'Generic TPU 95A', filament_type: 'TPU', filament_density: 1.21, filament_cost: 35, max_volumetric_speed: 3.6, flow_ratio: 1.0,
    temps: [225, 225, 40, 40], fan_speed: 100, slow_down_layer_time: 8,
    filament_retraction_length: 0.6, filament_retraction_speed: 25, filament_z_hop: 0,
    printers: { mk3s: { temps: [230, 240, 50, 50] } } },
  placf: { name: 'Generic PLA-CF', filament_type: 'PLA-CF', filament_density: 1.3, filament_cost: 30, max_volumetric_speed: 14, flow_ratio: 0.95,
    temps: [230, 230, 55, 55], fan_speed: 100, required_nozzle_hrc: true, printers: { mk3s: { temps: [220, 220, 60, 60], max_volumetric_speed: 10 } } },
  petgcf: { name: 'Generic PETG-CF', filament_type: 'PETG-CF', filament_density: 1.3, filament_cost: 35, max_volumetric_speed: 10, flow_ratio: 0.95,
    temps: [250, 250, 70, 70], fan_speed: 30, close_fan_the_first_x_layers: 3, slow_down_layer_time: 8, required_nozzle_hrc: true,
    printers: { mk3s: { temps: [250, 255, 80, 85], max_volumetric_speed: 8 } } },
  pacf: { name: 'Generic PA-CF (nylon)', filament_type: 'PA-CF', filament_density: 1.2, filament_cost: 60, max_volumetric_speed: 8, flow_ratio: 0.96,
    temps: [280, 280, 90, 90], fan_speed: 0, close_fan_the_first_x_layers: 3, slow_down_layer_time: 8, required_nozzle_hrc: true, needs_enclosure: true,
    printers: { mk3s: { temps: [285, 285, 90, 90] } } },
};

const PROCESS_BASE = {
  layer_height: 0.2, initial_layer_print_height: 0.2, line_width: 0.42,
  seam_position: 'aligned', scarf_seam_length: 0, xy_hole_compensation: 0, xy_contour_compensation: 0,
  arc_fitting: false, arc_tolerance: 0.15, adaptive_layer_height: false, min_layer_height: 0.08,
  detect_thin_wall: 'off', wall_sequence: 'in-out', alternate_wall_direction: false, solidify: false, anti_backlash: 0,
  wall_loops: 2, top_shell_layers: 5, bottom_shell_layers: 3, solid_infill_direction: 45, minimum_flat_area: 1,
  flat_area_threshold: 0.4, solid_infill_expansion: 0, sparse_infill_density: 15, sparse_infill_pattern: 'grid',
  infill_wall_overlap: 25, infill_layer_repeat: 1,
  small_perimeter_threshold: 0, min_print_speed: 10,
  enable_support: false, support_style: 'normal', support_threshold_angle: 30, support_density: 15,
  support_object_xy_distance: 0.35, support_top_z_gap: true, support_expansion: 0, support_enclose: true,
  raft_enable: false, raft_spacing: 0.2,
  skirt_loops: 0, skirt_distance: 2, draft_shield: false, brim_type: 'none', brim_width: 5, spiral_mode: false,
  retract_on_layer_change: false, avoid_crossing_gaps: true, wall_coasting: 0,
};

const LAYER_PRESETS = [
  { id: '0.08', name: '0.08mm Extra Fine', layer_height: 0.08, initial_layer_print_height: 0.2, top_shell_layers: 9, bottom_shell_layers: 7, speedScale: 0.7 },
  { id: '0.12', name: '0.12mm Fine', layer_height: 0.12, initial_layer_print_height: 0.2, top_shell_layers: 7, bottom_shell_layers: 5, speedScale: 0.85 },
  { id: '0.16', name: '0.16mm Optimal', layer_height: 0.16, initial_layer_print_height: 0.2, top_shell_layers: 6, bottom_shell_layers: 4 },
  { id: '0.20', name: '0.20mm Standard', layer_height: 0.2, initial_layer_print_height: 0.2 },
  { id: '0.24', name: '0.24mm Draft', layer_height: 0.24, initial_layer_print_height: 0.24, top_shell_layers: 4, bottom_shell_layers: 3 },
  { id: '0.28', name: '0.28mm Extra Draft', layer_height: 0.28, initial_layer_print_height: 0.28, top_shell_layers: 4, bottom_shell_layers: 3 },
  // Team presets
  { id: 'robot', name: '0.20mm Robot Part (Strong) @5572', layer_height: 0.2, initial_layer_print_height: 0.2,
    wall_loops: 4, top_shell_layers: 6, bottom_shell_layers: 5, sparse_infill_density: 40, sparse_infill_pattern: 'gyroid' },
  { id: 'proto', name: '0.28mm Fast Prototype @5572', layer_height: 0.28, initial_layer_print_height: 0.28,
    wall_loops: 2, top_shell_layers: 3, bottom_shell_layers: 3, sparse_infill_density: 10, sparse_infill_pattern: 'grid' },
];

export function systemProcesses(printerId) {
  const p = SYSTEM_PRINTERS[printerId];
  const out = {};
  for (const lp of LAYER_PRESETS) {
    const { id, name, speedScale = 1, ...vals } = lp;
    const v = { ...PROCESS_BASE, ...p.process, ...vals };
    if (printerId === 'mk3s') v.bottom_shell_layers = Math.max(v.bottom_shell_layers, 4);
    for (const k of ['outer_wall_speed', 'print_speed']) v[k] = Math.round(v[k] * speedScale);
    out[`${printerId}/${id}`] = { name: `${name} @${p.short}`, printer: printerId, values: v };
  }
  return out;
}

export function systemFilamentValues(id, printerId) {
  const f = SYSTEM_FILAMENTS[id];
  const { temps, printers, name, ...rest } = f;
  const ov = printers?.[printerId] || {};
  const t = ov.temps || temps;
  const { temps: _t, ...ovRest } = ov;
  return {
    ...FILAMENT_BASE, ...rest, ...ovRest,
    nozzle_temperature_initial_layer: t[0], nozzle_temperature: t[1],
    bed_temperature_initial_layer: t[2], bed_temperature: t[3],
  };
}

export function systemPrinterValues(id) {
  const { process, name, short, ...vals } = SYSTEM_PRINTERS[id];
  return vals;
}

// ---------- user presets (localStorage) ----------
const USER_KEY = 'frc5572-slicer-user-presets-v2';

export function loadUserPresets() {
  try {
    const v = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
    return { printer: v.printer || {}, filament: v.filament || {}, process: v.process || {} };
  } catch { return { printer: {}, filament: {}, process: {} }; }
}

export function saveUserPresets(u) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch { /* storage unavailable */ }
}
