import Actor from "./actor";
import CONFIG from "./config";
import type WorkerDispatch from "./worker-dispatch";
import decodeImage from "./decode-image";
import { Timer } from "./performance";
import type {
  ContourTile,
  DemManager,
  DemManagerInitizlizationParameters,
  DemTile,
  Encoding,
  FetchResponse,
  IndividualContourTileOptions,
} from "./types";
import { prepareDemTile } from "./utils";

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

  constructor(options: DemManagerInitizlizationParameters) {
    const managerId = (this.managerId = ++id);
    this.actor = options.actor || defaultActor();
    this.loaded = this.actor.send(
      "init",
      [],
      new AbortController(),
      undefined,
      {
        ...options,
        managerId,
      },
    );
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

  /** Updates the DEM tile URL pattern */
  updateUrl(url: string): void {
    this.actor.send("updateUrl", [], new AbortController(), undefined, this.managerId, url);
  }
}
