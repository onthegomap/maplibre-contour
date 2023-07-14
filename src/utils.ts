import {
  CancelablePromise,
  ContourTile,
  DemTile,
  GlobalContourTileOptions,
  IndividualContourTileOptions,
  TransferrableContourTile,
  TransferrableDemTile,
} from "./types";

function sortedEntries(object: any): [string, any][] {
  const entries = Object.entries(object);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries;
}

function encodeThresholds(thresholds: {
  [n: number]: number | number[];
}): string {
  return sortedEntries(thresholds)
    .map(([key, value]) =>
      [key, ...(typeof value === "number" ? [value] : value)].join("*"),
    )
    .join("~");
}

function decodeThresholds(thresholds: string): {
  [n: number]: number | number[];
} {
  return Object.fromEntries(
    thresholds
      .split("~")
      .map((part) => part.split("*").map(Number))
      .map(([key, ...values]) => [key, values]),
  );
}

export function encodeOptions({
  thresholds,
  ...rest
}: GlobalContourTileOptions): string {
  return sortedEntries({ thresholds: encodeThresholds(thresholds), ...rest })
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

export function decodeOptions(options: string): GlobalContourTileOptions {
  return Object.fromEntries(
    options
      .replace(/^.*\?/, "")
      .split("&")
      .map((part) => {
        const parts = part.split("=").map(decodeURIComponent);
        const k = parts[0] as keyof GlobalContourTileOptions;
        let v: any = parts[1];
        switch (k) {
          case "thresholds":
            v = decodeThresholds(v);
            break;
          case "extent":
          case "multiplier":
          case "overzoom":
          case "buffer":
            v = Number(v);
        }
        return [k, v];
      }),
  ) as any as GlobalContourTileOptions;
}

export function encodeIndividualOptions(
  options: IndividualContourTileOptions,
): string {
  return sortedEntries(options)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join(",");
}

export function getOptionsForZoom(
  options: GlobalContourTileOptions,
  zoom: number,
): IndividualContourTileOptions {
  const { thresholds, ...rest } = options;

  let levels: number[] = [];
  let maxLessThanOrEqualTo: number = -Infinity;

  Object.entries(thresholds).forEach(([zString, value]) => {
    const z = Number(zString);
    if (z <= zoom && z > maxLessThanOrEqualTo) {
      maxLessThanOrEqualTo = z;
      levels = typeof value === "number" ? [value] : value;
    }
  });

  return {
    levels,
    ...rest,
  };
}

export function map<T, U>(
  { cancel, value }: CancelablePromise<T>,
  mapper: (t: T) => U,
) {
  return { cancel, value: value.then(mapper) };
}

export function copy(src: ArrayBuffer): ArrayBuffer {
  const dst = new ArrayBuffer(src.byteLength);
  new Uint8Array(dst).set(new Uint8Array(src));
  return dst;
}

export function prepareDemTile(
  promise: CancelablePromise<DemTile>,
  copy: boolean,
): CancelablePromise<TransferrableDemTile> {
  return map(promise, ({ data, ...rest }) => {
    let newData = data;
    if (copy) {
      newData = new Float32Array(data.length);
      newData.set(data);
    }
    return { ...rest, data: newData, transferrables: [newData.buffer] };
  });
}

export function prepareContourTile(
  promise: CancelablePromise<ContourTile>,
): CancelablePromise<TransferrableContourTile> {
  return map(promise, ({ arrayBuffer }) => {
    const clone = copy(arrayBuffer);
    return {
      arrayBuffer: clone,
      transferrables: [clone],
    };
  });
}

let supportsOffscreenCanvas: boolean | null = null;

export function offscreenCanvasSupported(): boolean {
  if (supportsOffscreenCanvas == null) {
    supportsOffscreenCanvas =
      typeof OffscreenCanvas !== "undefined" &&
      new OffscreenCanvas(1, 1).getContext("2d") &&
      typeof createImageBitmap === "function";
  }

  return supportsOffscreenCanvas || false;
}

export function withTimeout<T>(
  timeoutMs: number,
  { value, cancel }: CancelablePromise<T>,
): CancelablePromise<T> {
  let reject: (error: Error) => void = () => {};
  const timeout = setTimeout(() => {
    cancel();
    reject(new Error("timed out"));
  }, timeoutMs);
  const cancelPromise: Promise<any> = new Promise((_, rej) => {
    reject = rej;
  });
  return {
    value: Promise.race([
      cancelPromise,
      (async () => {
        try {
          return await value;
        } finally {
          clearTimeout(timeout);
        }
      })(),
    ]),
    cancel: () => {
      clearTimeout(timeout);
      cancel();
    },
  };
}
