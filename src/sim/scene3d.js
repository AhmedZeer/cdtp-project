// three.js view of the simulation world. Reads world state; never changes it.
import * as THREE from 'three';
import { ARENA, ROBOT, STATION, MARKERS, MARKER_FAMILY, MARKER_MOUNTS, RENDER_WIDTH, RENDER_HEIGHT, CAMERA_PRESETS } from './simConfig.js';
import { drawMarkerCanvas } from './markerTexture.js';
import { applyCameraPreset } from './cameraRig.js';
import { APPROACH_RADIUS } from './world.js';

export { RENDER_WIDTH, RENDER_HEIGHT, CAMERA_PRESETS };

const toScene = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

function markerMesh(renderer, role) {
  const { id, size } = MARKERS[role];
  const { canvas, cellsAcross, markerCells } = drawMarkerCanvas(MARKER_FAMILY, id);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  const side = (size * cellsAcross) / markerCells;
  // Unlit so lighting/shadows never reduce marker contrast. Plane lies flat, image +right = local +X.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(side, side), new THREE.MeshBasicMaterial({ map: texture }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = `marker-${role}`;
  return mesh;
}

const standard = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });
function shadowed(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

function buildFloor(scene) {
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), standard('#6b5a4a'));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.002; outer.receiveShadow = true;
  scene.add(outer);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.width, ARENA.depth), standard('#c9ccd1', { roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);
  // Faint 0.5 m reference lines (low contrast so they cannot form marker candidates).
  const pts = [];
  for (let x = -ARENA.width / 2; x <= ARENA.width / 2 + 1e-6; x += 0.5) pts.push(x, 0.001, -ARENA.depth / 2, x, 0.001, ARENA.depth / 2);
  for (let z = -ARENA.depth / 2; z <= ARENA.depth / 2 + 1e-6; z += 0.5) pts.push(-ARENA.width / 2, 0.001, z, ARENA.width / 2, 0.001, z);
  const grid = new THREE.BufferGeometry(); grid.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: '#b4b8be' })));
  // Low skirting walls.
  const wall = standard('#e8e2d6');
  for (const [w, d, x, z] of [[ARENA.width + 0.08, 0.04, 0, -ARENA.depth / 2 - 0.02], [ARENA.width + 0.08, 0.04, 0, ARENA.depth / 2 + 0.02],
    [0.04, ARENA.depth, -ARENA.width / 2 - 0.02, 0], [0.04, ARENA.depth, ARENA.width / 2 + 0.02, 0]]) {
    const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), wall)); m.position.set(x, 0.03, z); scene.add(m);
  }
}

function buildWheel() {
  const group = new THREE.Group();
  const tyre = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(ROBOT.wheelRadius, ROBOT.wheelRadius, ROBOT.wheelWidth, 40), standard('#1f2329')));
  tyre.rotation.x = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(ROBOT.wheelRadius * 0.6, ROBOT.wheelRadius * 0.6, ROBOT.wheelWidth + 0.002, 24), standard('#e3b021'));
  hub.rotation.x = Math.PI / 2;
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(ROBOT.wheelRadius * 1.15, 0.012, ROBOT.wheelWidth + 0.004), standard('#5b4a12'));
  group.add(tyre, hub, spoke);
  return group;
}

function buildRobot(renderer) {
  const { body, medicine, wheelRadius: r } = ROBOT;
  const robot = new THREE.Group(); robot.name = 'robot';
  const wheelZ = body.width / 2 + ROBOT.wheelWidth / 2 + 0.004;
  const left = buildWheel(); left.position.set(0, r, -wheelZ); // world +y (robot's left) is scene -z
  const right = buildWheel(); right.position.set(0, r, wheelZ);
  robot.add(left, right);

  // Everything above the axle leans together.
  const pivot = new THREE.Group(); pivot.position.y = r; robot.add(pivot);
  const bodyBottom = body.clearance - r;
  const shell = shadowed(new THREE.Mesh(new THREE.BoxGeometry(body.depth, body.height, body.width), standard('#f4f1ea')));
  shell.position.y = bodyBottom + body.height / 2;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(body.depth + 0.004, 0.03, body.width + 0.004), standard('#0e7490'));
  stripe.position.y = bodyBottom + body.height * 0.55;
  const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.08), standard('#111827'));
  sensor.position.set(body.depth / 2 + 0.005, bodyBottom + 0.04, 0); // IR transceiver for docking
  const robotMarker = markerMesh(renderer, 'robot'); robotMarker.position.y = bodyBottom + body.height + 0.001;

  // Medicine box on a front tray, below the body top so both markers face the camera.
  const boxX = body.depth / 2 + medicine.gap + medicine.depth / 2;
  const boxBottom = medicine.liftFromFloor - r;
  const tray = shadowed(new THREE.Mesh(new THREE.BoxGeometry(medicine.depth + medicine.gap + 0.01, 0.008, medicine.width + 0.02), standard('#64748b')));
  tray.position.set(boxX - 0.003, boxBottom - 0.004, 0);
  const box = shadowed(new THREE.Mesh(new THREE.BoxGeometry(medicine.depth, medicine.height, medicine.width), standard('#fafafa')));
  box.position.set(boxX, boxBottom + medicine.height / 2, 0); box.name = 'medicine-box';
  const band = new THREE.Mesh(new THREE.BoxGeometry(medicine.depth + 0.002, 0.018, medicine.width + 0.002), standard('#dc2626'));
  band.position.set(boxX, boxBottom + medicine.height * 0.4, 0);
  const medicineMarker = markerMesh(renderer, 'medicine');
  medicineMarker.position.set(boxX, boxBottom + medicine.height + 0.001, 0);

  pivot.add(shell, stripe, sensor, robotMarker, tray, box, band, medicineMarker);
  return { robot, pivot, left, right };
}

function buildStation(renderer) {
  const station = new THREE.Group(); station.name = 'station';
  const { depth, width, height, pad } = STATION;
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(depth, height, width), standard('#f8fafc')));
  body.position.y = height / 2;
  const contacts = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.12), standard('#b87333', { metalness: 0.7, roughness: 0.35 }));
  contacts.position.set(depth / 2 + 0.003, 0.05, 0);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(pad.length, 0.004, pad.width), standard('#3f4650'));
  plate.position.set(depth / 2 + pad.length / 2, 0.002, 0); plate.receiveShadow = true;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(pad.length, 0.005, 0.02), standard('#eab308'));
  const edge2 = edge.clone();
  edge.position.set(depth / 2 + pad.length / 2, 0.0025, pad.width / 2 - 0.01);
  edge2.position.set(depth / 2 + pad.length / 2, 0.0025, -pad.width / 2 + 0.01);
  const { tower } = STATION;
  const towerX = MARKER_MOUNTS.station.forward;
  const back = shadowed(new THREE.Mesh(new THREE.BoxGeometry(tower.depth, tower.height, width), standard('#f8fafc')));
  back.position.set(towerX, tower.height / 2, 0);
  const marker = markerMesh(renderer, 'station');
  marker.position.set(towerX, MARKER_MOUNTS.station.height, 0);
  // Charging indicator on the tower face, driven by the simulated CHG/STAT line.
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), new THREE.MeshStandardMaterial({ color: '#7f1d1d', emissive: '#7f1d1d' }));
  led.position.set(towerX + tower.depth / 2 + 0.006, tower.height - 0.04, width / 2 - 0.05);
  station.add(body, back, contacts, plate, edge, edge2, marker, led);

  // §4.3 approach region: 90° sector of 30 cm radius in front of the station (floor marking only).
  const sector = new THREE.Mesh(new THREE.CircleGeometry(APPROACH_RADIUS, 48, -Math.PI / 4, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.12, depthWrite: false }));
  sector.rotation.x = -Math.PI / 2; sector.position.y = 0.0015;
  station.add(sector);
  return { station, led };
}

export function createSimScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(RENDER_WIDTH, RENDER_HEIGHT, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2b2f36');
  scene.add(new THREE.HemisphereLight('#ffffff', '#5c5045', 1.6));
  const sun = new THREE.DirectionalLight('#fff7e8', 1.6);
  sun.position.set(-1.5, 3.5, 1.2); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5 });
  scene.add(sun);
  buildFloor(scene);

  const robotParts = buildRobot(renderer);
  const stationParts = buildStation(renderer);
  scene.add(robotParts.robot, stationParts.station);

  const camera = new THREE.PerspectiveCamera(52, RENDER_WIDTH / RENDER_HEIGHT, 0.05, 30);
  const setCameraPreset = (name) => applyCameraPreset(camera, name);
  setCameraPreset('tripod');

  function sync(world) {
    const r = world.robot;
    robotParts.robot.position.copy(toScene(r.x, r.y));
    robotParts.robot.rotation.y = r.heading;
    robotParts.pivot.rotation.z = -r.pitch;
    robotParts.left.rotation.z = -r.wheelLeft;
    robotParts.right.rotation.z = -r.wheelRight;
    const s = world.station;
    stationParts.station.position.copy(toScene(s.x, s.y));
    stationParts.station.rotation.y = s.heading;
    const ledColour = world.charging ? '#22c55e' : '#7f1d1d';
    stationParts.led.material.color.set(ledColour);
    stationParts.led.material.emissive.set(ledColour);
  }

  return {
    renderer, scene, camera, setCameraPreset, sync,
    render: () => renderer.render(scene, camera),
    dispose() {
      scene.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
      });
      renderer.dispose();
    },
  };
}
