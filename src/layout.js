// Geometry of the screw-turbine apparatus (reference image 8A.jpg), in metres.
// Shared by the physics (heights, pipe lengths) and the 3D scene (meshes), so
// what you see is exactly what is simulated. y is up, x to the right, z toward the viewer.

export const BASE_TOP = 0.02;
export const PISTON_THICKNESS = 0.05;
export const PISTON_STOP = 0.045; // stop ring: the weight can't go lower than this above the floor
const HOUSING_RADIUS = 0.055;
const HOUSING_LENGTH = 0.34;
const VENT_LENGTH = 0.32;

export function computeLayout(p) {
  const RL = p.ltDiameter / 2;
  const RB = p.bvDiameter / 2;
  const rT = p.turbinePipeDia / 2000;
  const rR = p.returnPipeDia / 2000;

  // Lower tank: centred at xL, open top.
  const xL = -0.36;
  const yF = BASE_TOP + 0.012; // inside floor (glass bottom sits on the base)
  const yLtop = yF + p.ltHeight;

  // Screw turbine: horizontal axis just above the lower tank's rim.
  const yT = yLtop + 0.1;
  const rH = HOUSING_RADIUS;
  const xs = xL + RL * 0.5; // spout x, off-centre so it clears the riser
  const xT0 = xs + 0.045; // housing left end
  const xT1 = xT0 + HOUSING_LENGTH; // housing right end (gear side)
  const zOut = yLtop + 0.03; // spout outlet height (free fall into the tank)

  // Big vessel: to the right, its outlet feeding the turbine's top near the gear end.
  const xB = xT1 + 0.1;
  const yH = yT + rH + 0.07; // horizontal feed pipe height
  const zBbMin = yH + 0.1;
  const zBb = Math.max(p.bvElevation, zBbMin);
  const funnelH = 0.06;
  const zBtop = zBb + p.bvHeight;
  const xIn = xT1 - 0.06; // feed enters housing top here

  // Return pipe: up from the lower tank, over the top, down into the big vessel.
  const zPeak = zBtop + 0.07;
  const xRin = xB - RB * 0.45;
  const zIn = zBtop - 0.04;
  const valveY = yLtop + 0.13;
  const intakeY = yF + 0.012;

  // Air-release (bubble) tube on the housing; acts as a piezometer.
  const tapX = xT0 + 0.1;
  const tapY = yT + rH;

  const turbineIn = [
    [xB, zBb - funnelH, 0],
    [xB, yH, 0],
    [xIn, yH, 0],
    [xIn, yT + rH, 0],
  ];
  const turbineOut =
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
        ];
  const ret = [
    [xL, intakeY, 0],
    [xL, zPeak, 0],
    [xRin, zPeak, 0],
    [xRin, zIn, 0],
  ];

  const gearR1 = 0.042;
  const gearR2 = 0.026;
  const gearX = xT1 + 0.035;
  const genY = yT - (gearR1 + gearR2 + 0.004);

  return {
    RL, RB, rT, rR, xL, yF, yLtop, HL: p.ltHeight, tP: PISTON_THICKNESS, hStop: PISTON_STOP,
    yT, rH, xT0, xT1, xs, zOut, housingLength: HOUSING_LENGTH,
    xB, zBb, zBbMin, zBtop, HB: p.bvHeight, funnelH, xIn, yH,
    zPeak, xRin, zIn, valveY, intakeY,
    tapX, tapY, ventLength: VENT_LENGTH,
    gearR1, gearR2, gearX, genY, genX0: xT1 + 0.075, genX1: xT1 + 0.2,
    zSub: yF + 0.022, // submerged outlet height in "under" mode
    paths: { turbineIn, turbineOut, ret },
    bends: { turbine: turbineIn.length - 2 + turbineOut.length - 2, ret: ret.length - 2 },
    lengths: {
      turbine: polylineLength(turbineIn) + polylineLength(turbineOut),
      ret: polylineLength(ret),
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
