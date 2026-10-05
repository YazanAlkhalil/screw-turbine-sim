// Three.js rendering of the apparatus (screw-turbine or Pelton variant). Purely visual:
// every moving part is driven by Simulation.readouts(), nothing here is animated on its own.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BASE_TOP } from './layout.js';

const GEAR_TEETH_1 = 20;
const GEAR_TEETH_2 = 12;
const PELTON_BUCKETS = 16;
const GLASS_ORDER = 3;
const WATER_ORDER = 2;
const WALL = 0.004;

const MAT = {
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xf2f7fb, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16,
    clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide,
  }),
  water: new THREE.MeshPhysicalMaterial({
    color: 0x3f93dc, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 1.2,
  }),
  jet: new THREE.MeshPhysicalMaterial({
    color: 0x2f86d6, roughness: 0.1, transparent: true, opacity: 0.75, depthWrite: false,
  }),
  steel: new THREE.MeshStandardMaterial({ color: 0xd3d7dc, metalness: 1, roughness: 0.22 }),
  steel2: new THREE.MeshStandardMaterial({ color: 0xd3d7dc, metalness: 1, roughness: 0.22, side: THREE.DoubleSide }),
  darkSteel: new THREE.MeshStandardMaterial({ color: 0x5b6169, metalness: 0.85, roughness: 0.35 }),
  backPlate: new THREE.MeshStandardMaterial({ color: 0x9aa1a9, metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide }),
  screw: new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 1, roughness: 0.28, side: THREE.DoubleSide }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.75 }),
  balloon: new THREE.MeshStandardMaterial({ color: 0x47607a, roughness: 0.6 }),
  paint: new THREE.MeshStandardMaterial({ color: 0x4a535e, metalness: 0.4, roughness: 0.45 }),
  base: new THREE.MeshStandardMaterial({ color: 0xc4c9cf, metalness: 0.9, roughness: 0.38 }),
  floor: new THREE.MeshStandardMaterial({ color: 0xe6e9ed, roughness: 0.95 }),
  wireRed: new THREE.MeshStandardMaterial({ color: 0xb33a3a, roughness: 0.6 }),
  wireBlack: new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.6 }),
  dialGlass: new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.12, depthWrite: false, clearcoat: 1,
  }),
  needle: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.4 }),
};

// ---------------------------------------------------------------------------------------
// geometry helpers

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function roundedPath(points, radius) {
  const v = points.map(v3);
  const path = new THREE.CurvePath();
  let start = v[0].clone();
  for (let i = 1; i < v.length - 1; i++) {
    const dIn = v[i].clone().sub(v[i - 1]);
    const dOut = v[i + 1].clone().sub(v[i]);
    const r = Math.min(radius, dIn.length() / 2, dOut.length() / 2);
    const a = v[i].clone().sub(dIn.normalize().multiplyScalar(r));
    const b = v[i].clone().add(dOut.normalize().multiplyScalar(r));
    if (start.distanceTo(a) > 1e-6) path.add(new THREE.LineCurve3(start, a));
    path.add(new THREE.QuadraticBezierCurve3(a, v[i].clone(), b));
    start = b;
  }
  path.add(new THREE.LineCurve3(start, v[v.length - 1]));
  return path;
}

function tubeMesh(path, r, mat) {
  const segs = Math.max(24, Math.round(path.getLength() * 260));
  return new THREE.Mesh(new THREE.TubeGeometry(path, segs, r, 20, false), mat);
}

/** Closed ring (washer) with height h along y, base at y = 0. */
function ringGeometry(rIn, rOut, h, seg = 64) {
  const pts = [
    new THREE.Vector2(rIn, 0), new THREE.Vector2(rOut, 0),
    new THREE.Vector2(rOut, h), new THREE.Vector2(rIn, h), new THREE.Vector2(rIn, 0),
  ];
  return new THREE.LatheGeometry(pts, seg);
}

/** Cylinder of unit height with its base at y = 0 – scale.y sets the height. */
function unitColumn(r, mat, seg = 64) {
  const g = new THREE.CylinderGeometry(r, r, 1, seg);
  g.translate(0, 0.5, 0);
  return new THREE.Mesh(g, mat);
}

/** Cylinder from a to b (radius r at b, rA at a – for cones). */
function cylinderBetween(a, b, r, mat, seg = 24, rA = r) {
  const A = v3(a);
  const B = v3(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, rA, A.distanceTo(B), seg), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Y_AXIS, B.clone().sub(A).normalize());
  return m;
}

function gearGeometry(radius, teeth, thickness) {
  const shape = new THREE.Shape();
  const rRoot = radius - 0.0055;
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const pts = [
      [rRoot, a0], [rRoot, a0 + step * 0.12], [radius, a0 + step * 0.3],
      [radius, a0 + step * 0.52], [rRoot, a0 + step * 0.7],
    ];
    pts.forEach(([r, a], j) => {
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      if (i === 0 && j === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.006, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(Math.PI / 2); // gear axis along x
  return g;
}

/** Helicoid blade along the x-axis (the Archimedes screw). */
function screwGeometry(rIn, rOut, length, turns) {
  const segs = Math.round(turns * 72);
  const radial = 5;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const x = -length / 2 + u * length;
    const a = u * turns * Math.PI * 2;
    for (let j = 0; j <= radial; j++) {
      const r = rIn + ((rOut - rIn) * j) / radial;
      pos.push(x, r * Math.cos(a), r * Math.sin(a));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function helixGeometry(r, h, turns, wire) {
  const pts = [];
  const n = Math.round(turns * 24);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(r * Math.cos(a), (i / n) * h, r * Math.sin(a)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, wire, 6, false);
}

/** D-shaped outline (round top, flat bottom) of the Pelton casing, centred on the axis. */
function casingShape(R, bottom) {
  const s = new THREE.Shape();
  s.moveTo(-R, -bottom);
  s.lineTo(R, -bottom);
  s.lineTo(R, 0);
  s.absarc(0, 0, R, 0, Math.PI, false);
  s.lineTo(-R, -bottom);
  return s;
}

function niceMax(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}

function dialTexture(title, min, max, unit) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfbf9';
  g.beginPath();
  g.arc(256, 256, 250, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#3a3f46';
  g.lineWidth = 10;
  g.stroke();
  const a0 = (-225 * Math.PI) / 180; // canvas angles, clockwise from +x
  const a1 = (45 * Math.PI) / 180;
  g.lineCap = 'round';
  for (let i = 0; i <= 20; i++) {
    const a = a0 + ((a1 - a0) * i) / 20;
    const major = i % 5 === 0;
    const r0 = major ? 178 : 196;
    g.lineWidth = major ? 7 : 3;
    g.beginPath();
    g.moveTo(256 + r0 * Math.cos(a), 256 + r0 * Math.sin(a));
    g.lineTo(256 + 220 * Math.cos(a), 256 + 220 * Math.sin(a));
    g.stroke();
    if (major) {
      const val = min + ((max - min) * i) / 20;
      g.fillStyle = '#3a3f46';
      g.font = '600 34px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const label = Math.abs(val) < 1e-9 ? '0' : +val.toPrecision(3) + '';
      g.fillText(label, 256 + 140 * Math.cos(a), 256 + 140 * Math.sin(a));
    }
  }
  g.fillStyle = '#1d2228';
  g.font = '700 46px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(title, 256, 360);
  g.fillStyle = '#6b7178';
  g.font = '500 30px system-ui, sans-serif';
  g.fillText(unit, 256, 408);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A round gauge facing +z; set(value) moves the needle. */
class Dial {
  constructor(radius, title, unit, min, max) {
    this.group = new THREE.Group();
    this.title = title;
    this.unit = unit;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, 0.014, 48), MAT.steel);
    rim.rotation.x = Math.PI / 2;
    rim.position.z = -0.006;
    this.face = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ toneMapped: false }));
    this.face.position.z = 0.0012;
    const cover = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.02, 48), MAT.dialGlass);
    cover.position.z = 0.006;
    cover.renderOrder = 4;
    const needleGeo = new THREE.BoxGeometry(radius * 0.08, radius * 0.82, 0.002);
    needleGeo.translate(0, radius * 0.36, 0);
    this.needle = new THREE.Mesh(needleGeo, MAT.needle);
    this.needle.position.z = 0.003;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.09, radius * 0.09, 0.006, 16), MAT.darkSteel);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.004;
    this.group.add(rim, this.face, cover, this.needle, hub);
    this.setRange(min, max);
  }

  setRange(min, max) {
    if (this.min === min && this.max === max) return;
    this.min = min;
    this.max = max;
    this.face.material.map?.dispose();
    this.face.material.map = dialTexture(this.title, min, max, this.unit);
    this.face.material.needsUpdate = true;
  }

  set(value) {
    const f = Math.min(1, Math.max(0, (value - this.min) / (this.max - this.min)));
    this.needle.rotation.z = THREE.MathUtils.degToRad(135 - 270 * f);
  }

  dispose() {
    this.face.material.map?.dispose();
    this.face.material.dispose();
  }
}

/** Specks carried along a pipe at the simulated water velocity. */
class FlowParticles {
  constructor(path, area, spacing = 0.035, size = 0.0042) {
    this.length = path.getLength();
    this.area = area;
    this.spacing = spacing;
    this.count = Math.max(2, Math.floor(this.length / spacing));
    this.samples = path.getSpacedPoints(Math.max(20, Math.round(this.length * 120)));
    this.offset = 0;
    this.material = new THREE.MeshBasicMaterial({ color: 0x1b5fae, transparent: true, opacity: 0, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 8, 6), this.material, this.count);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.tmp = new THREE.Matrix4();
    this.place();
  }

  update(Q, dtSim) {
    const v = Q / this.area;
    // cap the step below the particle spacing so fast flows don't strobe
    const ds = Math.max(-0.45 * this.spacing, Math.min(0.45 * this.spacing, v * dtSim));
    this.offset = (this.offset + ds + this.length) % this.length;
    this.material.opacity = Math.min(0.95, Math.abs(v) / 0.03);
    this.mesh.visible = this.material.opacity > 0.02;
    if (this.mesh.visible) this.place();
  }

  place() {
    const n = this.samples.length - 1;
    for (let i = 0; i < this.count; i++) {
      const s = (i * this.spacing + this.offset) % this.length;
      const f = (s / this.length) * n;
      const k = Math.min(n - 1, Math.floor(f));
      const p = this.samples[k].clone().lerp(this.samples[k + 1], f - k);
      this.tmp.makeTranslation(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, this.tmp);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Spring-loaded one-way valve on a vertical pipe; set(open 0..1) lifts the poppet. */
class CheckValve {
  constructor(r) {
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.017, r + 0.017, 0.075, 32, 1, true), MAT.glass);
    body.renderOrder = GLASS_ORDER;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.015, r + 0.015, 0.075, 32), MAT.water);
    water.renderOrder = WATER_ORDER;
    this.group.add(body, water);
    for (const y of [-0.0375, 0.0375]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.022, r + 0.022, 0.014, 32), MAT.steel);
      c.position.y = y;
      c.castShadow = true;
      this.group.add(c);
    }
    const seat = new THREE.Mesh(ringGeometry(r, r + 0.015, 0.004, 32), MAT.brass);
    seat.position.y = -0.026;
    this.poppet = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.009, r + 0.009, 0.007, 32), MAT.brass);
    this.spring = new THREE.Mesh(helixGeometry(r + 0.004, 1, 5, 0.0012), MAT.steel);
    this.group.add(seat, this.poppet, this.spring);
  }

  set(open) {
    const py = -0.018 + open * 0.02;
    this.poppet.position.y = py;
    this.spring.position.y = py + 0.004;
    this.spring.scale.y = Math.max(0.005, 0.03 - py - 0.004);
  }
}

// ---------------------------------------------------------------------------------------

export class ApparatusScene {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f4);
    scene.fog = new THREE.Fog(0xeef1f4, 4.5, 10);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.9;
    this.scene = scene;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dde3, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1.4, 3.2, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1.4, right: 1.4, top: 2, bottom: -0.4, near: 0.5, far: 8 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), MAT.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 50);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.apparatus = null;
    this.showLabels = true;
    this.powerPeak = 0;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setLabelsVisible(on) {
    this.showLabels = on;
    this.labelRenderer.domElement.style.display = on ? '' : 'none';
  }

  /** HTML label pinned to a 3D point; `cls` (left/right/below) offsets it from the anchor. */
  label(text, pos, cls = '') {
    const div = document.createElement('div');
    div.className = 'scene-label-anchor';
    const tag = document.createElement('span');
    tag.className = `scene-label ${cls}`;
    tag.textContent = text;
    div.appendChild(tag);
    const obj = new CSS2DObject(div);
    obj.position.set(pos[0], pos[1], pos[2]);
    this.apparatus.add(obj);
    return obj;
  }

  /** Add an opaque part (casts and receives shadows). */
  add(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.apparatus.add(mesh);
    return mesh;
  }

  glass(mesh) {
    mesh.renderOrder = GLASS_ORDER;
    this.apparatus.add(mesh);
    return mesh;
  }

  waterMesh(mesh) {
    mesh.renderOrder = WATER_ORDER;
    this.apparatus.add(mesh);
    return mesh;
  }

  /** Steel pipe fitting centred on `p`, aligned with `dir`. */
  collar(p, dir, r, len = 0.026) {
    const a = v3(p).addScaledVector(dir, -len / 2);
    const b = v3(p).addScaledVector(dir, len / 2);
    return this.add(cylinderBetween(a.toArray(), b.toArray(), r + 0.008, MAT.steel, 24));
  }

  /** (Re)build every mesh from the layout. Called on reset-type parameter changes. */
  build(L, params) {
    this.dispose();
    this.apparatus = new THREE.Group();
    this.scene.add(this.apparatus);
    this.dials = [];
    this.disposables = [];
    this.particleSets = { turbine: [], ret: [] };
    this.L = L;
    this.machine = L.machine;
    this.powerPeak = 0;

    this.buildCommon(L, params);
    if (L.machine === 'pelton') this.buildPelton(L);
    else this.buildScrew(L, params);
    for (const set of Object.values(this.particleSets)) for (const p of set) this.apparatus.add(p.mesh);

    this.setLabelsVisible(this.showLabels);
    if (!this.framed) {
      this.framed = true;
      this.frame(L);
    }
  }

  /** Point the camera so the whole apparatus fits in view. */
  frame(L) {
    const top = Math.max(L.zPeak, L.zBtop + 0.12) + 0.08; // highest pipe or the vessel's lid gauge
    const width = L.baseX1 - L.baseX0 + 0.1;
    const t = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(top / t, width / (t * this.camera.aspect)) * 1.22;
    const dir = new THREE.Vector3(0.2, 0.16, 1).normalize();
    this.controls.target.set((L.baseX0 + L.baseX1) / 2, top * 0.45, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  // -------------------------------------------------------------------------------------
  // parts both machines share: base, lower tank + weight, big vessel, pipes, valves

  buildCommon(L, params) {
    const pelton = L.machine === 'pelton';
    const plate = new THREE.Mesh(new THREE.BoxGeometry(L.baseX1 - L.baseX0, BASE_TOP, 0.62), MAT.base);
    plate.position.set((L.baseX0 + L.baseX1) / 2, BASE_TOP / 2, -0.02);
    this.add(plate);

    // ---- lower water tank
    const tank = new THREE.Group();
    tank.position.set(L.xL, 0, 0);
    this.apparatus.add(tank);
    const tankWall = new THREE.Mesh(new THREE.CylinderGeometry(L.RL + WALL, L.RL + WALL, L.HL + 0.012, 72, 1, true), MAT.glass);
    tankWall.position.y = BASE_TOP + (L.HL + 0.012) / 2;
    tankWall.renderOrder = GLASS_ORDER;
    const tankFloor = new THREE.Mesh(new THREE.CylinderGeometry(L.RL + WALL, L.RL + WALL, 0.012, 72), MAT.glass);
    tankFloor.position.y = BASE_TOP + 0.006;
    tankFloor.renderOrder = GLASS_ORDER;
    tank.add(tankWall, tankFloor);
    for (const y of [BASE_TOP, L.yLtop - 0.022]) {
      const ring = new THREE.Mesh(ringGeometry(L.RL + WALL, L.RL + 0.018, 0.024), MAT.steel);
      ring.position.y = y;
      ring.castShadow = true;
      tank.add(ring);
    }
    if (pelton) {
      // closed lid; the drain from the turbine casing comes in through its centre
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(L.RL + 0.02, L.RL + 0.02, 0.016, 72), MAT.steel);
      lid.position.y = L.yLtop + 0.008;
      lid.castShadow = true;
      tank.add(lid);
    }
    const stop = new THREE.Mesh(ringGeometry(L.RL - 0.012, L.RL, 0.006), MAT.darkSteel);
    stop.position.y = L.yF + L.hStop - 0.006;
    tank.add(stop);

    this.waterUnder = unitColumn(L.RL - 0.0005, MAT.water);
    this.waterUnder.renderOrder = WATER_ORDER;
    this.waterOnTop = unitColumn(L.RL - 0.0005, MAT.water);
    this.waterOnTop.renderOrder = WATER_ORDER;
    tank.add(this.waterUnder, this.waterOnTop);

    this.piston = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(L.RL - 0.002, L.RL - 0.002, L.tP, 72), MAT.darkSteel);
    disc.position.y = L.tP / 2;
    disc.castShadow = true;
    // screw drawing: thin O-ring · Pelton drawing: fat "balloon ring" under the weight
    const ring = pelton
      ? new THREE.Mesh(new THREE.TorusGeometry(L.RL - 0.013, 0.012, 16, 72), MAT.balloon)
      : new THREE.Mesh(new THREE.TorusGeometry(L.RL - 0.005, 0.006, 12, 72), MAT.rubber);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = pelton ? 0.008 : L.tP * 0.3;
    const topRim = new THREE.Mesh(ringGeometry(L.RL - 0.012, L.RL - 0.002, 0.004), MAT.steel);
    topRim.position.y = L.tP;
    this.piston.add(disc, ring, topRim);
    tank.add(this.piston);

    // ---- big vessel
    const vessel = new THREE.Group();
    vessel.position.set(L.xB, 0, 0);
    this.apparatus.add(vessel);
    const vWall = new THREE.Mesh(new THREE.CylinderGeometry(L.RB + WALL, L.RB + WALL, L.HB, 72, 1, true), MAT.glass);
    vWall.position.y = L.zBb + L.HB / 2;
    vWall.renderOrder = GLASS_ORDER;
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(L.RB + WALL, L.rT + 0.006, L.funnelH, 72, 1, true), MAT.glass);
    funnel.position.y = L.zBb - L.funnelH / 2;
    funnel.renderOrder = GLASS_ORDER;
    const funnelWater = new THREE.Mesh(new THREE.CylinderGeometry(L.RB, L.rT + 0.002, L.funnelH, 72), MAT.water);
    funnelWater.position.y = funnel.position.y;
    funnelWater.renderOrder = WATER_ORDER;
    vessel.add(vWall, funnel, funnelWater);
    for (const y of [L.zBb - 0.006, L.zBtop - 0.03]) {
      const r = new THREE.Mesh(ringGeometry(L.RB + WALL, L.RB + 0.02, 0.03), MAT.steel);
      r.position.y = y;
      r.castShadow = true;
      vessel.add(r);
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(L.RB + 0.022, L.RB + 0.022, 0.018, 72), MAT.steel);
    lid.position.y = L.zBtop + 0.009;
    lid.castShadow = true;
    vessel.add(lid);
    const collarOut = new THREE.Mesh(new THREE.CylinderGeometry(L.rT + 0.012, L.rT + 0.012, 0.03, 24), MAT.steel);
    collarOut.position.y = L.zBb - L.funnelH - 0.012;
    vessel.add(collarOut);
    this.vesselWater = unitColumn(L.RB - 0.0005, MAT.water);
    this.vesselWater.renderOrder = WATER_ORDER;
    vessel.add(this.vesselWater);
    const lidX = pelton ? 0 : L.RB * 0.45; // keep clear of the screw version's return inlet
    if (params.lid === 'sealed') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 12), MAT.steel);
      stem.position.set(lidX, L.zBtop + 0.04, 0);
      vessel.add(stem);
      this.airDial = new Dial(0.04, 'AIR', 'kPa', -20, 20);
      this.airDial.group.position.set(lidX, L.zBtop + 0.1, 0);
      vessel.add(this.airDial.group);
      this.dials.push(this.airDial);
    } else {
      this.airDial = null;
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 16, 1, true), MAT.steel);
      vent.position.set(lidX, L.zBtop + 0.04, 0);
      const ventCap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20), MAT.steel);
      ventCap.position.set(lidX, L.zBtop + 0.075, 0);
      vessel.add(vent, ventCap);
    }

    // ---- pipes (glass with a water core)
    this.paths = {};
    for (const key of ['turbineIn', 'turbineOut', 'ret']) {
      const r = key === 'ret' ? L.rR : L.rT;
      const path = roundedPath(L.paths[key], Math.max(0.03, r * 2.5));
      this.paths[key] = path;
      this.waterMesh(tubeMesh(path, r, MAT.water));
      this.glass(tubeMesh(path, r + 0.003, MAT.glass));
    }

    // one-way valves on the return pipe
    this.valves = L.valves.map(({ x, y }) => {
      const v = new CheckValve(L.rR);
      v.group.position.set(x, y, 0);
      this.apparatus.add(v.group);
      return v;
    });

    // falling water: turbine → weight, return inlet → vessel
    this.jetSpout = this.waterMesh(unitColumn(L.rT * 0.8, MAT.jet, 20));
    this.jetReturn = this.waterMesh(unitColumn(L.rR * 0.8, MAT.jet, 20));

    this.particleSets.ret.push(new FlowParticles(this.paths.ret, Math.PI * L.rR ** 2, 0.035, 0.0036));

    this.label('Big vessel', [L.xB + L.RB + 0.03, L.zBtop - 0.05, 0], 'right');
    this.label('Lower water tank', [L.xL - L.RL - 0.03, L.yF + L.HL * 0.75, 0], 'left');
    this.weightLabel = this.label(`Water pressure weight · ${params.pistonMass} kg`, [L.xL - L.RL - 0.03, 0, 0], 'left');
  }

  // -------------------------------------------------------------------------------------
  // screw turbine (8A.jpg)

  buildScrew(L, params) {
    // vessel support column, behind-right of the vessel
    const ang = THREE.MathUtils.degToRad(-55);
    const post = [L.xB + (L.RB + 0.06) * Math.cos(ang), (L.RB + 0.06) * Math.sin(ang)];
    const touch = [L.xB + (L.RB + 0.012) * Math.cos(ang), (L.RB + 0.012) * Math.sin(ang)];
    this.add(cylinderBetween([post[0], BASE_TOP, post[1]], [post[0], L.zBb + L.HB * 0.6, post[1]], 0.014, MAT.steel));
    for (const y of [L.zBb + 0.05, L.zBb + L.HB * 0.55]) {
      const clamp = new THREE.Mesh(new THREE.TorusGeometry(L.RB + 0.012, 0.006, 10, 72), MAT.steel);
      clamp.rotation.x = Math.PI / 2;
      clamp.position.set(L.xB, y, 0);
      this.add(clamp);
      this.add(cylinderBetween([post[0], y, post[1]], [touch[0], y, touch[1]], 0.007, MAT.steel));
    }

    // foot valve (ball in a cage) at the return pipe's intake inside the lower tank
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(L.rR + 0.006, L.rR + 0.006, 0.05, 16, 1, true), MAT.glass);
    cage.position.set(L.xL, L.intakeY + 0.02, 0);
    this.glass(cage);
    this.footBall = this.add(new THREE.Mesh(new THREE.SphereGeometry(L.rR + 0.002, 20, 14), MAT.darkSteel));
    this.footBall.position.x = L.xL;

    // housing
    const hx = (L.xT0 + L.xT1) / 2;
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(L.rH, L.rH, L.housingLength, 56, 1, true), MAT.glass);
    housing.rotation.z = Math.PI / 2;
    housing.position.set(hx, L.yT, 0);
    this.glass(housing);
    const housingWater = new THREE.Mesh(new THREE.CylinderGeometry(L.rH - 0.002, L.rH - 0.002, L.housingLength, 56), MAT.water);
    housingWater.rotation.z = Math.PI / 2;
    housingWater.position.copy(housing.position);
    this.waterMesh(housingWater);
    for (const x of [L.xT0, L.xT0 + L.housingLength / 3, L.xT0 + (2 * L.housingLength) / 3, L.xT1]) {
      const fl = new THREE.Mesh(ringGeometry(L.rH, L.rH + 0.012, 0.014, 48), MAT.steel);
      fl.rotation.z = -Math.PI / 2;
      fl.position.set(x - 0.007, L.yT, 0);
      this.add(fl);
    }
    for (const x of [L.xT0, L.xT1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(L.rH + 0.012, L.rH + 0.012, 0.01, 48), MAT.steel);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(x + (x === L.xT0 ? -0.005 : 0.005), L.yT, 0);
      this.add(cap);
    }
    this.screw = new THREE.Group();
    this.screw.position.set(hx, L.yT, 0);
    const blade = new THREE.Mesh(screwGeometry(0.009, L.rH - 0.004, L.housingLength - 0.02, 4.25), MAT.screw);
    blade.castShadow = true;
    this.screw.add(blade);
    this.apparatus.add(this.screw);
    // the shaft runs out through the right end cap, under the side inlet, to the gears
    this.add(cylinderBetween([L.xT0 + 0.005, L.yT, 0], [L.gearX + 0.012, L.yT, 0], 0.008, MAT.steel, 16));
    for (const x of [L.xT0 + 0.08, L.xT1 - 0.05]) {
      const z = -L.rH - 0.02;
      this.add(cylinderBetween([x, BASE_TOP, z], [x, L.yT, z], 0.007, MAT.steel));
      this.add(cylinderBetween([x, L.yT, z], [x, L.yT, -L.rH + 0.004], 0.006, MAT.steel));
    }

    // air-release tube (doubles as a piezometer: its water level shows the pressure)
    this.glass(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, L.ventLength, 20, 1, true), MAT.glass)).position.set(
      L.tapX, L.tapY + L.ventLength / 2, 0
    );
    this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.035, 24), MAT.steel)).position.set(
      L.tapX, L.tapY + L.ventLength + 0.017, 0
    );
    this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 20), MAT.steel)).position.set(L.tapX, L.tapY + 0.008, 0);
    this.piezo = unitColumn(0.0085, MAT.water, 20);
    this.piezo.position.set(L.tapX, L.tapY, 0);
    this.waterMesh(this.piezo);

    // gears + generator
    this.gear1 = this.add(new THREE.Mesh(gearGeometry(L.gearR1, GEAR_TEETH_1, 0.012), MAT.brass));
    this.gear1.position.set(L.gearX, L.yT, 0);
    this.gear2 = this.add(new THREE.Mesh(gearGeometry(L.gearR2, GEAR_TEETH_2, 0.012), MAT.brass));
    this.gear2.position.set(L.gearX, L.genY, 0);
    const gx0 = L.genX0;
    const gx1 = L.genX1;
    this.add(cylinderBetween([L.gearX - 0.01, L.genY, 0], [gx0, L.genY, 0], 0.006, MAT.steel));
    this.buildGenerator([gx0, L.genY, 0], [gx1, L.genY, 0]);
    const cradle = new THREE.Mesh(new THREE.BoxGeometry((gx1 - gx0) * 0.7, 0.02, 0.07), MAT.paint);
    cradle.position.set((gx0 + gx1) / 2, L.genY - 0.052, 0);
    this.add(cradle);
    for (const x of [gx0 + 0.035, gx1 - 0.035]) {
      this.add(cylinderBetween([x, BASE_TOP, 0], [x, L.genY - 0.06, 0], 0.011, MAT.steel));
    }
    this.buildPowerGauge([gx1 + 0.12, L.genY + 0.11, -0.012], [(gx0 + gx1) / 2, L.genY + 0.066, 0]);

    // fittings
    this.collar([L.xT1 + 0.013, L.yT + L.inOff, 0], X_AXIS, L.rT);
    this.collar([L.xT0 - 0.012, L.yT, 0], X_AXIS, L.rT);
    // where the turbine's outlet passes through the tank's side wall
    const out = L.paths.turbineOut;
    const inDir = v3(out.at(-1)).sub(v3(out.at(-2))).normalize();
    this.collar(v3(out.at(-1)).addScaledVector(inDir, -0.016).toArray(), inDir, L.rT, 0.02);
    this.collar([L.xRin, L.zBtop + 0.03, 0], Y_AXIS, L.rR);
    this.collar([L.xL, L.yLtop + 0.05, 0], Y_AXIS, L.rR);

    // flow particles: feed pipe → along the screw → spout
    const AT = Math.PI * L.rT ** 2;
    const inside = roundedPath(
      [[L.xT1 - 0.005, L.yT + L.inOff, 0.012], [L.xT1 - 0.04, L.yT - L.rH * 0.55, 0.012], [L.xT0 + 0.01, L.yT - L.rH * 0.55, 0.012]],
      0.02
    );
    this.particleSets.turbine.push(
      new FlowParticles(this.paths.turbineIn, AT),
      new FlowParticles(inside, Math.PI * L.rH ** 2 * 0.5, 0.03, 0.004),
      new FlowParticles(this.paths.turbineOut, AT)
    );

    this.label('Screw turbine', [(L.xT0 + L.xT1) / 2 - 0.02, L.yT - L.rH - 0.03, 0.06], 'below');
    this.label('Generator', [L.genX1 - 0.02, L.genY - 0.07, 0.05], 'below');
    this.label('Power', [gx1 + 0.12, L.genY + 0.19, 0]);
    this.label('Release bubble air', [L.tapX, L.tapY + L.ventLength + 0.07, 0]);
    this.label('One-way valve', [L.xL - L.rR - 0.04, L.valves[0].y, 0], 'left');
    this.label('Return pipe', [(L.xL + L.xRin) / 2, L.zPeak + 0.045, 0]);
    if (params.discharge === 'under') this.label('Discharge under the weight', [L.xWall + 0.06, L.yF + 0.06, 0.04], 'right small');
  }

  // -------------------------------------------------------------------------------------
  // Pelton wheel (1ojpg.jpg)

  buildPelton(L) {
    const { xP, yA, Rc, rPitch, casingDepth: dep, casingBottom } = L;

    // tripod under the big vessel
    const ringY = L.zBb - 0.01;
    const legRing = new THREE.Mesh(new THREE.TorusGeometry(L.RB + 0.012, 0.008, 10, 72), MAT.steel);
    legRing.rotation.x = Math.PI / 2;
    legRing.position.set(L.xB, ringY, 0);
    this.add(legRing);
    for (const deg of [90, 210, 330]) {
      const a = THREE.MathUtils.degToRad(deg);
      const top = [L.xB + (L.RB + 0.012) * Math.cos(a), ringY, (L.RB + 0.012) * Math.sin(a)];
      const foot = [L.xB + (L.RB + 0.13) * Math.cos(a), BASE_TOP, (L.RB + 0.13) * Math.sin(a)];
      this.add(cylinderBetween(foot, top, 0.011, MAT.steel));
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 20), MAT.steel);
      pad.position.set(foot[0], BASE_TOP + 0.004, foot[2]);
      this.add(pad);
    }

    // casing: glass front/back faces, steel rim, a darker plate behind the wheel
    const caseGeo = new THREE.ExtrudeGeometry(casingShape(Rc, casingBottom), { depth: dep, bevelEnabled: false, curveSegments: 48 });
    caseGeo.translate(0, 0, -dep / 2);
    const casing = new THREE.Mesh(caseGeo, [MAT.glass, MAT.steel2]);
    casing.position.set(xP, yA, 0);
    this.glass(casing);
    const back = new THREE.Mesh(new THREE.ShapeGeometry(casingShape(Rc - 0.002, casingBottom - 0.002), 48), MAT.backPlate);
    back.position.set(xP, yA, -dep / 2 + 0.003);
    this.add(back);
    // a little water collects in the casing's flat bottom before it drains
    const pool = new THREE.Mesh(new THREE.BoxGeometry(2 * Rc - 0.006, 0.012, dep - 0.008), MAT.water);
    pool.position.set(xP, yA - casingBottom + 0.007, 0);
    this.waterMesh(pool);
    this.add(cylinderBetween([xP, BASE_TOP, -0.04], [xP, yA - casingBottom, -0.04], 0.012, MAT.steel));

    // runner: disc + buckets (pairs of cups; the splitter between them meets the jet)
    this.wheel = new THREE.Group();
    this.wheel.position.set(xP, yA, 0);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rPitch - 0.012, rPitch - 0.012, 0.008, 48), MAT.steel);
    disc.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 24), MAT.darkSteel);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(disc, hub);
    const cupGeo = new THREE.SphereGeometry(0.013, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    cupGeo.scale(1, 0.75, 0.75);
    this.disposables.push(cupGeo);
    for (let i = 0; i < PELTON_BUCKETS; i++) {
      const phi = (i / PELTON_BUCKETS) * Math.PI * 2;
      // the cup's open side (local −y) faces the oncoming jet, i.e. against the clockwise motion
      for (const dz of [-0.0095, 0.0095]) {
        const cup = new THREE.Mesh(cupGeo, MAT.steel2);
        cup.position.set(rPitch * Math.cos(phi), rPitch * Math.sin(phi), dz);
        cup.rotation.z = phi + Math.PI;
        cup.castShadow = true;
        this.wheel.add(cup);
      }
    }
    this.apparatus.add(this.wheel);

    // nozzle + jet
    this.nozzleR = Math.max(0.004, L.rT * 0.45);
    this.add(cylinderBetween([xP + Rc, L.zNozzle, 0], [L.nozzleTipX, L.zNozzle, 0], this.nozzleR + 0.003, MAT.steel, 24, L.rT + 0.004));
    this.peltonJet = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), MAT.jet);
    this.peltonJet.rotation.z = Math.PI / 2;
    this.waterMesh(this.peltonJet);

    // air vent on top of the casing (a Pelton casing has to stay at air pressure)
    this.glass(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, L.ventLength, 20, 1, true), MAT.glass)).position.set(
      L.tapX, L.tapY + L.ventLength / 2, 0
    );
    this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 20), MAT.steel)).position.set(L.tapX, L.tapY + 0.008, 0);
    this.add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 14), MAT.steel)).position.set(L.tapX, L.tapY + L.ventLength + 0.02, 0);

    // shaft through the back of the casing to the generator behind it
    this.add(cylinderBetween([xP, yA, 0.012], [xP, yA, L.genZ0], 0.007, MAT.steel, 16));
    this.buildGenerator([xP, yA, L.genZ0], [xP, yA, L.genZ1]);
    const gz = (L.genZ0 + L.genZ1) / 2;
    this.add(cylinderBetween([xP, BASE_TOP, gz], [xP, yA - 0.05, gz], 0.012, MAT.steel));
    // wires drop down behind the casing and run along the base to the meter
    const [mx, , mz] = L.gauge;
    this.buildPowerGauge(L.gauge, [xP, yA + 0.066, gz], [
      [xP + 0.06, yA + 0.02, gz],
      [xP + 0.06, BASE_TOP + 0.04, gz],
      [mx + 0.02, BASE_TOP + 0.03, mz - 0.03],
      [mx + 0.005, L.gauge[1] - 0.15, mz - 0.025],
    ]);

    // fittings
    this.collar([xP - Rc - 0.012, L.yDrain, 0], X_AXIS, L.rT);
    this.collar([L.xL, L.yLtop + 0.03, 0], Y_AXIS, L.rT);
    this.collar([L.xL + L.RL + 0.012, L.intakeY, 0], X_AXIS, L.rR);
    this.collar([L.xB + L.RB + 0.014, L.zPeak, 0], X_AXIS, L.rR);

    // flow particles: feed → (jet) → falls inside the casing → drain
    const AT = Math.PI * L.rT ** 2;
    const zf = dep / 2 - 0.012;
    const fall = roundedPath(
      [[xP - 0.01, L.zNozzle, zf], [xP - Rc * 0.55, yA - casingBottom + 0.02, zf], [xP - Rc + 0.01, L.yDrain, zf]],
      0.03
    );
    this.particleSets.turbine.push(
      new FlowParticles(this.paths.turbineIn, AT),
      new FlowParticles(fall, AT, 0.03, 0.004),
      new FlowParticles(this.paths.turbineOut, AT)
    );

    this.label('Pelton turbine', [xP - 0.02, yA + Rc + 0.03, 0.05], 'left');
    this.label('Release bubble air', [L.tapX + 0.03, L.tapY + L.ventLength + 0.02, 0], 'right');
    this.label('Generator', [xP + 0.06, yA + 0.08, L.genZ1], 'right');
    this.label('Power', [L.gauge[0], L.gauge[1] + 0.08, L.gauge[2]]);
    this.label('Nozzle', [(xP + Rc + L.xB) / 2, L.zNozzle - 0.035, 0], 'below');
    this.label('One-way valves', [L.xR + 0.04, (L.valves[0].y + L.valves[1].y) / 2, 0], 'right');
    this.label('Return pipe', [(L.xL + L.xR) / 2 + 0.1, L.intakeY + 0.05, 0.05]);
  }

  /** Generator body between two points on its axis, plus a status lamp on top. */
  buildGenerator(a, b) {
    const A = v3(a);
    const B = v3(b);
    const axis = B.clone().sub(A);
    const len = axis.length();
    axis.normalize();
    const at = (p, d) => p.clone().addScaledVector(axis, d).toArray();
    this.add(cylinderBetween(a, b, 0.045, MAT.paint, 40));
    for (let i = 0; i < 7; i++) {
      const c = A.clone().addScaledVector(axis, 0.02 + (i * (len - 0.04)) / 6);
      this.add(cylinderBetween(at(c, -0.002), at(c, 0.002), 0.05, MAT.paint, 40));
    }
    this.add(cylinderBetween(at(A, 0.008), at(A, -0.006), 0.047, MAT.steel, 40));
    this.add(cylinderBetween(at(B, -0.006), at(B, 0.008), 0.047, MAT.steel, 40));
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.04), MAT.darkSteel);
    box.position.set(mid.x, mid.y + 0.055, mid.z);
    box.quaternion.setFromUnitVectors(X_AXIS, axis);
    this.add(box);
    this.lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.009, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffb21e, emissiveIntensity: 0 })
    );
    this.lamp.position.set(mid.x, mid.y + 0.072, mid.z).addScaledVector(axis, 0.012);
    this.apparatus.add(this.lamp);
  }

  /** Power meter on a post at `pos`, wired from `from` (top of the generator) via optional `via` points. */
  buildPowerGauge(pos, from, via = null) {
    const [gx, gy, gz] = pos;
    this.add(cylinderBetween([gx, BASE_TOP, gz - 0.018], [gx, gy, gz - 0.018], 0.008, MAT.steel));
    this.powerDial = new Dial(0.055, 'POWER', 'W', 0, 1);
    this.powerDial.group.position.set(gx, gy, gz);
    this.apparatus.add(this.powerDial.group);
    this.dials.push(this.powerDial);
    [MAT.wireRed, MAT.wireBlack].forEach((m, i) => {
      const dz = (i - 0.5) * 0.012;
      const mid = via ?? [[from[0] + (gx - from[0]) * 0.3, from[1] + 0.05, from[2] + (gz - from[2]) * 0.3]];
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(from[0], from[1], from[2] + dz),
        ...mid.map(([x, y, z]) => new THREE.Vector3(x, y, z + dz)),
        new THREE.Vector3(gx - 0.02, gy + 0.02, gz - 0.02 + dz),
        new THREE.Vector3(gx, gy, gz - 0.022 + dz),
      ]);
      this.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.0025, 8, false), m));
    });
  }

  // -------------------------------------------------------------------------------------

  /** Move every part to match the physics state. dtSim = simulated seconds since last frame. */
  update(r, dtSim) {
    const L = this.L;
    const MIN = 1e-4;
    this.waterUnder.position.y = L.yF;
    this.waterUnder.scale.y = Math.max(MIN, r.hLB);
    this.piston.position.y = r.yP;
    this.waterOnTop.position.y = r.yP + L.tP;
    this.waterOnTop.scale.y = Math.max(MIN, r.hLA);
    this.waterOnTop.visible = r.hLA > 0.0005;
    this.vesselWater.position.y = L.zBb;
    this.vesselWater.scale.y = Math.max(MIN, r.hB);
    this.vesselWater.visible = r.hB > 0.0005;
    this.weightLabel.position.y = r.yP + L.tP / 2;

    // power meter auto-ranges upward so the needle never pins
    this.powerPeak = Math.max(this.powerPeak, r.power);
    this.powerDial.setRange(0, niceMax(Math.max(0.5, this.powerPeak * 1.15)));
    this.powerDial.set(r.power);
    this.lamp.material.emissiveIntensity = Math.min(3, (r.power / this.powerDial.max) * 4);
    if (this.airDial) this.airDial.set(r.pAirGauge / 1000);

    const open = Math.min(1, r.flowReturn / 4);
    for (const v of this.valves) v.set(open);

    if (this.machine === 'pelton') {
      this.wheel.rotation.z = -r.theta; // clockwise: the jet hits the bottom buckets, pushing them left
      const on = r.flowTurbine > 0.05;
      this.peltonJet.visible = on;
      if (on) {
        const len = L.nozzleTipX - L.xP;
        const rad = this.nozzleR * Math.min(1, 0.4 + 0.6 * Math.sqrt(r.flowTurbine / 8));
        this.peltonJet.scale.set(rad, len, rad);
        this.peltonJet.position.set(L.xP + len / 2, L.zNozzle, 0);
      }
    } else {
      this.screw.rotation.x = -r.theta;
      this.gear1.rotation.x = -r.theta;
      this.gear2.rotation.x = r.theta * (GEAR_TEETH_1 / GEAR_TEETH_2) + Math.PI / GEAR_TEETH_2;
      this.footBall.position.y = L.intakeY + 0.006 + open * 0.02;
      this.piezo.scale.y = Math.max(MIN, r.piezoLevel);
      this.piezo.visible = r.piezoLevel > 0.001;
    }

    // free-falling water (none once the inlet is under water)
    const spoutOn = r.onto && r.flowTurbine > 0.05 && r.zLAs < L.zOut;
    this.jetSpout.visible = spoutOn;
    if (spoutOn) {
      const w = Math.min(1, Math.sqrt(r.flowTurbine / 8));
      this.jetSpout.position.set(L.spoutX, r.zLAs, 0);
      this.jetSpout.scale.set(0.35 + 0.65 * w, Math.max(MIN, L.zOut - r.zLAs), 0.35 + 0.65 * w);
    }
    const retOn = r.flowReturn > 0.05 && r.zBs < L.zIn;
    this.jetReturn.visible = retOn;
    if (retOn) {
      const w = Math.min(1, Math.sqrt(r.flowReturn / 6));
      this.jetReturn.position.set(L.xRin, r.zBs, 0);
      this.jetReturn.scale.set(0.35 + 0.65 * w, L.zIn - r.zBs, 0.35 + 0.65 * w);
    }

    const qT = r.flowTurbine / 60000;
    const qR = r.flowReturn / 60000;
    for (const p of this.particleSets.turbine) p.update(qT, dtSim);
    for (const p of this.particleSets.ret) p.update(qR, dtSim);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.showLabels) this.labelRenderer.render(this.scene, this.camera);
  }

  dispose() {
    if (!this.apparatus) return;
    for (const set of Object.values(this.particleSets ?? {})) for (const p of set) p.dispose();
    for (const d of this.dials ?? []) d.dispose();
    for (const g of this.disposables ?? []) g.dispose();
    this.apparatus.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && !this.disposables.includes(o.geometry)) o.geometry.dispose();
      if (o.isCSS2DObject) o.element.remove();
    });
    this.lamp?.material.dispose();
    this.scene.remove(this.apparatus);
    this.apparatus = null;
  }
}
