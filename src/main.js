import './style.css';
import { Simulation } from './physics.js';
import { defaultParams } from './params.js';
import { ApparatusScene } from './scene.js';
import { Panel } from './ui.js';

const params = defaultParams();
const sim = new Simulation(params);
const scene = new ApparatusScene(document.getElementById('scene'));
scene.build(sim.layout, sim.params);

let playing = true;
let speed = 1;
let rebuildPending = false;
let reframePending = false;

const panel = new Panel(document.getElementById('panel'), params, {
  onParam(key, value, live) {
    params[key] = value;
    if (live) sim.setLiveParams(params);
    else rebuildPending = true; // coalesced to once per frame while a slider is dragged
  },
  onPreset(values) {
    Object.assign(params, defaultParams(), values);
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
