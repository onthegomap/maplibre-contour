import Actor from "./actor";
import { MainThreadDispatch } from "./remote-dem-manager";
import WorkerDispatch from "./worker-dispatch";

// eslint-disable-next-line no-restricted-globals
const g: any = typeof self !== "undefined" ? self : window;

g.actor = new Actor<MainThreadDispatch>(g, new WorkerDispatch());
