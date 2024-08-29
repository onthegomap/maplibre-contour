import type {
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

export function copy(src: ArrayBuffer): ArrayBuffer {
  const dst = new ArrayBuffer(src.byteLength);
  new Uint8Array(dst).set(new Uint8Array(src));
  return dst;
}

export function prepareDemTile(
  promise: Promise<DemTile>,
  copy: boolean,
): Promise<TransferrableDemTile> {
  return promise.then(({ data, ...rest }) => {
    let newData = data;
    if (copy) {
      newData = new Float32Array(data.length);
      newData.set(data);
    }
    return { ...rest, data: newData, transferrables: [newData.buffer] };
  });
}

export function prepareContourTile(
  promise: Promise<ContourTile>,
): Promise<TransferrableContourTile> {
  return promise.then(({ arrayBuffer }) => {
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

let useVideoFrame: boolean | null = null;

export function shouldUseVideoFrame(): boolean {
  if (useVideoFrame == null) {
    useVideoFrame = false;
    // if webcodec is supported, AND if the browser mangles getImageData results
    // (ie. safari with increased privacy protections) then use webcodec VideoFrame API
    if (offscreenCanvasSupported() && typeof VideoFrame !== "undefined") {
      const size = 5;
      const canvas = new OffscreenCanvas(5, 5);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        for (let i = 0; i < size * size; i++) {
          const base = i * 4;
          context.fillStyle = `rgb(${base},${base + 1},${base + 2})`;
          context.fillRect(i % size, Math.floor(i / size), 1, 1);
        }
        const data = context.getImageData(0, 0, size, size).data;
        for (let i = 0; i < size * size * 4; i++) {
          if (i % 4 !== 3 && data[i] !== i) {
            useVideoFrame = true;
            break;
          }
        }
      }
    }
  }

  return useVideoFrame || false;
}

export function withTimeout<T>(
  timeoutMs: number,
  value: Promise<T>,
  abortController?: AbortController,
): Promise<T> {
  let reject: (error: Error) => void = () => {};
  const timeout = setTimeout(() => {
    reject(new Error("timed out"));
    abortController?.abort();
  }, timeoutMs);
  onAbort(abortController, () => {
    reject(new Error("aborted"));
    clearTimeout(timeout);
  });
  const cancelPromise: Promise<any> = new Promise((_, rej) => {
    reject = rej;
  });
  return Promise.race([
    cancelPromise,
    value.finally(() => clearTimeout(timeout)),
  ]);
}

export function onAbort(
  abortController?: AbortController,
  action?: () => void,
) {
  if (action) {
    abortController?.signal.addEventListener("abort", action);
  }
}

export function isAborted(abortController?: AbortController): boolean {
  return Boolean(abortController?.signal?.aborted);
}
