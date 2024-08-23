/** Scheme used to map pixel rgb values elevations. */
export type Encoding = "terrarium" | "mapbox";
export interface IsTransferrable {
  transferrables: Transferable[];
}
/** A decoded `raster-rgb` image. */
export interface DemTile {
  width: number;
  height: number;
  /** elevation values in row-major order */
  data: Float32Array;
}
export interface TransferrableDemTile extends DemTile, IsTransferrable {}
/** A rendered contour tile */
export interface ContourTile {
  /** Encoded mapbox vector tile bytes */
  arrayBuffer: ArrayBuffer;
}
export interface TransferrableContourTile
  extends ContourTile,
    IsTransferrable {}

export interface FetchResponse {
  data: Blob;
  expires?: string;
  cacheControl?: string;
}

/** Parameters to use when creating a contour vector tile from raw elevation data */
export interface ContourTileOptions {
  /** Factor to scale the elevation meters by to support different units (default 1 for meters) */
  multiplier?: number;
  /**
   * Request `raster-dem` tiles from lower zoom levels to generate the contour vector tile.
   *
   * The default value is 0, which means to generate a contour vector tile at z10, it gets
   * the z10 `raster-dem` tile plus its 8 neighbors
   *
   * Setting to 1 requests a z9 tile and uses one quadrant of it so that it only needs up to 3
   * neighboring tiles to get the neighboring elevation data. It also improves performance with
   * 512x512 or larger `raster-dem` tiles.
   */
  overzoom?: number;
  /** Key for the elevation property to set on each contour line. */
  elevationKey?: string;
  /** Key for the "level" property to set on each contour line. Minor lines have level=0, major have level=1 */
  levelKey?: string;
  /** Name of the vector tile layer to put contour lines in */
  contourLayer?: string;
  /** Grid size of the vector tile (default 4096) */
  extent?: number;
  /** How many pixels to generate on each tile into the neighboring tile to reduce rendering artifacts */
  buffer?: number;
  /** When overzooming tiles, subsample to scale up to at least this size to make the contour lines smoother at higher zooms. */
  subsampleBelow?: number;
}

export interface GlobalContourTileOptions extends ContourTileOptions {
  /**
   * Map from zoom level to the `[minor, major]` elevation distance between contour lines.
   *
   * Contour lines without an entry will use the threshold for the next lower zoom.
   *
   * The `level` tag on each contour line will have an integer that corresponds to the largest index in
   * this array that the elevation is a multiple of.
   */
  thresholds: { [n: number]: number | number[] };
}

export interface IndividualContourTileOptions extends ContourTileOptions {
  levels: number[];
}

export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface InitMessage {
  managerId: number;
  demUrlPattern: string;
  cacheSize: number;
  encoding: Encoding;
  maxzoom: number;
  timeoutMs: number;
}

export type TimingCategory = "main" | "worker" | "fetch" | "decode" | "isoline";

/** Performance profile for a tile request */
export interface Timing {
  /** The "virtual" tile url using the protocol ID registered with maplibre */
  url: string;
  /** Timing origin that all marks are relative to. */
  origin: number;
  /** Overall duration of the request */
  duration: number;
  /** Time spent fetching all resources, or `undefined` if they were cached */
  fetch?: number;
  /** Time spent decoding all raster-rgb images, or `undefined` if it was cached */
  decode?: number;
  /** Time spent generating isolines and rendering the vector tile, or `undefined` if it was cached */
  process?: number;
  wait: number;
  /** Number of tiles used for generation, even if they were cached */
  tilesUsed: number;
  /** Map from category (fetch, main, isoline) to list of start/end timestamps */
  marks: {
    [key in TimingCategory]?: number[][];
  };
  /** Detailed timing for all resources actually fetched (not cached) to generate this tile */
  resources: PerformanceResourceTiming[];
  /** If the tile failed with an error */
  error?: boolean;
}
