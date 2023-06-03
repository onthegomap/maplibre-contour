import { DemTile } from "./types";

const MIN_VALID_M = -12000;
const MAX_VALID_M = 9000;
function defaultIsValid(number: number): boolean {
  return !isNaN(number) && number >= MIN_VALID_M && number <= MAX_VALID_M;
}

export class HeightTile {
  get: (x: number, y: number) => number;
  width: number;
  height: number;
  isValid: (ele: number) => boolean;
  constructor(
    width: number,
    height: number,
    get: (x: number, y: number) => number,
    isValid = defaultIsValid
  ) {
    this.get = get;
    this.width = width;
    this.height = height;
    this.isValid = isValid;
  }

  static fromRawDem(demTile: DemTile): HeightTile {
    return new HeightTile(
      demTile.width,
      demTile.height,
      (x, y) => demTile.data[y * demTile.width + x]
    );
  }

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
    return new HeightTile(
      width,
      height,
      (x, y) => {
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
      },
      mainTile.isValid
    );
  }

  split = (subz: number, subx: number, suby: number): HeightTile => {
    if (subz === 0) return this;
    const by = 1 << subz;
    const dx = (subx * this.width) / by;
    const dy = (suby * this.height) / by;
    return new HeightTile(
      this.width / by,
      this.height / by,
      (x, y) => this.get(x + dx, y + dy),
      this.isValid
    );
  };

  subsamplePixelCenters = (factor: number): HeightTile => {
    const lerp = (a: number, b: number, f: number) =>
      !this.isValid(a) ? b : !this.isValid(b) ? a : a + (b - a) * f;
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
    return new HeightTile(
      this.width * factor,
      this.height * factor,
      blerper,
      this.isValid
    );
  };

  averagePixelCentersToGrid = (radius: number = 1): HeightTile =>
    new HeightTile(
      this.width + 1,
      this.height + 1,
      (x, y) => {
        let sum = 0,
          count = 0,
          v = 0;
        for (let newX = x - radius; newX < x + radius; newX++) {
          for (let newY = y - radius; newY < y + radius; newY++) {
            if (this.isValid((v = this.get(newX, newY)))) {
              count++;
              sum += v;
            }
          }
        }
        return count === 0 ? NaN : sum / count;
      },
      this.isValid
    );

  scaleElevation = (multiplier: number): HeightTile =>
    multiplier === 1
      ? this
      : new HeightTile(
          this.width,
          this.height,
          (x, y) => this.get(x, y) * multiplier,
          (ele) => this.isValid(ele / multiplier)
        );
}
