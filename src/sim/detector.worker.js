// Runs ArUco detection off the main thread so rendering and physics keep real time.
import { createMarkerDetector } from '../utils/markerDetector.js';

let detector = null;
self.onmessage = ({ data }) => {
  const { image, family, minPerimeterFraction, simTime, seq } = data;
  detector ??= createMarkerDetector(family, { minPerimeterFraction });
  const t0 = performance.now();
  const markers = detector.detect(image).map((m) => ({ id: m.id, corners: m.corners.map(({ x, y }) => ({ x, y })) }));
  self.postMessage({ markers, ms: performance.now() - t0, simTime, seq });
};
