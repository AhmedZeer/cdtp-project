// Sub-pixel refinement of a detected marker's four corners.
//
// js-aruco's corners are vertices of a polygon approximation of a thresholded contour: whole
// pixels, and pulled inside the true outline (≈1 px on a 65 px marker, several px on bigger ones).
// That bias is systematic, so averaging frames cannot remove it, and it scales metric distances.
// Here each edge is located precisely from the greyscale image instead: along the edge, find the
// strongest dark→light step across it (sub-pixel), fit a straight line through those points, and
// intersect neighbouring edge lines to get the corners.

/**
 * Bilinear sample of a greyscale image { width, height, data }; null outside it. Continuous pixel
 * coordinates (pixel i covers [i, i+1), centre i + 0.5), matching the camera model's cx/cy, so the
 * refined corners are also in that convention.
 */
// Pixels are gamma-encoded (sRGB); edge blur happens in linear light, so the edge's true position is
// the steepest point of the *linear* intensity profile. Measuring on encoded values biases it inward.
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return 255 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
});

function sample(grey, xc, yc) {
  const x = xc - 0.5, y = yc - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= grey.width || y0 + 1 >= grey.height) return null;
  const fx = x - x0, fy = y - y0, w = grey.width, d = grey.data, i = y0 * w + x0;
  const L = (j) => LINEAR[d[j]];
  return (L(i) * (1 - fx) + L(i + 1) * fx) * (1 - fy) + (L(i + w) * (1 - fx) + L(i + w + 1) * fx) * fy;
}

/** Total-least-squares line through points: { point, dir } (dir unit). */
function fitLine(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal axis
  return { point: { x: mx, y: my }, dir: { x: Math.cos(angle), y: Math.sin(angle) } };
}

function intersect(a, b) {
  const det = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.point.x - a.point.x) * b.dir.y - (b.point.y - a.point.y) * b.dir.x) / det;
  return { x: a.point.x + t * a.dir.x, y: a.point.y + t * a.dir.y };
}

/**
 * corners: four coarse corners in order around the marker. Returns refined corners in the same
 * order, or the input unchanged if any edge cannot be measured (too small, off-image, no edge).
 * search: how far (px) either side of the coarse edge to look for the true edge; by default 6% of
 * the marker side (2–6 px), well short of the first inner cell boundary one cell (≥ 1/7 side) in.
 */
export function refineCorners(grey, corners, { search: searchPx, step = 0.25 } = {}) {
  const side = corners.reduce((s, p, i) => s + Math.hypot(corners[(i + 1) % 4].x - p.x, corners[(i + 1) % 4].y - p.y), 0) / 4;
  const search = searchPx ?? Math.min(6, Math.max(2, side * 0.06));
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4, cy = corners.reduce((s, p) => s + p.y, 0) / 4;
  const lines = [];
  for (let e = 0; e < 4; e++) {
    const a = corners[e], b = corners[(e + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 12) return corners;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    let nx = -uy, ny = ux; // edge normal, oriented away from the marker centre (dark → light)
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const points = [];
    const samples = Math.max(6, Math.round(len / 2));
    for (let k = 0; k <= samples; k++) {
      const t = 0.15 + (0.7 * k) / samples; // stay clear of the corners, where two edges mix
      const px = a.x + ux * len * t, py = a.y + uy * len * t;
      let best = null, prev = sample(grey, px - nx * (search + step), py - ny * (search + step));
      const grads = [];
      for (let s = -search; s <= search + 1e-9; s += step) {
        const v = sample(grey, px + nx * s, py + ny * s);
        if (v === null || prev === null) { grads.length = 0; break; }
        grads.push({ s: s - step / 2, g: v - prev });
        prev = v;
      }
      if (grads.length < 3) continue;
      for (let i = 1; i < grads.length - 1; i++) if (!best || grads[i].g > grads[best].g) best = i;
      if (!best || grads[best].g < 20 * step) continue; // no clear dark→light step here
      // Parabolic peak through the strongest gradient and its neighbours.
      const g0 = grads[best - 1].g, g1 = grads[best].g, g2 = grads[best + 1].g, den = g0 - 2 * g1 + g2;
      const offset = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (g0 - g2)) / den)) : 0;
      const s = grads[best].s + offset * step;
      points.push({ x: px + nx * s, y: py + ny * s });
    }
    if (points.length < 4) return corners;
    lines.push(fitLine(points));
  }
  // Corner k is where the edge ending at it (k−1 → k) meets the edge leaving it (k → k+1).
  const refined = corners.map((_, k) => intersect(lines[(k + 3) % 4], lines[k]));
  if (refined.some((p, k) => !p || Math.hypot(p.x - corners[k].x, p.y - corners[k].y) > search * 2.5)) return corners;
  return refined;
}
