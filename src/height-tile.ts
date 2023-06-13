import { DemTile } from "./types";

const MIN_VALID_M = -12000;
const MAX_VALID_M = 9000;
function defaultIsValid(number: number): boolean {
  return !isNaN(number) && number >= MIN_VALID_M && number <= MAX_VALID_M;
}

/** A tile containing elevation values aligned to a grid. */
export class HeightTile {
  get: (x: number, y: number) => number;
  width: number;
  height: number;
  constructor(
    width: number,
    height: number,
    get: (x: number, y: number) => number
  ) {
    this.get = get;
    this.width = width;
    this.height = height;
  }

  /** Construct a height tile from raw DEM pixel values */
  static fromRawDem(demTile: DemTile): HeightTile {
    return new HeightTile(demTile.width, demTile.height, (x, y) => {
      const value = demTile.data[y * demTile.width + x];
      return defaultIsValid(value) ? value : NaN;
    });
  }

  /**
   * Construct a height tile from a DEM tile plus it's 8 neighbors, so that
   * you can request `x` or `y` outside the bounds of the original tile.
   *
   * @param neighbors An array containing tiles: `[nw, n, ne, w, c, e, sw, s, se]`
   */
  static combineNeighbors(
    neighbors: (HeightTile | undefined)[]
  ): HeightTile | undefined {
    if (neighbors.length !== 9) {
      throw new Error("Must include a tile plus 8 neighbors");
    }
    const mainTile = neighbors[4];
    if (!mainTile) {
      return undefined;
    }
    const width = mainTile.width;
    const height = mainTile.height;
    return new HeightTile(width, height, (x, y) => {
      let gridIdx = 0;
      if (y < 0) {
        y += height;
      } else if (y < height) {
        gridIdx += 3;
      } else {
        y -= height;
        gridIdx += 6;
      }
      if (x < 0) {
        x += width;
      } else if (x < width) {
        gridIdx += 1;
      } else {
        x -= width;
        gridIdx += 2;
      }
      const grid = neighbors[gridIdx];
      return grid ? grid.get(x, y) : NaN;
    });
  }

  /**
   * Splits this tile into a `1<<subz` x `1<<subz` grid and returns the tile at coordinates `subx, suby`.
   */
  split = (subz: number, subx: number, suby: number): HeightTile => {
    if (subz === 0) return this;
    const by = 1 << subz;
    const dx = (subx * this.width) / by;
    const dy = (suby * this.height) / by;
    return new HeightTile(this.width / by, this.height / by, (x, y) =>
      this.get(x + dx, y + dy)
    );
  };

  /**
   * Returns a new tile scaled up by `factor` with pixel values that are subsampled using
   * bilinear interpolation between the original height tile values.
   *
   * The original and result tile are assumed to represent values taken at the center of each pixel.
   */
  subsamplePixelCenters = (factor: number): HeightTile => {
    const lerp = (a: number, b: number, f: number) =>
      isNaN(a) ? b : isNaN(b) ? a : a + (b - a) * f;
    if (factor <= 1) return this;
    const sub = 0.5 - 1 / (2 * factor);
    const blerper = (x: number, y: number) => {
      const dx = x / factor - sub;
      const dy = y / factor - sub;
      const ox = Math.floor(dx);
      const oy = Math.floor(dy);
      const a = this.get(ox, oy);
      const b = this.get(ox + 1, oy);
      const c = this.get(ox, oy + 1);
      const d = this.get(ox + 1, oy + 1);
      const fx = dx - ox;
      const fy = dy - oy;
      const top = lerp(a, b, fx);
      const bottom = lerp(c, d, fx);
      return lerp(top, bottom, fy);
    };
    return new HeightTile(this.width * factor, this.height * factor, blerper);
  };

  /**
   * Assumes the input tile represented measurements taken at the center of each pixel, and
   * returns a new tile where values are the height at the top-left of each pixel by averaging
   * the 4 adjacent pixel values.
   */
  averagePixelCentersToGrid = (radius: number = 1): HeightTile =>
    new HeightTile(this.width + 1, this.height + 1, (x, y) => {
      let sum = 0,
        count = 0,
        v = 0;
      for (let newX = x - radius; newX < x + radius; newX++) {
        for (let newY = y - radius; newY < y + radius; newY++) {
          if (!isNaN((v = this.get(newX, newY)))) {
            count++;
            sum += v;
          }
        }
      }
      return count === 0 ? NaN : sum / count;
    });

  /** Returns a new tile with elevation values scaled by `multiplier`. */
  scaleElevation = (multiplier: number): HeightTile =>
    multiplier === 1
      ? this
      : new HeightTile(
          this.width,
          this.height,
          (x, y) => this.get(x, y) * multiplier
        );

  /**
   * Precompute every value from `-bufer, -buffer` to `width + buffer, height + buffer` and serve them
   * out of a `Float32Array`. Until this method is called, all `get` requests are lazy and call all previous
   * methods in the chain up to the root DEM tile.
   */
  materialize = (buffer: number = 2): HeightTile => {
    const stride = this.width + 2 * buffer;
    const data = new Float32Array(stride * (this.height + 2 * buffer));
    let idx = 0;
    for (let y = -buffer; y < this.height + buffer; y++) {
      for (let x = -buffer; x < this.width + buffer; x++) {
        data[idx++] = this.get(x, y);
      }
    }
    return new HeightTile(
      this.width,
      this.height,
      (x, y) => data[(y + buffer) * stride + x + buffer]
    );
  };
}
