# 5572 Slicer

A browser-based slicer for FRC 5572's printers, laid out like OrcaSlicer and styled like the
[Parts Tracker](https://parts.frc5572.org). Hosted on GitHub Pages; everything runs in the browser and
models are never uploaded.

**Printers:** Creality K1C · Flashforge Adventurer 5M Pro · Prusa i3 MK3S+ · Bambu Lab A1.
The Bambu A1 uses Bambu's own start/end G-code taken from a Bambu Studio slice ([`site/js/machines/bambu-a1.js`](site/js/machines/bambu-a1.js)). For the others, machine G-code, retraction, speeds and accelerations come from [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer)'s
system profiles. Slicing is done by the [Kiri:Moto](https://github.com/GridSpace/grid-apps) engine (MIT), compiled for the browser.

## Features

**Presets (Orca-style).** Printer, Filament and Process presets with system and user presets, "(modified)"
markers, per-setting reset, Save / Save as / Delete / Discard, and JSON export/import to share team presets.
Process presets per printer: 0.08 Extra Fine → 0.28 Extra Draft, plus *Robot Part (Strong) @5572* and
*Fast Prototype @5572*. Filaments: PLA, PETG, ABS, ASA, TPU 95A, PLA-CF, PETG-CF, PA-CF, with
per-printer temperatures and hardened-nozzle / enclosure warnings.

**Process settings** (Quality / Strength / Speed / Support / Others, Advanced toggle, search):
layer height, initial layer, line width, seam position, scarf seam, X-Y hole and contour compensation,
arc fitting, adaptive layer height, thin-wall detection, wall sequence, alternate wall direction,
walls, top/bottom shells, solid infill direction, flat-area thresholds, infill density / pattern / overlap,
per-feature speeds, small-perimeter slowdown, **per-feature acceleration**, normal / tree supports
(threshold angle, density, XY distance, top gap, expansion), raft, skirt, brim, draft shield,
**spiral vase**, retract on layer change, avoid crossing gaps, coasting.

**Filament settings:** temperatures (initial / other layers), flow ratio, **pressure advance**, max volumetric
speed, fan, no-cooling layers, minimum layer time, retraction overrides, density and price (for cost).

**Printer settings:** bed size and origin, G-code flavor, editable start / end / layer-change / progress /
pause / filament-change G-code, retraction, z-hop, wipe, motion limits.

**Plate:** STL / 3MF / OBJ, multiple objects, drag to move, numeric position / rotation / scale / size
(uniform or per-axis), lay on face, auto orient, arrange, duplicate, in → mm for inch exports,
**height range modifiers** (e.g. 100 % infill for Z 12–18 mm).

**Preview:** toolpaths drawn as solid filament (GPU-instanced tubes sized to line width and layer height), line type / speed / volumetric flow / height color schemes, per-feature time, % and grams,
show/hide line types (travel hidden by default), dual layer slider, **pause and filament change at a layer**,
time, filament, cost.

Shortcuts: `Ctrl+I` add, `Ctrl+R` slice, `A` arrange, `O` orient, `F` lay on face, `Ctrl+D` duplicate,
`Del` delete, `0/1/2` views, `Tab` Prepare ↔ Preview, `↑/↓` layers.

### Compared to OrcaSlicer

Not available because the engine doesn't support them: ironing, fuzzy skin, seam painting,
support painting/blockers, per-object settings and modifier meshes (height ranges apply to the whole
plate), Arachne variable-width walls, bridge and overhang speed tiers, separate line widths per feature,
multi-plate projects, and sending to printers (planned with the remote-printing setup).

Per-feature acceleration, pressure advance, spiral vase and pauses are done by post-processing the
engine's G-code ([`postprocess.js`](site/js/postprocess.js)).

### Changes to the Kiri:Moto engine

[`scripts/patch-kiri.mjs`](scripts/patch-kiri.mjs) patches the engine at build time:

- **Tree supports** ([`scripts/kiri-ext/tree.js`](scripts/kiri-ext/tree.js)). Upstream Kiri has a tree option
  but no implementation (it silently printed normal supports). Tuned against a Bambu Studio A1 slice:
  thin tips, 2 mm branches printed as single wall loops, branches ~4.5 mm apart that pair up and merge at
  up to 40°, only merged trunks thicken (5° diameter angle), filled 10 mm base pads, 2 roof layers at
  interface density. On that part, branch counts and diameters per layer match Bambu's within ~25%.
- **Gyroid infill** ([`scripts/kiri-ext/gyroid.js`](scripts/kiri-ext/gyroid.js)). Upstream gyroid printed about
  5x too little plastic (40 % gyroid used less than 10 % grid) and stamped hundreds of thousands of tile
  pieces per layer. Replaced with an analytic generator: correct density and far faster.

### Slicing speed

Measured on a 200 × 140 × 40 mm electronics tray (K1C, 0.2 mm, Chrome):

| Change | Time |
|---|---|
| Original (engine API ran on one CPU core) | over 3 min |
| Worker pool on (`controller.threaded`) | 16 s |
| Detect thin walls off by default (Orca's default too; it cost ~9.5 s) | 6 s |
| Grid / rectilinear infill | about 4 s |
| Gyroid 40 % (correct density) | about 13 s |

Remaining time is the JavaScript engine itself: polygon clipping that OrcaSlicer does in multi-threaded C++.
Each slice logs a per-phase breakdown to the browser console.

## How it's built

```
site/
  index.html, css/app.css   UI (Parts Tracker tokens and components)
  js/app.js                 presets, sidebar, objects, slicing, preview wiring
  js/schema.js              every setting: label, tab, section, units, tooltips   <- add settings here
  js/presets.js             system printer / filament / process presets          <- tune profiles here
  js/kiri-map.js            Orca-style settings -> Kiri:Moto engine settings
  js/postprocess.js         acceleration, pressure advance, spiral vase, pauses, placeholders
  js/gcode.js               G-code parser: preview geometry, per-feature stats, time estimate
  js/viewer.js              three.js plate, transforms, toolpath preview
  js/tubes.js               instanced filament renderer for the preview
  js/settings-ui.js         settings rows renderer
  js/slicer.js, loaders.js  engine wrapper, model loading
  js/bambu3mf.js            Bambu .gcode.3mf packaging (zip, MD5, thumbnails, metadata)
  engine/, wasm/            Kiri:Moto engine (generated by the build, not committed)
scripts/build-engine.sh     clones Kiri:Moto at a pinned commit, patches, builds, copies bundles into site/
scripts/patch-kiri.mjs      applies the engine changes below (scripts/kiri-ext/*)
scripts/serve.mjs           local test server
.github/workflows/pages.yml builds the engine and deploys site/ on every push to main
```

### Engine quirks handled in `kiri-map.js` (measured)

- Kiri computes line volume as an ellipse; Orca uses a rounded rectangle. Flow is scaled per layer height to match Orca.
- Kiri's support angle is measured from vertical; Orca's from horizontal (`90 - angle`).
- Kiri moves walls by half its compensation value and its outer offset shrinks the part, so hole/contour
  compensation are passed as `2×` and `-2×` to behave like Orca's per-side values.

### Run locally

Needs Node.js 22+, git and bash (Git Bash on Windows).

```bash
bash scripts/build-engine.sh      # first time only (~3 min)
node scripts/serve.mjs            # http://localhost:8080/frc5572-slicer/
```

### Moving to the frc5572 organization

GitHub → **Settings → General → Transfer ownership** → `frc5572`, then in the new repo
**Settings → Pages → Source: GitHub Actions**. The site moves to `https://frc5572.github.io/frc5572-slicer/`.

## License

MIT for this project's code. Kiri:Moto is MIT, © Stewart Allen; its license is copied to
`site/engine/LICENSE-kiri-moto.md` during the build.
