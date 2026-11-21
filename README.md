# FRC 5572 Slicer

A browser-based 3D-print slicer for the team's printers, hosted on GitHub Pages.
Open the site on any school computer, drop in an STL/3MF/OBJ, pick a printer, slice, and download G-code.
Everything runs in the browser: models are never uploaded anywhere.

**Printers**

| Printer | Bed (mm) | Notes |
|---|---|---|
| Creality K1C | 220 × 220 × 250 | Uses the K1C's `START_PRINT` / `END_PRINT` macros |
| Flashforge Adventurer 5M Pro | 220 × 220 × 220 | Center-origin coordinates, Flashforge header block |
| Prusa i3 MK3S+ | 250 × 210 × 210 | Mesh bed leveling, intro line, `M73` progress |

Start/end G-code, retraction and bed sizes are adapted from [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer)'s system profiles.
The slicing itself is done by the [Kiri:Moto](https://github.com/GridSpace/grid-apps) engine (MIT license), compiled for the browser.

## Using it

1. **Open model** (or drag files onto the bed). Multiple files are fine: they're placed side by side.
2. Pick the printer on the left. Pick material, layer height and a strength preset.
   - *Strong (robot part)* = 4 walls, 40 % gyroid. Use it for anything that goes on the robot.
3. Orient parts: drag to move, **Lay on face** then click the face that should touch the bed, or **Auto orient**.
   - If a part looks tiny, it was probably exported from CAD in inches: click **in → mm**.
4. **Slice**. Check the layer preview, then **Download G-code**, copy it to a USB drive and print.

Print time is an estimate that accounts for acceleration but not heat-up time.

## How it's built

```
site/                 static site (what GitHub Pages serves)
  index.html
  css/app.css
  js/app.js           UI wiring, settings, download
  js/viewer.js        three.js build plate: parts, drag, orient, toolpath preview
  js/printers.js      printer / material / quality profiles  <- edit this to tune prints
  js/slicer.js        wrapper around the Kiri:Moto engine
  js/gcode.js         G-code parser for the preview and stats
  js/loaders.js       STL / 3MF / OBJ loading
  engine/, wasm/      Kiri:Moto engine (generated, not committed)
scripts/
  build-engine.sh     clones Kiri:Moto at a pinned commit, builds it, copies bundles into site/
  serve.mjs           local test server
.github/workflows/pages.yml   builds the engine and deploys site/ on every push to main
```

### Run locally

Needs Node.js 22+, git and bash (Git Bash on Windows).

```bash
bash scripts/build-engine.sh      # first time only (~3 min)
node scripts/serve.mjs            # http://localhost:8080/frc5572-slicer/
```

### Tuning profiles

All print settings live in [`site/js/printers.js`](site/js/printers.js): temperatures per printer and
material, speeds, retraction, start/end G-code. Kiri:Moto G-code variables: `{temp}`, `{bed_temp}`,
`{layers}`, `{layer}`, `{z}`, `{progress}`, `{remain_time}`, plus `%%TOP+N%%` (top of print + N mm),
which the app fills in after slicing.

### Updating the engine

Change `KIRI_COMMIT` in `scripts/build-engine.sh` and push. CI rebuilds it.

### Moving to the frc5572 organization

GitHub → repo **Settings → General → Transfer ownership** → `frc5572`. After the transfer, re-enable
**Settings → Pages → Source: GitHub Actions** in the new repo. The site URL becomes
`https://frc5572.github.io/frc5572-slicer/` (old links redirect for the repo, but not for Pages).

## License

MIT for this project's code. The Kiri:Moto engine is MIT, © Stewart Allen; its license is copied to
`site/engine/LICENSE-kiri-moto.md` during the build.
