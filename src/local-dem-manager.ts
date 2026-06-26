import AsyncCache from "./cache";
import defaultDecodeImage from "./decode-image";
import { HeightTile } from "./height-tile";
import generateIsolines from "./isolines";
import { findPressureCentersInTiles } from "./pressure-centers";
import { encodeIndividualOptions, isAborted, withTimeout } from "./utils";
import type {
  ContourTile,
  DecodeImageFunction,
  DemManager,
  DemManagerInitizlizationParameters,
  DemSourceSnapshot,
  DemTile,
  Encoding,
  FetchResponse,
  GetTileFunction,
  IndividualContourTileOptions,
  PressureCenterCalculation,
  PressureCenterTileRequest,
  PressureCenterTileOptions,
} from "./types";
import type { PressureCenterOptions } from "./pressure-centers";
import encodeVectorTile, { GeomType } from "./vtpbf";
import { Timer } from "./performance";

const defaultGetTile: GetTileFunction = async (
  url: string,
  abortController: AbortController,
) => {
  const options: RequestInit = {
    signal: abortController.signal,
  };
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Bad response: ${response.status} for ${url}`);
  }
  return {
    data: await response.blob(),
    expires: response.headers.get("expires") || undefined,
    cacheControl: response.headers.get("cache-control") || undefined,
  };
};

/**
 * Caches, decodes, and processes raster tiles in the current thread.
 */
export class LocalDemManager implements DemManager {
  tileCache: AsyncCache<string, FetchResponse>;
  parsedCache: AsyncCache<string, DemTile>;
  contourCache: AsyncCache<string, ContourTile>;
  pressureCenterTileCache: AsyncCache<string, ContourTile>;
  activeSource: DemSourceSnapshot;
  sources: Map<string, DemSourceSnapshot>;
  encoding: Encoding;
  maxzoom: number;
  timeoutMs: number;
  loaded = Promise.resolve();
  decodeImage: DecodeImageFunction;
  getTile: GetTileFunction;

  constructor(options: DemManagerInitizlizationParameters) {
    this.tileCache = new AsyncCache(options.cacheSize);
    this.parsedCache = new AsyncCache(options.cacheSize);
    this.contourCache = new AsyncCache(options.cacheSize);
    this.pressureCenterTileCache = new AsyncCache(options.cacheSize);
    this.timeoutMs = options.timeoutMs;
    this.activeSource = options.source;
    this.sources = new Map([[options.source.key, options.source]]);
    this.encoding = options.encoding;
    this.maxzoom = options.maxzoom;
    this.decodeImage = options.decodeImage || defaultDecodeImage;
    this.getTile = options.getTile || defaultGetTile;
  }

  fetchTile(
    z: number,
    x: number,
    y: number,
    parentAbortController: AbortController,
    timer?: Timer,
  ): Promise<FetchResponse> {
    return this.fetchTileForSource(
      this.activeSource,
      z,
      x,
      y,
      parentAbortController,
      timer,
    );
  }

  private tileUrl(source: DemSourceSnapshot, z: number, x: number, y: number) {
    return source.urlPattern
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString());
  }

  private fetchTileForSource(
    source: DemSourceSnapshot,
    z: number,
    x: number,
    y: number,
    parentAbortController: AbortController,
    timer?: Timer,
  ): Promise<FetchResponse> {
    const url = this.tileUrl(source, z, x, y);
    timer?.useTile(url);
    return this.tileCache.get(
      url,
      (_, childAbortController) => {
        timer?.fetchTile(url);
        const mark = timer?.marker("fetch");
        return withTimeout(
          this.timeoutMs,
          this.getTile(url, childAbortController).finally(() => mark?.()),
          childAbortController,
        );
      },
      parentAbortController,
    );
  }
  fetchAndParseTile(
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<DemTile> {
    return this.fetchAndParseTileForSource(
      this.activeSource,
      z,
      x,
      y,
      abortController,
      timer,
    );
  }

  private fetchAndParseTileForSource(
    source: DemSourceSnapshot,
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<DemTile> {
    const url = this.tileUrl(source, z, x, y);

    timer?.useTile(url);

    return this.parsedCache.get(
      url,
      async (_, childAbortController) => {
        const response = await this.fetchTileForSource(
          source,
          z,
          x,
          y,
          childAbortController,
          timer,
        );
        if (isAborted(childAbortController)) throw new Error("canceled");
        const promise = this.decodeImage(
          response.data,
          this.encoding,
          childAbortController,
        );
        const mark = timer?.marker("decode");
        const result = await promise;
        mark?.();
        return result;
      },
      abortController,
    );
  }

  private async fetchDemForSource(
    source: DemSourceSnapshot,
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<HeightTile> {
    const zoom = Math.min(z - (options.overzoom || 0), this.maxzoom);
    const subZ = z - zoom;
    const div = 1 << subZ;
    const newX = Math.floor(x / div);
    const newY = Math.floor(y / div);

    const tile = await this.fetchAndParseTileForSource(
      source,
      zoom,
      newX,
      newY,
      abortController,
      timer,
    );

    return HeightTile.fromRawDem(tile).split(subZ, x % div, y % div);
  }

  fetchContourTile(
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    parentAbortController: AbortController,
    timer?: Timer,
  ): Promise<ContourTile> {
    const {
      levels,
      multiplier = 1,
      buffer = 1,
      extent = 4096,
      contourLayer = "contours",
      elevationKey = "ele",
      levelKey = "level",
      subsampleBelow = 100,
    } = options;

    // no levels means less than min zoom with levels specified
    if (!levels || levels.length === 0) {
      return Promise.resolve({ arrayBuffer: new ArrayBuffer(0) });
    }
    const source = this.activeSource;
    const key = [source.key, z, x, y, encodeIndividualOptions(options)].join(
      "/",
    );
    return this.contourCache.get(
      key,
      async (_, childAbortController) => {
        const max = 1 << z;
        const neighborPromises: (Promise<HeightTile> | undefined)[] = [];
        for (let iy = y - 1; iy <= y + 1; iy++) {
          for (let ix = x - 1; ix <= x + 1; ix++) {
            neighborPromises.push(
              iy < 0 || iy >= max
                ? undefined
                : this.fetchDemForSource(
                    source,
                    z,
                    (ix + max) % max,
                    iy,
                    options,
                    childAbortController,
                    timer,
                  ),
            );
          }
        }
        const neighbors = await Promise.all(neighborPromises);
        let virtualTile = HeightTile.combineNeighbors(neighbors);
        if (!virtualTile || isAborted(childAbortController)) {
          return { arrayBuffer: new Uint8Array().buffer };
        }
        const mark = timer?.marker("isoline");

        if (virtualTile.width >= subsampleBelow) {
          virtualTile = virtualTile.materialize(2);
        } else {
          while (virtualTile.width < subsampleBelow) {
            virtualTile = virtualTile.subsamplePixelCenters(2).materialize(2);
          }
        }

        virtualTile = virtualTile
          .averagePixelCentersToGrid()
          .scaleElevation(multiplier)
          .materialize(1);

        const isolines = generateIsolines(
          levels[0],
          virtualTile,
          extent,
          buffer,
        );

        mark?.();
        const result = encodeVectorTile({
          extent,
          layers: {
            [contourLayer]: {
              features: Object.entries(isolines).map(([eleString, geom]) => {
                const ele = Number(eleString);
                return {
                  type: GeomType.LINESTRING,
                  geometry: geom,
                  properties: {
                    [elevationKey]: ele,
                    [levelKey]: Math.max(
                      ...levels.map((l, i) => (ele % l === 0 ? i : 0)),
                    ),
                  },
                };
              }),
            },
          },
        });
        mark?.();

        return { arrayBuffer: result.slice().buffer };
      },
      parentAbortController,
    );
  }

  async fetchPressureCenters(
    tiles: PressureCenterTileRequest[],
    options: PressureCenterOptions,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<PressureCenterCalculation> {
    const source = this.activeSource;
    const tileResults = await Promise.allSettled(
      tiles.map(async (tile) => ({
        ...tile,
        tile: await this.fetchAndParseTileForSource(
          source,
          tile.z,
          tile.x,
          tile.y,
          abortController,
          timer,
        ),
      })),
    );
    const demTiles = tileResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    if (demTiles.length === 0 || isAborted(abortController)) {
      return { centers: [], complete: false };
    }

    const mark = timer?.marker("isoline");
    // H/L center detection is cross-tile CPU work, so run it beside contour
    // generation in the worker-backed manager instead of blocking the UI thread.
    const centers = findPressureCentersInTiles(
      demTiles,
      options,
      () => !isAborted(abortController),
    );
    mark?.();

    if (isAborted(abortController)) {
      return { centers: [], complete: false };
    }

    return {
      centers,
      complete: demTiles.length === tiles.length,
    };
  }

  fetchPressureCenterTile(
    z: number,
    x: number,
    y: number,
    options: PressureCenterTileOptions,
    parentAbortController: AbortController,
    timer?: Timer,
  ): Promise<ContourTile> {
    const {
      centerLayer = "pressure-centers",
      extent = 4096,
      typeKey = "type",
      valueKey = "value",
      prominenceKey = "prominence",
      ...centerOptions
    } = options;
    const source = this.activeSource;
    const centerKey = JSON.stringify(centerOptions);
    const key = [source.key, z, x, y, "pressure-centers", centerKey, centerLayer].join("/");

    return this.pressureCenterTileCache.get(
      key,
      async (_, childAbortController) => {
        // Match the per-tile 3×3 context pattern used by fetchContourTile.
        // Expand the requested tile area at maxzoom by one tile in each
        // direction so the closed-contour BFS does not hit an artificial
        // tile boundary and reject legitimate H/L centers.
        const dz = this.maxzoom - z;
        const xMin = x << dz;
        const yMin = y << dz;
        const xMax = (x + 1) << dz;
        const yMax = (y + 1) << dz;
        const n = 1 << this.maxzoom;

        const seen = new Set<string>();
        const tileCoords: { x: number; y: number }[] = [];
        for (let ty = yMin; ty < yMax; ty++) {
          for (let tx = xMin; tx < xMax; tx++) {
            for (let ny = -1; ny <= 1; ny++) {
              for (let nx = -1; nx <= 1; nx++) {
                const adjX = ((tx + nx) % n + n) % n;
                const adjY = ((ty + ny) % n + n) % n;
                const key = `${adjX}:${adjY}`;
                if (seen.has(key)) continue;
                seen.add(key);
                tileCoords.push({ x: adjX, y: adjY });
              }
            }
          }
        }

        const tilePromises = tileCoords.map((tc) =>
          this.fetchAndParseTileForSource(
            source,
            this.maxzoom,
            tc.x,
            tc.y,
            childAbortController,
            timer,
          ).then((tile) => ({
            z: this.maxzoom,
            x: tc.x,
            y: tc.y,
            tile,
            tileSize: tile.width,
          })),
        );

        if (isAborted(childAbortController)) {
          return { arrayBuffer: new ArrayBuffer(0) };
        }

        const tileResults = await Promise.allSettled(tilePromises);
        const demTiles = tileResults
          .filter((r) => r.status === "fulfilled" && r.value.tile)
          .map((r) => (r as PromiseFulfilledResult<{ z: number; x: number; y: number; tile: DemTile; tileSize: number }>).value);

        if (demTiles.length === 0 || isAborted(childAbortController)) {
          return { arrayBuffer: new ArrayBuffer(0) };
        }

        const mark = timer?.marker("isoline");
        const allCenters = findPressureCentersInTiles(
          demTiles,
          centerOptions,
          () => !isAborted(childAbortController),
        );
        mark?.();

        if (isAborted(childAbortController)) {
          return { arrayBuffer: new ArrayBuffer(0) };
        }

        const centers = allCenters.filter((center) =>
          isLngLatInTile(center.lng, center.lat, z, x, y),
        );

        const result = encodeVectorTile({
          extent,
          layers: {
            [centerLayer]: {
              features: centers.map((center) => ({
                type: GeomType.POINT,
                geometry: [lngLatToVectorTilePoint(center.lng, center.lat, z, x, y, extent)],
                properties: {
                  [typeKey]: center.type,
                  [valueKey]: center.value,
                  [prominenceKey]: center.prominence,
                },
              })),
            },
          },
        });

        return { arrayBuffer: result.slice().buffer };
      },
      parentAbortController,
    );
  }

  setSource(source: DemSourceSnapshot): boolean {
    if (this.activeSource.key === source.key) {
      return false;
    }
    this.sources.set(source.key, source);
    this.activeSource = source;
    return true;
  }

  /** Updates the DEM tile URL pattern */
  updateUrl(url: string): void {
    this.setSource({ key: url, urlPattern: url });
  }
}

function isLngLatInTile(
  lng: number,
  lat: number,
  z: number,
  x: number,
  y: number,
): boolean {
  const point = lngLatToTileXY(lng, lat, z);
  return point.x >= x && point.x < x + 1 && point.y >= y && point.y < y + 1;
}

function lngLatToVectorTilePoint(
  lng: number,
  lat: number,
  z: number,
  x: number,
  y: number,
  extent: number,
): number[] {
  const point = lngLatToTileXY(lng, lat, z);
  return [
    Math.round((point.x - x) * extent),
    Math.round((point.y - y) * extent),
  ];
}

function lngLatToTileXY(
  lng: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const normalizedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
  return {
    x: ((normalizedLng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}
