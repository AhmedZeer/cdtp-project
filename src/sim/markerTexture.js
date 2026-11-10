import { markerBits } from '../utils/markerDetector.js';

export const QUIET_CELLS = 1; // white margin around the black border, in cells

/**
 * Draw an ArUco marker onto a canvas: white quiet zone, black border, payload bits.
 * Returns { canvas, cellsAcross } where cellsAcross includes the quiet zone, so a
 * marker of physical side S (black square) is drawn on a plane of S * cellsAcross / (bits + 2).
 */
export function drawMarkerCanvas(family, id, cellPx = 32) {
  const bits = markerBits(family, id);
  const inner = bits.length;
  const cellsAcross = inner + 2 + QUIET_CELLS * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cellsAcross * cellPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  const o = QUIET_CELLS * cellPx;
  ctx.fillRect(o, o, (inner + 2) * cellPx, (inner + 2) * cellPx);
  ctx.fillStyle = '#fff';
  bits.forEach((row, y) => row.forEach((bit, x) => {
    if (bit) ctx.fillRect(o + (x + 1) * cellPx, o + (y + 1) * cellPx, cellPx, cellPx);
  }));
  return { canvas, cellsAcross, markerCells: inner + 2 };
}
