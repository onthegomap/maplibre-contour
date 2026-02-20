import { HeightTile } from "../height-tile";
import type { IndividualAnalysisTileOptions } from "../types";

const EARTH_CIRCUMFERENCE = 40075016.68557849;
const RAD2DEG = 180 / Math.PI;

export interface AnalysisScalarTile {
  width: number;
  height: number;
  data: Float32Array;
}

export function computeAnalysisTile(
  tile: HeightTile,
  z: number,
  _x: number,
  yTile: number,
  options: IndividualAnalysisTileOptions,
): AnalysisScalarTile {
  const width = tile.width;
  const height = tile.height;
  const worldTiles = 1 << z;
  const metersPerPixelY = EARTH_CIRCUMFERENCE / (worldTiles * height);
  const out = new Float32Array(width * height);

  let idx = 0;
  for (let y = 0; y < height; y++) {
    const lat = mercatorYToLat((yTile + (y + 0.5) / height) / worldTiles);
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.0001);
    const metersPerPixelX = metersPerPixelY * cosLat;

    for (let x = 0; x < width; x++) {
      const a = tile.get(x - 1, y - 1);
      const b = tile.get(x, y - 1);
      const c = tile.get(x + 1, y - 1);
      const d = tile.get(x - 1, y);
      const f = tile.get(x + 1, y);
      const g = tile.get(x - 1, y + 1);
      const h = tile.get(x, y + 1);
      const i = tile.get(x + 1, y + 1);

      const dzdx =
        ((c + 2 * f + i - (a + 2 * d + g)) / 8 / metersPerPixelX) *
        options.exaggeration;
      const dzdy =
        ((g + 2 * h + i - (a + 2 * b + c)) / 8 / metersPerPixelY) *
        options.exaggeration;
      const gradient = Math.hypot(dzdx, dzdy);

      if (options.mode === "aspect") {
        let aspect = (90 - Math.atan2(dzdy, -dzdx) * RAD2DEG) % 360;
        if (aspect < 0) aspect += 360;
        if (gradient < 0.0001) aspect = 0;
        out[idx++] = aspect;
      } else if (options.units === "percent") {
        out[idx++] = gradient * 100;
      } else {
        out[idx++] = Math.atan(gradient) * RAD2DEG;
      }
    }
  }

  if (!options.smooth) {
    return { width, height, data: out };
  }

  return {
    width,
    height,
    data: boxBlur3x3(out, width, height),
  };
}

function mercatorYToLat(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * RAD2DEG;
}

function boxBlur3x3(
  src: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const dst = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const py = Math.max(0, Math.min(height - 1, y + oy));
        for (let ox = -1; ox <= 1; ox++) {
          const px = Math.max(0, Math.min(width - 1, x + ox));
          sum += src[py * width + px];
          count++;
        }
      }
      dst[y * width + x] = sum / count;
    }
  }

  return dst;
}
