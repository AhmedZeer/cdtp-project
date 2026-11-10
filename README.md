# CDTP Robot Evaluation App

A React web app for viewing a robot with a phone camera, detecting ArUco markers, displaying robot telemetry, and running scored evaluation tasks. The laptop runs the web app; open it in the phone's browser to use the phone's rear camera.

## What it does

- Shows a live camera feed and asks for the environment-facing (usually rear) camera.
- Detects ArUco markers in the browser with `js-aruco`; it does not require OpenCV.
- Displays telemetry received over WebSocket: robot link status, tilt, battery voltage, charging state, motion, direction, and estimated dock distance.
- Provides timed evaluation tasks and generates a result report with a SHA-256 digest.
- Uses a responsive layout: the camera and stats appear above the controls on a phone; on wider screens, controls sit beside the camera and stats.

## Requirements

- Node.js and npm.
- A current browser on the phone with camera access.
- The laptop and phone connected to a network that lets the phone reach the laptop. If the robot creates its own Wi-Fi network, configure the laptop/phone and WebSocket connection to match that network.
- A WebSocket endpoint that sends robot telemetry. A mock endpoint is included for local development.

## Run the app

From the project folder:

```bash
npm install
npm run dev
```

Vite listens on `0.0.0.0:5173`, so it can be reached from other devices on the same network. Find the laptop's LAN IP address and open the URL shown by Vite on the phone, typically:

```text
https://<laptop-ip>:5173
```

The Vite configuration enables a self-signed HTTPS certificate. HTTPS is needed for camera access on a phone when the page is opened from another device. The phone may show a certificate warning; camera permission can also depend on the browser trusting or accepting that certificate. Grant camera permission when prompted.

The app uses the phone camera, not a camera stream from the robot. Keep the phone pointed at the robot and markers while using the app.

## 3D robot simulator

Open `https://localhost:5173/?scene=sim3d`. A three.js arena stands in for the real
room: a two-wheeled robot (box body, two wheels), a medicine box on a front tray and a
charging station with a floor pad. Each carries its own ArUco marker (OpenCV
DICT_5X5_100):

| Object | Marker ID | Black-square size |
| --- | ---: | ---: |
| Charging station (on its raised back tower) | 0 | 15 cm |
| Robot body (top) | 1 | 10 cm |
| Medicine box (top) | 2 | 10 cm |

Sizes (in `src/sim/simConfig.js`):

| Object | Size |
| --- | --- |
| Robot body | 24 cm wide × 13 cm deep × 30 cm tall, top at 34 cm; 12 cm wheels |
| Medicine box | 13 × 14 × 8 cm on a front tray, top flush with the body, so the robot with its box is about 27 cm long |
| Charging station | 28 cm wide × 35 cm deep: a 12 cm-high front section and a 40 cm-high marker tower |
| Floor pad | 22 × 32 cm in front of the station; it holds both wheels of a docked robot |

The station is as small as two constraints allow. The tower top has to hold the 15 cm
marker plus its white border (19.3 cm), and the low front section has to be longer than
the docked robot's medicine-box overhang (13.6 cm). Making it smaller would need a
smaller station marker, which makes the camera calibration less accurate.

The robot is tall and thin like a typical self-balancing robot. Its depth is set by the
10 cm robot marker, which needs a 12.9 cm square on top of the body. The tower stays
taller than the robot (40 cm vs 34 cm) so a docked robot cannot hide the station marker.

A fixed virtual **phone camera** renders the arena at 1920×1080. Three mounts are
available: tripod at the south edge, shelf in a corner, and overhead. The detector
only gets the rendered pixels. It runs in a Web Worker at up to 10 Hz. Each detected
marker gets an SVG outline in its role's colour (station blue, robot green, medicine box
red) and +X/+Y axes, drawn over the image at a fixed on-screen size. The robot's +X axis
is its forward direction. The detections table lists image pixels; the calibration panel
converts them to metres (below).

The simulator's detector refines each corner to sub-pixel accuracy
(`src/utils/cornerRefine.js`). js-aruco's own corners are whole pixels and sit inside
the true outline, by about 1–4 px depending on marker size.
That error is systematic, so it scales every distance. The refinement finds the steepest
dark-to-light step across each edge (after undoing sRGB gamma), fits a line to each edge
and intersects neighbouring lines. On the rendered frames this reduces corner error to
about 0.4 px with no inward bias. Corners are refined before the marker bits are read,
not after. With only 3–4 px per cell, the coarse corners shift the sampling grid enough
to misread small or oblique markers, and refining first fixes that. Each cell is also
read from its central 4×4 of the 8×8 warped pixels, away from blurred cell edges. It is
the detector option `refine: true`; the live camera page does not use it yet.

### Phone camera debugging placeholder

Below the simulator's drive controls, **Phone camera preview** copies the rendered
camera into a 640×360 mock preview, capped at 10 frames per second. It shows the
source resolution, measured preview rate and copied-frame count. **Pause preview**
holds the last frame; **Resume preview** continues without pausing the simulator.
The panel is labelled **Mock · debug only**, and the phone link remains **Not
connected**.

The intended integration is phone video streamed to the laptop. To replace this
placeholder, the remaining work is:

- A phone sender page with rear-camera access and an HTTPS URL reachable from the phone.
- A WebRTC video connection and signaling between phone and laptop, with connection and retry states.
- Feed received video frames into the simulator's refined `DICT_5X5_100` worker
  (station 0, robot 1, medicine box 2). The older live page at `/` uses a different detector.
- Replace simulated focal length, gravity and marker dimensions with phone calibration,
  phone sensor readings and measurements of the real marker mounts. Reset calibration
  when the camera, video orientation or resolution changes.
- Connect real telemetry and available glove-command evidence to the shared recorder
  using a common clock, then validate metric accuracy and dropout handling on hardware.

### Controls

| Key | Button | Command |
| --- | --- | --- |
| `W` / `↑` | ▲ Fwd | Forward |
| `S` / `↓` | ▼ Back | Backward |
| `A` / `←` | ⟲ 90° | Turn left 90° in place |
| `D` / `→` | 90° ⟳ | Turn right 90° in place |
| `Space` / `X` | ■ Stop | Stop |

**Hold to drive** moves while the key is held. **Glove-style** latches forward/backward
until Stop (or until the robot is blocked). This copies the glove's five discrete
commands, and a real glove adapter can later call the same `command()` entry point
(`src/sim/simController.js`). Turns accelerate and decelerate onto exactly 90°. Driving
waits until the turn has finished.

### Simulated physics and telemetry

- Kinematic differential drive: 0.35 m/s top speed with acceleration and braking limits.
  The wheels spin to match the motion.
- The body leans into acceleration (a damped spring towards atan(a/g)) and the
  telemetry reports this as tilt. This is a visual/telemetry stand-in, not a balance controller.
- The robot collides with the station and the arena walls.
- **Docking:** the body front must be within 3 cm of the station's contact face, within
  5 cm laterally and 10° of square, with the robot stopped. After 0.8 s of stable contact
  the simulated CHG/STAT line asserts. Charging telemetry and the station LED turn on,
  and both turn off as soon as the robot leaves.
- The floor shows the §4.3 approach region as a 90° sector in front of the station. Its
  30 cm radius is measured from the contact face, which is this simulator's
  interpretation of "30 cm-radius area centred on the station".
- A telemetry packet in the same `{ tilt, battery, charging }` shape as `mock-esp32.js` is
  produced at 1 Hz. It also carries `mode`, the robot's docking state, which is shown as
  *Robot mode* in the status bar.

### Autonomous docking (§4.3)

When the robot enters the approach region, its onboard controller takes over and docks
it with no human input. From then until it has docked, glove and keyboard commands are
ignored (and logged as ignored). The controller only uses what a real robot has
(`src/sim/irSensors.js`, `src/sim/autoDock.js`). It never sees the camera's view or the
true positions:

- **Station IR**, laid out like a robot-vacuum dock. A left and a right beam come from the
  centre of the contact face (±80°, 1.8 m). They overlap only within ±2° of the centre
  line. A short-range field covers exactly the approach region.
- **Robot IR:**
  - a receiver on top reports which of L, R and the field it hears;
  - a pair of receivers on the front reports the bearing to the emitter (±60°, 1.5°
    noise) and a rough range (±8%);
  - 3% of readings drop out.
- **Other robot sensors:** its gyro heading, wheel odometry, a front bumper, and the
  voltage on its charging contacts. Voltage appears only when the contacts line up,
  that is, when the robot is docked.

The controller's steps:
1. Spin until the front receivers see the emitter, then face it.
2. If only one beam is heard, turn 90° towards the centre line and drive across until both
   beams are heard, then face the emitter again.
3. Drive in, keeping the emitter ahead and nudging back towards the centre line if one
   beam drops.
4. Stop on the bumper. If the contacts show no voltage within 1 s, the robot is
   misaligned: back off 25 cm and try again (up to 4 attempts, 90 s limit).

The **Onboard IR docking** panel shows the state, the receiver readings and the attempt
count. In 200 random placements across the whole region, facing any direction, every
run docked and charged (median 17 s, worst 27 s).

**By hand** (Setup) has three actions, standing in for a person moving the robot:
- *Place in approach region:* a random pose in the region, facing any direction. Docking
  starts at once.
- *Pull away from dock* and *Put back on dock:* for the C3.4 indicator test. A robot
  that has been pulled away does not re-dock by itself until it has left the region and
  entered it again.

The *Autonomous docking* toggle turns the takeover off.

Everything runs on a simulation clock. If a device renders too slowly, the simulation
runs in slow motion rather than skipping time, and the **Sim speed** readout drops below
1×. A software-rendered headless browser runs at roughly 0.3×; a GPU machine should run
at about 1×.

The ground-truth panel and top-down mini-map show simulator state that the app would
not see in reality. They are for checking the camera-based measurements against.

Known visibility limit (a real resolution effect, kept on purpose): from the tripod, the
markers are too small to read when the robot is in the far south-east corner.

### Metric calibration

The camera is calibrated from the **station marker** alone. The station stays fixed
during evaluation (§4.3), and its marker's size (15 cm) and height above the floor are
known. When the station marker is visible, the app averages 10 detections (about 1 s),
solves the camera pose and then freezes it. From then on, the robot and medicine-box
markers are converted to metres by intersecting each corner's viewing ray with the
horizontal plane at that marker's own known height (`MARKER_MOUNTS` in
`src/sim/simConfig.js`).

Results are reported in the **station frame**: the origin is the station centre, *u*
points out of the contact face and *w* points to its left. The panel shows the robot's
position and heading, its distance to the contact face, the docking front gap, the
lateral and angle error, whether it is inside the approach region, and whether the
medicine box is still in the robot's tray (within 5 cm of where the tray holds it).
The mini-map draws the camera's measurement as a dashed purple outline over the true
robot, and *Error vs truth* compares the two.

- **Phone tilt from the accelerometer (on by default):** the phone's gravity reading
  fixes the camera's tilt, and the marker only has to provide yaw and position. This
  matters. Without it, recovering tilt from one marker about 65 px wide turns about 1 px
  of corner noise into errors of tens of centimetres. With it, simulated tests show a
  mean error of about 1–3 cm and a 1 m move measured within about ±3 cm. The simulator
  adds ±0.3° of IMU error.
- Measured live on rendered frames with sub-pixel corners, known focal length and the
  10 cm robot marker, at 8 robot poses per view: tripod 0.3–1.3 cm, corner shelf
  0.2–1.7 cm, overhead 0.2–0.5 cm. Heading error was at most 0.9°. Every pose was
  detected except one far corner from the tripod.
- **Focal length:** this defaults to the camera's known intrinsics (the simulator's
  equivalent of a phone's factory calibration). *Estimate focal length* derives it from
  the station marker instead. That only works when the marker is seen at an angle;
  the overhead view refuses with an explanation. On the tripod view it estimates within
  about 4%, which still gives position errors of about 2 cm or less.
- If the station marker drifts more than 4 px from where it was calibrated, the panel
  asks for a recalibration. Changing the camera preset recalibrates automatically.
- Known error sources (kept on purpose): the body lean shifts the robot marker by up to
  about 1 cm while it accelerates, and each calibration draws a fresh IMU error.

### Evaluation (§5.2)

The **Evaluation** panel runs the four §5.2 tasks against the camera's metric
measurements and the robot's 1 Hz telemetry. The code is in `src/eval/` and is
independent of the simulator, so the live phone page can feed it the same records.

1. Choose a task (for Robot Guidance, also the commanded direction). **Start Test**
   needs a valid calibration and locks the camera preset, calibration and robot reset
   until the test ends.
2. Under the camera, a status bar shows live: the motion state measured by the camera
   (moving / turning / static balance / recovering balance / fallen, with direction),
   tilt, charging, robot link (LOST after more than 2 s without a packet) and the test
   timer.
3. The test ends itself when the task's completion condition is met, or press
   **End Test**. Tasks the document does not time-limit stop after 180 s.

| Task | Ends automatically | Checks |
| --- | --- | --- |
| Static Balance (A) | at 30 s | 30 ± 2 s; stayed within 5 cm of the start |
| Robot Guidance (B) | after ≥ 0.5 m of travel and a 3 s stop | 0.8–1.2 m start to end; within 20° of the commanded axis; a matching command was issued |
| Charging (C) | 1 s after charging is reported at the dock | started inside the approach region; docked (camera: front gap ≤ 4 cm, lateral ≤ 5 cm, angle ≤ 10°, held 0.5 s); no operator input from start to docking; charging reported ≤ 5 s after docking |
| Charging indicator (C3.4) | 1 s after charging resumes | charging at the start; the camera sees the robot leave the dock; charging reported off ≤ 2 s later; robot back on the dock; charging reported on ≤ 5 s later |
| Integrated (E) | as Charging | waited 5 s in place; drove 0.8–1.2 m (path) with a ≥ 60° turn; held still 5 s (the delivery point); then reached the approach region, docked autonomously and started charging within 5 s |

Every task also checks: camera tracking (no gap over 1 s), the telemetry link (no
silence over 2 s), balance (no tilt of 45° or more) and that the medicine box stayed on
the robot (seen off it for 0.5 s = dropped). Each check is marked as either a
specification value or an app threshold. A run **passes** (5 points) only if every
check passes. It **fails** on any violated check, and is **inconclusive** when required
evidence is missing. The run history lists every run and adds up C5 over the latest
four integrated runs.

**Autonomy evidence:** a run fails "Autonomous docking" if, between entering the
approach region (or Start Test, for Charging) and docking, a command was acted on or
operator input was still driving the robot. A latched glove-style forward started
earlier still counts. The robot gets 0.5 s to notice the region and take over (an app
threshold). Commands it ignored because it was docking itself do not count. Driving
into the dock by hand, with *Autonomous docking* off, fails this check, as it would in
the real test.

All five tasks have passed live in the simulator, with the robot docking itself for
Charging and Integrated.

**Tamper evidence:** each finished run is sealed. That is a SHA-256 digest over the full
record (every camera frame, telemetry packet and command, with timestamps) and its
result. **Download sealed record** saves it as JSON. **Verify a saved record** recomputes
the digest and re-runs the evaluator on the stored data, so changing either the data or
the verdict shows as *ALTERED*. A video recording is not included; the timestamped
record is the §5.2 alternative.

*Simulate telemetry dropout* (Setup) stops the robot's packets so the link check can be
exercised.

Evaluation tests: `node --test tests/evaluateRun.test.js tests/motionState.test.js`.
These drive the simulator physics through scripted runs of each task, including full
runs through the controller with autonomous docking. Docking tests:
`node --test tests/autoDock.test.js`.

Physics tests: `node --test tests/simWorld.test.js`. Calibration accuracy for every
camera preset: `node --test tests/cameraCalibration.test.js`.

## Placeholder image experiment

### Draggable 2D playground

Open `https://localhost:5173/?scene=playground`. The white plane starts with
`marker1.png` as robot and `marker2.png` as station. Click-hold and drag either
marker using a mouse or touch. Select either role from the three files in
`static/placeholder/`; a file already in use by the other role is disabled.
Reset restores the defaults. Images are cropped around their detected marker and
fitted to fixed-size tiles with a white margin. There are no upload controls.

| File | Family | ID |
| --- | --- | --- |
| marker1.png | OpenCV DICT_6X6_250 | 23 |
| marker2.png | OpenCV DICT_5X5_100 | 66 |
| marker3.png | Legacy js-aruco | 3 |

The playground detector supports these families together and identifies markers
by family plus ID. Other views retain their existing detector configuration.

The renderer updates the plane while a separate detector samples its pixels up
to 10 times/sec. SVG overlays show detected outlines, centres and their connecting
line. The panel reports detected distance and station-minus-robot offsets in
1080×1080 source-image pixels, independently of the displayed canvas size.
Tile-centre distance is shown separately as a scene reference; for image crops
it is an approximate reference because the crop can offset the detected centre.
If a marker is obscured, measurements become unavailable. This is a 2D simulation;
physical camera calibration and hardware telemetry are not connected.

#### Recording and replay

Choose a task from the four names in project specification §5.2, then click
**Start task recording**. Stop manually or wait for the recording cap.

| Task | Specification requirements |
| --- | --- |
| Static Balance (A) | Remain balanced for 30 s; apply ±2 s timing tolerance. |
| Robot Guidance (B) | Correct commanded direction and 0.8–1.2 m travel. |
| Charging (C) | Autonomous docking; charging starts within 5 s after docking. |
| Integrated Task (E) | Glove-controlled delivery, 5 s wait at target with the box retained, autonomous docking and charging; C5 repeats the task four times. |

**Simulation scale** defaults to 600 pixels/metre and is frozen for the recording
and replay. It converts the plane's distances to simulated metres; it is not a
physical camera calibration. Guidance offers forward/backward relative to the
initial marker's canonical horizontal axis. Real marker-to-robot mounting alignment
must be calibrated later. Forward/backward/turning rubric subtests are not combined
into this one §5.2 guidance task: §8 C2 separately uses approximately 0.5 m and
90-degree turns, while C1 uses approximately 1 m with 3 s stops.

Static Balance records for 30 s. Other tasks have a **120 s playground recording
cap**; the document does not prescribe that total duration. Charging's 5 s deadline
is measured after an observed docking transition, not after Start Test.

The **Simulation** toggle is on by default and freezes at recording start; replay
retains that recorded mode even if the current toggle changes. Simulation evaluates
only the available visual checks:

| Task | Simulation checks |
| --- | --- |
| Static Balance | Duration and stationary marker position. |
| Robot Guidance | Scaled displacement and commanded marker-relative direction. |
| Charging | Final robot/station distance at most 0.3 m; no charging or docking claim. |
| Integrated Task | Delivery to target, 5 s wait, then arrival within 0.3 m of the station. |

Hardware/load checks appear as **skipped** and cannot prevent a simulation pass.
Missing required endpoint/hold observations, scale or heading still makes simulation inconclusive;
observed violations still fail. A simulation pass is labelled **visual checks only**.
Turn Simulation off to evaluate the full task with hardware evidence requirements.

Tracking coverage is task-specific in simulation. Charging uses the final observed
robot/station pair; earlier tracking gaps are warnings rather than automatic failure.
Static/guidance tests allow brief gaps up to 0.5 s between valid observations.
Integrated tests require covered delivery/wait observations and a final station
arrival after the wait; missing frames during transit alone do not invalidate it.
No pose is invented for missing frames and path length excludes unobserved travel.
Missing final markers still yields inconclusive. Station proximity permits an
explicit 2 px simulation measurement tolerance, and its star sits 10 px inside the
nominal boundary to avoid requiring an exact edge placement.

The result lists each check as passed, failed, unavailable or skipped. Overall results are
**failed** for an observed violation, **inconclusive** when required evidence is
missing, and **passed** only when all supplied evidence satisfies the task. The
playground currently provides geometry/heading, not verified balance, glove,
box-retention, docking or charging evidence. In full-task mode, good visual
measurements alone cannot pass the complete task. No hardware success is injected.
Future adapters can supply timestamped `frame.evidence`
(`balanced`, `loadSecure`, `gloveControlled`, `docked`, `autonomousDocking`,
`charging`) from verified observations/telemetry.

Integrated evaluation checks the delivery stage before docking, rather than
mistaking final distance at the charging station for delivery distance. Its star
registers the delivery target. The current evaluator uses a 0.2 m target-position
tolerance and 10 px hold tolerance as simulation settings, not rubric thresholds.
Each recording is one trial; aggregating the four C5 trials remains pending.

Engineering evidence thresholds remain separate from the specification: full-task
mode requires continuous recorded robot detections; simulation uses the task-specific
coverage rules above. A recording cap missed by more than 0.5 s makes results
inconclusive. Static-position drift uses a 10 px simulation
tolerance. The tracker uses a 2 px motion deadband. The final scene is sampled when
Stop is processed; task settings are frozen at Start.

The trail, path length, displacement, speed, approach/leave states and tracking-gap
count remain available. A yellow star and boundaries guide the selected task:
static start position; 1 m guidance/delivery destination; or a 30 cm station
approach radius. The charging guide does not establish the mandatory 90-degree
approach sector, successful docking or charging. Overlay graphics never enter
the detector input. Goals freeze from the first sample and are restored on replay.

Every detected marker shows its projected local coordinate frame: red **+X**,
green **+Y**, and a white centre origin. The axes follow canonical detected corner
ordering; the robot's +X is the heading used by guidance. These are 2D image-plane
axes, not a calibrated 3D pose (no Z axis). They move with detections and disappear
on tracking loss. Axes, labels and goal graphics remain outside detector pixels.

**Replay recording** renders each saved scene sample and runs detection again,
using the original sample timestamps for motion analysis. Every sample is processed
in order; a slow device may take longer than the original recording. The saved
scene inputs are separate from the original measured detections. Marker selection,
reset and dragging are disabled during replay; Stop interrupts playback. Marker
selection/reset and station dragging are also disabled during recording.

Replay evaluates fresh detections using the original task and stop metadata,
regardless of the current task selector. Interrupting replay keeps the completed
recording's original result rather than evaluating a partial replay.

Recordings are held in tab memory and disappear on refresh. This iteration does
not export or persist a dataset. Replay uses the loaded marker images from that run.
Measurements use a 2 px deadband; very slow motion can be labelled stationary.
Path length excludes unobserved gaps and approximates curves with sampled straight
segments. These are simulation measurements, not physical acceptance scores.

Run the geometry, motion/replay and synthetic pixel-detection checks with:

```bash
node --test tests/*.test.js
```

### Static image check

For a quick single-image detection check without camera access or telemetry:

1. Place the scene at `static/placeholder/2d_basic_v1.png` inside this
   project directory.
2. Run `npm run dev` and open `https://localhost:5173/?scene=placeholder`.
3. Select detected IDs as Robot and Station. The view outlines markers and reports
   their centres in source-image pixels. Roles must use different IDs.
4. After replacing the PNG, click **Reload scene** to detect again.

The placeholder view defaults to **OpenCV DICT_6X6_250**, IDs 0–249. The supplied
scene contains IDs **23** and **98**; assign their roles using the selectors.
The detector reuses js-aruco's square candidate extraction, then decodes against
the OpenCV dictionary. It currently requires exact bit matches (no error correction).
Select **Legacy js-aruco** for the older marker family. The normal camera view still
uses the legacy detector. This experiment reports
image detections only, not calibrated pose, motion or physical distance. The normal
camera app is still available at `/`. Vite serves the project's `static/` directory
as public assets, so keep only intended public files there.

## Connect telemetry

The browser connects to a WebSocket endpoint. By default, Vite proxies the app's `/ws` WebSocket path to `ws://localhost:8080`. This assumes a telemetry service is listening on the laptop at port 8080. To target a different endpoint, set `VITE_WS_URL` to the WebSocket URL before starting Vite, for example:

```text
VITE_WS_URL=wss://<host>/ws
```

Restart Vite after changing the environment variable. For an HTTPS app, use a secure WebSocket (`wss://`) endpoint unless the endpoint is proxied through the app's HTTPS origin. Browsers may block insecure WebSocket connections from an HTTPS page.

### Mock ESP32 telemetry

The included `mock-esp32.js` program runs a test WebSocket server on port 8080. In a second terminal, start it with:

```bash
node mock-esp32.js
```

The mock broadcasts a JSON packet once per second:

```json
{
  "tilt": 0.2,
  "battery": 12.4,
  "charging": false
}
```

While it is running, keyboard commands in its terminal simulate telemetry changes:

| Key | Effect |
| --- | --- |
| `c` | Toggle charging state |
| `t` | Set tilt to 12 degrees |
| `r` | Reset tilt to 0.2 degrees |
| `b` | Decrease battery by 0.5 volts |
| `Ctrl+C` | Stop the mock server |

For the real ESP32, implement or configure a WebSocket endpoint that provides the same JSON fields. The Vite proxy currently points to the laptop's `localhost:8080`; it does not automatically connect to the ESP32's Wi-Fi address. Set up a bridge/proxy or configure `VITE_WS_URL` and the network so the phone's browser can reach the real endpoint.

## ArUco marker setup

Marker detection and measurement settings are in `src/config.js`:

| Purpose | Marker ID |
| --- | ---: |
| Charging station / dock | `0` |
| Robot | `1` |

The configured printed marker side length is 10 cm. Print markers with the matching IDs and known physical size, keep them visible to the phone camera, and avoid glare or motion blur.

The stats behave as follows:

- **Robot marker visible:** the app reports motion state and direction based on changes in the marker's image position.
- **Robot and station visible:** it also estimates the distance between their image centers and shows Dock Distance.
- **No usable robot/station pair:** Dock Distance displays “Searching markers...”.
- The app does not currently draw marker boxes, labels, or highlights over the video.

The marker position and distance calculations are image-based approximations, not calibrated robot localization. Camera angle, perspective, marker size, lighting, and detection quality can affect the results. Validate measurements against the physical setup before relying on them for evaluation.

## Evaluation tasks

Choose a task in the Evaluation Console, start the test, and end it to generate a report:

| Task | Current pass condition |
| --- | --- |
| Static Balance | Test duration is at least 30 seconds |
| Robot Guidance | Tracked distance is between 0.8 m and 1.2 m |
| Charging | Charging telemetry is active when the test ends, within 5 seconds |
| Integrated Task | Tracked distance is at least 0.8 m and charging telemetry is active |

The report includes task, duration, measured distance, tilt, result, diagnostic text, timestamp, and a SHA-256 digest of the report data. The digest can help detect changes to the generated data; it is not a digital signature or proof that sensor inputs are authentic. Reports are held in the page state and are not saved to a database.

## Project structure

```text
src/
  sim/
    simConfig.js             Dimensions, marker IDs, speeds, docking tolerances
    world.js                 Pure physics: drive, 90° turns, lean, collisions, docking, battery
    simController.js         Operator commands (keyboard / buttons / future glove)
    scene3d.js               three.js arena, robot, station and camera presets
    markerTexture.js         Draws ArUco marker textures from the dictionary
    detector.worker.js       Off-thread ArUco detection
  App.jsx                    Main page layout and shared hook state
  components/
    Simulator3D.jsx          3D simulator page (?scene=sim3d)
    CameraView.jsx           Phone camera feed and processing canvas
    TelemetryHud.jsx         Robot and vision stats
    TestManager.jsx          Evaluation selection, controls, and report
    AuditReport.jsx          Report component
  hooks/
    useCameraVision.js       Camera access and ArUco detection loop
    useTelemetry.js          WebSocket telemetry and connection watchdog
  utils/
    visionMath.js            Marker geometry and motion calculations
    reportCrypto.js          SHA-256 report digest
  config.js                  WebSocket and marker/evaluation settings
mock-esp32.js                Local WebSocket telemetry simulator
vite.config.js               Vite, HTTPS, LAN host, and WebSocket proxy
```

## Useful commands

```bash
npm run dev       # Start the development server
npm run build     # Create the production build in dist/
npm run preview   # Preview the production build
npm run lint      # Run ESLint across the repository
```
