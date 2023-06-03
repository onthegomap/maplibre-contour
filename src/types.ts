export type Encoding = "terrarium" | "mapbox";
export interface IsTransferrable {
  transferrables: Transferable[];
}
export interface DemTile {
  width: number;
  height: number;
  data: Float32Array;
}
export interface TransferrableDemTile extends DemTile, IsTransferrable {}
export interface ContourTile {
  arrayBuffer: ArrayBuffer;
}
export interface TransferrableContourTile
  extends ContourTile,
    IsTransferrable {}

export interface Cancelable {
  cancel: () => void;
}

export interface CancelablePromise<T> extends Cancelable {
  value: Promise<T>;
}

export interface FetchResponse {
  data: Blob;
  expires?: string;
  cacheControl?: string;
}

export interface ContourTileOptions {
  multiplier?: number;
  overzoom?: number;
  elevationKey?: string;
  levelKey?: string;
  contourLayer?: string;
  extent?: number;
  buffer?: number;
}

export interface GlobalContourTileOptions extends ContourTileOptions {
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

export interface Timing {
  url: String;
  origin: number;
  duration: number;
  fetch?: number;
  decode?: number;
  process?: number;
  wait: number;
  tilesUsed: number;
  marks: {
    [key in TimingCategory]?: number[][];
  };
  resources: PerformanceResourceTiming[];
  error?: boolean;
}
