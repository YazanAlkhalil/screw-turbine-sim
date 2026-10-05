// Side panel: status, live readings, energy ledger, charts and parameter controls.

import { MACHINES, PARAM_GROUPS, PARAM_LIST, appliesTo, presetsFor } from './params.js';
import { LineChart } from './chart.js';

const COLOR = {
  turbine: '#2a78d6', // categorical slot 1
  ret: '#eb6834', // slot 2
  released: '#4a3aa7', // slot 7
  generated: '#1baf7a', // slot 3 (below 3:1 → always direct-labelled + legend)
  lost: '#c3c2b7', // neutral: energy that went nowhere useful
};

const LOSS_LABELS = {
  splash: 'Splashing & falling water',
  valves: 'One-way valves',
  pipe: 'Pipe friction & bends',
  leakage: 'Screw blade-gap leakage',
  jet: 'Jet energy the buckets missed',
  seal: 'Weight seal friction',
  bearing: 'Bearings & gears',
  transient: 'Surges (valve slams)',
};

const $ = (sel, root = document) => root.querySelector(sel);

export function formatJ(j) {
  const a = Math.abs(j);
  if (a >= 1e4) return `${(j / 1000).toFixed(1)} kJ`;
  if (a >= 100) return `${j.toFixed(0)} J`;
  if (a >= 10) return `${j.toFixed(1)} J`;
  return `${j.toFixed(2)} J`;
}
const kPa = (pa) => `${(pa / 1000).toFixed(1)} kPa`;
const fixed = (v, d) => (Math.abs(v) < 0.5 * 10 ** -d ? (0).toFixed(d) : v.toFixed(d));

function paramValueText(def, v) {
  if (def.type === 'choice') return '';
  const digits = def.digits ?? (def.step < 0.01 ? 3 : def.step < 1 ? 2 : 0);
  return `${Number(v).toFixed(digits)}${def.unit ? ` ${def.unit}` : ''}`;
}

export class Panel {
  /**
   * handlers: { onMachine(id), onParam(key, value, live), onPreset(values), onPlayPause(), onReset(),
   *             onWindUp(), onSpeed(x), onLabels(bool) }
   */
  constructor(root, params, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.inputs = {};
    this.lastSlow = 0;
    this.renderControls(params);
    this.charts = {
      flow: new LineChart($('#chart-flow'), {
        title: 'Flow', unit: 'L/min',
        series: [
          { key: 'flowTurbine', label: 'Through turbine', color: COLOR.turbine },
          { key: 'flowReturn', label: 'Up return pipe', color: COLOR.ret },
        ],
      }),
      power: new LineChart($('#chart-power'), {
        title: 'Electrical power', unit: 'W',
        series: [{ key: 'power', label: 'Power', color: COLOR.generated }],
      }),
      energy: new LineChart($('#chart-energy'), {
        title: 'Energy, cumulative', unit: 'J',
        series: [
          { key: 'released', label: 'Released from storage', color: COLOR.released },
          { key: 'generated', label: 'Became electricity', color: COLOR.generated },
        ],
      }),
    };

    $('#btn-play').addEventListener('click', () => handlers.onPlayPause());
    $('#btn-reset').addEventListener('click', () => handlers.onReset());
    $('#btn-windup').addEventListener('click', () => handlers.onWindUp());
    $('#speed').addEventListener('change', (e) => handlers.onSpeed(Number(e.target.value)));
    $('#labels').addEventListener('change', (e) => handlers.onLabels(e.target.checked));
    $('#machine-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && !b.classList.contains('on')) handlers.onMachine(b.dataset.machine);
    });
    this.setMachine(params.machine);
  }

  setMachine(machine) {
    for (const b of document.querySelectorAll('#machine-seg button')) {
      const on = b.dataset.machine === machine;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    $('#machine-image').textContent = MACHINES[machine].image;
  }

  /** (Re)build the parameter controls for the current machine. */
  renderControls(params) {
    const host = $('#params');
    const machine = params.machine;
    this.inputs = {};
    const presetOptions = presetsFor(machine).map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
    host.innerHTML = `
      <label class="preset">Preset
        <select id="preset">${presetOptions}<option value="custom" hidden>Custom</option></select>
      </label>
      ${PARAM_GROUPS.map(
        (g) => `
        <details class="group" ${g.id === 'weight' || g.id === 'vessel' ? 'open' : ''}>
          <summary>${g.title}</summary>
          ${g.params
            .filter((p) => appliesTo(p, machine))
            .map((p) => {
              const tag = p.live ? '' : '<span class="tag" title="Changing this restarts the simulation">restarts</span>';
              const help = p.help ? `<div class="help">${p.help}</div>` : '';
              if (p.type === 'choice') {
                return `<div class="row"><div class="row-head"><span>${p.label}${tag}</span></div>
                  <div class="seg" data-key="${p.key}">${p.options
                    .map((o) => `<button type="button" data-value="${o.value}">${o.label}</button>`)
                    .join('')}</div>${help}</div>`;
              }
              return `<div class="row"><div class="row-head"><span>${p.label}${tag}</span><output data-key="${p.key}"></output></div>
                <input type="range" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}">${help}</div>`;
            })
            .join('')}
        </details>`
      ).join('')}`;

    for (const def of PARAM_LIST.filter((d) => appliesTo(d, machine))) {
      if (def.type === 'choice') {
        const seg = host.querySelector(`.seg[data-key="${def.key}"]`);
        seg.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          this.setValue(def.key, b.dataset.value);
          this.markCustom();
          this.handlers.onParam(def.key, b.dataset.value, def.live);
        });
        this.inputs[def.key] = { def, seg };
      } else {
        const input = host.querySelector(`input[data-key="${def.key}"]`);
        const out = host.querySelector(`output[data-key="${def.key}"]`);
        input.addEventListener('input', () => {
          const v = Number(input.value);
          out.textContent = paramValueText(def, v);
          this.markCustom();
          this.handlers.onParam(def.key, v, def.live);
        });
        this.inputs[def.key] = { def, input, out };
      }
    }
    $('#preset').addEventListener('change', (e) => {
      const preset = presetsFor(machine).find((p) => p.id === e.target.value);
      if (preset) this.handlers.onPreset(preset.values);
    });
    this.setAll(params);
  }

  markCustom() {
    $('#preset').value = 'custom';
  }

  setValue(key, v) {
    const { def, input, out, seg } = this.inputs[key];
    if (seg) {
      for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === v);
    } else {
      input.value = v;
      out.textContent = paramValueText(def, v);
    }
  }

  setAll(params, presetId) {
    for (const key of Object.keys(this.inputs)) this.setValue(key, params[key]);
    if (presetId) $('#preset').value = presetId;
  }

  setPlaying(playing) {
    const b = $('#btn-play');
    b.textContent = playing ? 'Pause' : 'Play';
    b.setAttribute('aria-pressed', String(playing));
  }

  setNotes(notes) {
    const el = $('#notes');
    el.hidden = !notes.length;
    el.textContent = notes.join(' ');
  }

  clearCharts() {
    for (const c of Object.values(this.charts)) c.setData([]);
  }

  /** Called every frame; DOM work is throttled to ~10 Hz. */
  update(r, history, now) {
    $('#time').textContent = `t = ${r.t.toFixed(1)} s`;
    if (now - this.lastSlow < 100) return;
    this.lastSlow = now;

    const st = describe(r);
    const status = $('#status');
    status.dataset.state = st.state;
    $('#status-title').textContent = st.title;
    $('#status-text').textContent = st.text;

    $('#v-flow-t').textContent = fixed(r.flowTurbine, 2);
    $('#v-flow-r').textContent = fixed(r.flowReturn, 2);
    $('#v-rpm').textContent = fixed(r.rpm, 0);
    $('#v-power').textContent = fixed(r.power, 3);
    $('#v-air').textContent = r.sealed ? fixed(r.pAirGauge / 1000, 1) : 'open';
    $('#u-air').textContent = r.sealed ? 'kPa (vs outside air)' : 'vented to air';
    $('#v-weight').textContent = fixed(r.waterUnder, 2);

    // Can the weight lift the water over the top?
    const max = Math.max(r.pushAvailable, r.pushNeeded) * 1.1;
    $('#push-avail').style.width = `${(100 * r.pushAvailable) / max}%`;
    $('#push-need').style.left = `${(100 * r.pushNeeded) / max}%`;
    $('#push-text').innerHTML =
      `Weight + water push at the intake <b>${kPa(r.pushAvailable)}</b> · ` +
      `needed to get over the top <b>${kPa(r.pushNeeded)}</b>` +
      (r.atStops ? ' · <b>weight is on its stops</b>' : '');

    // Energy ledger
    const e = r.energy;
    $('#e-input').textContent = formatJ(e.input);
    $('#e-released').textContent = formatJ(e.released);
    $('#e-generated').textContent = formatJ(e.generated);
    $('#e-lost').textContent = formatJ(e.lost);
    const pct = (x) => (e.released > 1e-9 ? (100 * x) / e.released : 0);
    $('#e-generated-pct').textContent = `${pct(e.generated).toFixed(0)}%`;
    $('#e-lost-pct').textContent = `${pct(e.lost).toFixed(0)}%`;
    $('#bar-generated').style.flexGrow = Math.max(0, e.generated);
    $('#bar-lost').style.flexGrow = Math.max(0, e.lost);
    $('#ledger-bar').classList.toggle('empty', e.released <= 1e-6);
    const losses = Object.entries(e.losses).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
    $('#loss-list').innerHTML = losses
      .map(([k, v]) => `<li><span>${LOSS_LABELS[k]}</span><span>${formatJ(v)}</span></li>`)
      .join('');
    const errPct = e.released > 1e-6 ? (100 * Math.abs(e.error)) / e.released : 0;
    $('#e-check').textContent =
      `Check: electricity + losses = released, to within ${errPct < 0.01 ? '0.01' : errPct.toFixed(2)}% (numerical error).`;
    // The machine starts pre-charged for free, so only count what came back after winding it up.
    $('#e-net').hidden = r.cycles === 0;
    $('#e-net').innerHTML =
      `Since you first wound it up (${r.cycles}×): you put in <b>${formatJ(e.input)}</b> and got back ` +
      `<b>${formatJ(e.generatedSinceWindUp)}</b> of electricity. Net: <b>${formatJ(e.generatedSinceWindUp - e.input)}</b>.`;

    // Winding up is only offered once the machine has run down; doing it mid-run would
    // hand back energy that was still stored and muddle the comparison above.
    const stopped = !r.moving && r.stillTime > 1;
    const wind = $('#btn-windup');
    wind.disabled = !stopped;
    wind.title = stopped
      ? 'Lift the weight and pour the water back up by hand. The work this takes is booked in the energy ledger.'
      : 'Available once the machine has stopped.';

    this.charts.flow.setData(history);
    this.charts.power.setData(history);
    this.charts.energy.setData(history);
  }
}

/** Plain-language explanation of what the machine is doing right now, and why. */
function describe(r) {
  const T = r.flowTurbine > 0.12;
  const back = r.flowTurbine < -0.12;
  const R = r.flowReturn > 0.12;
  const e = r.energy;
  const returnStalled = () => {
    if (r.atStops) return 'the weight has reached its stops at the bottom of the tank, so it can push no more water up';
    if (r.pushAvailable < r.pushNeeded) {
      return `the weight's push (${kPa(r.pushAvailable)}) is less than the ${kPa(r.pushNeeded)} needed to lift water over the top`;
    }
    return 'the one-way valves are closed';
  };

  if (!r.moving && r.stillTime > 1) {
    let why;
    if (r.atStops) why = 'The weight is resting on its stops: the energy it stored has been used up.';
    else if (!r.onto) why = 'The weight presses on the turbine outlet exactly as hard as on the return pipe, so the pressures cancel.';
    else if (r.vesselEmpty) why = `The big vessel is empty, and ${returnStalled()}.`;
    else if (r.sealed && r.pAirGauge < -300) {
      why = `The partial vacuum in the sealed vessel (${kPa(r.pAirGauge)}) is holding its water back from the turbine, and ${returnStalled()}.`;
    } else why = `Pressures have balanced: ${returnStalled()}.`;
    return {
      state: 'stopped',
      title: 'Stopped',
      text: `${why} It released ${formatJ(e.released)} in total: ${formatJ(e.generated)} became electricity and ${formatJ(e.lost)} was lost. Use "Wind it back up" to restart it and see what that costs.`,
    };
  }
  if (back) {
    return {
      state: 'running',
      title: 'Turbine running backwards',
      text: 'The weight pressurises the water under it, and that pressure pushes water back up through the turbine into the big vessel.',
    };
  }
  if (T && R) {
    return {
      state: 'running',
      title: 'Circulating',
      text: 'Water is going round the loop, driven only by the weight sinking (watch "Water under the weight" fall). When the weight reaches the bottom, the loop stops.',
    };
  }
  if (T) {
    return { state: 'running', title: 'Draining through the turbine', text: `The upper vessel is emptying through the turbine, but the return pipe has stopped: ${returnStalled()}.` };
  }
  if (R) {
    const why = r.sealed && r.pAirGauge < -300
      ? `the partial vacuum in the sealed vessel (${kPa(r.pAirGauge)}) is holding its water back`
      : 'there is not enough height difference to drive it';
    return { state: 'running', title: 'Refilling the big vessel', text: `The weight is pushing water up, but nothing flows through the turbine: ${why}.` };
  }
  return { state: 'slowing', title: 'Coming to rest', text: 'Flows have stopped; the turbine is spinning down.' };
}
