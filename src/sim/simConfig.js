// Simulation constants. Units: metres, seconds, radians unless the name says otherwise.
// World frame (top-down): +x east, +y north, heading measured counter-clockwise from +x.
// three.js maps world (x, y) to scene (x, 0, -y) with +Y up.

export const MARKER_FAMILY = '5x5_100';

export const MARKERS = {
  station: { id: 0, size: 0.15 },
  robot: { id: 1, size: 0.14 },
  medicine: { id: 2, size: 0.1 },
};

export const ARENA = { width: 3.2, depth: 2.6 }; // floor rectangle centred on the origin

export const ROBOT = {
  wheelRadius: 0.06,
  wheelWidth: 0.03,
  body: { depth: 0.2, width: 0.24, height: 0.22, clearance: 0.04 }, // clearance = floor to body bottom
  medicine: { depth: 0.13, width: 0.14, height: 0.08, liftFromFloor: 0.18, gap: 0.006 }, // top flush with the body so neither marker hides the other
  maxSpeed: 0.35, // m/s
  accel: 0.8, // m/s^2
  brake: 1.4, // m/s^2
  maxTurnRate: (120 * Math.PI) / 180, // rad/s
  turnAccel: (480 * Math.PI) / 180, // rad/s^2
  turnStep: Math.PI / 2,
  turnSettle: (0.05 * Math.PI) / 180,
};
ROBOT.track = ROBOT.body.width + ROBOT.wheelWidth; // wheel centre to wheel centre

export const STATION = {
  depth: 0.36, width: 0.4, height: 0.12, // low front section: the docked robot's medicine box overhangs it
  tower: { depth: 0.2, height: 0.3 }, // raised back section carrying the marker, taller than the robot so a docked robot cannot hide it
  pad: { length: 0.36, width: 0.34 }, // floor plate in front of the station
  dockDepthTolerance: 0.03, // body front must be within this of the contact face
  dockLateralTolerance: 0.05,
  dockHeadingTolerance: (10 * Math.PI) / 180,
  chargeDelay: 0.8, // s from stable contact to CHG/STAT asserting
};

export const BATTERY = { full: 12.6, empty: 10.8, start: 12.1, drainPerMetre: 0.02, idleDrainPerSec: 0.0005, chargePerSec: 0.01 };

export const INITIAL_POSES = {
  robot: { x: -0.9, y: -0.3, heading: 0 },
  station: { x: 1.15, y: 0.55, heading: Math.PI }, // heading = direction its contact face points
};

export const PHYSICS_HZ = 120;
export const TELEMETRY_HZ = 1; // §5.2: robot reports charging status and tilt at 1 Hz
export const DETECTION_HZ = 10;
