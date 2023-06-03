import AsyncCache from "./cache";

test("get()", async () => {
  const requests: { [_: string]: any } = {};
  const cache = new AsyncCache<number, number>(2);
  const getter = async (k: number) => {
    requests[k] = (requests[k] || 0) + 1;
    return k + 1;
  };
  expect(await cache.get(1, getter)).toBe(2);
  expect(await cache.get(1, getter)).toBe(2);
  expect(requests).toEqual({ 1: 1 });

  expect(await cache.get(2, getter)).toBe(3);
  expect(await cache.get(2, getter)).toBe(3);
  expect(await cache.get(1, getter)).toBe(2);
  expect(requests).toEqual({ 1: 1, 2: 1 });

  // prunes 2 (not 1) because 2 was most recently accessed
  expect(await cache.get(3, getter)).toBe(4);
  expect(await cache.get(3, getter)).toBe(4);
  expect(await cache.get(1, getter)).toBe(2);
  expect(await cache.get(2, getter)).toBe(3);
  expect(requests).toEqual({ 1: 1, 2: 2, 3: 1 });
});

test("getCancelable()", () => {
  let canceledFirst = false;
  let canceledOthers = false;
  const cache = new AsyncCache(2);
  const result1 = cache.getCancelable(1, () => ({
    value: new Promise(() => {}),
    cancel: () => {
      canceledFirst = true;
    },
  }));
  const result2 = cache.getCancelable(1, () => ({
    value: new Promise(() => {}),
    cancel: () => {
      canceledOthers = true;
    },
  }));
  const result3 = cache.getCancelable(1, () => ({
    value: new Promise(() => {}),
    cancel: () => {
      canceledOthers = true;
    },
  }));
  expect(canceledFirst).toBeFalsy();
  expect(cache.size()).toBe(1);

  result1.cancel();
  expect(canceledFirst).toBeFalsy();
  expect(cache.size()).toBe(1);

  result2.cancel();
  expect(canceledFirst).toBeFalsy();
  expect(cache.size()).toBe(1);

  result3.cancel();
  expect(canceledFirst).toBeTruthy();
  expect(canceledOthers).toBeFalsy();
  expect(cache.size()).toBe(0);
});

test("dont cache failures", async () => {
  const cache = new AsyncCache(2);
  let reject: (e: Error) => void = () => {};
  const result = cache.getCancelable(1, () => ({
    value: new Promise((_, rej) => {
      reject = rej;
    }),
    cancel: () => {
      throw new Error();
    },
  }));
  const error = new Error();
  reject(error);
  await expect(result.value).rejects.toThrow(error);
  let resolve: (any: any) => void = () => {};
  const result2 = cache.getCancelable(1, () => ({
    value: new Promise((res) => {
      resolve = res;
    }),
    cancel: () => {
      throw new Error();
    },
  }));
  resolve("ok!");
  await expect(result2.value).resolves.toBe("ok!");
});
