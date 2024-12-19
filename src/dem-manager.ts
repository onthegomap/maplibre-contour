import AsyncCache from "./cache";
import decodeImage from "./decode-image";
import { HeightTile } from "./height-tile";
import generateIsolines from "./isolines";
import { encodeIndividualOptions, isAborted } from "./utils";
import { openPMtiles, getPMtilesTile } from "./pmtiles-adapter-node";

import type {
  ContourTile,
  DemTile,
  Encoding,
  FetchResponse,
  IndividualContourTileOptions,
} from "./types";
import encodeVectorTile, { GeomType } from "./vtpbf";
import { Timer } from "./performance";
import type { PMTiles } from "pmtiles";

/**
 * Holds cached tile state, and exposes `fetchContourTile` which fetches the necessary
 * tiles and returns an encoded contour vector tiles.
 */
export interface DemManager {
  initializePMTiles(): unknown;
  loaded: Promise<any>;
  fetchTile(
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<FetchResponse>;
  fetchAndParseTile(
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<DemTile>;
  fetchContourTile(
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<ContourTile>;
}

/**
 * Caches, decodes, and processes raster tiles in the current thread.
 */
export class LocalDemManager implements DemManager {
  tileCache: AsyncCache<string, FetchResponse>;
  parsedCache: AsyncCache<string, DemTile>;
  contourCache: AsyncCache<string, ContourTile>;
  encoding: Encoding;
  maxzoom: number;
  pmtiles: PMTiles | null = null;
  fileUrl: string;
  timeoutMs: number;

  loaded = Promise.resolve();
  decodeImage: (
    blob: Blob,
    encoding: Encoding,
    abortController: AbortController,
  ) => Promise<DemTile> = decodeImage;

  constructor(
    fileUrl: string,
    cacheSize: number,
    encoding: Encoding,
    maxzoom: number,
    timeoutMs: number,
  ) {
    this.tileCache = new AsyncCache(cacheSize);
    this.parsedCache = new AsyncCache(cacheSize);
    this.contourCache = new AsyncCache(cacheSize);
    this.timeoutMs = timeoutMs;
    this.fileUrl = fileUrl;
    this.encoding = encoding;
    this.maxzoom = maxzoom;
    this.pmtiles = null;
  }

  public async initializePMTiles() {
    this.pmtiles = openPMtiles(this.fileUrl);
  }

  async fetchTile(
    z: number,
    x: number,
    y: number,
    parentAbortController: AbortController,
    timer?: Timer,
  ): Promise<FetchResponse> {
    if (!this.pmtiles) {
      throw new Error("pmtiles is not initialized.");
    }
    const url = `${z}/${x}/${y}`;

    timer?.useTile(url); // Use the timer here

    return new Promise(async (resolve, reject) => {
      if (parentAbortController.signal.aborted) {
        reject(new Error("Request aborted by parent."));
        return;
      }

      const childAbortController = new AbortController();
      parentAbortController.signal.addEventListener("abort", () => {
        childAbortController.abort();
      });

      try {
        timer?.fetchTile(url);
        const mark = timer?.marker("fetch");

        if (this.pmtiles) {
          const zxyTile = await getPMtilesTile(this.pmtiles, z, x, y);
          mark?.();

          if (zxyTile && zxyTile.data) {
            const blob = new Blob([zxyTile.data]);
            resolve({
              data: blob,
              expires: undefined,
              cacheControl: undefined,
            });
          } else {
            reject(new Error(`Tile data not found for z:${z} x:${x} y:${y}`));
          }
        } else {
          reject(new Error("pmtiles is not initialized."));
        }
      } catch (error) {
        reject(
          new Error(
            `Failed to fetch DEM tile for z:${z} x:${x} y:${y} from PMTiles: ${error}`,
          ),
        );
      } finally {
        childAbortController.abort();
      }
    });
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
    const url = `${z}/${x}/${y}`;
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
    const zoom = Math.min(z - (options.overzoom || 0), this.maxzoom);
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
                : this.fetchDem(
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

        return { arrayBuffer: result.buffer as ArrayBuffer };
      },
      parentAbortController,
    );
  }
}
