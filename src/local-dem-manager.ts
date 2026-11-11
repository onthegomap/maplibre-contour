import AsyncCache from "./cache";
import defaultDecodeImage from "./decode-image";
import { HeightTile } from "./height-tile";
import generateIsolines from "./isolines";
import { copy, encodeIndividualOptions, isAborted, withTimeout } from "./utils";
import type {
  ContourTile,
  DecodeImageFunction,
  DemManager,
  DemManagerInitizlizationParameters,
  DemTile,
  Encoding,
  FetchResponse,
  GetTileFunction,
  IndividualContourTileOptions,
} from "./types";
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
    throw Object.assign(
      new Error(`Bad response: ${response.status} for ${url}`),
      { status: response.status },
    );
  }
  return {
    data: await response.blob(),
    expires: response.headers.get("expires") || undefined,
    cacheControl: response.headers.get("cache-control") || undefined,
  };
};

/**
 * Whether a DEM tile request failed because the tileset does not have that tile, as a sparse tileset that only
 * holds its higher zooms where there is data answers, and not because it could not be fetched.
 */
function isNotFound(error: unknown): boolean {
  return (error as { status?: number } | undefined)?.status === 404;
}

/**
 * Caches, decodes, and processes raster tiles in the current thread.
 */
export class LocalDemManager implements DemManager {
  tileCache: AsyncCache<string, FetchResponse>;
  parsedCache: AsyncCache<string, DemTile>;
  contourCache: AsyncCache<string, ContourTile>;
  demUrlPattern: string;
  encoding: Encoding;
  maxzoom: number;
  minzoom: number;
  sparse: boolean;
  timeoutMs: number;
  loaded = Promise.resolve();
  decodeImage: DecodeImageFunction;
  getTile: GetTileFunction;

  constructor(options: DemManagerInitizlizationParameters) {
    this.tileCache = new AsyncCache(options.cacheSize);
    this.parsedCache = new AsyncCache(options.cacheSize);
    this.contourCache = new AsyncCache(options.cacheSize);
    this.timeoutMs = options.timeoutMs;
    this.demUrlPattern = options.demUrlPattern;
    this.encoding = options.encoding;
    this.maxzoom = options.maxzoom;
    this.minzoom = options.minzoom ?? 0;
    this.sparse = options.sparse ?? false;
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
    const url = this.demUrlPattern
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString());
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
  fetchAndParseTile = (
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<DemTile> => {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const url = this.demUrlPattern
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString());

    timer?.useTile(url);

    return this.parsedCache.get(
      url,
      async (_, childAbortController) => {
        const response = await self.fetchTile(
          z,
          x,
          y,
          childAbortController,
          timer,
        );
        if (isAborted(childAbortController)) throw new Error("canceled");
        const promise = self.decodeImage(
          response.data,
          self.encoding,
          childAbortController,
        );
        const mark = timer?.marker("decode");
        const result = await promise;
        mark?.();
        return result;
      },
      abortController,
    );
  };

  async fetchDem(
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<HeightTile> {
    return this.fetchDemAtZoom(
      this.demZoom(z, options),
      z,
      x,
      y,
      abortController,
      timer,
    );
  }

  private demZoom(z: number, options: IndividualContourTileOptions): number {
    return Math.max(0, Math.min(z - (options.overzoom || 0), this.maxzoom));
  }

  /**
   * The DEM under the contour tile and its 8 neighbors, at the zoom `fetchDem` uses or, when the tileset answers
   * that the tile under the contour tile does not exist, at the closest lower zoom down to `minzoom` that has it -
   * a sparse tileset leaves out its higher zooms where it has no data for them. A neighbor the tileset does not
   * have is left out. Both only apply when `sparse` is enabled; otherwise any failed DEM request fails the tile.
   */
  private async fetchNeighbors(
    zoom: number,
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<(HeightTile | undefined)[]> {
    const max = 1 << z;
    const neighborPromises: (Promise<HeightTile | undefined> | undefined)[] =
      [];
    for (let iy = y - 1; iy <= y + 1; iy++) {
      for (let ix = x - 1; ix <= x + 1; ix++) {
        neighborPromises.push(
          iy < 0 || iy >= max
            ? undefined
            : this.fetchDemAtZoom(
                zoom,
                z,
                (ix + max) % max,
                iy,
                abortController,
                timer,
              ).catch((error) => {
                if (this.sparse && isNotFound(error)) {
                  return undefined;
                }
                throw error;
              }),
        );
      }
    }
    const neighbors = await Promise.all(neighborPromises);
    if (
      !this.sparse ||
      neighbors[4] ||
      zoom <= this.minzoom ||
      isAborted(abortController)
    ) {
      return neighbors;
    }
    return this.fetchNeighbors(zoom - 1, z, x, y, abortController, timer);
  }

  private async fetchDemAtZoom(
    zoom: number,
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<HeightTile> {
    const subZ = z - zoom;
    const div = 1 << subZ;
    const newX = Math.floor(x / div);
    const newY = Math.floor(y / div);

    const tile = await this.fetchAndParseTile(
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
    const key = [z, x, y, encodeIndividualOptions(options)].join("/");
    const cached = this.contourCache.get(
      key,
      async (_, childAbortController) => {
        const neighbors = await this.fetchNeighbors(
          this.demZoom(z, options),
          z,
          x,
          y,
          childAbortController,
          timer,
        );
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
    // maplibre transfers the buffer to its own worker, which would detach the
    // copy held in the cache, so give each caller its own
    return cached.then(({ arrayBuffer }) => ({
      arrayBuffer: copy(arrayBuffer),
    }));
  }
}
