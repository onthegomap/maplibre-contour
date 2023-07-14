import Actor from "./actor";
import { Timer } from "./performance";
import { CancelablePromise } from "./types";

class Local {
  received: any[][] = [];
  localAction = (x: number, y: number, z: number): CancelablePromise<void> => {
    this.received.push([x, y, z]);
    return { cancel() {}, value: Promise.resolve() };
  };
}

class Remote {
  received: any[][] = [];
  canceled = false;
  remoteAction = (x: number, y: number, z: number): CancelablePromise<void> => {
    this.received.push([x, y, z]);
    return { cancel() {}, value: Promise.resolve() };
  };
  remotePromise = (x: number, timer?: Timer): CancelablePromise<number> => {
    const oldNow = performance.now;
    if (timer) timer.timeOrigin = 100;
    performance.now = () => oldNow() - 100;
    const finish = timer?.marker("fetch");
    performance.now = () => oldNow() - 99;
    finish?.();
    performance.now = () => oldNow() + 2;
    return {
      cancel() {
        throw new Error("not expected");
      },
      value: Promise.resolve(x),
    };
  };
  remoteFail = (): CancelablePromise<number> => ({
    cancel() {},
    value: Promise.reject(new Error("error")),
  });
  remoteNever = (): CancelablePromise<number> => ({
    cancel: () => {
      this.canceled = true;
    },
    value: new Promise(() => {}),
  });
}

test("send and cancel messages", async () => {
  performance.now = () => 1;
  const remote = new Remote();
  const local = new Local();
  const workerFromMainThread: Worker = {} as any as Worker;
  const mainThreadFromWorker: Worker = {} as any as Worker;
  workerFromMainThread.postMessage = (data) =>
    //@ts-ignore
    mainThreadFromWorker?.onmessage?.({ data });
  mainThreadFromWorker.postMessage = (data) =>
    //@ts-ignore
    workerFromMainThread?.onmessage?.({ data });
  const mainActor = new Actor<Remote>(workerFromMainThread, local);
  const workerActor = new Actor<Local>(mainThreadFromWorker, remote);

  mainActor.send("remoteAction", [], undefined, 1, 2, 3);
  expect(remote.received).toEqual([[1, 2, 3]]);
  workerActor.send("localAction", [], undefined, 4, 3, 2);
  expect(local.received).toEqual([[4, 3, 2]]);

  const timer = new Timer("main");
  timer.timeOrigin = 0;
  expect(await mainActor.send("remotePromise", [], timer, 9).value).toBe(9);
  expect(timer.finish("url")).toMatchObject({
    duration: 2,
    fetch: 1,
    marks: {
      fetch: [[1, 2]],
      main: [[1, 3]],
    },
  });
  const { cancel } = mainActor.send("remoteNever", []);
  expect(remote.canceled).toBeFalsy();
  cancel();
  expect(remote.canceled).toBeTruthy();

  await expect(mainActor.send("remoteFail", []).value).rejects.toThrowError(
    "Error: error",
  );
});
