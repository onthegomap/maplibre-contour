import AsyncCache from "./cache";
import decodeImage from "./decode-image";
import { HeightTile } from "./height-tile";
import generateIsolines from "./isolines";
import { encodeIndividualOptions, withTimeout } from "./utils";
import {
  CancelablePromise,
  ContourTile,
  DemTile,
  Encoding,
  FetchResponse,
  IndividualContourTileOptions,
} from "./types";
import encodeVectorTile, { GeomType } from "./vtpbf";
import { Timer } from "./performance";

/**
 * Holds cached tile state, and exposes `fetchContourTile` which fetches the necessary
 * tiles and returns an encoded contour vector tiles.
 */
export interface DemManager {
  loaded: Promise<any>;
  fetchTile(
    z: number,
    x: number,
    y: number,
    timer?: Timer
  ): CancelablePromise<FetchResponse>;
  fetchAndParseTile(
    z: number,
    x: number,
    y: number,
    timer?: Timer
  ): CancelablePromise<DemTile>;
  fetchContourTile(
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    timer?: Timer
  ): CancelablePromise<ContourTile>;
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
  timeoutMs: number;
  loaded = Promise.resolve();
  decodeImage: (blob: Blob, encoding: Encoding) => CancelablePromise<DemTile> =
    decodeImage;

  constructor(
    demUrlPattern: string,
    cacheSize: number,
    encoding: Encoding,
    maxzoom: number,
    timeoutMs: number
  ) {
    this.tileCache = new AsyncCache(cacheSize);
    this.parsedCache = new AsyncCache(cacheSize);
    this.contourCache = new AsyncCache(cacheSize);
    this.timeoutMs = timeoutMs;
    this.demUrlPattern = demUrlPattern;
    this.encoding = encoding;
    this.maxzoom = maxzoom;
  }

  fetchTile(
    z: number,
    x: number,
    y: number,
    timer?: Timer
  ): CancelablePromise<FetchResponse> {
    const url = this.demUrlPattern
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString());
    timer?.useTile(url);
    return this.tileCache.getCancelable(url, () => {
      let cancel = () => {};
      const options: RequestInit = {};
      try {
        const controller = new AbortController();
        options.signal = controller.signal;
        cancel = () => controller.abort();
      } catch (e) {
        // ignore
      }
      timer?.fetchTile(url);
      const mark = timer?.marker("fetch");
      return withTimeout(this.timeoutMs, {
        value: fetch(url, options).then(async (response) => {
          mark?.();
          if (!response.ok) {
            throw new Error(`Bad response: ${response.status} for ${url}`);
          }
          return {
            data: await response.blob(),
            expires: response.headers.get("expires") || undefined,
            cacheControl: response.headers.get("cache-control") || undefined,
          };
        }),
        cancel,
      });
    });
  }
  fetchAndParseTile = (
    z: number,
    x: number,
    y: number,
    timer?: Timer
  ): CancelablePromise<DemTile> => {
    const self = this;
    const url = this.demUrlPattern
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString());

    timer?.useTile(url);

    return this.parsedCache.getCancelable(url, () => {
      const tile = self.fetchTile(z, x, y, timer);
      let canceled = false;
      let alsoCancel = () => {};
      return {
        value: tile.value.then(async (response) => {
          if (canceled) throw new Error("canceled");
          const result = self.decodeImage(response.data, self.encoding);
          alsoCancel = result.cancel;
          const mark = timer?.marker("decode");
          const value = await result.value;
          mark?.();
          return value;
        }),
        cancel: () => {
          canceled = true;
          alsoCancel();
          tile.cancel();
        },
      };
    });
  };

  fetchDem(
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    timer?: Timer
  ): CancelablePromise<HeightTile> {
    const zoom = Math.min(z - (options.overzoom || 0), this.maxzoom);
    const subZ = z - zoom;
    const div = 1 << subZ;
    const newX = Math.floor(x / div);
    const newY = Math.floor(y / div);

    const { value, cancel } = this.fetchAndParseTile(zoom, newX, newY, timer);
    const subX = x % div;
    const subY = y % div;

    return {
      value: value.then((tile) =>
        HeightTile.fromRawDem(tile).split(subZ, subX, subY)
      ),
      cancel,
    };
  }

  fetchContourTile(
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    timer?: Timer
  ): CancelablePromise<ContourTile> {
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
      return {
        cancel() {},
        value: Promise.resolve({ arrayBuffer: new ArrayBuffer(0) }),
      };
    }
    const key = [z, x, y, encodeIndividualOptions(options)].join("/");
    return this.contourCache.getCancelable(key, () => {
      const max = 1 << z;
      let canceled = false;
      const neighborPromises: (CancelablePromise<HeightTile> | null)[] = [];
      for (let iy = y - 1; iy <= y + 1; iy++) {
        for (let ix = x - 1; ix <= x + 1; ix++) {
          neighborPromises.push(
            iy < 0 || iy >= max
              ? null
              : this.fetchDem(z, (ix + max) % max, iy, options, timer)
          );
        }
      }
      const value = Promise.all(neighborPromises.map((n) => n?.value)).then(
        async (neighbors) => {
          let virtualTile = HeightTile.combineNeighbors(neighbors);
          if (!virtualTile || canceled) {
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
            buffer
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
                        ...levels.map((l, i) => (ele % l === 0 ? i : 0))
                      ),
                    },
                  };
                }),
              },
            },
          });
          mark?.();

          return { arrayBuffer: result.buffer };
        }
      );

      return {
        value,
        cancel() {
          canceled = true;
          neighborPromises.forEach((n) => n && n.cancel());
        },
      };
    });
  }
}
