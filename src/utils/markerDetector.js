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

export function createMarkerDetector(family = '6x6_250') {
  if (family === 'catalog') {
    const detectors = ['6x6_250', '5x5_100', 'legacy'].map((name) => ({ name, detector: createMarkerDetector(name) }));
    return { detect(image) {
      return detectors.flatMap(({ name, detector }) => detector.detect(image).map((marker) => ({ ...marker, family: name })));
    } };
  }
  const detector = new AR.Detector();
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
