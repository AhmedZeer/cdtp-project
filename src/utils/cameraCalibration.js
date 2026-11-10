// Metric calibration of a fixed camera from one square marker of known size lying level at a
// known height (the charging-station marker). Pure maths, no DOM, so it runs under `node --test`.
//
// Floor frame F (metres): origin on the floor directly below the station marker's centre,
// +X = the marker's +X (out of the station's contact face), +Y = 90° to its left, +Z up.
// Other markers are located by intersecting their pixels' viewing rays with the horizontal
// plane at their own known height, so a robot marker 26 cm up is not mistaken for one on the floor.
//
// Pixels: x right, y down. Marker corners use the detector's canonical order: corner 0 → 1 is
// the marker's +X, corner 0 → 3 is image-down in the marker's own texture (so −Y in F).

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => a.map((v) => v * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const norm = (a) => Math.hypot(...a);
const unit = (a) => scale(a, 1 / norm(a));
const col = (M, j) => M.map((row) => row[j]);
const mulT = (R, v) => [0, 1, 2].map((j) => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]); // Rᵀ v
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Marker-plane coordinates (metres, +Y up the texture) of the four canonical corners. */
export function markerCornerModel(size) {
  const s = size / 2;
  return [{ x: -s, y: s }, { x: s, y: s }, { x: s, y: -s }, { x: -s, y: -s }];
}

/** Solve A x = b by Gaussian elimination with partial pivoting. Returns null if singular. */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Similarity transform that centres points and scales their mean distance to √2 (Hartley). */
function normaliser(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length, cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const d = points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / points.length || 1;
  const k = Math.SQRT2 / d;
  return { apply: (p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k }), T: [[k, 0, -k * cx], [0, k, -k * cy], [0, 0, 1]], Tinv: [[1 / k, 0, cx], [0, 1 / k, cy], [0, 0, 1]] };
}

const mul3 = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));

/** Homography H (3×3, H[2][2] = 1) with dst ≃ H·src, from ≥4 point pairs (least squares). */
export function homography(src, dst) {
  if (src.length < 4 || src.length !== dst.length) return null;
  const ns = normaliser(src), nd = normaliser(dst);
  const AtA = Array.from({ length: 8 }, () => Array(8).fill(0)), Atb = Array(8).fill(0);
  src.forEach((sp, i) => {
    const s = ns.apply(sp), d = nd.apply(dst[i]);
    for (const [row, rhs] of [[[s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y], d.x], [[0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y], d.y]]) {
      for (let a = 0; a < 8; a++) { Atb[a] += row[a] * rhs; for (let b = 0; b < 8; b++) AtA[a][b] += row[a] * row[b]; }
    }
  });
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const H = mul3(mul3(nd.Tinv, Hn), ns.T);
  return H.map((row) => row.map((v) => v / H[2][2]));
}

export function applyHomography(H, p) {
  const w = H[2][0] * p.x + H[2][1] * p.y + H[2][2];
  return { x: (H[0][0] * p.x + H[0][1] * p.y + H[0][2]) / w, y: (H[1][0] * p.x + H[1][1] * p.y + H[1][2]) / w };
}

/**
 * Focal length (pixels) from a single plane homography, assuming square pixels, no skew and the
 * principal point at (cx, cy); `extent` is the marker side in the homography's source units. Uses the two rotation constraints (r1 ⟂ r2, |r1| = |r2|). It is only
 * well-conditioned when the marker is seen at an angle; a marker facing the camera (overhead view)
 * carries no focal-length information, which is reported instead of a guess.
 */
export function focalFromHomography(H, cx, cy, extent) {
  const T = [[1, 0, -cx], [0, 1, -cy], [0, 0, 1]];
  const G = mul3(T, H);
  const [a1, b1, c1] = col(G, 0), [a2, b2, c2] = col(G, 1);
  // Foreshortening across the marker: the perspective term's size at the marker edge (0 = fronto-parallel).
  const perspective = (Math.hypot(c1, c2) * extent) / 2 / Math.abs(G[2][2]);
  const estimates = [];
  const den1 = c1 * c2;
  if (Math.abs(den1) > 1e-12) estimates.push(-(a1 * a2 + b1 * b2) / den1);
  const den2 = c1 * c1 - c2 * c2;
  if (Math.abs(den2) > 1e-12) estimates.push((a2 * a2 + b2 * b2 - a1 * a1 - b1 * b1) / den2);
  // Weight each constraint by how strongly it depends on f; drop non-physical (negative) ones.
  const weights = [Math.abs(den1), Math.abs(den2)];
  const valid = estimates.map((f2, i) => ({ f2, w: weights[i] })).filter((e) => e.f2 > 0);
  if (!valid.length || perspective < 0.01) return { ok: false, reason: 'The station marker faces the camera too squarely to estimate focal length; tilt the phone or use known intrinsics.' };
  const f2 = valid.reduce((s, e) => s + e.f2 * e.w, 0) / valid.reduce((s, e) => s + e.w, 0);
  return { ok: true, f: Math.sqrt(f2), perspective };
}

/** Rotation R (rows) and translation t mapping marker-plane points (X, Y, 0) to camera coordinates. */
export function poseFromHomography(H, K) {
  const kinv = (v) => [(v[0] - K.cx * v[2]) / K.fx, (v[1] - K.cy * v[2]) / K.fy, v[2]];
  let b1 = kinv(col(H, 0)), b2 = kinv(col(H, 1)), b3 = kinv(col(H, 2));
  const lambda = 2 / (norm(b1) + norm(b2));
  [b1, b2, b3] = [b1, b2, b3].map((b) => scale(b, lambda));
  if (b3[2] < 0) [b1, b2, b3] = [b1, b2, b3].map((b) => scale(b, -1)); // marker must be in front of the camera
  // Nearest pair of orthonormal axes, splitting the error symmetrically between r1 and r2.
  const a = unit(b1), b = unit(b2), c = unit(add(a, b)), d = unit(sub(a, b));
  const r1 = scale(add(c, d), Math.SQRT1_2), r2 = scale(sub(c, d), Math.SQRT1_2), r3 = cross(r1, r2);
  const R = [0, 1, 2].map((i) => [r1[i], r2[i], r3[i]]);
  return { R, t: b3 };
}

/** Rotation matrix exp([w]×) (Rodrigues). */
function rodrigues(w) {
  const th = norm(w);
  if (th < 1e-12) return [[1, -w[2], w[1]], [w[2], 1, -w[0]], [-w[1], w[0], 1]];
  const [x, y, z] = scale(w, 1 / th), c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}

const projectPlane = (K, R, t, p) => {
  const v = add([R[0][0] * p.x + R[0][1] * p.y, R[1][0] * p.x + R[1][1] * p.y, R[2][0] * p.x + R[2][1] * p.y], t);
  return { x: K.fx * (v[0] / v[2]) + K.cx, y: K.fy * (v[1] / v[2]) + K.cy };
};

/**
 * Gauss–Newton refinement of a marker pose: minimises pixel reprojection error over the six pose
 * parameters (rotation increment + translation). The closed-form decomposition alone amplifies
 * sub-pixel corner noise on a small marker into several pixels of error.
 */
export function refinePose(model, pixels, K, { R, t }, iterations = 20) {
  let cur = { R, t };
  const residual = ({ R: r, t: tt }) => model.flatMap((p, i) => { const q = projectPlane(K, r, tt, p); return [q.x - pixels[i].x, q.y - pixels[i].y]; });
  const apply = ({ R: r, t: tt }, d) => ({ R: mul3(rodrigues(d.slice(0, 3)), r), t: add(tt, d.slice(3)) });
  for (let it = 0; it < iterations; it++) {
    const r0 = residual(cur);
    const J = r0.map(() => Array(6).fill(0));
    for (let k = 0; k < 6; k++) {
      const eps = k < 3 ? 1e-6 : 1e-6 * Math.max(1, norm(cur.t));
      const d = Array(6).fill(0); d[k] = eps;
      const r1 = residual(apply(cur, d));
      r1.forEach((v, i) => { J[i][k] = (v - r0[i]) / eps; });
    }
    const JtJ = Array.from({ length: 6 }, (_, a) => Array.from({ length: 6 }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0) + (a === b ? 1e-9 : 0)));
    const Jtr = Array.from({ length: 6 }, (_, a) => -J.reduce((s, row, i) => s + row[a] * r0[i], 0));
    const step = solve(JtJ, Jtr);
    if (!step) break;
    const next = apply(cur, step);
    const before = r0.reduce((s, v) => s + v * v, 0), after = residual(next).reduce((s, v) => s + v * v, 0);
    if (after > before) break;
    cur = next;
    if (before - after < 1e-12) break;
  }
  return cur;
}

/** Any rotation whose third column is z (unit): a tilt-only frame for a known "up" direction. */
function tiltFrame(z) {
  const helper = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = unit(sub(helper, scale(z, dot(helper, z)))), y = cross(z, x);
  return [0, 1, 2].map((i) => [x[i], y[i], z[i]]);
}
const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

/**
 * Pose refinement when the floor's "up" direction in camera coordinates is known (from the phone's
 * accelerometer). Tilt is then fixed and only yaw + translation (4 parameters) come from the marker,
 * which is far better conditioned than recovering tilt from a marker only a few dozen pixels wide.
 */
export function refinePoseWithGravity(model, pixels, K, initial, upInCamera, iterations = 30) {
  const T = tiltFrame(unit(upInCamera));
  const pose = (q) => ({ R: mul3(T, rotZ(q[0])), t: q.slice(1) });
  const residual = (q) => { const { R, t } = pose(q); return model.flatMap((m, i) => { const r = projectPlane(K, R, t, m); return [r.x - pixels[i].x, r.y - pixels[i].y]; }); };
  const cost = (q) => residual(q).reduce((s, v) => s + v * v, 0);
  const descend = (start) => {
    let p = start;
    for (let it = 0; it < iterations; it++) {
      const r0 = residual(p);
      const J = r0.map(() => Array(4).fill(0));
      for (let k = 0; k < 4; k++) {
        const eps = 1e-6 * (k === 0 ? 1 : Math.max(1, norm(p.slice(1))));
        const q = [...p]; q[k] += eps;
        residual(q).forEach((v, i) => { J[i][k] = (v - r0[i]) / eps; });
      }
      const JtJ = Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
      const step = solve(JtJ, Array.from({ length: 4 }, (_, a) => -J.reduce((s, row, i) => s + row[a] * r0[i], 0)));
      if (!step) break;
      const next = p.map((v, i) => v + step[i]);
      const before = cost(p), after = cost(next);
      if (after > before) break;
      p = next;
      if (before - after < 1e-12) break;
    }
    return p;
  };
  // A small marker's tilt-only pose is ambiguous, so the unconstrained yaw may come from the wrong
  // branch: start from it and from eight evenly spaced yaws, keep the best fit.
  const local = mulT(T, col(initial.R, 0));
  const yaws = [Math.atan2(local[1], local[0]), ...Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4)];
  // Physical solutions only: marker in front of the camera, camera above the marker (up · t < 0).
  const up = unit(upInCamera);
  const physical = (q) => q[3] > 0 && dot(up, q.slice(1)) < 0;
  const fits = yaws.map((yaw) => descend([yaw, ...initial.t])).filter(physical);
  if (!fits.length) return initial;
  return pose(fits.reduce((a, b) => (cost(b) < cost(a) ? b : a)));
}

/**
 * Build a calibration from the station marker's pixel corners (ideally averaged over several frames).
 * K: { fx, fy, cx, cy }. upInCamera: the floor's up direction in camera coordinates (x right,
 * y down, z forward) from the phone's accelerometer; strongly recommended (see refinePoseWithGravity). Returns { ok, ... } with diagnostics; ok = false carries `reason`.
 */
export function calibrateFromMarker(corners, { markerSize, markerHeight, K, upInCamera = null }) {
  const model = markerCornerModel(markerSize);
  const H = homography(model, corners);
  if (!H) return { ok: false, reason: 'Station marker corners are degenerate.' };
  const initial = refinePose(model, corners, K, poseFromHomography(H, K));
  const { R, t } = upInCamera ? refinePoseWithGravity(model, corners, K, initial, upInCamera) : initial;
  // Camera centre in F: C = −Rᵀt, lifted by the marker height.
  const c = scale(mulT(R, t), -1);
  const centre = [c[0], c[1], c[2] + markerHeight];
  if (centre[2] <= markerHeight) return { ok: false, reason: 'Solved camera is below the station marker; corner order or detection is wrong.' };
  const cal = { ok: true, K, R, t, markerHeight, centre };
  const reprojection = model.reduce((s, p, i) => {
    const q = projectFloorPoint(cal, [p.x, p.y, markerHeight]);
    return s + Math.hypot(q.x - corners[i].x, q.y - corners[i].y);
  }, 0) / model.length;
  const optical = mulT(R, [0, 0, 1]); // camera viewing direction in F
  return {
    ...cal,
    reprojectionPx: reprojection,
    cameraHeight: centre[2],
    cameraDistance: Math.hypot(centre[0], centre[1]),
    depressionDeg: (Math.asin(Math.max(-1, Math.min(1, -optical[2]))) * 180) / Math.PI, // 90° = looking straight down
  };
}

/** F-frame point [X, Y, Z] to pixels. */
export function projectFloorPoint(cal, P) {
  const v = add(cal.R.map((row) => dot(row, [P[0], P[1], P[2] - cal.markerHeight])), cal.t);
  return { x: cal.K.fx * (v[0] / v[2]) + cal.K.cx, y: cal.K.fy * (v[1] / v[2]) + cal.K.cy };
}

/** Pixel → point on the horizontal plane Z = height in F, or null if the ray never reaches it. */
export function pixelToPlane(cal, p, height) {
  const ray = mulT(cal.R, [(p.x - cal.K.cx) / cal.K.fx, (p.y - cal.K.cy) / cal.K.fy, 1]);
  if (Math.abs(ray[2]) < 1e-9) return null;
  const s = (height - cal.centre[2]) / ray[2];
  if (s <= 0) return null;
  return { x: cal.centre[0] + s * ray[0], y: cal.centre[1] + s * ray[1] };
}

/**
 * Metric pose of a level marker at a known height: its centre (F frame) and +X heading
 * (radians, counter-clockwise from F's +X). `forward` shifts the result back from the marker
 * centre to its object's reference point (e.g. medicine box marker → box centre is 0).
 */
export function measureMarker(cal, corners, { height, forward = 0 }) {
  const pts = corners.map((c) => pixelToPlane(cal, c, height));
  if (pts.some((p) => !p)) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  // +X edge direction averaged over the top and bottom edges.
  const ex = (pts[1].x - pts[0].x) + (pts[2].x - pts[3].x), ey = (pts[1].y - pts[0].y) + (pts[2].y - pts[3].y);
  const heading = Math.atan2(ey, ex);
  const side = (Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) + Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y)
    + Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y) + Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)) / 4;
  return { x: cx - forward * Math.cos(heading), y: cy - forward * Math.sin(heading), heading: wrap(heading), side };
}

/** Mean of several detections of the same marker, corner by corner. */
export function averageCorners(samples) {
  return [0, 1, 2, 3].map((i) => ({
    x: samples.reduce((s, c) => s + c[i].x, 0) / samples.length,
    y: samples.reduce((s, c) => s + c[i].y, 0) / samples.length,
  }));
}
