import { DemManager, LocalDemManager } from "./dem-manager";
import { decodeOptions, encodeOptions, getOptionsForZoom } from "./utils";
import RemoteDemManager from "./remote-dem-manager";
import { DemTile, GlobalContourTileOptions, Timing } from "./types";
import type WorkerDispatch from "./worker-dispatch";
import Actor from "./actor";
import { Timer } from "./performance";

if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = (event) =>
        resolve(event.target?.result as ArrayBuffer);
      fileReader.onerror = reject;
      fileReader.readAsArrayBuffer(this);
    });
  };
}

// for maplibre interop
type RequestParameters = {
  url: string;
  headers?: any;
  method?: "GET" | "POST" | "PUT";
  body?: string;
  type?: "string" | "json" | "arrayBuffer";
  credentials?: "same-origin" | "include";
  collectResourceTiming?: boolean;
};
type ExpiryData = {
  cacheControl?: string | null;
  expires?: Date | string | null;
};
type GetResourceResponse<T> = ExpiryData & {
  data: T;
};
type AddProtocolAction = (
  requestParameters: RequestParameters,
  abortController: AbortController,
) => Promise<GetResourceResponse<any>>;

const used = new Set<string>();

/**
 * A remote source of DEM tiles that can be connected to maplibre.
 */
export class DemSource {
  sharedDemProtocolId: string;
  contourProtocolId: string;
  contourProtocolUrlBase: string;
  manager: DemManager;
  sharedDemProtocolUrl: string;
  timingCallbacks: Array<(timing: Timing) => void> = [];

  constructor({
    url,
    cacheSize = 100,
    id = "dem",
    encoding = "terrarium",
    maxzoom = 12,
    worker = true,
    timeoutMs = 10_000,
    actor,
  }: {
    /** Remote DEM tile url using `{z}` `{x}` and `{y}` placeholders */
    url: string;
    /** Number of most-recently-used tiles to cache */
    cacheSize?: number;
    /** Prefix for the maplibre protocol */
    id?: string;
    encoding?: "terrarium" | "mapbox";
    /** Maximum zoom of tiles contained in the source */
    maxzoom: number;
    timeoutMs?: number;
    /** Handle requests in a shared web worker to reduce UI-thread jank */
    worker?: boolean;
    actor?: Actor<WorkerDispatch>;
  }) {
    let protocolPrefix = id;
    let i = 1;
    while (used.has(protocolPrefix)) {
      protocolPrefix = id + i++;
    }
    used.add(protocolPrefix);
    this.sharedDemProtocolId = `${protocolPrefix}-shared`;
    this.contourProtocolId = `${protocolPrefix}-contour`;
    this.sharedDemProtocolUrl = `${this.sharedDemProtocolId}://{z}/{x}/{y}`;
    this.contourProtocolUrlBase = `${this.contourProtocolId}://{z}/{x}/{y}`;
    const ManagerClass = worker ? RemoteDemManager : LocalDemManager;
    this.manager = new ManagerClass(
      url,
      cacheSize,
      encoding,
      maxzoom,
      timeoutMs,
      actor,
    );
  }

  /** Registers a callback to be invoked with a performance report after each tile is requested. */
  onTiming = (callback: (timing: Timing) => void) => {
    this.timingCallbacks.push(callback);
  };

  getDemTile(z: number, x: number, y: number): Promise<DemTile> {
    return this.manager.fetchAndParseTile(z, x, y).value;
  }

  /**
   * Adds contour and shared DEM protocol handlers to maplibre.
   *
   * @param maplibre maplibre global object
   */
  setupMaplibre = (maplibre: {
    addProtocol: (id: string, protcol: AddProtocolAction) => void;
  }) => {
    maplibre.addProtocol(this.sharedDemProtocolId, this.sharedDemProtocol);
    maplibre.addProtocol(this.contourProtocolId, this.contourProtocol);
  };

  parseUrl(url: string): [number, number, number] {
    const [, z, x, y] = /\/\/(\d+)\/(\d+)\/(\d+)/.exec(url) || [];
    return [Number(z), Number(x), Number(y)];
  }

  /**
   * Callback to be used with maplibre addProtocol to re-use cached DEM tiles across sources.
   */
  sharedDemProtocol: AddProtocolAction = async (
    request: RequestParameters,
    abortController: AbortController,
  ): Promise<GetResourceResponse<any>> => {
    const [z, x, y] = this.parseUrl(request.url);
    const timer = new Timer("main");
    const result = this.manager.fetchTile(z, x, y, timer);
    abortController.signal.addEventListener("abort", () => {
      result.cancel();
    });
    let timing: Timing;
    try {
      const data = await result.value;
      timing = timer.finish(request.url);
      const arrayBuffer: ArrayBuffer = await data.data.arrayBuffer();
      // response(undefined, arrayBuffer, data.cacheControl, data.expires);
      return {
        data: arrayBuffer,
        cacheControl: data.cacheControl,
        expires: data.expires,
      };
    } catch (error) {
      timing = timer.error(request.url);
      throw error;
    } finally {
      this.timingCallbacks.forEach((cb) => cb(timing));
    }
  };

  /**
   * Callback to be used with maplibre addProtocol to generate contour vector tiles according
   * to options encoded in the tile URL pattern generated by `contourProtocolUrl`.
   */
  contourProtocol: AddProtocolAction = async (
    request: RequestParameters,
    abortController: AbortController,
  ): Promise<GetResourceResponse<any>> => {
    const timer = new Timer("main");
    const [z, x, y] = this.parseUrl(request.url);
    const options = decodeOptions(request.url);
    const result = this.manager.fetchContourTile(
      z,
      x,
      y,
      getOptionsForZoom(options, z),
      timer,
    );
    abortController.signal.addEventListener("abort", () => {
      result.cancel();
    });
    let timing: Timing;
    try {
      const data = await result.value;
      timing = timer.finish(request.url);
      return { data: data.arrayBuffer };
    } catch (error) {
      timing = timer.error(request.url);
      throw error;
    } finally {
      this.timingCallbacks.forEach((cb) => cb(timing));
    }
  };

  /**
   * Returns a URL with the correct maplibre protocol prefix and all `option` encoded in request parameters.
   */
  contourProtocolUrl = (options: GlobalContourTileOptions) =>
    `${this.contourProtocolUrlBase}?${encodeOptions(options)}`;
}
