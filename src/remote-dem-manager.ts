import Actor from "./actor";
import CONFIG from "./config";
import type WorkerDispatch from "./worker-dispatch";
import decodeImage from "./decode-image";
import type { DemManager } from "./dem-manager";
import { Timer } from "./performance";
import {
  CancelablePromise,
  ContourTile,
  DemTile,
  Encoding,
  FetchResponse,
  IndividualContourTileOptions,
} from "./types";
import { prepareDemTile } from "./utils";

let _actor: Actor<WorkerDispatch> | undefined;
let id = 0;

export class MainThreadDispatch {
  decodeImage = (blob: Blob, encoding: Encoding) =>
    prepareDemTile(decodeImage(blob, encoding), false);
}

function defaultActor(): Actor<WorkerDispatch> {
  if (!_actor) {
    const worker = new Worker(CONFIG.workerUrl);
    const dispatch = new MainThreadDispatch();
    _actor = new Actor(worker, dispatch);
  }
  return _actor;
}

export default class RemoteDemManager implements DemManager {
  managerId: number;
  actor: Actor<WorkerDispatch>;
  loaded: Promise<any>;

  constructor(
    demUrlPattern: string,
    cacheSize: number,
    encoding: Encoding,
    maxzoom: number,
    timeoutMs: number,
    actor?: Actor<WorkerDispatch>
  ) {
    const managerId = (this.managerId = ++id);
    this.actor = actor || defaultActor();
    this.loaded = this.actor.send("init", [], undefined, {
      cacheSize,
      demUrlPattern,
      encoding,
      maxzoom,
      managerId,
      timeoutMs,
    }).value;
  }

  fetchTile = (
    z: number,
    x: number,
    y: number,
    timer?: Timer
  ): CancelablePromise<FetchResponse> =>
    this.actor.send("fetchTile", [], timer, this.managerId, z, x, y);
  fetchAndParseTile = (
    z: number,
    x: number,
    y: number,
    timer?: Timer
  ): CancelablePromise<DemTile> =>
    this.actor.send("fetchAndParseTile", [], timer, this.managerId, z, x, y);
  fetchContourTile = (
    z: number,
    x: number,
    y: number,
    options: IndividualContourTileOptions,
    timer?: Timer
  ): CancelablePromise<ContourTile> =>
    this.actor.send(
      "fetchContourTile",
      [],
      timer,
      this.managerId,
      z,
      x,
      y,
      options
    );
}
