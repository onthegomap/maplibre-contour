import { flattenDeep } from "lodash";
import Actor from "./actor";
import WorkerDispatch from "./worker-dispatch";
import { DemSource } from "./dem-source";
import { MainThreadDispatch } from "./remote-dem-manager";
import type { DemTile, Timing } from "./types";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { MessageChannel } from "worker_threads";
import { LocalDemManager } from "./local-dem-manager";

beforeEach(() => {
  jest.useFakeTimers({ now: 0, doNotFake: ["performance"] });
});
afterEach(() => {
  jest.useRealTimers();
});

jest.mock("./decode-image", () => (): Promise<DemTile> => {
  jest.advanceTimersByTime(1);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const flattenDeep = require("lodash/flattenDeep");
  const value: DemTile = {
    data: Float32Array.from(
      flattenDeep([
        [5, 5, 5, 5],
        [5, 15, 15, 5],
        [5, 15, 15, 5],
        [5, 5, 5, 5],
      ]),
    ),
    width: 4,
    height: 4,
  };
  return Promise.resolve(value);
});

const remote = new WorkerDispatch();
const local = new MainThreadDispatch();
const workerFromMainThread: Worker = {} as any as Worker;
const mainThreadFromWorker: Worker = {} as any as Worker;
workerFromMainThread.postMessage = (data) =>
  mainThreadFromWorker?.onmessage?.({ data } as any);
mainThreadFromWorker.postMessage = (data) =>
  workerFromMainThread?.onmessage?.({ data } as any);
const mainActor = new Actor<WorkerDispatch>(workerFromMainThread, local);
const workerActor = new Actor<MainThreadDispatch>(mainThreadFromWorker, remote);

const source = new DemSource({
  url: "https://example/{z}/{x}/{y}.png",
  cacheSize: 100,
  encoding: "terrarium",
  maxzoom: 11,
  worker: true,
  actor: mainActor,
});

const expectedElevations = Float32Array.from(
  flattenDeep([
    [5, 5, 5, 5],
    [5, 15, 15, 5],
    [5, 15, 15, 5],
    [5, 5, 5, 5],
  ]),
);

test("e2e fetch tile and shared DEM protocol share cache", async () => {
  global.fetch = jest.fn().mockImplementation(async () => {
    jest.advanceTimersByTime(1);
    return new Response(
      new Blob([Uint8Array.from([1, 2])], { type: "image/png" }),
      {
        status: 200,
      },
    );
  });
  const tile = await source.getDemTile(1, 2, 3);
  expect(tile.data).toEqual(expectedElevations);
  expect(tile.width).toBe(4);
  expect(tile.height).toBe(4);
  const tile2 = await source.getDemTile(1, 2, 3);
  expect(tile2.data).toEqual(expectedElevations);

  const timings: Timing[] = [];
  source.onTiming((timing) => timings.push(timing));
  const fetched = (
    await source.sharedDemProtocol(
      {
        url: source.sharedDemProtocolUrl
          .replace("{z}", "1")
          .replace("{x}", "2")
          .replace("{y}", "3"),
      },
      new AbortController(),
    )
  ).data;

  expect(fetched).toEqual(Uint8Array.from([1, 2]).buffer);

  expect(global.fetch).toBeCalledTimes(1);
  expect(global.fetch).toBeCalledWith(
    "https://example/1/2/3.png",
    expect.anything(),
  );
  expect(timings).toMatchObject([
    {
      duration: 0,
      marks: {
        main: [[2, 2]],
        worker: [[2, 2]],
      },
      resources: [],
      url: "dem-shared://1/2/3",
      wait: 0,
    },
  ]);
});

test("e2e contour tile", async () => {
  global.fetch = jest.fn().mockImplementation(async () => {
    jest.advanceTimersByTime(1);
    return new Response(
      new Blob([Uint8Array.from([1, 2])], { type: "image/png" }),
      {
        status: 200,
      },
    );
  });
  const timings: Timing[] = [];
  source.onTiming((timing) => timings.push(timing));
  const contourTile: ArrayBuffer = (
    await source.contourProtocol(
      {
        url: source
          .contourProtocolUrl({
            thresholds: {
              10: 10,
            },
            buffer: 0,
            contourLayer: "c",
            elevationKey: "e",
            levelKey: "l",
            overzoom: 0,
          })
          .replace("{z}", "10")
          .replace("{x}", "20")
          .replace("{y}", "30"),
      },
      new AbortController(),
    )
  ).data;

  const tile = new VectorTile(new Pbf(contourTile));

  expect(tile.layers.c.name).toBe("c");
  expect(tile.layers.c.extent).toBe(4096);
  expect(tile.layers.c.length).toBe(1);
  expect(tile.layers.c.feature(0).properties).toEqual({
    e: 10,
    l: 0,
  });
  const geom = tile.layers.c.feature(0).loadGeometry()[0];
  expect(geom.length).toEqual(253);

  let xSum = 0,
    ySum = 0;
  for (const { x, y } of geom) {
    xSum += x;
    ySum += y;
  }
  const center = { x: Math.round(xSum / 253), y: Math.round(ySum / 253) };
  expect(center).toMatchObject({
    x: 2049,
    y: 2052,
  });
  expect(timings).toMatchObject([
    {
      tilesUsed: 9,
      process: 0,
      duration: 18,
      marks: {
        main: [[0, 18]],
        worker: [[0, 18]],
        fetch: [
          [0, 9],
          [1, 9],
          [2, 9],
          [3, 9],
          [4, 9],
          [5, 9],
          [6, 9],
          [7, 9],
          [8, 9],
        ],
        decode: [
          [10, 18],
          [11, 18],
          [12, 18],
          [13, 18],
          [14, 18],
          [15, 18],
          [16, 18],
          [17, 18],
          [18, 18],
        ],
        isoline: [[18, 18, 18]],
      },
      decode: 8,
      fetch: 9,
      resources: [],
      url: "dem-contour://10/20/30?buffer=0&contourLayer=c&elevationKey=e&levelKey=l&overzoom=0&thresholds=10*10",
      wait: 1,
    },
  ]);

  // fetch adjacent tile where 6/9 neighbors are already cached
  jest.setSystemTime(1);
  performance.getEntriesByName = (name) => [
    {
      duration: 1,
      name,
      entryType: "resource",
      startTime: performance.now(),
    } as PerformanceResourceTiming,
  ];
  await source.contourProtocol(
    {
      url: source
        .contourProtocolUrl({
          thresholds: {
            10: 10,
          },
          overzoom: 0,
        })
        .replace("{z}", "10")
        .replace("{x}", "21")
        .replace("{y}", "30"),
    },
    new AbortController(),
  );
  expect(timings[1]).toMatchObject({
    tilesUsed: 9,
    process: 0,
    duration: 6,
    decode: 2,
    fetch: 3,
    wait: 1,
    marks: {
      main: [[1, 7]],
      worker: [[1, 7]],
      fetch: [
        [1, 4],
        [2, 4],
        [3, 4],
      ],
      decode: [
        [5, 7],
        [6, 7],
        [7, 7],
      ],
      isoline: [[7, 7, 7]],
    },
    resources: [
      { duration: 1, startTime: 7, name: "https://example/10/22/29.png" },
      { duration: 1, startTime: 7, name: "https://example/10/22/30.png" },
      { duration: 1, startTime: 7, name: "https://example/10/22/31.png" },
    ],
    url: "dem-contour://10/21/30?overzoom=0&thresholds=10*10",
  });
});

test("contour tile buffer survives transfer when re-requested without worker", async () => {
  global.fetch = jest.fn().mockImplementation(async () => {
    jest.advanceTimersByTime(1);
    return new Response(
      new Blob([Uint8Array.from([1, 2])], { type: "image/png" }),
      {
        status: 200,
      },
    );
  });
  const localSource = new DemSource({
    url: "https://example/{z}/{x}/{y}.png",
    cacheSize: 100,
    encoding: "terrarium",
    maxzoom: 11,
    worker: false,
  });
  const url = localSource
    .contourProtocolUrl({
      thresholds: {
        10: 10,
      },
      overzoom: 0,
    })
    .replace("{z}", "10")
    .replace("{x}", "20")
    .replace("{y}", "30");

  const first: ArrayBuffer = (
    await localSource.contourProtocol({ url }, new AbortController())
  ).data;
  const byteLength = first.byteLength;
  expect(byteLength).toBeGreaterThan(0);

  // maplibre transfers vector tile data to its own worker, which detaches
  // the buffer
  const { port1, port2 } = new MessageChannel();
  port1.postMessage(first, [first]);
  port1.close();
  port2.close();
  expect(first.byteLength).toBe(0);

  const second: ArrayBuffer = (
    await localSource.contourProtocol({ url }, new AbortController())
  ).data;
  expect(global.fetch).toHaveBeenCalledTimes(9);
  expect(second.byteLength).toBe(byteLength);
  expect(new VectorTile(new Pbf(second)).layers.contours.length).toBe(1);
});

test("decode image from worker", async () => {
  const result = await workerActor.send(
    "decodeImage",
    [],
    new AbortController(),
    undefined,
    new Blob([], { type: "image/png" }),
    "terrarium",
  );
  expect(result).toMatchObject({
    width: 4,
    height: 4,
    data: expectedElevations,
  });
});

test("fake decode image and fetch tile", async () => {
  const getTileSpy = jest.fn().mockReturnValue(Promise.resolve({}));
  const demManager = new LocalDemManager({
    demUrlPattern: "https://example/{z}/{x}/{y}.png",
    cacheSize: 100,
    encoding: "terrarium",
    maxzoom: 11,
    timeoutMs: 10000,
    decodeImage: async () => ({
      width: 4,
      height: 4,
      data: expectedElevations,
    }),
    getTile: getTileSpy,
  });
  const demTile = await demManager.fetchAndParseTile(
    1,
    2,
    3,
    new AbortController(),
  );
  expect(demTile.data).toEqual(expectedElevations);
  expect(getTileSpy.mock.calls[0][0]).toBe("https://example/1/2/3.png");
});

test("fetchDem floors the DEM zoom at 0 when overzoom exceeds z", async () => {
  const getTileSpy = jest.fn().mockReturnValue(Promise.resolve({}));
  const demManager = new LocalDemManager({
    demUrlPattern: "https://example/{z}/{x}/{y}.png",
    cacheSize: 100,
    encoding: "terrarium",
    maxzoom: 11,
    timeoutMs: 10000,
    decodeImage: async () => ({
      width: 4,
      height: 4,
      data: expectedElevations,
    }),
    getTile: getTileSpy,
  });
  const heightTile = await demManager.fetchDem(
    1,
    1,
    1,
    { overzoom: 2, levels: [10] },
    new AbortController(),
  );
  // z1 asks for z-1; clamped to z0 and split into the bottom-right quarter
  expect(getTileSpy.mock.calls[0][0]).toBe("https://example/0/0/0.png");
  expect(heightTile.width).toBe(2);
  expect(heightTile.height).toBe(2);
  expect([
    [heightTile.get(0, 0), heightTile.get(1, 0)],
    [heightTile.get(0, 1), heightTile.get(1, 1)],
  ]).toEqual([
    [15, 5],
    [5, 5],
  ]);
});

function notFound(url: string) {
  return Object.assign(new Error(`Bad response: 404 for ${url}`), {
    status: 404,
  });
}

function sparseDemManager(
  getTile: jest.Mock,
  minzoom?: number,
  sparse: boolean = true,
) {
  return new LocalDemManager({
    demUrlPattern: "https://example/{z}/{x}/{y}.png",
    cacheSize: 100,
    encoding: "terrarium",
    maxzoom: 12,
    minzoom,
    sparse,
    timeoutMs: 10000,
    decodeImage: async () => ({
      width: 4,
      height: 4,
      data: expectedElevations,
    }),
    getTile,
  });
}

test("fetchContourTile falls back to a lower DEM zoom when the tile is missing", async () => {
  const getTile = jest.fn().mockImplementation(async (url: string) => {
    if (url.startsWith("https://example/12/")) {
      throw notFound(url);
    }
    return { data: new Blob([]) };
  });
  const demManager = sparseDemManager(getTile);
  const contourTile = await demManager.fetchContourTile(
    12,
    2048,
    2048,
    { levels: [10] },
    new AbortController(),
  );
  const urls = getTile.mock.calls.map((call) => call[0]);
  expect(urls).toContain("https://example/12/2048/2048.png");
  expect(urls).toContain("https://example/11/1024/1024.png");
  expect(contourTile.arrayBuffer.byteLength).toBeGreaterThan(0);
});

test("fetchContourTile leaves out a missing neighbor instead of failing", async () => {
  const getTile = jest.fn().mockImplementation(async (url: string) => {
    if (url === "https://example/12/2049/2049.png") {
      throw notFound(url);
    }
    return { data: new Blob([]) };
  });
  const demManager = sparseDemManager(getTile);
  const contourTile = await demManager.fetchContourTile(
    12,
    2048,
    2048,
    { levels: [10] },
    new AbortController(),
  );
  const urls = getTile.mock.calls.map((call) => call[0]);
  expect(urls.some((url) => url.startsWith("https://example/11/"))).toBe(false);
  expect(contourTile.arrayBuffer.byteLength).toBeGreaterThan(0);
});

test("fetchContourTile fails when a DEM tile can not be fetched", async () => {
  const getTile = jest.fn().mockImplementation(async (url: string) => {
    throw Object.assign(new Error(`Bad response: 500 for ${url}`), {
      status: 500,
    });
  });
  const demManager = sparseDemManager(getTile);
  await expect(
    demManager.fetchContourTile(
      12,
      2048,
      2048,
      { levels: [10] },
      new AbortController(),
    ),
  ).rejects.toThrow("500");
});

test("fetchContourTile does not fall back below the minzoom of the source", async () => {
  const getTile = jest.fn().mockImplementation(async (url: string) => {
    if (!url.startsWith("https://example/10/")) {
      throw notFound(url);
    }
    return { data: new Blob([]) };
  });
  const demManager = sparseDemManager(getTile, 11);
  const contourTile = await demManager.fetchContourTile(
    12,
    2048,
    2048,
    { levels: [10] },
    new AbortController(),
  );
  const urls = getTile.mock.calls.map((call) => call[0]);
  expect(urls).toContain("https://example/11/1024/1024.png");
  expect(urls.some((url) => url.startsWith("https://example/10/"))).toBe(false);
  expect(contourTile.arrayBuffer.byteLength).toBe(0);
});

test("fetchContourTile fails on a missing DEM tile when sparse is disabled", async () => {
  const getTile = jest.fn().mockImplementation(async (url: string) => {
    if (url.startsWith("https://example/12/")) {
      throw notFound(url);
    }
    return { data: new Blob([]) };
  });
  const demManager = sparseDemManager(getTile, undefined, false);
  await expect(
    demManager.fetchContourTile(
      12,
      2048,
      2048,
      { levels: [10] },
      new AbortController(),
    ),
  ).rejects.toThrow("404");
  const urls = getTile.mock.calls.map((call) => call[0]);
  expect(urls.some((url) => url.startsWith("https://example/11/"))).toBe(false);
});
