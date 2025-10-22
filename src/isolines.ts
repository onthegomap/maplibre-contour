/*
Adapted from d3-contour https://github.com/d3/d3-contour

Copyright 2012-2023 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
*/

import type { HeightTile } from "./height-tile";

class Fragment {
  start: number;
  end: number;
  points: number[];

  constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
    this.points = [];
    this.append = this.append.bind(this);
    this.prepend = this.prepend.bind(this);
  }

  append(x: number, y: number) {
    this.points.push(x, y);
  }

  prepend(x: number, y: number) {
    this.points.splice(0, 0, x, y);
  }

  lineString() {
    return this.toArray();
  }

  toArray() {
    return this.points;
  }

  isEmpty() {
    return this.points.length < 2;
  }

  appendFragment(other: Fragment) {
    this.points.push(...other.points);
    this.end = other.end;
  }
}

const CASES: [number, number][][][] = [
  [],
  [
    [
      [1, 2],
      [0, 1],
    ],
  ],
  [
    [
      [2, 1],
      [1, 2],
    ],
  ],
  [
    [
      [2, 1],
      [0, 1],
    ],
  ],
  [
    [
      [1, 0],
      [2, 1],
    ],
  ],
  [
    [
      [1, 2],
      [0, 1],
    ],
    [
      [1, 0],
      [2, 1],
    ],
  ],
  [
    [
      [1, 0],
      [1, 2],
    ],
  ],
  [
    [
      [1, 0],
      [0, 1],
    ],
  ],
  [
    [
      [0, 1],
      [1, 0],
    ],
  ],
  [
    [
      [1, 2],
      [1, 0],
    ],
  ],
  [
    [
      [0, 1],
      [1, 0],
    ],
    [
      [2, 1],
      [1, 2],
    ],
  ],
  [
    [
      [2, 1],
      [1, 0],
    ],
  ],
  [
    [
      [0, 1],
      [2, 1],
    ],
  ],
  [
    [
      [1, 2],
      [2, 1],
    ],
  ],
  [
    [
      [0, 1],
      [1, 2],
    ],
  ],
  [],
];

function index(width: number, x: number, y: number, point: [number, number]) {
  x = x * 2 + point[0];
  y = y * 2 + point[1];
  return x + y * (width + 1) * 2;
}

function ratio(a: number, b: number, c: number) {
  return (b - a) / (c - a);
}

// Helper to check if a contour is a closed loop (start and end indexes are the same)
function isClosed(points: number[]): boolean {
  return (
    points[0] === points[points.length - 2] &&
    points[1] === points[points.length - 1]
  );
}

/**
 * Iterative Laplacian Smoothing (Moving average for visible smoothing)
 */
function smoothLinear(points: number[], iterations: number = 1): number[] {
  if (points.length <= 4) return points; // Need at least 2 points to smooth

  let result = points;
  const closed = isClosed(points);

  // Apply smoothing multiple times for stronger effect
  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: number[] = [];

    if (closed) {
      // If closed, use the last point as the 'previous' for the first point
      const p0x = result[result.length - 4];
      const p0y = result[result.length - 3];
      const p1x = result[0];
      const p1y = result[1];
      const p2x = result[2];
      const p2y = result[3];
      smoothed.push((p0x + p1x * 2 + p2x) / 4, (p0y + p1y * 2 + p2y) / 4);
    } else {
      // Keep first point as-is for open lines
      smoothed.push(result[0], result[1]);
    }

    // Interpolate middle points
    const limit = closed ? result.length - 2 : result.length - 4;
    for (let i = 2; i < limit; i += 2) {
      const prevX = result[i - 2];
      const prevY = result[i - 1];
      const currX = result[i];
      const currY = result[i + 1];
      const nextX = result[i + 2];
      const nextY = result[i + 3];

      // Simple linear interpolation: average of neighbors
      smoothed.push(
        (prevX + currX * 2 + nextX) / 4,
        (prevY + currY * 2 + nextY) / 4,
      );
    }

    if (closed) {
      // For the last unique point (which is the one before the closing point)
      const p0x = result[result.length - 6];
      const p0y = result[result.length - 5];
      const p1x = result[result.length - 4];
      const p1y = result[result.length - 3];
      const p2x = result[0]; // Next point is the start
      const p2y = result[1];
      smoothed.push((p0x + p1x * 2 + p2x) / 4, (p0y + p1y * 2 + p2y) / 4);
      // Add closing point to match the start point
      smoothed.push(smoothed[0], smoothed[1]);
    } else {
      // Keep last point as-is for open lines
      smoothed.push(result[result.length - 2], result[result.length - 1]);
    }

    result = smoothed;
  }

  return result;
}

// Chaikin's corner-cutting algorithm - produces very smooth curves
function smoothChaikin(points: number[], iterations: number = 1): number[] {
  if (points.length <= 4) return points;

  let result = points;
  const closed = isClosed(points);

  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: number[] = [];

    // Start and end handling for closed vs open
    const limit = closed ? result.length - 2 : result.length;

    for (let i = 0; i < limit; i += 2) {
      const x1 = result[i];
      const y1 = result[i + 1];

      // Get the next point, handling wrap-around for closed loops
      const i2 = (i + 2) % result.length;
      const x2 = result[i2];
      const y2 = result[i2 + 1];

      // Point at 1/4 of the way from p1 to p2
      smoothed.push(0.75 * x1 + 0.25 * x2, 0.75 * y1 + 0.25 * y2);

      // Point at 3/4 of the way from p1 to p2
      smoothed.push(0.25 * x1 + 0.75 * x2, 0.25 * y1 + 0.75 * y2);
    }

    if (!closed) {
      // For open lines, keep the start and end points
      smoothed.splice(0, 0, result[0], result[1]);
      smoothed.push(result[result.length - 2], result[result.length - 1]);
    } else {
      // For closed lines, the last segment's points will correctly meet the first segment's points.
      // Add the closing point
      smoothed.push(smoothed[0], smoothed[1]);
    }

    result = smoothed;
  }

  return result;
}

/**
 * Catmull-Rom spline interpolation.
 */
function smoothCatmullRom(
  points: number[],
  tension: number = 0.5,
  segmentsPerPoint: number = 8,
): number[] {
  if (points.length <= 4) return points;

  const smoothed: number[] = [];
  const closed = isClosed(points);

  // The Catmull-Rom formula is based on 4 points (P0, P1, P2, P3) to interpolate between P1 and P2.
  const numPoints = closed ? points.length - 2 : points.length;

  for (let i = 0; i < numPoints; i += 2) {
    // P1 is the current point (i)
    const p1x = points[i];
    const p1y = points[i + 1];

    // P2 is the next point (i+2)
    const i2 = (i + 2) % (closed ? numPoints : points.length);
    const p2x = points[i2];
    const p2y = points[i2 + 1];

    // P0 is the point before P1
    let i0;
    if (i === 0) {
      if (closed) {
        i0 = numPoints - 2;
      } else {
        i0 = 0; // Clamp to P1
      }
    } else {
      i0 = i - 2;
    }
    const p0x = points[i0];
    const p0y = points[i0 + 1];

    // P3 is the point after P2
    let i3;
    const numLimit = closed ? numPoints : points.length;
    if (i2 >= numLimit - 2) {
      if (closed) {
        i3 = (i2 + 2) % numPoints;
      } else {
        i3 = numLimit - 2; // Clamp to P2
      }
    } else {
      i3 = i2 + 2;
    }
    const p3x = points[i3];
    const p3y = points[i3 + 1];

    // Add points along the curve segment
    for (let t = 0; t < segmentsPerPoint; t++) {
      const t_norm = t / segmentsPerPoint;
      const t2 = t_norm * t_norm;
      const t3 = t2 * t_norm;

      // Catmull-Rom basis matrix terms
      const c1 = 2 * p1x;
      const c2 = (-p0x + p2x) * tension;
      const c3 = (2 * p0x - 5 * p1x + 4 * p2x - p3x) * tension;
      const c4 = (-p0x + 3 * p1x - 3 * p2x + p3x) * tension;

      const x = 0.5 * (c1 + c2 * t_norm + c3 * t2 + c4 * t3);

      const d1 = 2 * p1y;
      const d2 = (-p0y + p2y) * tension;
      const d3 = (2 * p0y - 5 * p1y + 4 * p2y - p3y) * tension;
      const d4 = (-p0y + 3 * p1y - 3 * p2y + p3y) * tension;

      const y = 0.5 * (d1 + d2 * t_norm + d3 * t2 + d4 * t3);

      smoothed.push(x, y);
    }
  }

  // Add the final point (which is the start point if closed)
  if (closed) {
    smoothed.push(smoothed[0], smoothed[1]);
  } else {
    smoothed.push(points[points.length - 2], points[points.length - 1]);
  }

  return smoothed;
}

/**
 * A simple high-resolution linear interpolation / point-doubling method.
 */
function smoothBezier(
  points: number[],
  segmentsPerPoint: number = 4,
): number[] {
  if (points.length <= 4) return points;

  const smoothed: number[] = [];
  const closed = isClosed(points);

  const limit = closed ? points.length - 2 : points.length - 2;

  for (let i = 0; i < limit; i += 2) {
    const x1 = points[i];
    const y1 = points[i + 1];

    const i2 = (i + 2) % (closed ? points.length - 2 : points.length);
    const x2 = points[i2];
    const y2 = points[i2 + 1];

    // Add points along the segment
    for (let t = 0; t < segmentsPerPoint; t++) {
      const t_norm = t / segmentsPerPoint;
      const x = x1 * (1 - t_norm) + x2 * t_norm;
      const y = y1 * (1 - t_norm) + y2 * t_norm;
      smoothed.push(x, y);
    }
  }

  // Add the final point
  if (closed) {
    smoothed.push(smoothed[0], smoothed[1]);
  } else {
    smoothed.push(points[points.length - 2], points[points.length - 1]);
  }

  return smoothed;
}

/**
 * Generates contour lines from a HeightTile
 *
 * @param interval Vertical distance between contours
 * @param tile The input height tile, where values represent the height at the top-left of each pixel
 * @param extent Vector tile extent (default 4096)
 * @param buffer How many pixels into each neighboring tile to include in a tile
 * @param smooth Apply smoothing to contour lines: 'none' = no smoothing, 'linear' = weighted average, 'chaikin' = corner cutting, 'catmull-rom' = spline interpolation, 'bezier' = linear interpolation upsampling (default none)
 * @param smoothIterations Number of times to apply smoothing (default 1, higher = smoother but more processing)
 * @returns an object where keys are the elevation, and values are a list of `[x1, y1, x2, y2, ...]`
 * contour lines in tile coordinates
 */
export default function generateIsolines(
  interval: number,
  tile: HeightTile,
  extent: number = 4096,
  buffer: number = 1,
  smooth: "none" | "linear" | "chaikin" | "catmull-rom" | "bezier" = "none",
  smoothIterations: number = 1,
): { [ele: number]: number[][] } {
  if (!interval) {
    return {};
  }
  const multiplier = extent / (tile.width - 1);
  let tld: number, trd: number, bld: number, brd: number;
  let r: number, c: number;
  const segments: { [ele: string]: number[][] } = {};
  const fragmentByStartByLevel: Map<number, Map<number, Fragment>> = new Map();
  const fragmentByEndByLevel: Map<number, Map<number, Fragment>> = new Map();

  function interpolate(
    point: [number, number],
    threshold: number,
    accept: (x: number, y: number) => void,
  ) {
    if (point[0] === 0) {
      // left
      accept(
        multiplier * (c - 1),
        multiplier * (r - ratio(bld, threshold, tld)),
      );
    } else if (point[0] === 2) {
      // right
      accept(multiplier * c, multiplier * (r - ratio(brd, threshold, trd)));
    } else if (point[1] === 0) {
      // top
      accept(
        multiplier * (c - ratio(trd, threshold, tld)),
        multiplier * (r - 1),
      );
    } else {
      // bottom
      accept(multiplier * (c - ratio(brd, threshold, bld)), multiplier * r);
    }
  }

  // Most marching-squares implementations (d3-contour, gdal-contour) make one pass through the matrix per threshold.
  // This implementation makes a single pass through the matrix, building up all of the contour lines at the
  // same time to improve performance.
  for (r = 1 - buffer; r < tile.height + buffer; r++) {
    trd = tile.get(0, r - 1);
    brd = tile.get(0, r);
    let minR = Math.min(trd, brd);
    let maxR = Math.max(trd, brd);
    for (c = 1 - buffer; c < tile.width + buffer; c++) {
      tld = trd;
      bld = brd;
      trd = tile.get(c, r - 1);
      brd = tile.get(c, r);
      const minL = minR;
      const maxL = maxR;
      minR = Math.min(trd, brd);
      maxR = Math.max(trd, brd);
      if (isNaN(tld) || isNaN(trd) || isNaN(brd) || isNaN(bld)) {
        continue;
      }
      const min = Math.min(minL, minR);
      const max = Math.max(maxL, maxR);
      const start = Math.ceil(min / interval) * interval;
      const end = Math.floor(max / interval) * interval;
      for (let threshold = start; threshold <= end; threshold += interval) {
        const tl = tld > threshold;
        const tr = trd > threshold;
        const bl = bld > threshold;
        const br = brd > threshold;
        for (const segment of CASES[
          (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)
        ]) {
          let fragmentByStart = fragmentByStartByLevel.get(threshold);
          if (!fragmentByStart)
            fragmentByStartByLevel.set(
              threshold,
              (fragmentByStart = new Map()),
            );
          let fragmentByEnd = fragmentByEndByLevel.get(threshold);
          if (!fragmentByEnd)
            fragmentByEndByLevel.set(threshold, (fragmentByEnd = new Map()));
          const start = segment[0];
          const end = segment[1];
          const startIndex = index(tile.width, c, r, start);
          const endIndex = index(tile.width, c, r, end);
          let f, g;

          if ((f = fragmentByEnd.get(startIndex))) {
            fragmentByEnd.delete(startIndex);
            if ((g = fragmentByStart.get(endIndex))) {
              fragmentByStart.delete(endIndex);
              if (f === g) {
                // closing a ring
                interpolate(end, threshold, f.append);
                if (!f.isEmpty()) {
                  let list = segments[threshold];
                  if (!list) {
                    segments[threshold] = list = [];
                  }
                  // Apply smoothing if enabled, then round for vector tiles
                  let line = f.lineString();
                  if (smooth !== "none") {
                    line = applySmoothing(line, smooth, smoothIterations);
                  }
                  line = line.map((coord) => Math.round(coord));
                  list.push(line);
                }
              } else {
                // connecting 2 segments
                f.appendFragment(g);
                fragmentByEnd.set((f.end = g.end), f);
              }
            } else {
              // adding to the end of f
              interpolate(end, threshold, f.append);
              fragmentByEnd.set((f.end = endIndex), f);
            }
          } else if ((f = fragmentByStart.get(endIndex))) {
            fragmentByStart.delete(endIndex);
            // extending the start of f
            interpolate(start, threshold, f.prepend);
            fragmentByStart.set((f.start = startIndex), f);
          } else {
            // starting a new fragment
            const newFrag = new Fragment(startIndex, endIndex);
            interpolate(start, threshold, newFrag.append);
            interpolate(end, threshold, newFrag.append);
            fragmentByStart.set(startIndex, newFrag);
            fragmentByEnd.set(endIndex, newFrag);
          }
        }
      }
    }
  }

  for (const [level, fragmentByStart] of fragmentByStartByLevel.entries()) {
    let list: number[][] | null = null;
    for (const value of fragmentByStart.values()) {
      if (!value.isEmpty()) {
        if (list == null) {
          list = segments[level] || (segments[level] = []);
        }
        let line = value.lineString();
        if (smooth !== "none") {
          line = applySmoothing(line, smooth, smoothIterations);
        }
        line = line.map((coord) => Math.round(coord));
        list.push(line);
      }
    }
  }

  return segments;
}

// Helper function to apply the selected smoothing algorithm
function applySmoothing(
  points: number[],
  method: "linear" | "chaikin" | "catmull-rom" | "bezier",
  iterations: number,
): number[] {
  switch (method) {
    case "linear":
      return smoothLinear(points, iterations);
    case "chaikin":
      return smoothChaikin(points, iterations);
    case "catmull-rom":
      // For catmull-rom, iterations controls segmentsPerPoint (interpolation density)
      return smoothCatmullRom(points, 0.5, iterations);
    case "bezier":
      // For bezier, iterations controls segmentsPerPoint (interpolation density)
      return smoothBezier(points, iterations);
    default:
      return points;
  }
}
