// Every user-facing setting, grouped the way OrcaSlicer groups them.
// scope: which preset the value lives in (printer | filament | process).
// adv:   only shown when "Advanced" is on (Orca's simple/advanced switch).
// show:  optional (values) => boolean, hides settings that don't apply.
// Names follow Orca's labels so the team can move between the two.

const pct = { unit: '%', step: 1 };
const mm = { unit: 'mm', step: 0.01 };
const mms = { unit: 'mm/s', step: 1, min: 1 };
const acc = { unit: 'mm/s²', step: 100, min: 100 };

export const PROCESS_TABS = [
  { id: 'quality', label: 'Quality' },
  { id: 'strength', label: 'Strength' },
  { id: 'speed', label: 'Speed' },
  { id: 'support', label: 'Support' },
  { id: 'others', label: 'Others' },
];

export const SEAM_OPTIONS = { nearest: 'Nearest', aligned: 'Aligned (bed origin)', center: 'Back to center', random: 'Random' };
export const WALL_SEQUENCE = { 'in-out': 'Inner/Outer', 'out-in': 'Outer/Inner', alternate: 'Inner-Outer-Inner' };
export const THIN_WALLS = { off: 'Off', basic: 'Basic', adaptive: 'Adaptive' };
export const INFILL_PATTERNS = {
  gyroid: 'Gyroid', grid: 'Grid', hex: 'Honeycomb', triangle: 'Triangles', linear: 'Rectilinear', none: 'None (hollow)',
};
export const SUPPORT_STYLES = { normal: 'Normal', tree: 'Tree' };
export const BRIM_TYPES = { none: 'No brim', outer: 'Outer brim only' };
export const FLAVORS = { klipper: 'Klipper', marlin: 'Marlin / Prusa firmware' };

export const PROCESS = [
  // ---------- Quality ----------
  { key: 'layer_height', tab: 'quality', section: 'Layer height', label: 'Layer height', type: 'number', ...mm, min: 0.04, max: 0.4 },
  { key: 'initial_layer_print_height', tab: 'quality', section: 'Layer height', label: 'Initial layer height', type: 'number', ...mm, min: 0.08, max: 0.4 },
  { key: 'line_width', tab: 'quality', section: 'Line width', label: 'Line width', type: 'number', ...mm, min: 0.2, max: 1.2,
    tip: 'Width of every extrusion line. Orca sets this per feature; this engine uses one width for all lines.' },
  { key: 'seam_position', tab: 'quality', section: 'Seam', label: 'Seam position', type: 'select', options: SEAM_OPTIONS,
    tip: 'Where each layer starts. Nearest continues from where the last layer ended (fastest). Aligned lines seams up toward the bed origin.' },
  { key: 'scarf_seam_length', tab: 'quality', section: 'Seam', label: 'Scarf seam length', type: 'number', ...mm, min: 0, max: 50, adv: true,
    tip: 'Ramps the start and end of each wall loop to hide the seam. 0 = off. Disables arc fitting.' },
  { key: 'xy_hole_compensation', tab: 'quality', section: 'Precision', label: 'X-Y hole compensation', type: 'number', ...mm, min: -2, max: 2,
    tip: 'Offsets the walls of holes. Use it to get bolt holes and bearing bores to size without editing the CAD.' },
  { key: 'xy_contour_compensation', tab: 'quality', section: 'Precision', label: 'X-Y contour compensation', type: 'number', ...mm, min: -2, max: 2,
    tip: 'Offsets the outside walls of the part. Negative shrinks the part.' },
  { key: 'arc_fitting', tab: 'quality', section: 'Precision', label: 'Arc fitting', type: 'bool', adv: true,
    tip: 'Turns circular paths into G2/G3 arcs. Smaller files and smoother curves. Firmware must support arcs.' },
  { key: 'arc_tolerance', tab: 'quality', section: 'Precision', label: 'Arc tolerance', type: 'number', ...mm, min: 0.01, max: 1, adv: true,
    show: v => v.arc_fitting },
  { key: 'adaptive_layer_height', tab: 'quality', section: 'Variable layer height', label: 'Adaptive layer height', type: 'bool',
    tip: 'Uses thinner layers on curved and sloped surfaces and thicker layers elsewhere.' },
  { key: 'min_layer_height', tab: 'quality', section: 'Variable layer height', label: 'Minimum layer height', type: 'number', ...mm, min: 0.04, max: 0.3,
    show: v => v.adaptive_layer_height },
  { key: 'detect_thin_wall', tab: 'quality', section: 'Walls and surfaces', label: 'Detect thin walls', type: 'select', options: THIN_WALLS,
    tip: 'Fills gaps between walls that are too narrow for a full line. Slow: can make slicing several times longer. Off by default, like Orca.' },
  { key: 'wall_sequence', tab: 'quality', section: 'Walls and surfaces', label: 'Wall sequence', type: 'select', options: WALL_SEQUENCE,
    tip: 'Inner/Outer gives the best overhangs. Outer/Inner gives the most accurate outside dimensions.' },
  { key: 'alternate_wall_direction', tab: 'quality', section: 'Walls and surfaces', label: 'Alternate wall direction', type: 'bool', adv: true,
    tip: 'Alternates clockwise / counter-clockwise walls each layer. Can reduce warping on thin parts.' },
  { key: 'solidify', tab: 'quality', section: 'Advanced', label: 'Treat model as solid', type: 'bool', adv: true,
    tip: 'Removes internal voids. Fixes models with overlapping or nested shells.' },
  { key: 'anti_backlash', tab: 'quality', section: 'Advanced', label: 'Anti-backlash', type: 'number', ...mm, min: 0, max: 3, adv: true,
    tip: 'Micro-moves to cancel backlash on solid layers. 0 = off.' },

  // ---------- Strength ----------
  { key: 'wall_loops', tab: 'strength', section: 'Walls', label: 'Wall loops', type: 'number', step: 1, min: 0, max: 30 },
  { key: 'top_shell_layers', tab: 'strength', section: 'Top/bottom shells', label: 'Top shell layers', type: 'number', step: 1, min: 0, max: 50 },
  { key: 'bottom_shell_layers', tab: 'strength', section: 'Top/bottom shells', label: 'Bottom shell layers', type: 'number', step: 1, min: 0, max: 50 },
  { key: 'solid_infill_direction', tab: 'strength', section: 'Top/bottom shells', label: 'Solid infill direction', type: 'number', unit: '°', step: 1, min: 0, max: 180, adv: true },
  { key: 'minimum_flat_area', tab: 'strength', section: 'Top/bottom shells', label: 'Minimum flat area', type: 'number', unit: 'mm²', step: 0.1, min: 0, max: 100, adv: true,
    tip: 'Top/bottom areas smaller than this are skipped (printed as infill).' },
  { key: 'flat_area_threshold', tab: 'strength', section: 'Top/bottom shells', label: 'Flat area detection', type: 'number', step: 0.05, min: 0, max: 1, adv: true,
    tip: 'Ratio of area to perimeter used to find bridges and flat areas. 0.0 to 0.5 works best.' },
  { key: 'solid_infill_expansion', tab: 'strength', section: 'Top/bottom shells', label: 'Solid infill expansion', type: 'number', ...mm, min: 0, max: 10, adv: true,
    tip: 'Grows solid areas so they anchor better over sparse infill.' },
  { key: 'sparse_infill_density', tab: 'strength', section: 'Sparse infill', label: 'Sparse infill density', type: 'number', ...pct, min: 0, max: 100 },
  { key: 'sparse_infill_pattern', tab: 'strength', section: 'Sparse infill', label: 'Sparse infill pattern', type: 'select', options: INFILL_PATTERNS, icons: true,
    tip: 'Grid and Rectilinear slice fastest. Gyroid is strong in every direction but takes longer to slice on large parts.' },
  { key: 'infill_wall_overlap', tab: 'strength', section: 'Sparse infill', label: 'Infill/wall overlap', type: 'number', ...pct, min: 0, max: 100, adv: true },
  { key: 'infill_layer_repeat', tab: 'strength', section: 'Sparse infill', label: 'Infill direction repeat', type: 'number', step: 1, min: 1, max: 10, adv: true,
    show: v => v.sparse_infill_pattern === 'linear', tip: 'Layers before rectilinear infill changes direction.' },

  // ---------- Speed ----------
  { key: 'initial_layer_speed', tab: 'speed', section: 'Initial layer speed', label: 'Initial layer', type: 'number', ...mms },
  { key: 'initial_layer_infill_speed', tab: 'speed', section: 'Initial layer speed', label: 'Initial layer infill', type: 'number', ...mms },
  { key: 'outer_wall_speed', tab: 'speed', section: 'Other layers speed', label: 'Outer wall', type: 'number', ...mms },
  { key: 'print_speed', tab: 'speed', section: 'Other layers speed', label: 'Inner wall / infill', type: 'number', ...mms,
    tip: 'Speed for inner walls, solid infill and sparse infill.' },
  { key: 'travel_speed', tab: 'speed', section: 'Travel speed', label: 'Travel', type: 'number', ...mms },
  { key: 'small_perimeter_threshold', tab: 'speed', section: 'Overhang / small features', label: 'Small perimeter threshold', type: 'number', ...mm, min: 0, max: 200, adv: true,
    tip: 'Loops shorter than this print at the minimum speed (for tiny features and pins).' },
  { key: 'min_print_speed', tab: 'speed', section: 'Overhang / small features', label: 'Minimum print speed', type: 'number', ...mms, adv: true },
  { key: 'accel_control', tab: 'speed', section: 'Acceleration', label: 'Control acceleration per feature', type: 'bool',
    tip: 'Adds acceleration commands before each feature (SET_VELOCITY_LIMIT on Klipper, M204 on Marlin/Prusa).' },
  { key: 'default_acceleration', tab: 'speed', section: 'Acceleration', label: 'Normal printing', type: 'number', ...acc, show: v => v.accel_control },
  { key: 'wall_acceleration', tab: 'speed', section: 'Acceleration', label: 'Walls', type: 'number', ...acc, show: v => v.accel_control },
  { key: 'solid_infill_acceleration', tab: 'speed', section: 'Acceleration', label: 'Solid infill', type: 'number', ...acc, show: v => v.accel_control },
  { key: 'sparse_infill_acceleration', tab: 'speed', section: 'Acceleration', label: 'Sparse infill', type: 'number', ...acc, show: v => v.accel_control },
  { key: 'support_acceleration', tab: 'speed', section: 'Acceleration', label: 'Support', type: 'number', ...acc, adv: true, show: v => v.accel_control },
  { key: 'initial_layer_acceleration', tab: 'speed', section: 'Acceleration', label: 'Initial layer', type: 'number', ...acc, show: v => v.accel_control },

  // ---------- Support ----------
  { key: 'enable_support', tab: 'support', section: 'Support', label: 'Enable support', type: 'bool' },
  { key: 'support_style', tab: 'support', section: 'Support', label: 'Style', type: 'select', options: SUPPORT_STYLES, icons: true, show: v => v.enable_support },
  { key: 'support_threshold_angle', tab: 'support', section: 'Support', label: 'Threshold angle', type: 'number', unit: '°', step: 1, min: 0, max: 90, show: v => v.enable_support,
    tip: 'Overhangs steeper than this (measured from vertical) get support.' },
  { key: 'support_density', tab: 'support', section: 'Support', label: 'Base pattern density', type: 'number', ...pct, min: 1, max: 100, show: v => v.enable_support },
  { key: 'support_object_xy_distance', tab: 'support', section: 'Support', label: 'Support/object XY distance', type: 'number', ...mm, min: 0, max: 10, show: v => v.enable_support },
  { key: 'support_top_z_gap', tab: 'support', section: 'Support', label: 'Leave a layer gap at the top', type: 'bool', show: v => v.enable_support,
    tip: 'One empty layer between support and the part so supports snap off cleanly.' },
  { key: 'support_expansion', tab: 'support', section: 'Support', label: 'Support expansion', type: 'number', ...mm, min: 0, max: 10, adv: true, show: v => v.enable_support },
  { key: 'support_enclose', tab: 'support', section: 'Support', label: 'Enclose support in a wall', type: 'bool', adv: true, show: v => v.enable_support },
  { key: 'raft_enable', tab: 'support', section: 'Raft', label: 'Raft', type: 'bool', tip: 'Prints a sacrificial base under the part.' },
  { key: 'raft_spacing', tab: 'support', section: 'Raft', label: 'Raft line spacing', type: 'number', ...mm, min: 0, max: 3, adv: true, show: v => v.raft_enable },

  // ---------- Others ----------
  { key: 'skirt_loops', tab: 'others', section: 'Skirt', label: 'Skirt loops', type: 'number', step: 1, min: 0, max: 20, show: v => v.brim_type === 'none' },
  { key: 'skirt_distance', tab: 'others', section: 'Skirt', label: 'Skirt distance', type: 'number', ...mm, min: 0.5, max: 50, show: v => v.brim_type === 'none' && v.skirt_loops > 0 },
  { key: 'draft_shield', tab: 'others', section: 'Skirt', label: 'Draft shield', type: 'bool', adv: true,
    tip: 'Raises the skirt to the full part height to keep drafts off ABS/ASA.' },
  { key: 'brim_type', tab: 'others', section: 'Brim', label: 'Brim type', type: 'select', options: BRIM_TYPES },
  { key: 'brim_width', tab: 'others', section: 'Brim', label: 'Brim width', type: 'number', ...mm, min: 0.5, max: 30, show: v => v.brim_type !== 'none' },
  { key: 'spiral_mode', tab: 'others', section: 'Special mode', label: 'Spiral vase', type: 'bool',
    tip: 'Prints a single continuous wall with no top and no infill.' },
  { key: 'retract_on_layer_change', tab: 'others', section: 'G-code output', label: 'Retract on layer change', type: 'bool', adv: true },
  { key: 'avoid_crossing_gaps', tab: 'others', section: 'G-code output', label: 'Avoid crossing gaps', type: 'bool', adv: true,
    tip: 'Travels around gaps instead of retracting over them.' },
  { key: 'wall_coasting', tab: 'others', section: 'G-code output', label: 'Wall coasting distance', type: 'number', ...mm, min: 0, max: 10, adv: true,
    tip: 'Stops extruding this far before the end of each wall to reduce blobs.' },
];

export const FILAMENT_TABS = [
  { id: 'filament', label: 'Filament' },
  { id: 'cooling', label: 'Cooling' },
  { id: 'overrides', label: 'Setting overrides' },
];

export const FILAMENT = [
  { key: 'filament_type', tab: 'filament', section: 'Basic information', label: 'Type', type: 'text' },
  { key: 'filament_diameter', tab: 'filament', section: 'Basic information', label: 'Diameter', type: 'number', ...mm, min: 1, max: 3 },
  { key: 'filament_density', tab: 'filament', section: 'Basic information', label: 'Density', type: 'number', unit: 'g/cm³', step: 0.01, min: 0.5, max: 3 },
  { key: 'filament_cost', tab: 'filament', section: 'Basic information', label: 'Price', type: 'number', unit: '$/kg', step: 0.5, min: 0, max: 500 },
  { key: 'flow_ratio', tab: 'filament', section: 'Basic information', label: 'Flow ratio', type: 'number', step: 0.01, min: 0.5, max: 1.5 },
  { key: 'enable_pressure_advance', tab: 'filament', section: 'Basic information', label: 'Enable pressure advance', type: 'bool' },
  { key: 'pressure_advance', tab: 'filament', section: 'Basic information', label: 'Pressure advance', type: 'number', step: 0.001, min: 0, max: 2, show: v => v.enable_pressure_advance },
  { key: 'max_volumetric_speed', tab: 'filament', section: 'Volumetric speed limitation', label: 'Max volumetric speed', type: 'number', unit: 'mm³/s', step: 0.5, min: 0.5, max: 100 },
  { key: 'nozzle_temperature_initial_layer', tab: 'filament', section: 'Print temperature', label: 'Nozzle, initial layer', type: 'number', unit: '°C', step: 1, min: 150, max: 350 },
  { key: 'nozzle_temperature', tab: 'filament', section: 'Print temperature', label: 'Nozzle, other layers', type: 'number', unit: '°C', step: 1, min: 150, max: 350 },
  { key: 'bed_temperature_initial_layer', tab: 'filament', section: 'Bed temperature', label: 'Bed, initial layer', type: 'number', unit: '°C', step: 1, min: 0, max: 120 },
  { key: 'bed_temperature', tab: 'filament', section: 'Bed temperature', label: 'Bed, other layers', type: 'number', unit: '°C', step: 1, min: 0, max: 120 },
  { key: 'fan_speed', tab: 'cooling', section: 'Part cooling fan', label: 'Fan speed', type: 'number', ...pct, min: 0, max: 100 },
  { key: 'close_fan_the_first_x_layers', tab: 'cooling', section: 'Part cooling fan', label: 'No cooling for the first', type: 'number', unit: 'layers', step: 1, min: 0, max: 50 },
  { key: 'slow_down_layer_time', tab: 'cooling', section: 'Cooling slowdown', label: 'Slow printing down for better layer cooling', type: 'number', unit: 's', step: 1, min: 0, max: 120,
    tip: 'Layers that would print faster than this are slowed down.' },
  { key: 'filament_retraction_length', tab: 'overrides', section: 'Retraction', label: 'Length (blank = printer default)', type: 'number', ...mm, min: 0, max: 10, optional: true },
  { key: 'filament_retraction_speed', tab: 'overrides', section: 'Retraction', label: 'Speed (blank = printer default)', type: 'number', ...mms, optional: true },
  { key: 'filament_z_hop', tab: 'overrides', section: 'Retraction', label: 'Z hop (blank = printer default)', type: 'number', ...mm, min: 0, max: 3, optional: true },
  { key: 'required_nozzle_hrc', tab: 'overrides', section: 'Compatibility', label: 'Needs hardened nozzle', type: 'bool',
    tip: 'Carbon-fiber and glass-fiber filaments wear out brass and stainless nozzles quickly.' },
  { key: 'needs_enclosure', tab: 'overrides', section: 'Compatibility', label: 'Needs enclosure', type: 'bool' },
];

export const PRINTER_TABS = [
  { id: 'basic', label: 'Basic information' },
  { id: 'gcode', label: 'Machine G-code' },
  { id: 'extruder', label: 'Extruder' },
  { id: 'motion', label: 'Motion ability' },
];

export const PRINTER = [
  { key: 'bed_x', tab: 'basic', section: 'Printable space', label: 'Bed width (X)', type: 'number', ...mm, min: 50, max: 1000 },
  { key: 'bed_y', tab: 'basic', section: 'Printable space', label: 'Bed depth (Y)', type: 'number', ...mm, min: 50, max: 1000 },
  { key: 'printable_height', tab: 'basic', section: 'Printable space', label: 'Printable height', type: 'number', ...mm, min: 50, max: 1000 },
  { key: 'origin_center', tab: 'basic', section: 'Printable space', label: 'Origin at bed center', type: 'bool' },
  { key: 'gcode_flavor', tab: 'basic', section: 'Advanced', label: 'G-code flavor', type: 'select', options: FLAVORS },
  { key: 'enclosed', tab: 'basic', section: 'Advanced', label: 'Enclosed printer', type: 'bool' },
  { key: 'hardened_nozzle', tab: 'basic', section: 'Advanced', label: 'Hardened nozzle installed', type: 'bool' },
  { key: 'machine_start_gcode', tab: 'gcode', section: 'Machine start G-code', label: '', type: 'gcode' },
  { key: 'machine_end_gcode', tab: 'gcode', section: 'Machine end G-code', label: '', type: 'gcode' },
  { key: 'layer_change_gcode', tab: 'gcode', section: 'Layer change G-code', label: '', type: 'gcode' },
  { key: 'progress_gcode', tab: 'gcode', section: 'Progress G-code (every 1%)', label: '', type: 'gcode' },
  { key: 'pause_gcode', tab: 'gcode', section: 'Pause G-code', label: '', type: 'gcode' },
  { key: 'change_filament_gcode', tab: 'gcode', section: 'Change filament G-code', label: '', type: 'gcode' },
  { key: 'nozzle_diameter', tab: 'extruder', section: 'Size', label: 'Nozzle diameter', type: 'number', ...mm, min: 0.1, max: 2 },
  { key: 'retraction_length', tab: 'extruder', section: 'Retraction', label: 'Length', type: 'number', ...mm, min: 0, max: 10 },
  { key: 'retraction_speed', tab: 'extruder', section: 'Retraction', label: 'Speed', type: 'number', ...mms },
  { key: 'z_hop', tab: 'extruder', section: 'Retraction', label: 'Z hop', type: 'number', ...mm, min: 0, max: 3 },
  { key: 'wipe_distance', tab: 'extruder', section: 'Retraction', label: 'Wipe distance', type: 'number', ...mm, min: 0, max: 10 },
  { key: 'deretraction_dwell', tab: 'extruder', section: 'Retraction', label: 'Dwell after unretract', type: 'number', unit: 'ms', step: 10, min: 0, max: 2000 },
  { key: 'machine_max_acceleration', tab: 'motion', section: 'Acceleration limitation', label: 'Max acceleration', type: 'number', ...acc,
    tip: 'Used for print time estimates and as the cap for per-feature acceleration.' },
  { key: 'machine_max_speed', tab: 'motion', section: 'Speed limitation', label: 'Max XY speed', type: 'number', ...mms },
];

export const SCHEMA = { process: PROCESS, filament: FILAMENT, printer: PRINTER };
export const byKey = Object.fromEntries([...PROCESS, ...FILAMENT, ...PRINTER].map(d => [d.key, d]));

/** Height-range modifier fields (Orca "Height range modifier"). */
export const RANGE_FIELDS = ['sparse_infill_density', 'sparse_infill_pattern', 'wall_loops', 'top_shell_layers', 'bottom_shell_layers', 'print_speed', 'outer_wall_speed', 'layer_height'];
