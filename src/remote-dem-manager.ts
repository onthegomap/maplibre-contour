import Actor from "./actor";
import CONFIG from "./config";
import type WorkerDispatch from "./worker-dispatch";
import decodeImage from "./decode-image";
import type { DemManager } from "./dem-manager";
import { Timer } from "./performance";
import type {
  ContourTile,
  DemTile,
  Encoding,
  FetchResponse,
  IndividualContourTileOptions,
} from "./types";
import { prepareDemTile } from "./utils";
import { PMTiles, FetchSource } from "pmtiles";

let _actor: Actor<WorkerDispatch> | undefined;
let id = 0;

export class MainThreadDispatch {
  decodeImage = (
    blob: Blob,
    encoding: Encoding,
    abortController: AbortController,
  ) => prepareDemTile(decodeImage(blob, encoding, abortController), false);
}

function defaultActor(): Actor<WorkerDispatch> {
  if (!_actor) {
    const worker = new Worker(CONFIG.workerUrl);
    const dispatch = new MainThreadDispatch();
    _actor = new Actor(worker, dispatch);
  }
  return _actor;
}

/**
 * Caches, decodes, and processes raster tiles in a shared web worker.
 */
export default class RemoteDemManager implements DemManager {
  managerId: number;
  actor: Actor<WorkerDispatch>;
  loaded: Promise<any>;
  pmtiles: PMTiles | null = null;
  fileUrl: string;

  constructor(
    fileUrl: string,
    cacheSize: number,
    encoding: Encoding,
    maxzoom: number,
    timeoutMs: number,
    actor?: Actor<WorkerDispatch>,
  ) {
    const managerId = (this.managerId = ++id);
    this.pmtiles = null;
    this.fileUrl = fileUrl;
    this.actor = actor || defaultActor();
    this.loaded = this.actor.send(
      "init",
      [],
      new AbortController(),
      undefined,
      {
        cacheSize,
        fileUrl,
        encoding,
        maxzoom,
        managerId,
        timeoutMs,
      },
    );
  }

  public async initializePMTiles() {
    const source = new FetchSource(this.fileUrl);
    this.pmtiles = new PMTiles(source);
  }

  fetchTile = (
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<FetchResponse> =>
    this.actor.send(
      "fetchTile",
      [],
      abortController,
      timer,
      this.managerId,
      z,
      x,
      y,
    );
  fetchAndParseTile = (
    z: number,
    x: number,
    y: number,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<DemTile> =>
    this.actor.send(
      "fetchAndParseTile",
      [],
      abortController,
      timer,
      this.managerId,
      z,
      x,
      y,
    );
  fetchContourTile = (
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    abortController: AbortController,
    timer?: Timer,
  ): Promise<ContourTile> =>
    this.actor.send(
      "fetchContourTile",
      [],
      abortController,
      timer,
      this.managerId,
      z,
      x,
      y,
      options,
    );
}
