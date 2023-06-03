import { DemManager, LocalDemManager } from "./dem-manager";
import { decodeOptions, encodeOptions, getOptionsForZoom } from "./utils";
import RemoteDemManager from "./remote-dem-manager";
import { DemTile, Cancelable, GlobalContourTileOptions, Timing } from "./types";
import type { WorkerDispatch } from "./worker";
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

type RequestParameters = {
  url: string;
  headers?: any;
  method?: "GET" | "POST" | "PUT";
  body?: string;
  type?: "string" | "json" | "arrayBuffer";
  credentials?: "same-origin" | "include";
  collectResourceTiming?: boolean;
};
type ResponseCallback = (
  error?: Error | undefined,
  data?: any | undefined,
  cacheControl?: string | undefined,
  expires?: string | undefined
) => void;

type Protocol = (
  request: RequestParameters,
  response: ResponseCallback
) => Cancelable;

const used = new Set<string>();

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
    maxzoom = 11,
    worker = true,
    timeoutMs = 10_000,
    actor,
  }: {
    url: string;
    cacheSize?: number;
    id?: string;
    encoding?: "terrarium" | "mapbox";
    maxzoom: number;
    timeoutMs?: number;
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
      actor
    );
  }

  onTiming = (callback: (timing: Timing) => void) => {
    this.timingCallbacks.push(callback);
  };

  getDemTile(z: number, x: number, y: number): Promise<DemTile> {
    return this.manager.fetchAndParseTile(z, x, y).value;
  }

  setupMaplibre = (maplibre: {
    addProtocol: (id: string, protcol: Protocol) => void;
  }) => {
    maplibre.addProtocol(this.sharedDemProtocolId, this.sharedDemProtocol);
    maplibre.addProtocol(this.contourProtocolId, this.contourProtocol);
  };

  parseUrl(url: string): [number, number, number] {
    const [, z, x, y] = /\/\/(\d+)\/(\d+)\/(\d+)/.exec(url) || [];
    return [Number(z), Number(x), Number(y)];
  }

  sharedDemProtocol = (
    request: RequestParameters,
    response: ResponseCallback
  ): Cancelable => {
    const [z, x, y] = this.parseUrl(request.url);
    const timer = new Timer("main");
    const result = this.manager.fetchTile(z, x, y, timer);
    let canceled = false;
    (async () => {
      let timing: Timing;
      try {
        const data = await result.value;
        timing = timer.finish(request.url);
        if (canceled) return;
        const arrayBuffer: ArrayBuffer = await data.data.arrayBuffer();
        if (canceled) return;
        response(undefined, arrayBuffer, data.cacheControl, data.expires);
      } catch (error) {
        timing = timer.error(request.url);
        if (canceled) return;
        response(error as Error);
      }
      this.timingCallbacks.forEach((cb) => cb(timing));
    })();
    return {
      cancel: () => {
        canceled = false;
        result.cancel();
      },
    };
  };

  contourProtocol = (
    request: RequestParameters,
    response: ResponseCallback
  ): Cancelable => {
    const timer = new Timer("main");
    const [z, x, y] = this.parseUrl(request.url);
    const options = decodeOptions(request.url);
    const result = this.manager.fetchContourTile(
      z,
      x,
      y,
      getOptionsForZoom(options, z),
      timer
    );
    let canceled = false;
    (async () => {
      let timing: Timing;
      try {
        const data = await result.value;
        timing = timer.finish(request.url);
        if (canceled) return;
        response(undefined, data.arrayBuffer);
      } catch (error) {
        if (canceled) return;
        timing = timer.error(request.url);
        response(error as Error);
      }
      this.timingCallbacks.forEach((cb) => cb(timing));
    })();
    return {
      cancel: () => {
        canceled = true;
        result.cancel();
      },
    };
  };

  contourProtocolUrl = (options: GlobalContourTileOptions) =>
    `${this.contourProtocolUrlBase}?${encodeOptions(options)}`;
}
