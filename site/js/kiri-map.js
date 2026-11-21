// Translate Orca-style settings (printer + filament + process) into the
// Kiri:Moto engine's device/process objects.

const SEAM = { nearest: 'last', aligned: 'origin', center: 'center', random: 'random' };

/** Kiri models a line as an ellipse; Orca as a rounded rectangle. Ratio of the two. */
export function flowCorrection(width, height) {
  const orca = (width - height) * height + Math.PI * height * height / 4;
  const kiri = Math.PI / 4 * width * height;
  return orca / kiri;
}

/** Effective max volumetric speed: filament limit capped by the hotend. */
export function maxFlow(printer, filament) {
  return Math.min(filament.max_volumetric_speed, printer.hotend_max_flow || Infinity);
}

/** Orca-style process keys that can appear in a height-range modifier, mapped to Kiri keys. */
export function rangeFieldsToKiri(fields, base) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    switch (k) {
      case 'sparse_infill_density': out.sliceFillSparse = Math.min(1, v / 100); break;
      case 'sparse_infill_pattern': out.sliceFillType = v; break;
      case 'wall_loops': out.sliceShells = v; break;
      case 'top_shell_layers': out.sliceTopLayers = v; break;
      case 'bottom_shell_layers': out.sliceBottomLayers = v; break;
      case 'print_speed': out.outputFeedrate = v; break;
      case 'outer_wall_speed': out.outputFinishrate = v; break;
      case 'layer_height': {
        out.sliceHeight = v;
        const m = flowCorrection(base.line_width, v) * base.flow_ratio;
        out.outputShellMult = out.outputFillMult = out.outputSparseMult = +m.toFixed(4);
        break;
      }
    }
  }
  return out;
}

/**
 * @param {object} P printer values, F filament values, S process values
 * @returns {{ device, process }}
 */
export function toKiri(P, F, S) {
  const flowRatio = F.flow_ratio ?? 1;
  const mult = +(flowCorrection(S.line_width, S.layer_height) * flowRatio).toFixed(4);
  const retractLen = F.filament_retraction_length ?? P.retraction_length;
  const retractSpeed = F.filament_retraction_speed ?? P.retraction_speed;
  const zhop = F.filament_z_hop ?? P.z_hop;
  const vase = !!S.spiral_mode;
  const brimLoops = Math.max(1, Math.round(S.brim_width / S.line_width));
  const split = s => (s || '').split('\n');

  const device = {
    mode: 'FDM',
    deviceName: P.name || 'printer',
    bedWidth: P.bed_x,
    bedDepth: P.bed_y,
    maxHeight: P.printable_height,
    originCenter: !!P.origin_center,
    bedRound: false,
    bedBelt: false,
    fwRetract: false,
    extrudeAbs: false,
    gcodeFExt: 'gcode',
    gcodeFan: ['M106 S{fan_speed}'],
    gcodeFeature: [],
    gcodeChange: [],
    gcodePre: split(P.machine_start_gcode),
    // marker lets post-processing find where the print ends and machine end G-code begins
    gcodePost: ['; MACHINE_END_GCODE', ...split(P.machine_end_gcode)],
    gcodeLayer: split(P.layer_change_gcode),
    gcodeTrack: P.progress_gcode ? split(P.progress_gcode) : [],
    extruders: [{ extFilament: F.filament_diameter, extNozzle: P.nozzle_diameter, extOffsetX: 0, extOffsetY: 0 }],
  };

  const process = {
    processName: S.name || 'process',
    // quality
    sliceHeight: S.layer_height,
    firstSliceHeight: S.initial_layer_print_height,
    sliceLineWidth: S.line_width,
    sliceLayerStart: vase ? 'spiral' : (SEAM[S.seam_position] || 'last'),
    outputScarfLength: S.scarf_seam_length || 0,
    // Measured: Kiri moves a wall by half its offset value, and a positive outer
    // offset shrinks the part. Orca's values are per side, positive = bigger.
    sliceCompInner: 2 * (S.xy_hole_compensation || 0),
    sliceCompOuter: -2 * (S.xy_contour_compensation || 0),
    fdmArcEnabled: !!S.arc_fitting && !(S.scarf_seam_length > 0),
    fdmArcTolerance: S.arc_tolerance,
    fdmArcResolution: 1,
    sliceAdaptive: !!S.adaptive_layer_height,
    sliceMinHeight: S.min_layer_height,
    sliceDetectThin: S.detect_thin_wall,
    sliceShellOrder: S.wall_sequence,
    outputAlternating: !!S.alternate_wall_direction,
    sliceSolidify: !!S.solidify,
    antiBacklash: S.anti_backlash || 0,
    // strength
    sliceShells: vase ? 1 : S.wall_loops,
    sliceTopLayers: vase ? 0 : S.top_shell_layers,
    sliceBottomLayers: S.bottom_shell_layers,
    sliceFillAngle: S.solid_infill_direction,
    sliceSolidMinArea: S.minimum_flat_area,
    sliceSolidMinThick: S.flat_area_threshold,
    sliceFillGrow: S.solid_infill_expansion,
    sliceFillSparse: vase ? 0 : Math.min(1, S.sparse_infill_density / 100),
    sliceFillType: vase ? 'vase' : (S.sparse_infill_density >= 100 ? 'linear' : S.sparse_infill_pattern),
    sliceFillOverlap: S.infill_wall_overlap / 100,
    sliceFillRepeat: S.infill_layer_repeat || 1,
    sliceFillWidth: 1,
    sliceZInterleave: false,
    // speed (mm/s)
    firstLayerRate: S.initial_layer_speed,
    firstLayerFillRate: S.initial_layer_infill_speed,
    outputFinishrate: S.outer_wall_speed,
    outputFeedrate: S.print_speed,
    outputSeekrate: S.travel_speed,
    outputShortPoly: S.small_perimeter_threshold || 0,
    outputMinSpeed: S.min_print_speed,
    outputMaxFlowrate: maxFlow(P, F),
    // support (Orca measures the threshold from horizontal, Kiri from vertical)
    sliceSupportType: S.enable_support ? 'automatic' : 'disabled',
    sliceSupportTree: S.enable_support && S.support_style === 'tree',
    sliceSupportAngle: 90 - S.support_threshold_angle,
    sliceSupportDensity: S.support_density / 100,
    sliceSupportOffset: S.support_object_xy_distance,
    sliceSupportGap: !!S.support_top_z_gap,
    sliceSupportExtra: S.support_expansion,
    sliceSupportOutline: !!S.support_enclose,
    sliceSupportNozzle: 0,
    outputRaft: !!S.raft_enable,
    outputRaftSpacing: S.raft_spacing,
    // adhesion: Kiri's skirt with offset 0 touches the part, which is a brim
    outputBrimCount: S.brim_type !== 'none' ? brimLoops : S.skirt_loops,
    outputBrimOffset: S.brim_type !== 'none' ? 0 : S.skirt_distance,
    outputDraftShield: !!S.draft_shield,
    // temperatures / cooling
    outputTemp: F.nozzle_temperature,
    firstLayerNozzleTemp: F.nozzle_temperature_initial_layer,
    outputBedTemp: F.bed_temperature,
    firstLayerBedTemp: F.bed_temperature_initial_layer,
    outputFanSpeed: Math.round(F.fan_speed / 100 * 255),
    firstLayerFanSpeed: 0,
    outputFanLayer: F.close_fan_the_first_x_layers,
    outputMinLayerTime: F.slow_down_layer_time,
    // extrusion
    outputShellMult: mult,
    outputFillMult: mult,
    outputSparseMult: mult,
    // retraction / travel
    outputRetractDist: retractLen,
    outputRetractSpeed: retractSpeed,
    outputRetractWipe: P.wipe_distance || 0,
    outputRetractDwell: P.deretraction_dwell || 0,
    zHopDistance: zhop,
    outputLayerRetract: !!S.retract_on_layer_change,
    outputAvoidGaps: !!S.avoid_crossing_gaps,
    outputCoastDist: S.wall_coasting || 0,
    outputPurgeTower: 0,
    outputLoops: 0,
    ranges: [],
  };

  return { device, process };
}
