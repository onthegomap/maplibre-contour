import type { DemTile } from "./types";

export type PressureCenterType = "H" | "L";

export interface GeoDemTile {
  z: number;
  x: number;
  y: number;
  tile: DemTile;
  tileSize?: number;
}

export interface PressureCenter {
  type: PressureCenterType;
  lng: number;
  lat: number;
  value: number;
  prominence: number;
  pixel: { x: number; y: number };
  sourceTile: { z: number; x: number; y: number };
}

export interface PressureCenterOptions {
  smoothRadiusPx?: number;
  neighborhoodRadiusPx?: number;
  sampleStridePx?: number;
  plateauTolerance?: number;
  closedContourDelta?: number;
  closedContourRadiusKm?: number;
  /**
   * Minimum prominence (hPa) between a candidate and its neighborhood.
   * Candidates whose prominence is below this threshold are dropped before
   * distance-based deduplication. Defaults to 0 (no filtering). Mirrors the
   * synoptic-scale rule that only absolute maxima/minima of the pressure
   * field bounded by closed isobars are worth labeling on a weather map.
   */
  minProminenceHpa?: number;
  /**
   * Minimum prominence (hPa) for a candidate to enter the candidate pool.
   * Distinct from `closedContourDelta`: this gates entry (`collectCandidates`)
   * while `closedContourDelta` gates the BFS threshold used to verify the
   * candidate sits inside a closed isobar. Splitting the two lets callers use
   * the standard 4 hPa isobar spacing for BFS (matching NMC/NOAA surface
   * analysis) without also requiring the candidate's local gradient to clear
   * that same 4 hPa bar — which would silently drop weak but real systems
   * such as summer continental lows. Defaults to 0 (no filtering).
   */
  minLocalProminenceHpa?: number;
  minDistanceKm?: number;
  maxCentersPerType?: number;
  validRange?: [number, number];
}

interface PressureCenterCandidate extends PressureCenter {
  globalPixel: { x: number; y: number };
  grid: { x: number; y: number };
}

interface NormalizedOptions {
  smoothRadiusPx: number;
  neighborhoodRadiusPx: number;
  sampleStridePx: number;
  plateauTolerance: number;
  closedContourDelta: number;
  closedContourRadiusKm: number;
  minProminenceHpa: number;
  minLocalProminenceHpa: number;
  minDistanceKm: number;
  maxCentersPerType: number;
  validRange: [number, number];
}

interface TilePlacement {
  input: GeoDemTile;
  width: number;
  height: number;
  tileSize: number;
  offsetX: number;
  offsetY: number;
  globalOriginX: number;
  globalOriginY: number;
}

interface PressureGrid {
  width: number;
  height: number;
  data: Float32Array;
  valid: Uint8Array;
  originX: number;
  originY: number;
  resolution: number;
  tileZ: number;
  placements: TilePlacement[];
}

const EARTH_RADIUS_KM = 6371.0088;
const DEFAULT_OPTIONS: NormalizedOptions = {
  smoothRadiusPx: 1,
  neighborhoodRadiusPx: 4,
  sampleStridePx: 1,
  plateauTolerance: 0.05,
  closedContourDelta: 2,
  closedContourRadiusKm: 600,
  minProminenceHpa: 0,
  minLocalProminenceHpa: 0,
  minDistanceKm: 600,
  maxCentersPerType: 8,
  validRange: [800, 1100],
};

export function findPressureCentersInTiles(
  tiles: GeoDemTile[],
  options: PressureCenterOptions = {},
  shouldContinue: () => boolean = () => true,
): PressureCenter[] {
  if (tiles.length === 0 || !shouldContinue()) {
    return [];
  }

  const resolved = normalizeOptions(options);
  const grid = buildPressureGrid(tiles, resolved.validRange);
  if (!grid || !shouldContinue()) {
    return [];
  }

  const data =
    resolved.smoothRadiusPx > 0
      ? smoothGrid(grid, resolved.smoothRadiusPx, shouldContinue)
      : grid.data;
  if (!shouldContinue()) {
    return [];
  }
  const candidates = collectCandidates(grid, data, resolved, shouldContinue);
  if (!shouldContinue()) {
    return [];
  }
  return filterByDistance(candidates, resolved);
}

export function mercatorPixelToLngLat(
  z: number,
  globalPixelX: number,
  globalPixelY: number,
  tileSize: number,
): { lng: number; lat: number } {
  // Pressure tiles are XYZ/Web Mercator tiles, so latitude must be inverted
  // with atan(sinh(...)); linear interpolation in degrees would move labels.
  const worldSize = tileSize * 2 ** z;
  const lng = (globalPixelX / worldSize) * 360 - 180;
  const mercatorY = Math.PI * (1 - (2 * globalPixelY) / worldSize);
  const lat = (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI;
  return { lng, lat };
}

function normalizeOptions(options: PressureCenterOptions): NormalizedOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    smoothRadiusPx: Math.max(0, Math.floor(options.smoothRadiusPx ?? DEFAULT_OPTIONS.smoothRadiusPx)),
    neighborhoodRadiusPx: Math.max(
      1,
      Math.floor(options.neighborhoodRadiusPx ?? DEFAULT_OPTIONS.neighborhoodRadiusPx),
    ),
    sampleStridePx: Math.max(
      1,
      Math.floor(options.sampleStridePx ?? DEFAULT_OPTIONS.sampleStridePx),
    ),
    plateauTolerance: Math.max(
      0,
      options.plateauTolerance ?? DEFAULT_OPTIONS.plateauTolerance,
    ),
    minProminenceHpa: Math.max(
      0,
      options.minProminenceHpa ?? DEFAULT_OPTIONS.minProminenceHpa,
    ),
    minLocalProminenceHpa: Math.max(
      0,
      options.minLocalProminenceHpa ?? DEFAULT_OPTIONS.minLocalProminenceHpa,
    ),
    maxCentersPerType: Math.max(
      1,
      Math.floor(options.maxCentersPerType ?? DEFAULT_OPTIONS.maxCentersPerType),
    ),
  };
}

function buildPressureGrid(
  tiles: GeoDemTile[],
  validRange: [number, number],
): PressureGrid | undefined {
  const first = tiles[0];
  const z = first.z;
  const tileSize = first.tileSize ?? first.tile.width;
  const resolution = tileSize / first.tile.width;

  const placements: TilePlacement[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const input of tiles) {
    const currentTileSize = input.tileSize ?? input.tile.width;
    if (input.z !== z || currentTileSize !== tileSize) {
      throw new Error("findPressureCentersInTiles requires tiles from the same zoom and tile size");
    }
    const currentResolution = currentTileSize / input.tile.width;
    if (currentResolution !== resolution || input.tile.width !== input.tile.height) {
      throw new Error("findPressureCentersInTiles requires square tiles with matching resolution");
    }

    const globalOriginX = input.x * tileSize;
    const globalOriginY = input.y * tileSize;
    minX = Math.min(minX, globalOriginX);
    minY = Math.min(minY, globalOriginY);
    maxX = Math.max(maxX, globalOriginX + tileSize);
    maxY = Math.max(maxY, globalOriginY + tileSize);
    placements.push({
      input,
      width: input.tile.width,
      height: input.tile.height,
      tileSize,
      offsetX: 0,
      offsetY: 0,
      globalOriginX,
      globalOriginY,
    });
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return undefined;
  }

  const width = Math.round((maxX - minX) / resolution);
  const height = Math.round((maxY - minY) / resolution);
  const data = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  data.fill(Number.NaN);

  for (const placement of placements) {
    placement.offsetX = Math.round((placement.globalOriginX - minX) / resolution);
    placement.offsetY = Math.round((placement.globalOriginY - minY) / resolution);
    const source = placement.input.tile.data;
    // Stitch all input tiles into a single world-pixel grid so extrema near tile
    // boundaries are judged against their real neighboring pressure values.
    for (let y = 0; y < placement.height; y++) {
      for (let x = 0; x < placement.width; x++) {
        const sourceValue = source[y * placement.width + x];
        const destIndex = (placement.offsetY + y) * width + placement.offsetX + x;
        if (
          Number.isFinite(sourceValue) &&
          sourceValue >= validRange[0] &&
          sourceValue <= validRange[1]
        ) {
          data[destIndex] = sourceValue;
          valid[destIndex] = 1;
        }
      }
    }
  }

  return {
    width,
    height,
    data,
    valid,
    originX: minX,
    originY: minY,
    resolution,
    tileZ: z,
    placements,
  };
}

function smoothGrid(
  grid: PressureGrid,
  radius: number,
  shouldContinue: () => boolean,
): Float32Array {
  const result = new Float32Array(grid.data.length);
  result.fill(Number.NaN);

  for (let y = 0; y < grid.height; y++) {
    if (!shouldContinue()) {
      return result;
    }
    for (let x = 0; x < grid.width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= grid.height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= grid.width) continue;
          const index = yy * grid.width + xx;
          if (!grid.valid[index]) continue;
          sum += grid.data[index];
          count++;
        }
      }
      if (count > 0) {
        result[y * grid.width + x] = sum / count;
      }
    }
  }

  return result;
}

function collectCandidates(
  grid: PressureGrid,
  data: Float32Array,
  options: NormalizedOptions,
  shouldContinue: () => boolean,
): PressureCenterCandidate[] {
  const candidates: PressureCenterCandidate[] = [];
  const radius = options.neighborhoodRadiusPx;
  const stride = options.sampleStridePx;
  const plateauCache = new Map<number, { x: number; y: number }>();
  const emittedPlateaus = new Set<string>();
  const plateauVisit = new Uint32Array(grid.width * grid.height);
  const contourVisit = new Uint32Array(grid.width * grid.height);
  let plateauVisitStamp = 0;
  let contourVisitStamp = 0;

  for (let y = radius; y < grid.height - radius; y += stride) {
    if (!shouldContinue()) {
      return candidates;
    }
    for (let x = radius; x < grid.width - radius; x += stride) {
      const index = y * grid.width + x;
      if (!grid.valid[index]) continue;

      const value = data[index];
      let isHigh = true;
      let isLow = true;
      let minNeighbor = Infinity;
      let maxNeighbor = -Infinity;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const neighborIndex = (y + dy) * grid.width + x + dx;
          if (!grid.valid[neighborIndex]) {
            isHigh = false;
            isLow = false;
            continue;
          }
          const neighbor = data[neighborIndex];
          minNeighbor = Math.min(minNeighbor, neighbor);
          maxNeighbor = Math.max(maxNeighbor, neighbor);
          if (value < neighbor - options.plateauTolerance) isHigh = false;
          if (value > neighbor + options.plateauTolerance) isLow = false;
        }
      }

      if (!isHigh && !isLow) continue;

      const type: PressureCenterType = isHigh ? "H" : "L";
      const prominence = isHigh ? value - minNeighbor : maxNeighbor - value;
      // Gate entry into the candidate pool with `minLocalProminenceHpa`
      // (independent of `closedContourDelta`, which controls the BFS
      // threshold for closed-isobar verification below).
      if (
        options.minLocalProminenceHpa > 0 &&
        prominence < options.minLocalProminenceHpa
      ) {
        continue;
      }
      const plateauCenter = getPlateauCenter(
        grid,
        data,
        x,
        y,
        value,
        options.plateauTolerance,
        plateauCache,
        plateauVisit,
        ++plateauVisitStamp,
      );
      const plateauKey = `${type}:${Math.round(plateauCenter.x * 1000)}:${Math.round(plateauCenter.y * 1000)}`;
      if (emittedPlateaus.has(plateauKey)) {
        continue;
      }
      if (
        !hasClosedPressureContour(
          grid,
          data,
          x,
          y,
          type,
          value,
          options,
          contourVisit,
          ++contourVisitStamp,
          shouldContinue,
        )
      ) {
        continue;
      }
      emittedPlateaus.add(plateauKey);
      const refined =
        plateauCenter.x === x && plateauCenter.y === y
          ? refinePixelByQuadraticFit(grid, data, x, y, type)
          : plateauCenter;
      const globalPixelX = grid.originX + (refined.x + 0.5) * grid.resolution;
      const globalPixelY = grid.originY + (refined.y + 0.5) * grid.resolution;
      const placement = findPlacement(grid, globalPixelX, globalPixelY);
      if (!placement) continue;

      const { lng, lat } = mercatorPixelToLngLat(
        grid.tileZ,
        globalPixelX,
        globalPixelY,
        placement.tileSize,
      );

      candidates.push({
        type,
        lng,
        lat,
        value,
        prominence,
        pixel: {
          x: (globalPixelX - placement.globalOriginX) / placement.tileSize * placement.width,
          y: (globalPixelY - placement.globalOriginY) / placement.tileSize * placement.height,
        },
        sourceTile: {
          z: placement.input.z,
          x: placement.input.x,
          y: placement.input.y,
        },
        globalPixel: { x: globalPixelX, y: globalPixelY },
        grid: { x, y },
      });
    }
  }

  return candidates;
}

function hasClosedPressureContour(
  grid: PressureGrid,
  data: Float32Array,
  startX: number,
  startY: number,
  type: PressureCenterType,
  centerValue: number,
  options: NormalizedOptions,
  visited: Uint32Array,
  visitStamp: number,
  shouldContinue: () => boolean,
): boolean {
  const startLonLat = gridPointToLngLat(grid, startX, startY);
  const threshold =
    type === "H"
      ? centerValue - options.closedContourDelta
      : centerValue + options.closedContourDelta;
  // TempestExtremes-style check: flood through the area inside the requested
  // pressure delta. If it reaches the search radius, the center is not enclosed.
  const queueX = [startX];
  const queueY = [startY];
  visited[startY * grid.width + startX] = visitStamp;

  for (let cursor = 0; cursor < queueX.length; cursor++) {
    if ((cursor & 255) === 0 && !shouldContinue()) {
      return false;
    }
    const x = queueX[cursor];
    const y = queueY[cursor];
    const { lng, lat } = gridPointToLngLat(grid, x, y);
    if (haversineKm(startLonLat, { lng, lat }) >= options.closedContourRadiusKm) {
      return false;
    }

    for (const [dx, dy] of NEIGHBORS_8) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= grid.width || yy < 0 || yy >= grid.height) {
        return false;
      }
      const index = yy * grid.width + xx;
      if (visited[index] === visitStamp) continue;
      if (!grid.valid[index]) {
        return false;
      }

      const value = data[index];
      const inside = type === "H" ? value > threshold : value < threshold;
      if (!inside) continue;

      visited[index] = visitStamp;
      queueX.push(xx);
      queueY.push(yy);
    }
  }

  return true;
}

function refinePixelByQuadraticFit(
  grid: PressureGrid,
  data: Float32Array,
  x: number,
  y: number,
  type: PressureCenterType,
): { x: number; y: number } {
  const center = data[y * grid.width + x];
  const left = data[y * grid.width + x - 1];
  const right = data[y * grid.width + x + 1];
  const top = data[(y - 1) * grid.width + x];
  const bottom = data[(y + 1) * grid.width + x];
  const offsetX = parabolaVertexOffset(left, center, right);
  const offsetY = parabolaVertexOffset(top, center, bottom);
  const clamp = type === "H" || type === "L";

  return {
    x: x + (clamp ? clampOffset(offsetX) : 0),
    y: y + (clamp ? clampOffset(offsetY) : 0),
  };
}

function getPlateauCenter(
  grid: PressureGrid,
  data: Float32Array,
  startX: number,
  startY: number,
  value: number,
  tolerance: number,
  cache: Map<number, { x: number; y: number }>,
  visited: Uint32Array,
  visitStamp: number,
): { x: number; y: number } {
  const startIndex = startY * grid.width + startX;
  const cached = cache.get(startIndex);
  if (cached) {
    return cached;
  }

  const queueX = [startX];
  const queueY = [startY];
  const plateauIndexes: number[] = [];
  visited[startIndex] = visitStamp;
  let sumX = 0;
  let sumY = 0;

  for (let cursor = 0; cursor < queueX.length; cursor++) {
    const x = queueX[cursor];
    const y = queueY[cursor];
    const index = y * grid.width + x;
    plateauIndexes.push(index);
    sumX += x;
    sumY += y;

    for (const [dx, dy] of NEIGHBORS_8) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= grid.width || yy < 0 || yy >= grid.height) {
        continue;
      }
      const neighborIndex = yy * grid.width + xx;
      if (visited[neighborIndex] === visitStamp || !grid.valid[neighborIndex]) {
        continue;
      }
      if (Math.abs(data[neighborIndex] - value) > tolerance) {
        continue;
      }

      visited[neighborIndex] = visitStamp;
      queueX.push(xx);
      queueY.push(yy);
    }
  }

  const center =
    plateauIndexes.length > 1
      ? { x: sumX / plateauIndexes.length, y: sumY / plateauIndexes.length }
      : { x: startX, y: startY };
  for (const index of plateauIndexes) {
    cache.set(index, center);
  }
  return center;
}

function parabolaVertexOffset(prev: number, center: number, next: number): number {
  const denominator = prev - 2 * center + next;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) {
    return 0;
  }
  return 0.5 * (prev - next) / denominator;
}

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-0.5, Math.min(0.5, value));
}

function filterByDistance(
  candidates: PressureCenterCandidate[],
  options: NormalizedOptions,
): PressureCenter[] {
  const result: PressureCenter[] = [];
  const minProminence = options.minProminenceHpa;
  for (const type of ["H", "L"] as const) {
    const accepted: PressureCenterCandidate[] = [];
    const sorted = candidates
      .filter(
        (candidate) =>
          candidate.type === type &&
          (minProminence <= 0 || candidate.prominence >= minProminence),
      )
      .sort((a, b) =>
        type === "H"
          ? b.value - a.value || b.prominence - a.prominence
          : a.value - b.value || b.prominence - a.prominence,
      );

    for (const candidate of sorted) {
      const tooClose = accepted.some(
        (existing) =>
          haversineKm(existing, candidate) <= Math.max(options.minDistanceKm, 1e-6),
      );
      if (tooClose) continue;
      accepted.push(candidate);
      const { globalPixel, grid, ...publicCenter } = candidate;
      result.push(publicCenter);
      if (accepted.length >= options.maxCentersPerType) {
        break;
      }
    }
  }

  return result;
}

function findPlacement(
  grid: PressureGrid,
  globalPixelX: number,
  globalPixelY: number,
): TilePlacement | undefined {
  return grid.placements.find(
    (placement) =>
      globalPixelX >= placement.globalOriginX &&
      globalPixelX < placement.globalOriginX + placement.tileSize &&
      globalPixelY >= placement.globalOriginY &&
      globalPixelY < placement.globalOriginY + placement.tileSize,
  );
}

function gridPointToLngLat(
  grid: PressureGrid,
  x: number,
  y: number,
): { lng: number; lat: number } {
  const globalPixelX = grid.originX + (x + 0.5) * grid.resolution;
  const globalPixelY = grid.originY + (y + 0.5) * grid.resolution;
  return mercatorPixelToLngLat(
    grid.tileZ,
    globalPixelX,
    globalPixelY,
    grid.placements[0].tileSize,
  );
}

function haversineKm(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

const NEIGHBORS_8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
