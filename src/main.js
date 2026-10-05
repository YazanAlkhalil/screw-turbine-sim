import './style.css';
import { Simulation } from './physics.js';
import { MACHINES, defaultParams } from './params.js';
import { ApparatusScene } from './scene.js';
import { Panel } from './ui.js';

// #pelton / #screw in the URL picks the machine, so either view can be linked to directly.
const fromHash = location.hash.slice(1);
const params = defaultParams(fromHash in MACHINES ? fromHash : 'screw');
const sim = new Simulation(params);
const scene = new ApparatusScene(document.getElementById('scene'));
scene.build(sim.layout, sim.params);

let playing = true;
let speed = 1;
let rebuildPending = false;
let reframePending = false;

const panel = new Panel(document.getElementById('panel'), params, {
  onMachine(machine) {
    for (const k of Object.keys(params)) delete params[k];
    Object.assign(params, defaultParams(machine));
    panel.renderControls(params);
    panel.setMachine(machine);
    history.replaceState(null, '', `#${machine}`);
    rebuildPending = true;
    reframePending = true;
  },
  onParam(key, value, live) {
    params[key] = value;
    if (live) sim.setLiveParams(params);
    else rebuildPending = true; // coalesced to once per frame while a slider is dragged
  },
  onPreset(values) {
    Object.assign(params, defaultParams(params.machine), values);
    panel.setAll(params);
    rebuildPending = true;
    reframePending = true; // presets can change the machine's size a lot
  },
  onPlayPause() {
    playing = !playing;
    panel.setPlaying(playing);
  },
  onReset() {
    sim.reset();
    scene.powerPeak = 0;
    panel.clearCharts();
  },
  onWindUp() {
    sim.windUp();
    if (!playing) {
      playing = true;
      panel.setPlaying(true);
    }
  },
  onSpeed(x) {
    speed = x;
  },
  onLabels(on) {
    scene.setLabelsVisible(on);
  },
});
panel.setNotes(sim.notes);

// The offline copy is produced by `npm run build`; it doesn't exist in dev, and the offline
// copy itself has no use for a link to itself.
if (import.meta.env.DEV || location.protocol === 'file:') document.getElementById('btn-download').hidden = true;

// Handy from the browser console: sim.readouts(), sim.energySummary(), …
Object.assign(window, { sim, scene });

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (rebuildPending) {
    rebuildPending = false;
    sim.rebuild(params);
    scene.build(sim.layout, sim.params);
    if (reframePending) scene.frame(sim.layout);
    reframePending = false;
    panel.setNotes(sim.notes);
    panel.clearCharts();
  }
  const dtReal = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dtSim = playing ? dtReal * speed : 0;
  if (dtSim > 0) sim.advance(dtSim);
  const r = sim.readouts();
  scene.update(r, dtSim);
  scene.render();
  panel.update(r, sim.history, now);
}
requestAnimationFrame(frame);
