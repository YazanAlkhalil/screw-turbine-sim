// Lumped-parameter hydraulic model of the closed-loop machine, in two variants:
//   screw  – big vessel → screw turbine (full pipe) → lower tank
//   pelton – big vessel → nozzle → free jet onto a Pelton wheel in a vented casing → drains to lower tank
// and in both: under the weight → one-way valves → up to the big vessel.
//
// Two rigid water columns (1-D unsteady Bernoulli, pipes assumed full) coupled to a
// rotor (turbine + gears + generator) and to three free-surface volumes
// (big vessel, water under the weight, water on top of the weight).
//
// Nothing is scripted: water moves only where pressure and gravity push it.
// Every joule is tracked in a ledger so the run can be audited:
//   released from storage = electricity + friction/leakage/splash losses (+ tiny numerical error)

import { computeLayout } from './layout.js';

export const RHO = 1000; // kg/m³
export const G = 9.81; // m/s²
export const P_ATM = 101325; // Pa
const P_MIN = 2340; // vapour pressure of water at 20 °C: absolute pressure can't go lower
const ROTOR_INERTIA = 4e-4; // kg·m², screw + shaft + gears + generator rotor
const DT_MAX = 1e-3; // s
const V_EPS = 0.002; // m/s, smoothing width of the seal's Coulomb friction
const K_ENTRY = 0.5;
const K_BEND = 0.3;
const K_EXIT = 1.0;
const K_NOZZLE = 0.05; // contraction loss of the Pelton nozzle
const BUCKET_FACTOR = 1.8; // 1 + k·cos(180° − deflection): ideal 2, real Pelton buckets ≈ 1.8
const FLOW_EPS = 2e-6; // m³/s (0.12 L/min) – below this a line counts as stopped
const SPIN_EPS = 0.1; // rad/s

export class Simulation {
  constructor(params) {
    this.rebuild(params);
  }

  /** Apply all parameters, rebuild geometry and restart from the initial state. */
  rebuild(params) {
    this.params = { ...params };
    this.layout = computeLayout(this.params);
    const L = this.layout;
    this.AL = Math.PI * L.RL ** 2;
    this.AB = Math.PI * L.RB ** 2;
    this.AT = Math.PI * L.rT ** 2;
    this.AR = Math.PI * L.rR ** 2;
    this.capB = this.AB * L.HB;
    this.capL = this.AL * (L.HL - L.tP - 0.01);
    this.Vstop = this.AL * L.hStop;
    this.IT = (RHO * L.lengths.turbine) / this.AT; // inertance, Pa·s²/m³
    this.IR = (RHO * L.lengths.ret) / this.AR;
    this.setLiveParams(this.params);
    this.reset();
  }

  /** Parameters that don't change stored energy can be changed mid-run. */
  setLiveParams(params) {
    Object.assign(this.params, params);
    const p = this.params;
    const L = this.layout;
    this.d = p.screwDisplacement / 1000 / (2 * Math.PI); // m³ per radian
    this.Gl = p.leakage * 1e-6; // m³/s per Pa
    this.cGen = p.genLoad * 1e-3; // N·m·s
    this.bBear = p.bearingFriction * 1e-3; // N·m·s
    this.Fs = p.sealFriction; // N
    this.pCrack = p.valveCrack * 1000; // Pa
    this.kTpipe = (p.frictionFactor * L.lengths.turbine) / (2 * L.rT) + K_ENTRY + K_BEND * L.bends.turbine;
    this.kRpipe = (p.frictionFactor * L.lengths.ret) / (2 * L.rR) + K_ENTRY + K_BEND * L.bends.ret;
    this.kRvalve = 2 * p.valveK; // screw: foot valve + one-way valve · pelton: two one-way valves
    this.pelton = p.machine === 'pelton';
    if (this.pelton) {
      this.AN = Math.PI * (p.nozzleDia / 2000) ** 2;
      this.kTpipe += K_NOZZLE;
    }
  }

  initialVolumes() {
    const L = this.layout;
    const p = this.params;
    const notes = [];
    const depth = Math.min(Math.max(p.ltDepth, L.hStop + 0.005), L.HL - L.tP - 0.03);
    let VLB = this.AL * depth;
    // All the water must fit in the lower tank, and everything above the stops must fit in the vessel.
    VLB = Math.min(VLB, 0.97 * this.capB + this.Vstop);
    const VBwanted = (this.capB * p.bvFill) / 100;
    const VB = Math.max(0, Math.min(VBwanted, 0.97 * this.capL - VLB, 0.97 * this.capB + this.Vstop - VLB));
    if (VB < VBwanted - 1e-6) {
      notes.push(`Initial vessel fill limited to ${Math.round((100 * VB) / this.capB)}% so all the water fits in the lower tank.`);
    }
    if (L.zBb > p.bvElevation + 1e-6) {
      notes.push(`Vessel raised to ${L.zBb.toFixed(2)} m to clear the turbine.`);
    }
    return { VB, VLB, notes };
  }

  reset() {
    const { VB, VLB, notes } = this.initialVolumes();
    this.notes = notes;
    this.init = { VB, VLB };
    this.s = { VB, VLB, VLA: 0, QT: 0, QR: 0, w: 0, theta: 0, vP: 0, t: 0 };
    this.Vair0 = this.capB - VB;
    this.E0 = this.storedEnergy();
    this.ledger = { input: 0, generated: 0, pipe: 0, valves: 0, leakage: 0, jet: 0, bearing: 0, seal: 0, splash: 0, transient: 0 };
    this.cycles = 0;
    this.stillTime = 0;
    this.history = [];
    this.histEvery = 0.1;
    this.nextHist = 0;
    this.record();
  }

  /** Absolute pressure of the air above the water in the big vessel. */
  pAir(VB) {
    if (this.params.lid !== 'sealed') return P_ATM;
    const Vair = Math.max(this.capB - VB, 1e-9);
    return Math.max(P_MIN, (P_ATM * this.Vair0) / Vair); // isothermal
  }

  /** Mechanical energy stored in the machine (J, relative to the floor). */
  storedEnergy(s = this.s) {
    const L = this.layout;
    const hB = s.VB / this.AB;
    const hLB = s.VLB / this.AL;
    const hLA = s.VLA / this.AL;
    const yP = L.yF + hLB;
    let E =
      RHO * G * this.AB * (hB * L.zBb + (hB * hB) / 2) +
      RHO * G * this.AL * (hLB * L.yF + (hLB * hLB) / 2) +
      RHO * G * this.AL * (hLA * (yP + L.tP) + (hLA * hLA) / 2) +
      this.params.pistonMass * G * (yP + L.tP / 2);
    if (this.params.lid === 'sealed') {
      // Work the trapped air can do against the atmosphere as it expands (isothermal).
      const V = this.capB - s.VB;
      E += -P_ATM * this.Vair0 * Math.log(V / this.Vair0) + P_ATM * (V - this.Vair0);
    }
    E += 0.5 * this.IT * s.QT ** 2 + 0.5 * this.IR * s.QR ** 2 + 0.5 * ROTOR_INERTIA * s.w ** 2;
    return E;
  }

  step(dt) {
    const s = this.s;
    const L = this.layout;
    const p = this.params;
    const onto = this.pelton || p.discharge !== 'under';
    const hB = s.VB / this.AB;
    const hLB = s.VLB / this.AL;
    const hLA = s.VLA / this.AL;
    const zBs = L.zBb + hB; // vessel water surface
    const yP = L.yF + hLB; // underside of the weight
    const zLAs = yP + L.tP + hLA; // surface of water sitting on the weight
    const pA = this.pAir(s.VB) - P_ATM; // gauge pressure of the vessel's air
    const fr = this.Fs * Math.tanh(s.vP / V_EPS); // seal friction, opposing the weight's motion
    const pBelow = (p.pistonMass * G + RHO * G * s.VLA + fr) / this.AL; // gauge, just under the weight
    const headLB = pBelow + RHO * G * yP; // piezometric head of the water under the weight (Pa)

    const ATT = 2 * this.AT * this.AT;
    const ARR = 2 * this.AR * this.AR;
    const aQT = Math.abs(s.QT);
    const aQR = Math.abs(s.QR);
    const J = ROTOR_INERTIA;
    const lg = this.ledger;
    let QT;
    let w;
    let fallFrom; // height turbine water falls from onto the weight ("onto" discharge)

    if (this.pelton) {
      // ---- Pelton: nozzle line → free jet; the wheel can't push back on the nozzle --------
      // The jet leaves at air pressure with speed vj = Q/A_nozzle (its kinetic energy is the
      // nozzle's "exit loss"); the buckets take torque ρ·Q·(vj − u)·k·r, u = ω·r.
      const DT = pA + RHO * G * (zBs - L.zNozzle);
      const AN2 = 2 * this.AN * this.AN;
      const RT = RHO * aQT * (this.kTpipe / ATT + 1 / AN2);
      QT = ((this.IT * s.QT) / dt + DT) / (this.IT / dt + RT);
      QT = Math.min(s.VB / dt, Math.max(0, QT));
      const vj = QT / this.AN;
      const r = L.rPitch;
      const k = BUCKET_FACTOR * RHO * r * QT; // torque = k·(vj − ω·r)
      w = ((J * s.w) / dt + k * vj) / (J / dt + k * r + this.bBear + this.cGen);
      const pWheel = k * (vj - w * r) * w;
      lg.jet += ((RHO * aQT * QT * QT) / AN2 - pWheel) * dt; // jet energy the buckets didn't capture
      lg.pipe += ((RHO * this.kTpipe * aQT) / ATT) * QT * QT * dt;
      fallFrom = L.zNozzle;
    } else {
      // ---- Screw: full pipe, implicitly coupled to the rotor ----------------------------
      // Positive-displacement machine with leakage: flow Q = d·ω + Gl·Δp ; torque = d·Δp
      const DT = onto ? pA + RHO * G * (zBs - L.zOut) : pA + RHO * G * zBs - headLB;
      const RT = (RHO * (this.kTpipe + K_EXIT) * aQT) / ATT;
      const d = this.d;
      const Gl = this.Gl;
      const a11 = this.IT / dt + RT + 1 / Gl;
      const a12 = -d / Gl;
      const a22 = J / dt + (d * d) / Gl + this.bBear + this.cGen;
      const b1 = (this.IT * s.QT) / dt + DT;
      const b2 = (J * s.w) / dt;
      const det = a11 * a22 - a12 * a12;
      QT = (b1 * a22 - a12 * b2) / det;
      w = (a11 * b2 - a12 * b1) / det;
      // A free outfall can't run backwards; nothing can be drawn from an empty vessel;
      // backflow can't take water the weight is already resting on its stops over.
      const QTmax = s.VB / dt;
      const QTmin = onto ? 0 : -Math.max(0, s.VLB - this.Vstop) / dt;
      if (QT > QTmax || QT < QTmin) {
        QT = Math.min(QTmax, Math.max(QTmin, QT));
        w = (b2 + (d * QT) / Gl) / a22;
      }
      lg.leakage += (((QT - d * w) ** 2) / Gl) * dt;
      lg.pipe += ((RHO * this.kTpipe * aQT) / ATT) * QT * QT * dt;
      lg.splash += ((RHO * K_EXIT * aQT) / ATT) * QT * QT * dt;
      fallFrom = L.zOut;
    }

    // ---- Return line ------------------------------------------------------------------
    // Must lift water over the top of the pipe (zPeak) into the vessel's air space,
    // or up to the vessel's water surface if that has risen above the inlet.
    const zLift = Math.max(L.zPeak, zBs);
    const DR = headLB - pA - RHO * G * zLift - this.pCrack;
    const RR = (RHO * (this.kRpipe + this.kRvalve + K_EXIT) * aQR) / ARR;
    let QR = ((this.IR * s.QR) / dt + DR) / (this.IR / dt + RR);
    const avail = s.VLB - this.Vstop + (onto ? 0 : QT * dt); // what the weight can still push out
    QR = Math.max(0, Math.min(QR, Math.max(0, avail) / dt)); // one-way valves + stop ring

    const dVLB = (onto ? -QR : QT - QR) * dt;
    const vP = dVLB / dt / this.AL;

    // ---- Energy ledger (every loss is computed explicitly, not as a remainder) --------
    lg.generated += this.cGen * w * w * dt;
    lg.bearing += this.bBear * w * w * dt;
    lg.pipe += ((RHO * this.kRpipe * aQR) / ARR) * QR * QR * dt;
    lg.valves += (this.pCrack * QR + ((RHO * this.kRvalve * aQR) / ARR) * QR * QR) * dt;
    lg.seal += fr * vP * dt;
    lg.splash +=
      ((RHO * K_EXIT * aQR) / ARR) * QR * QR * dt +
      RHO * G * (zLift - zBs) * QR * dt + // falls from the top of the return pipe into the vessel
      (onto ? RHO * G * (fallFrom - zLAs) * QT * dt : 0); // falls from the turbine onto the weight
    lg.transient += 0.5 * this.IT * (QT - s.QT) ** 2 + 0.5 * this.IR * (QR - s.QR) ** 2 + 0.5 * J * (w - s.w) ** 2;

    s.VB = Math.max(0, s.VB + (QR - QT) * dt);
    s.VLB += dVLB;
    if (onto) s.VLA += QT * dt;
    s.QT = QT;
    s.QR = QR;
    s.w = w;
    s.vP = vP;
    s.theta += w * dt;
    s.t += dt;
  }

  /** Advance the simulation by `seconds` of simulated time. */
  advance(seconds) {
    const n = Math.min(40000, Math.max(1, Math.ceil(seconds / DT_MAX)));
    const dt = seconds / n;
    for (let i = 0; i < n; i++) {
      this.step(dt);
      if (this.s.t >= this.nextHist) this.record();
    }
    this.stillTime = this.isMoving() ? 0 : this.stillTime + seconds;
  }

  isMoving() {
    const s = this.s;
    return Math.abs(s.QT) > FLOW_EPS || s.QR > FLOW_EPS || Math.abs(s.w) > SPIN_EPS;
  }

  /** Lift the weight and pour the water back up by hand, and book the work that takes. */
  windUp() {
    // The machine starts pre-charged for free, so "what you got back for your work"
    // only counts electricity generated after the first wind-up.
    if (this.cycles === 0) this.generatedBeforeWindUp = this.ledger.generated;
    const before = this.storedEnergy();
    Object.assign(this.s, { VB: this.init.VB, VLB: this.init.VLB, VLA: 0, QT: 0, QR: 0, w: 0, vP: 0 });
    this.ledger.input += this.storedEnergy() - before;
    this.cycles += 1;
    this.stillTime = 0;
  }

  energySummary() {
    const lg = this.ledger;
    const released = this.E0 + lg.input - this.storedEnergy();
    const losses = {
      pipe: lg.pipe,
      valves: lg.valves,
      leakage: lg.leakage,
      jet: lg.jet,
      bearing: lg.bearing,
      seal: lg.seal,
      splash: lg.splash,
      transient: lg.transient,
    };
    const lost = Object.values(losses).reduce((a, b) => a + b, 0);
    return {
      released,
      input: lg.input,
      generated: lg.generated,
      generatedSinceWindUp: this.cycles ? lg.generated - this.generatedBeforeWindUp : 0,
      losses,
      lost,
      error: released - lg.generated - lost,
    };
  }

  record() {
    const s = this.s;
    const e = this.energySummary();
    this.history.push({
      t: s.t,
      flowTurbine: s.QT * 60000,
      flowReturn: s.QR * 60000,
      power: this.cGen * s.w * s.w,
      released: e.released,
      generated: e.generated,
    });
    if (this.history.length > 2400) {
      this.history = this.history.filter((_, i) => i % 2 === 0);
      this.histEvery *= 2;
    }
    this.nextHist = s.t + this.histEvery;
  }

  /** Everything the UI and the 3D scene need for one frame. */
  readouts() {
    const s = this.s;
    const L = this.layout;
    const p = this.params;
    const hB = s.VB / this.AB;
    const hLB = s.VLB / this.AL;
    const hLA = s.VLA / this.AL;
    const yP = L.yF + hLB;
    const zBs = L.zBb + hB;
    const pA = this.pAir(s.VB) - P_ATM;
    const weightPressure = (p.pistonMass * G) / this.AL;
    const pushAvailable = weightPressure + (RHO * G * s.VLA) / this.AL + RHO * G * (yP - L.intakeY);
    const pushNeeded = RHO * G * (L.zPeak - L.intakeY) + pA + this.pCrack;
    // Pressure at the air-release tube (near the turbine inlet) → water level in it.
    const pTap = pA + RHO * G * (zBs - L.tapY) - (0.5 * RHO * this.kTpipe * s.QT * Math.abs(s.QT)) / (2 * this.AT * this.AT);
    return {
      t: s.t,
      machine: p.machine,
      onto: this.pelton || p.discharge !== 'under',
      sealed: p.lid === 'sealed',
      flowTurbine: s.QT * 60000, // L/min
      flowReturn: s.QR * 60000,
      rpm: (s.w * 60) / (2 * Math.PI),
      theta: s.theta,
      power: this.cGen * s.w * s.w, // W
      pAirGauge: pA, // Pa
      hB, hLB, hLA, yP, zBs,
      zLAs: yP + L.tP + hLA,
      waterVessel: s.VB * 1000, // L
      waterUnder: s.VLB * 1000,
      waterOnTop: s.VLA * 1000,
      weightPressure,
      pushAvailable,
      pushNeeded,
      atStops: s.VLB <= this.Vstop + 1e-8,
      vesselEmpty: s.VB < 2e-5,
      // the Pelton casing is vented, so its tube is just an air vent
      piezoLevel: this.pelton ? 0 : Math.min(L.ventLength, Math.max(0, pTap / (RHO * G))),
      jetSpeed: this.pelton ? s.QT / this.AN : 0, // m/s
      moving: this.isMoving(),
      stillTime: this.stillTime,
      cycles: this.cycles,
      energy: this.energySummary(),
    };
  }
}
