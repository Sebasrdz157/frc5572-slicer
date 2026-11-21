// Thin wrapper around the Kiri:Moto engine (built into ./engine by scripts/build-engine.sh).
import { Engine } from '../engine/kiri-eng.js';

const workURL = new URL('../engine/kiri-work.js', import.meta.url).href;
const poolURL = new URL('../engine/kiri-pool.js', import.meta.url).href;

/**
 * Slice a merged binary STL.
 * @param {object} job - { stl: ArrayBuffer, center: {x,y}, device, process }
 * @param {(fraction:number, label:string) => void} onProgress
 * @returns {Promise<string>} G-code
 */
export async function slice(job, onProgress = () => {}) {
  const engine = new Engine({ workURL, poolURL });
  let phase = 'Slicing';
  const ranges = { Slicing: [0, 0.6], 'Planning paths': [0.6, 0.9], 'Writing G-code': [0.9, 1] };
  const report = f => {
    const [a, b] = ranges[phase];
    onProgress(a + (b - a) * Math.max(0, Math.min(1, f)), phase);
  };
  engine.setListener(msg => {
    if (msg.slice) {
      const u = msg.slice.update ?? msg.slice.progress;
      if (typeof u === 'number') report(u);
    } else if (msg.prepare?.update !== undefined) {
      const u = msg.prepare.update;
      report(typeof u === 'number' ? u : (u?.update ?? 0));
    }
  });

  report(0);
  await engine.parse(job.stl);
  // Kiri centers the model; move it back to where it sits on our bed
  engine.move(job.center.x, job.center.y, 0);
  engine.setDevice(job.device);
  engine.setProcess(job.process);
  await engine.slice();
  phase = 'Planning paths'; report(0);
  await engine.prepare();
  phase = 'Writing G-code'; report(0);
  const gcode = await engine.export();
  report(1);
  return gcode.replace(/\r\n/g, '\n');
}
