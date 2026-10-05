// Runs every preset headless and checks the physics is honest:
// the energy ledger balances, nothing is generated from nothing, and the machine stops.
import { Simulation } from '../src/physics.js';
import { defaultParams, PRESETS } from '../src/params.js';

let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

for (const preset of PRESETS) {
  const sim = new Simulation({ ...defaultParams(), ...preset.values });
  console.log(`\n${preset.label}`);
  if (sim.notes.length) console.log('  note:', sim.notes.join(' '));
  let stopAt = null;
  const marks = [1, 5, 10, 20, 40, 80, 160];
  for (let t = 0; t < 600 && stopAt === null; ) {
    sim.advance(0.05);
    t += 0.05;
    const r = sim.readouts();
    if (marks.some((m) => Math.abs(t - m) < 0.025)) {
      console.log(
        `  t=${t.toFixed(0).padStart(3)}s  turbine ${r.flowTurbine.toFixed(2).padStart(6)} L/min  return ${r.flowReturn.toFixed(2).padStart(6)} L/min` +
          `  ${r.rpm.toFixed(0).padStart(4)} rpm  ${r.power.toFixed(3)} W  air ${(r.pAirGauge / 1000).toFixed(1)} kPa  under ${r.waterUnder.toFixed(2)} L`
      );
    }
    if (r.stillTime > 3) stopAt = t - 3;
  }
  const e = sim.energySummary();
  console.log(
    `  released ${e.released.toFixed(2)} J → generated ${e.generated.toFixed(2)} J, lost ${e.lost.toFixed(2)} J ` +
      `(${Object.entries(e.losses).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')})`
  );
  check(stopAt !== null, `machine stops (at ~${stopAt?.toFixed(1)} s)`);
  check(e.generated <= e.released + 1e-9, 'never generates more than it releases');
  check(Math.abs(e.error) <= 0.01 * Math.max(1, e.released), `ledger balances (error ${e.error.toFixed(4)} J)`);
  check(Object.values(e.losses).every((v) => v > -1e-6), 'all loss buckets ≥ 0');

  sim.windUp();
  for (let i = 0; i < 6000 && sim.readouts().stillTime < 3; i++) sim.advance(0.05);
  const e2 = sim.energySummary();
  check(e2.generated < e2.input + e.released, `after winding up (cost ${e2.input.toFixed(2)} J) total generated ${e2.generated.toFixed(2)} J`);
  check(Math.abs(e2.error) <= 0.01 * Math.max(1, e2.released), `ledger still balances after wind-up (error ${e2.error.toFixed(4)} J)`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
