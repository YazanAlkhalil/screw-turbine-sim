// Geometry of the two apparatus variants, in metres:
//   screw  – reference image 8A.jpg
//   pelton – reference image 1ojpg.jpg
// Shared by the physics (heights, pipe lengths) and the 3D scene (meshes), so
// what you see is exactly what is simulated. y is up, x to the right, z toward the viewer.

export const BASE_TOP = 0.02;
export const PISTON_THICKNESS = 0.05;
export const PISTON_STOP = 0.045; // stop ring: the weight can't go lower than this above the floor
const HOUSING_RADIUS = 0.055;
const HOUSING_LENGTH = 0.34;
const FUNNEL_H = 0.06;

export function computeLayout(p) {
  const RL = p.ltDiameter / 2;
  const RB = p.bvDiameter / 2;
  const common = {
    machine: p.machine,
    RL, RB,
    rT: p.turbinePipeDia / 2000,
    rR: p.returnPipeDia / 2000,
    xL: -0.36, // lower tank centre
    yF: BASE_TOP + 0.012, // inside floor of the lower tank (glass bottom sits on the base)
    HL: p.ltHeight,
    tP: PISTON_THICKNESS,
    hStop: PISTON_STOP,
    HB: p.bvHeight,
    funnelH: FUNNEL_H,
  };
  common.yLtop = common.yF + p.ltHeight;
  const L = p.machine === 'pelton' ? peltonLayout(p, common) : screwLayout(p, common);
  L.zBtop = L.zBb + L.HB;
  // The Pelton's drain is gravity-fed at air pressure, so only its feed pipe is part of the pressurised line.
  const pressurised = L.machine === 'screw' ? [L.paths.turbineIn, L.paths.turbineOut] : [L.paths.turbineIn];
  L.lengths = {
    turbine: pressurised.reduce((sum, pts) => sum + polylineLength(pts), 0),
    ret: polylineLength(L.paths.ret),
  };
  L.bends = {
    turbine: pressurised.reduce((sum, pts) => sum + pts.length - 2, 0),
    ret: L.paths.ret.length - 2,
  };
  return L;
}

function screwLayout(p, c) {
  const { RL, RB, rT, xL, yF, yLtop } = c;
  // Screw turbine: horizontal axis just above the lower tank's rim.
  const yT = yLtop + 0.1;
  const rH = HOUSING_RADIUS;
  const xs = xL + RL * 0.5; // spout x, off-centre so it clears the riser
  const xT0 = xs + 0.045; // housing left end (outlet)
  const xT1 = xT0 + HOUSING_LENGTH; // housing right end (inlet + gears)
  const zOut = yLtop + 0.03; // spout outlet height (free fall into the tank)

  // Feed enters the right end cap from the side, above the shaft (as in 8A.jpg):
  // the pipe drops from the vessel and elbows straight into the end of the housing.
  const inOff = rH - rT - 0.008;
  const xB = xT1 + 0.045;
  const zBbMin = yT + inOff + FUNNEL_H + 0.06;
  const zBb = Math.max(p.bvElevation, zBbMin);
  const zBtop = zBb + p.bvHeight;

  // Return pipe: up from inside the lower tank, over the top, down into the big vessel.
  const zPeak = zBtop + 0.07;
  const xRin = xB - RB * 0.45;
  const zIn = zBtop - 0.04;
  const intakeY = yF + 0.012;

  const gearX = xT1 + 0.085;
  const genX1 = xT1 + 0.25;
  return {
    ...c,
    yT, rH, xT0, xT1, xs, zOut, housingLength: HOUSING_LENGTH, inOff,
    xB, zBb, zBbMin,
    zPeak, xRin, zIn, intakeY,
    tapX: xT0 + 0.1,
    tapY: yT + rH,
    ventLength: 0.32,
    gearR1: 0.042, gearR2: 0.026, gearX,
    genY: yT - (0.042 + 0.026 + 0.004),
    genX0: xT1 + 0.125, genX1,
    zSub: yF + 0.022, // submerged outlet height in "under" mode
    valves: [{ x: xL, y: yLtop + 0.13 }],
    baseX0: xL - RL - 0.1,
    baseX1: Math.max(xB + RB, genX1 + 0.2) + 0.1,
    paths: {
      turbineIn: [
        [xB, zBb - FUNNEL_H, 0],
        [xB, yT + inOff, 0],
        [xT1, yT + inOff, 0],
      ],
      turbineOut:
        p.discharge === 'under'
          ? [
              [xT0, yT, 0],
              [xT0 - 0.04, yT, 0],
              [xT0 - 0.04, yT, RL + 0.045],
              [xT0 - 0.04, yF + 0.022, RL + 0.045],
              [xT0 - 0.04, yF + 0.022, RL * 0.55],
            ]
          : [
              [xT0, yT, 0],
              [xs, yT, 0],
              [xs, zOut, 0],
            ],
      ret: [
        [xL, intakeY, 0],
        [xL, zPeak, 0],
        [xRin, zPeak, 0],
        [xRin, zIn, 0],
      ],
    },
  };
}

function peltonLayout(p, c) {
  const { RL, RB, xL, yF, yLtop } = c;
  // Pelton wheel in a vented, D-shaped casing (round top, flat bottom), axis along z.
  const rPitch = p.wheelRadius;
  const Rc = rPitch + 0.04; // casing radius
  const casingDepth = 0.07;
  const casingBottom = 0.85 * Rc; // flat bottom this far below the axis
  const xP = xL + RL + 0.17;
  const yA = yLtop + casingBottom + 0.1;
  const zNozzle = yA - rPitch; // jet runs tangent to the bottom of the pitch circle, right → left
  const yDrain = yA - 0.6 * Rc;
  const zOut = yLtop - 0.01; // drain discharges through the lid onto the weight

  // Big vessel on a tripod to the right; outlet drops, then runs left to the nozzle.
  const xB = xP + Rc + 0.24;
  const zBbMin = zNozzle + FUNNEL_H + 0.08;
  const zBb = Math.max(p.bvElevation, zBbMin);
  const zBtop = zBb + p.bvHeight;

  // Return: side outlet at the bottom of the lower tank, along the base, up the far
  // right through two one-way valves, into the vessel's upper side.
  const intakeY = yF + 0.025;
  const xR = xB + RB + 0.09;
  const zPeak = zBtop - 0.06;
  const vy = (f) => intakeY + (zPeak - intakeY) * f;

  return {
    ...c,
    rPitch, Rc, casingDepth, casingBottom, xP, yA, zNozzle, yDrain, zOut,
    nozzleTipX: xP + 0.3 * Rc,
    xB, zBb, zBbMin,
    zPeak, xR, intakeY,
    xRin: xB + RB - 0.02,
    zIn: zPeak,
    tapX: xP,
    tapY: yA + Rc,
    ventLength: 0.2,
    genZ0: -casingDepth / 2 - 0.02,
    genZ1: -casingDepth / 2 - 0.15,
    gauge: [xL + RL + 0.075, yLtop * 0.62, 0.12], // low, between the tank and the casing
    valves: [{ x: xR, y: vy(0.38) }, { x: xR, y: vy(0.68) }],
    baseX0: xL - RL - 0.1,
    baseX1: xR + 0.12,
    paths: {
      turbineIn: [
        [xB, zBb - FUNNEL_H, 0],
        [xB, zNozzle, 0],
        [xP + Rc - 0.004, zNozzle, 0],
      ],
      turbineOut: [
        [xP - Rc + 0.004, yDrain, 0],
        [xL, yDrain, 0],
        [xL, yLtop + 0.005, 0],
      ],
      ret: [
        [xL + RL - 0.004, intakeY, 0],
        [xR, intakeY, 0],
        [xR, zPeak, 0],
        [xB + RB - 0.004, zPeak, 0],
      ],
    },
  };
}

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  }
  return L;
}
