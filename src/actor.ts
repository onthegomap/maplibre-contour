import { Timer } from "./performance";
import { CancelablePromise, IsTransferrable, Timing } from "./types";
import { withTimeout } from "./utils";

let id = 0;

interface Cancel {
  type: "cancel";
  id: number;
}
interface Response {
  type: "response";
  id: number;
  error?: string;
  response?: any;
  timings: Timing;
}
interface Request {
  type: "request";
  id?: number;
  name: string;
  args: any[];
}
type Message = Cancel | Response | Request;

type MethodsReturning<T, R> = {
  [K in keyof T]: T[K] extends (...args: any) => R ? T[K] : never;
};

/**
 * Utility for sending messages to a remote instance of `<T>` running in a web worker
 * from the main thread, or in the main thread running from a web worker.
 */
export default class Actor<T> {
  callbacks: {
    [id: number]: (
      error: Error | undefined,
      message: any,
      timings: Timing,
    ) => void;
  };
  cancels: { [id: number]: () => void };
  dest: Worker;
  timeoutMs: number;
  constructor(dest: Worker, dispatcher: any, timeoutMs: number = 20_000) {
    this.callbacks = {};
    this.cancels = {};
    this.dest = dest;
    this.timeoutMs = timeoutMs;
    this.dest.onmessage = async ({ data }) => {
      const message: Message = data;
      if (message.type === "cancel") {
        const cancel = this.cancels[message.id];
        delete this.cancels[message.id];
        if (cancel) {
          cancel();
        }
      } else if (message.type === "response") {
        const callback = this.callbacks[message.id];
        delete this.callbacks[message.id];
        if (callback) {
          callback(
            message.error ? new Error(message.error) : undefined,
            message.response,
            message.timings,
          );
        }
      } else if (message.type === "request") {
        const timer = new Timer("worker");
        const handler: Function = (dispatcher as any)[message.name];
        const request = handler.apply(handler, [...message.args, timer]);
        const url = `${message.name}_${message.id}`;
        if (message.id && request) {
          this.cancels[message.id] = request.cancel;
          try {
            const response = await request.value;
            const transferrables = (response as IsTransferrable)
              ?.transferrables;
            this.postMessage(
              {
                id: message.id,
                type: "response",
                response,
                timings: timer.finish(url),
              },
              transferrables,
            );
          } catch (e: any) {
            this.postMessage({
              id: message.id,
              type: "response",
              error: e?.toString() || "error",
              timings: timer.finish(url),
            });
          }
          delete this.cancels[message.id];
        }
      }
    };
  }

  postMessage(message: Message, transferrables?: Transferable[]) {
    this.dest.postMessage(message, transferrables || []);
  }

  /** Invokes a method by name with a set of arguments in the remote context. */
  send<
    R,
    M extends MethodsReturning<T, CancelablePromise<R>>,
    K extends keyof M & string,
    P extends Parameters<M[K]>,
  >(
    name: K,
    transferrables: Transferable[],
    timer?: Timer,
    ...args: P
  ): CancelablePromise<R> {
    const thisId = ++id;
    const value: Promise<R> = new Promise((resolve, reject) => {
      this.postMessage(
        { id: thisId, type: "request", name, args },
        transferrables,
      );
      this.callbacks[thisId] = (error, result, timings) => {
        timer?.addAll(timings);
        if (error) reject(error);
        else resolve(result);
      };
    });

    return withTimeout(this.timeoutMs, {
      value,
      cancel: () => {
        delete this.callbacks[thisId];
        this.postMessage({ id: thisId, type: "cancel" });
      },
    });
  }
}
