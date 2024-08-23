import Actor from "./actor";
import { Timer } from "./performance";
import { onAbort } from "./utils";

class Local {
  received: any[][] = [];
  localAction = (
    x: number,
    y: number,
    z: number,
    _: AbortController,
  ): Promise<void> => {
    this.received.push([x, y, z]);
    return Promise.resolve();
  };
}

class Remote {
  received: any[][] = [];
  canceled = false;
  remoteAction = (
    x: number,
    y: number,
    z: number,
    _: AbortController,
  ): Promise<void> => {
    this.received.push([x, y, z]);
    return Promise.resolve();
  };
  remotePromise = (
    x: number,
    abortController?: AbortController,
    timer?: Timer,
  ): Promise<number> => {
    const oldNow = performance.now;
    if (timer) timer.timeOrigin = 100;
    performance.now = () => oldNow() - 100;
    const finish = timer?.marker("fetch");
    performance.now = () => oldNow() - 99;
    finish?.();
    performance.now = () => oldNow() + 2;
    onAbort(abortController, () => {
      throw new Error("not expected");
    });
    return Promise.resolve(x);
  };
  remoteFail = (): Promise<number> => Promise.reject(new Error("error"));
  remoteNever = (abortController?: AbortController): Promise<number> => {
    onAbort(abortController, () => (this.canceled = true));
    return new Promise(() => {});
  };
}

test("send and cancel messages", async () => {
  performance.now = () => 1;
  const remote = new Remote();
  const local = new Local();
  const workerFromMainThread: Worker = {} as any as Worker;
  const mainThreadFromWorker: Worker = {} as any as Worker;
  workerFromMainThread.postMessage = (data) =>
    //@ts-expect-error handle data
    mainThreadFromWorker?.onmessage?.({ data });
  mainThreadFromWorker.postMessage = (data) =>
    //@ts-expect-error handle data
    workerFromMainThread?.onmessage?.({ data });
  const mainActor = new Actor<Remote>(workerFromMainThread, local);
  const workerActor = new Actor<Local>(mainThreadFromWorker, remote);
  mainActor.send("remoteAction", [], new AbortController(), undefined, 1, 2, 3);
  expect(remote.received).toEqual([[1, 2, 3]]);
  workerActor.send(
    "localAction",
    [],
    new AbortController(),
    undefined,
    4,
    3,
    2,
  );
  expect(local.received).toEqual([[4, 3, 2]]);
  const timer = new Timer("main");
  timer.timeOrigin = 0;
  expect(
    await mainActor.send("remotePromise", [], new AbortController(), timer, 9),
  ).toBe(9);
  expect(timer.finish("url")).toMatchObject({
    duration: 2,
    fetch: 1,
    marks: {
      fetch: [[1, 2]],
      main: [[1, 3]],
    },
  });
  const abortController = new AbortController();
  let resolveThrew;
  const threw = new Promise<boolean>((res) => (resolveThrew = res));
  mainActor.send("remoteNever", [], abortController).catch(resolveThrew);
  expect(remote.canceled).toBeFalsy();
  abortController.abort();
  expect(remote.canceled).toBeTruthy();
  expect(threw).resolves.toBeTruthy();
  await expect(
    mainActor.send("remoteFail", [], new AbortController()),
  ).rejects.toThrow("Error: error");
});
