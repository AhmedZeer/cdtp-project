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
  App.jsx                    Main page layout and shared hook state
  components/
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
