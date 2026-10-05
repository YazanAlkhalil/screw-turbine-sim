// Every adjustable parameter of the machine.
// `live: true`  → applied immediately while the simulation runs.
// `live: false` → changes stored energy or geometry, so the simulation resets
//                 (otherwise a slider could inject energy and break the ledger).

export const PARAM_GROUPS = [
  {
    id: 'weight',
    title: 'Water pressure weight (piston)',
    params: [
      { key: 'pistonMass', label: 'Weight mass', unit: 'kg', min: 0, max: 150, step: 1, value: 60, live: false,
        help: 'Heavy sealed piston resting on the water in the lower tank.' },
      { key: 'sealFriction', label: 'Seal friction', unit: 'N', min: 0, max: 100, step: 1, value: 15, live: true,
        help: 'Friction of the O-ring / balloon ring sliding on the tank wall.' },
    ],
  },
  {
    id: 'vessel',
    title: 'Big vessel (upper reservoir)',
    params: [
      { key: 'lid', label: 'Lid', type: 'choice', value: 'sealed', live: false,
        options: [
          { value: 'sealed', label: 'Sealed (air pocket → "vacuum")' },
          { value: 'vented', label: 'Vented to air' },
        ],
        help: 'Sealed reproduces the "partial vacuum / suction" described in the docs.' },
      { key: 'bvElevation', label: 'Height of vessel bottom', unit: 'm', min: 0.75, max: 1.6, step: 0.01, value: 0.88, live: false },
      { key: 'bvDiameter', label: 'Vessel diameter', unit: 'm', min: 0.12, max: 0.35, step: 0.01, value: 0.2, live: false },
      { key: 'bvHeight', label: 'Vessel height', unit: 'm', min: 0.25, max: 0.7, step: 0.01, value: 0.45, live: false },
      { key: 'bvFill', label: 'Initial fill', unit: '%', min: 0, max: 95, step: 1, value: 50, live: false },
    ],
  },
  {
    id: 'tank',
    title: 'Lower water tank',
    params: [
      { key: 'ltDiameter', label: 'Tank diameter', unit: 'm', min: 0.12, max: 0.4, step: 0.01, value: 0.2, live: false },
      { key: 'ltHeight', label: 'Tank height', unit: 'm', min: 0.3, max: 0.7, step: 0.01, value: 0.5, live: false },
      { key: 'ltDepth', label: 'Initial water under weight', unit: 'm', min: 0.05, max: 0.5, step: 0.01, value: 0.15, live: false },
      { key: 'discharge', label: 'Turbine discharges', type: 'choice', value: 'onto', live: false,
        options: [
          { value: 'onto', label: 'Onto the weight (as drawn)' },
          { value: 'under', label: 'Under the weight (piped in)' },
        ],
        help: 'As drawn, turbine water lands on top of the weight. "Under" pipes it into the pressurised water below.' },
    ],
  },
  {
    id: 'turbine',
    title: 'Screw turbine & generator',
    params: [
      { key: 'screwDisplacement', label: 'Screw displacement', unit: 'L/rev', min: 0.02, max: 0.5, step: 0.01, value: 0.08, live: true,
        help: 'Water carried per revolution of the screw.' },
      { key: 'leakage', label: 'Blade-gap leakage', unit: 'L/s per kPa', min: 0.0005, max: 0.05, step: 0.0005, value: 0.005, live: true, digits: 4 },
      { key: 'genLoad', label: 'Generator load', unit: 'mN·m per rad/s', min: 0, max: 20, step: 0.1, value: 5, live: true,
        help: 'Electrical braking torque per unit speed. 0 = generator disconnected.' },
      { key: 'bearingFriction', label: 'Bearing & gear friction', unit: 'mN·m per rad/s', min: 0, max: 2, step: 0.01, value: 0.2, live: true },
    ],
  },
  {
    id: 'pipes',
    title: 'Pipes & valves',
    params: [
      { key: 'turbinePipeDia', label: 'Turbine pipe diameter', unit: 'mm', min: 10, max: 40, step: 1, value: 20, live: false },
      { key: 'returnPipeDia', label: 'Return pipe diameter', unit: 'mm', min: 6, max: 30, step: 1, value: 12, live: false },
      { key: 'frictionFactor', label: 'Pipe friction factor', unit: '', min: 0, max: 0.06, step: 0.001, value: 0.025, live: true, digits: 3,
        help: 'Darcy friction factor. 0 = perfectly smooth (impossible in practice).' },
      { key: 'valveK', label: 'Loss per one-way valve', unit: 'K', min: 0, max: 20, step: 0.1, value: 4, live: true },
      { key: 'valveCrack', label: 'Valve opening pressure', unit: 'kPa', min: 0, max: 3, step: 0.05, value: 0.5, live: true },
    ],
  },
];

export const PARAM_LIST = PARAM_GROUPS.flatMap((g) => g.params);

export function defaultParams() {
  return Object.fromEntries(PARAM_LIST.map((p) => [p.key, p.value]));
}

export const PRESETS = [
  { id: 'default', label: 'As drawn (default)', values: {} },
  { id: 'light', label: 'Weight too light (25 kg, vented)', values: { pistonMass: 25, lid: 'vented' } },
  { id: 'vented', label: 'Vented big vessel', values: { lid: 'vented' } },
  { id: 'under', label: 'Discharge under the weight', values: { discharge: 'under' } },
  { id: 'nogen', label: 'Generator disconnected', values: { genLoad: 0 } },
  { id: 'ideal', label: 'Near-frictionless parts', values: {
    sealFriction: 0, frictionFactor: 0, valveK: 0, valveCrack: 0, leakage: 0.0005, bearingFriction: 0 } },
  { id: 'heavy', label: 'Heavy weight, tall tank', values: { pistonMass: 140, ltHeight: 0.7, ltDepth: 0.4, bvHeight: 0.6, bvFill: 20 } },
];
