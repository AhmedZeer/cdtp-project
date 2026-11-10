// Evaluation tasks and thresholds. Values tagged "spec" come from the project document
// (YTU EEF MDP, Two-Wheeled Indoor Patient Assistance Robot, v14); everything else is an
// engineering threshold of this app and is labelled as such in reports.

export const SPEC = {
  durationToleranceS: 2, // §5.2 measured duration ±2 s
  staticBalanceS: 30, // §5.2 Static Balance: remain balanced for 30 s
  guidanceMinM: 0.8, guidanceMaxM: 1.2, // §5.2 Robot Guidance distance range
  chargeDeadlineS: 5, // §4.3 / §5.2 charging must start within 5 s of docking
  linkMaxGapS: 2, // §5.2 connection must not be interrupted for more than 2 s
  telemetryHz: 1, // §5.2 charging status and tilt at 1 Hz
  initialBalanceS: 5, // §5.3 robot waits balanced for 5 s
  deliveryWaitS: 5, // §8 C5 waits for 5 s without dropping the box
  guidanceStopS: 3, // §8 C1 move ~1 m and stop for 3 s
  indicatorOffS: 2, // §4.3 / C3.4 indicator off within 2 s of pulling the robot away
  indicatorOnS: 5, // §4.3 / C3.4 indicator on again within 5 s of returning it
};

export const ENGINEERING = {
  stationaryM: 0.05, // max drift from the start of a window that still counts as "not moving"
  directionToleranceDeg: 20, // displacement must lie within this of the commanded axis
  turnChangeDeg: 60, // heading change that counts as "changed direction" in the integrated task
  minTurnLegM: 0.5, // minimum travel before a stop can count as the delivery point
  fallenTiltDeg: 45, // |tilt| at or beyond this means the robot fell
  recoveringTiltDeg: 5, // |tilt| at or beyond this while not driving = rebalancing
  boxLossS: 0.5, // box seen off the robot for this long = dropped
  maxTrackingGapS: 1, // longer camera dropouts make required observations unavailable
  dock: { frontGapM: 0.04, lateralM: 0.05, headingDeg: 10, holdS: 0.5 }, // camera-side docking test (sim dock: 3 cm / 5 cm / 10°)
  timeLimitS: 180, // cap for tasks the document does not time-limit
  handoverS: 0.5, // time the robot may take to notice the approach region and take over from the glove
  moveSpeed: 0.05, // m/s: faster than this = moving
  turnRateDeg: 15, // °/s: faster than this = turning
};

export const TASKS = [
  { id: 'static-balance', name: 'Static Balance', module: 'A', rubric: 'C1.1',
    summary: 'Stay balanced in place for 30 s (±2 s) with the medicine box on board. Ends automatically at 30 s.' },
  { id: 'robot-guidance', name: 'Robot Guidance', module: 'B', rubric: 'C1.2–3 / C2',
    summary: 'Drive 0.8–1.2 m in the chosen direction with glove commands, then stop. Ends automatically after a 3 s stop.' },
  { id: 'charging', name: 'Charging', module: 'C', rubric: 'C3',
    summary: 'Start inside the approach region; the robot docks on its own and charging must start within 5 s of docking. Ends once charging is reported.' },
  { id: 'charging-indicator', name: 'Charging indicator', module: 'C', rubric: 'C3.4',
    summary: 'Start docked and charging. Pull the robot away by hand: charging must go off within 2 s. Put it back: charging must resume within 5 s. Ends shortly after charging resumes.' },
  { id: 'integrated', name: 'Integrated Task', module: 'E', rubric: 'C5',
    summary: 'Wait balanced 5 s → drive ~1 m and change direction with glove commands → wait 5 s keeping the box → reach the approach region → dock autonomously → charging starts. Ends once charging is reported.' },
];

export const taskById = (id) => TASKS.find((t) => t.id === id);
