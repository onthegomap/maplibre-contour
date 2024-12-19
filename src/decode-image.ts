import type Actor from "./actor";
import {
  isAborted,
  offscreenCanvasSupported,
  onAbort,
  shouldUseVideoFrame,
} from "./utils";
import type { MainThreadDispatch } from "./remote-dem-manager";
import type { DemTile, Encoding } from "./types";
import {
  createCanvas,
  Canvas,
  CanvasRenderingContext2D as NodeCanvasRenderingContext2D,
  loadImage,
  Image as NodeImage,
} from "canvas";

// Define a type that encompasses both browser and Node.js CanvasRenderingContext2D types
type AnyCanvasRenderingContext2D =
  | CanvasRenderingContext2D
  | NodeCanvasRenderingContext2D;

type AnyImage = ImageBitmap | HTMLImageElement | NodeImage;

let offscreenCanvas: OffscreenCanvas;
let offscreenContext: OffscreenCanvasRenderingContext2D | null;
let canvas: HTMLCanvasElement | Canvas;
let canvasContext: AnyCanvasRenderingContext2D | null; // use the any type

/**
 * Parses a `raster-dem` image into a DemTile using Webcoded VideoFrame API.
 */
async function decodeImageModern(
  blob: Blob,
  encoding: Encoding,
  abortController: AbortController,
): Promise<DemTile> {
  const img = await createImageBitmap(blob);
  if (isAborted(abortController)) return null as any as DemTile;
  return decodeImageUsingOffscreenCanvas(img, encoding);
}

function decodeImageUsingOffscreenCanvas(
  img: ImageBitmap,
  encoding: Encoding,
): DemTile {
  if (!offscreenCanvas) {
    offscreenCanvas = new OffscreenCanvas(img.width, img.height);
    offscreenContext = offscreenCanvas.getContext("2d", {
      willReadFrequently: true,
    }) as OffscreenCanvasRenderingContext2D;
  }

  return getElevations(img, encoding, offscreenCanvas, offscreenContext);
}

/**
 * Parses a `raster-dem` image into a DemTile using webcodec VideoFrame API which works
 * even when browsers disable/degrade the canvas getImageData API as a privacy protection.
 */
async function decodeImageVideoFrame(
  blob: Blob,
  encoding: Encoding,
  abortController: AbortController,
): Promise<DemTile> {
  const img = await createImageBitmap(blob);
  if (isAborted(abortController)) return null as any as DemTile;

  const vf = new VideoFrame(img, { timestamp: 0 });
  try {
    // formats we can handle: BGRX, BGRA, RGBA, RGBX
    const valid =
      vf?.format?.startsWith("BGR") || vf?.format?.startsWith("RGB");
    if (!valid) {
      throw new Error(`Unrecognized format: ${vf?.format}`);
    }
    const swapBR = vf?.format?.startsWith("BGR");
    const size = vf.allocationSize();
    const data = new Uint8ClampedArray(size);
    await vf.copyTo(data);
    if (swapBR) {
      for (let i = 0; i < data.length; i += 4) {
        const tmp = data[i];
        data[i] = data[i + 2];
        data[i + 2] = tmp;
      }
    }
    return decodeParsedImage(img.width, img.height, encoding, data);
  } catch (_) {
    if (isAborted(abortController)) return null as any as DemTile;
    // fall back to offscreen canvas
    return decodeImageUsingOffscreenCanvas(img, encoding);
  } finally {
    vf.close();
  }
}

/**
 * Parses a `raster-dem` image into a DemTile using `<img>` element drawn to a `<canvas>`.
 * Only works on the main thread, but works across all browsers.
 */
async function decodeImageOld(
  blob: Blob,
  encoding: Encoding,
  abortController: AbortController,
): Promise<DemTile> {
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvasContext = canvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
  }
  const img: HTMLImageElement = new Image();
  onAbort(abortController, () => (img.src = ""));
  const fetchedImage = await new Promise<HTMLImageElement>(
    (resolve, reject) => {
      img.onload = () => {
        if (!isAborted(abortController)) resolve(img);
        URL.revokeObjectURL(img.src);
        img.onload = null;
      };
      img.onerror = () => reject(new Error("Could not load image."));
      img.src = blob.size ? URL.createObjectURL(blob) : "";
    },
  );
  return getElevations(fetchedImage, encoding, canvas, canvasContext);
}

/**
 * This function is an alternative to decodeImageOld that is compatible with node
 * It will load a image and then use a canvas provided by the 'canvas' library to convert to a DemTile
 * */
async function decodeImageNode(
  blob: Blob,
  encoding: Encoding,
  abortController: AbortController,
): Promise<DemTile> {
  if (!canvas) {
    canvas = createCanvas(1, 1);
    canvasContext = canvas.getContext("2d") as NodeCanvasRenderingContext2D;
  }

  const buffer = await blob.arrayBuffer();
  const image = (await loadImage(Buffer.from(buffer))) as NodeImage;
  return getElevations(image, encoding, canvas, canvasContext);
}

/**
 * Parses a `raster-dem` image in a worker that doesn't support OffscreenCanvas and createImageBitmap
 * by running decodeImageOld on the main thread and returning the result.
 */
function decodeImageOnMainThread(
  blob: Blob,
  encoding: Encoding,
  abortController: AbortController,
): Promise<DemTile> {
  return ((self as any).actor as Actor<MainThreadDispatch>).send(
    "decodeImage",
    [],
    abortController,
    undefined,
    blob,
    encoding,
  );
}

function isWorker(): boolean {
  return (
    // @ts-expect-error WorkerGlobalScope defined
    typeof WorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" &&
    // @ts-expect-error WorkerGlobalScope defined
    self instanceof WorkerGlobalScope
  );
}

function isNode(): boolean {
  return (
    typeof process === "object" &&
    process.versions != null &&
    process.versions.node != null
  );
}

const defaultDecoder: (
  blob: Blob,
  encoding: Encoding,
  abortController: AbortController,
) => Promise<DemTile> = isNode()
  ? decodeImageNode
  : shouldUseVideoFrame()
    ? decodeImageVideoFrame
    : offscreenCanvasSupported()
      ? decodeImageModern
      : isWorker()
        ? decodeImageOnMainThread
        : decodeImageOld;

export default defaultDecoder;

function getElevations(
  img: any,
  encoding: Encoding,
  canvas: HTMLCanvasElement | OffscreenCanvas | Canvas,
  canvasContext:
    | AnyCanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null,
): DemTile {
  canvas.width = img.width;
  canvas.height = img.height;

  if (!canvasContext) throw new Error("failed to get context");

  if (isNode()) {
    // Handle Node.js environment
    (canvasContext as NodeCanvasRenderingContext2D).drawImage(
      img,
      0,
      0,
      img.width,
      img.height,
    );
  } else {
    // Handle browser environment
    if (img instanceof HTMLImageElement || img instanceof ImageBitmap) {
      if (canvasContext instanceof CanvasRenderingContext2D) {
        canvasContext.drawImage(img, 0, 0, img.width, img.height);
      } else if (canvasContext instanceof OffscreenCanvasRenderingContext2D) {
        canvasContext.drawImage(img, 0, 0, img.width, img.height);
      }
    }
  }

  const rgba = (canvasContext as CanvasRenderingContext2D).getImageData(
    0,
    0,
    img.width,
    img.height,
  ).data;
  return decodeParsedImage(img.width, img.height, encoding, rgba);
}

export function decodeParsedImage(
  width: number,
  height: number,
  encoding: Encoding,
  input: Uint8ClampedArray,
): DemTile {
  const decoder: (r: number, g: number, b: number) => number =
    encoding === "mapbox"
      ? (r, g, b) => -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
      : (r, g, b) => r * 256 + g + b / 256 - 32768;
  const data = new Float32Array(width * height);
  for (let i = 0; i < input.length; i += 4) {
    data[i / 4] = decoder(input[i], input[i + 1], input[i + 2]);
  }
  return { width, height, data };
}
