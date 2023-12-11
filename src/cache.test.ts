import AsyncCache from "./cache";
import { onAbort } from "./utils";

test("get()", async () => {
  const requests: { [_: string]: any } = {};
  const cache = new AsyncCache<number, number>(2);
  const getter = async (k: number) => {
    requests[k] = (requests[k] || 0) + 1;
    return k + 1;
  };
  expect(await cache.get(1, getter, new AbortController())).toBe(2);
  expect(await cache.get(1, getter, new AbortController())).toBe(2);
  expect(requests).toEqual({ 1: 1 });

  expect(await cache.get(2, getter, new AbortController())).toBe(3);
  expect(await cache.get(2, getter, new AbortController())).toBe(3);
  expect(await cache.get(1, getter, new AbortController())).toBe(2);
  expect(requests).toEqual({ 1: 1, 2: 1 });

  // prunes 2 (not 1) because 2 was most recently accessed
  expect(await cache.get(3, getter, new AbortController())).toBe(4);
  expect(await cache.get(3, getter, new AbortController())).toBe(4);
  expect(await cache.get(1, getter, new AbortController())).toBe(2);
  expect(await cache.get(2, getter, new AbortController())).toBe(3);
  expect(requests).toEqual({ 1: 1, 2: 2, 3: 1 });
});

function cancel(action: () => void): AbortController {
  const ab = new AbortController();
  onAbort(ab, action);
  return ab;
}

test("getCancelable()", () => {
  let canceledUnderlying = false;
  const cache = new AsyncCache(2);
  const abortController1 = new AbortController();
  const abortController2 = new AbortController();
  const abortController3 = new AbortController();
  function supplier(key: any, ab2?: AbortController) {
    onAbort(ab2, () => (canceledUnderlying = true));
    return new Promise(() => {});
  }
  cache.get(1, supplier, abortController1);
  cache.get(1, supplier, abortController2);
  cache.get(1, supplier, abortController3);
  expect(canceledUnderlying).toBeFalsy();
  expect(cache.size()).toBe(1);

  abortController1.abort();
  expect(canceledUnderlying).toBeFalsy();
  expect(cache.size()).toBe(1);

  abortController2.abort();
  expect(canceledUnderlying).toBeFalsy();
  expect(cache.size()).toBe(1);

  abortController3.abort();
  expect(canceledUnderlying).toBeTruthy();
  expect(cache.size()).toBe(0);
});

test("dont cache failures", async () => {
  const cache = new AsyncCache(2);
  let reject: (e: Error) => void = () => {};
  const abortController1 = cancel(() => {
    throw new Error();
  });
  const abortController2 = cancel(() => {
    throw new Error();
  });
  const result = cache.get(
    1,
    () =>
      new Promise((_, rej) => {
        reject = rej;
      }),
    abortController1,
  );
  const error = new Error();
  reject(error);
  await expect(result).rejects.toThrow(error);
  let resolve: (any: any) => void = () => {};
  const result2 = cache.get(
    1,
    () =>
      new Promise((res) => {
        resolve = res;
      }),
    abortController2,
  );
  resolve("ok!");
  await expect(result2).resolves.toBe("ok!");
});
