import {
  GlobalContourTileOptions,
  IndividualContourTileOptions,
} from "./types";
import {
  decodeOptions,
  encodeIndividualOptions,
  encodeOptions,
  getOptionsForZoom,
  offscreenCanvasSupported,
  shouldUseVideoFrame,
  withTimeout,
} from "./utils";
import { Canvas } from "canvas";

const fullGlobalOptions: GlobalContourTileOptions = {
  thresholds: {
    10: 500,
    11: [100, 1000],
  },
  contourLayer: "contour layer",
  elevationKey: "elevation key",
  extent: 123,
  buffer: 1,
  levelKey: "level key",
  multiplier: 123,
  overzoom: 3,
};
const fullGlobalOptionsOut: GlobalContourTileOptions = {
  ...fullGlobalOptions,
  thresholds: {
    10: [500],
    11: [100, 1000],
  },
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
});

test("parse known ContourTileOptions", () => {
  expect(
    decodeOptions(
      "buffer=1&contourLayer=contour%20layer&elevationKey=elevation%20key&extent=123&levelKey=level%20key&multiplier=123&overzoom=3&thresholds=10*500~11*100*1000",
    ),
  ).toEqual(fullGlobalOptionsOut);
});

test("round-trip ContourTileOptions", () => {
  expect(
    decodeOptions(`example.com?${encodeOptions(fullGlobalOptions)}`),
  ).toEqual(fullGlobalOptionsOut);
});

test("round-trip minimal ContourTileOptions", () => {
  const options: GlobalContourTileOptions = {
    thresholds: {
      10: [500],
      11: [100, 1000],
    },
  };
  expect(decodeOptions(encodeOptions(options))).toEqual(options);
});

test("extract levels from global contour options", () => {
  // eslint-disable-next-line
  const { thresholds, ...rest } = fullGlobalOptions;
  expect(getOptionsForZoom(fullGlobalOptions, 9)).toEqual({
    ...rest,
    levels: [],
  });
  expect(getOptionsForZoom(fullGlobalOptions, 10)).toEqual({
    ...rest,
    levels: [500],
  });
  expect(getOptionsForZoom(fullGlobalOptions, 11)).toEqual({
    ...rest,
    levels: [100, 1000],
  });
  expect(getOptionsForZoom(fullGlobalOptions, 12)).toEqual({
    ...rest,
    levels: [100, 1000],
  });
});

test("encode individual options", () => {
  const options: IndividualContourTileOptions = {
    levels: [1, 2],
    contourLayer: "contour layer",
    elevationKey: "elevation key",
    extent: 123,
    levelKey: "level key",
    multiplier: 123,
    overzoom: 3,
  };
  const origEncoded = encodeIndividualOptions(options);
  expect(encodeIndividualOptions(options)).toBe(origEncoded);
  for (const key in options) {
    const updated: any = { ...options };
    delete updated[key];
    const newEncode = encodeIndividualOptions(updated);
    expect(encodeIndividualOptions(updated)).toBe(newEncode);
    expect(encodeIndividualOptions(updated)).not.toBe(origEncoded);
  }
});

test("withTimeout - times out", async () => {
  const ac = new AbortController();
  const result = withTimeout(1000, new Promise(() => {}), ac);
  jest.advanceTimersByTime(999);
  expect(ac.signal.aborted).toBeFalsy();
  jest.advanceTimersByTime(2);
  expect(ac.signal.aborted).toBeTruthy();
  await expect(result).rejects.toThrow(new Error("timed out"));
});

test("withTimeout - resolve cancels timer", async () => {
  const ac = new AbortController();
  const result = withTimeout(1000, Promise.resolve(true), ac);
  await expect(result).resolves.toBe(true);
  jest.advanceTimersByTime(10_000);
  expect(ac.signal.aborted).toBeFalsy();
  await expect(result).resolves.toBe(true);
});

test("withTimeout - reject cancels timer", async () => {
  const ac = new AbortController();
  const error = new Error("rejected");
  const result = withTimeout(1000, Promise.reject(error), ac);
  await expect(result).rejects.toBe(error);
  jest.advanceTimersByTime(10_000);
  expect(ac.signal.aborted).toBeFalsy();
  await expect(result).rejects.toBe(error);
});

test("withTimeout - cancel cancels timer", async () => {
  const ac = new AbortController();
  const result = withTimeout(1000, new Promise(() => {}), ac);
  ac.abort();
  await expect(result).rejects.toThrow();
});

test("should use video frame", async () => {
  const OffscreenCanvas = ((window as any).OffscreenCanvas = jest.fn(
    (width: number, height: number) => new Canvas(width, height),
  ));
  (window as any).createImageBitmap = () => Promise.resolve();
  (window as any).VideoFrame = {};
  expect(offscreenCanvasSupported()).toBeTruthy();
  OffscreenCanvas.mockClear();
  expect(shouldUseVideoFrame()).toBeFalsy();
  expect(window.OffscreenCanvas).toHaveBeenCalledTimes(1);
});
