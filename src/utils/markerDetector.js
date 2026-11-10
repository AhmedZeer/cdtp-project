import aruco from 'js-aruco';
import dictionary from './aruco6x6_250.json' with { type: 'json' };
import dictionary5 from './aruco5x5_100.json' with { type: 'json' };
const { AR, CV } = aruco;

// OpenCV DICT_6X6_250 codewords (first 250 entries of DICT_6X6_1000_BYTES).
// Source: https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/aruco/predefined_dictionaries.hpp
// OpenCV is licensed under Apache-2.0: https://opencv.org/license/
// This baseline accepts exact codes only; it does not implement error correction.
const codes = dictionary.map((bytes) => bytes.map((byte, i) => byte.toString(2).padStart(i === 4 ? 4 : 8, '0')).join(''));
const codes5 = dictionary5.map((bytes) => bytes.map((byte, i) => byte.toString(2).padStart(i === 3 ? 1 : 8, '0')).join(''));

// js-aruco discards contours shorter than 20% of the image width (≈64 px marker sides at
// 1280 px). `minPerimeterFraction` lowers that so distant markers in a room-wide view qualify.
export function createMarkerDetector(family = '6x6_250', { minPerimeterFraction = 0.2 } = {}) {
  if (family === 'catalog') {
    const detectors = ['6x6_250', '5x5_100', 'legacy'].map((name) => ({ name, detector: createMarkerDetector(name, { minPerimeterFraction }) }));
    return { detect(image) {
      return detectors.flatMap(({ name, detector }) => detector.detect(image).map((marker) => ({ ...marker, family: name })));
    } };
  }
  const detector = new AR.Detector();
  if (minPerimeterFraction !== 0.2) {
    detector.detect = function (image) {
      CV.grayscale(image, this.grey);
      CV.adaptiveThreshold(this.grey, this.thres, 2, 7);
      this.contours = CV.findContours(this.thres, this.binary);
      this.candidates = this.findCandidates(this.contours, image.width * minPerimeterFraction, 0.05, 10);
      this.candidates = this.clockwiseCorners(this.candidates);
      this.candidates = this.notTooNear(this.candidates, 10);
      return this.findMarkers(this.grey, this.candidates, 49);
    };
  }
  if (family === 'legacy') return detector;
  if (!['6x6_250', '5x5_100'].includes(family)) throw new Error(`Unsupported marker family: ${family}`);
  const cells = family === '5x5_100' ? 7 : 8;
  const codebook = family === '5x5_100' ? codes5 : codes;

  detector.findMarkers = function (image, candidates) {
    const markers = [];
    for (const candidate of candidates) {
      CV.warp(image, this.homography, candidate, cells * 8);
      CV.threshold(this.homography, this.homography, CV.otsu(this.homography));
      const grid = Array.from({ length: cells }, (_, y) => Array.from({ length: cells }, (_, x) =>
        CV.countNonZero(this.homography, { x: x * 8, y: y * 8, width: 8, height: 8 }) > 32 ? 1 : 0));
      if (grid.some((row, y) => row.some((bit, x) => (x === 0 || y === 0 || x === cells - 1 || y === cells - 1) && bit))) continue;
      let bits = grid.slice(1, cells - 1).map((row) => row.slice(1, cells - 1));
      for (let rotation = 0; rotation < 4; rotation++) {
        const id = codebook.indexOf(bits.flat().join(''));
        if (id !== -1) {
          markers.push(new AR.Marker(id, this.rotate2(candidate, 4 - rotation)));
          break;
        }
        bits = this.rotate(bits);
      }
    }
    return markers;
  };
  return detector;
}

// Inner payload bits for rendering a marker: rows top-to-bottom, 1 = white cell.
// Matches the decoder above (a cell counts as 1 when it is mostly white).
export function markerBits(family, id) {
  const families = { '6x6_250': { codebook: codes, size: 6 }, '5x5_100': { codebook: codes5, size: 5 } };
  const entry = families[family];
  if (!entry) throw new Error(`Unsupported marker family: ${family}`);
  const code = entry.codebook[id];
  if (!code) throw new Error(`Marker ${id} is not in ${family}.`);
  return Array.from({ length: entry.size }, (_, y) =>
    Array.from({ length: entry.size }, (_, x) => Number(code[y * entry.size + x])));
}
