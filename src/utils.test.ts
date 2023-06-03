import {
  GlobalContourTileOptions,
  IndividualContourTileOptions,
} from "./types";
import {
  decodeOptions,
  encodeIndividualOptions,
  encodeOptions,
  getOptionsForZoom,
  withTimeout,
} from "./utils";

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
      "buffer=1&contourLayer=contour%20layer&elevationKey=elevation%20key&extent=123&levelKey=level%20key&multiplier=123&overzoom=3&thresholds=10*500~11*100*1000"
    )
  ).toEqual(fullGlobalOptionsOut);
});

test("round-trip ContourTileOptions", () => {
  expect(
    decodeOptions(`example.com?${encodeOptions(fullGlobalOptions)}`)
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
  const cancel = jest.fn();
  const result = withTimeout(1000, {
    value: new Promise(() => {}),
    cancel,
  });
  jest.advanceTimersByTime(999);
  expect(cancel).not.toBeCalled();
  jest.advanceTimersByTime(2);
  expect(cancel).toBeCalledTimes(1);
  await expect(result.value).rejects.toThrow(new Error("timed out"));
});

test("withTimeout - resolve cancels timer", async () => {
  const cancel = jest.fn();
  const result = withTimeout(1000, {
    value: Promise.resolve(true),
    cancel,
  });
  await expect(result.value).resolves.toBe(true);
  jest.advanceTimersByTime(10_000);
  expect(cancel).not.toBeCalled();
  await expect(result.value).resolves.toBe(true);
});

test("withTimeout - reject cancels timer", async () => {
  const cancel = jest.fn();
  const error = new Error("rejected");
  const result = withTimeout(1000, {
    value: Promise.reject(error),
    cancel,
  });
  await expect(result.value).rejects.toBe(error);
  jest.advanceTimersByTime(10_000);
  expect(cancel).not.toBeCalled();
  await expect(result.value).rejects.toBe(error);
});

test("withTimeout - cancel cancels timer", async () => {
  const cancel = jest.fn();
  const result = withTimeout(1000, {
    value: new Promise(() => {}),
    cancel,
  });
  result.cancel();
  expect(cancel).toBeCalledTimes(1);
  jest.advanceTimersByTime(10_000);
  expect(cancel).toBeCalledTimes(1);
});
