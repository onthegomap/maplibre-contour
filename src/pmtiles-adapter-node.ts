/**
 * This module provides utilities for working with PMTiles and processing image data in node.
 */
import fs from "node:fs";
import { PMTiles, FetchSource, type Source } from "pmtiles";
import sharp from "sharp";
import { decodeParsedImage } from "./decode-image";
import type { DemTile, Encoding } from "./types";

const httpTester = /^https?:\/\//i;

/**
 * Represents a PMTiles data source using a file descriptor.
 */
export class PMTilesFileSource implements Source {
  private fd: number;

  /**
   * Creates a new PMTilesFileSource.
   * @param {number} fd - The file descriptor for the PMTiles file.
   */
  constructor(fd: number) {
    this.fd = fd;
  }

  /**
   * Gets the key representing this source (the file descriptor as a string).
   * @returns {string} The key for this source.
   */
  getKey(): string {
    return String(this.fd);
  }

  /**
   * Gets a chunk of bytes from the PMTiles file.
   * @param {number} offset - The offset to read from.
   * @param {number} length - The number of bytes to read.
   * @returns {Promise<{ data: ArrayBuffer }>} A Promise that resolves with the requested bytes as an ArrayBuffer.
   */
  async getBytes(
    offset: number,
    length: number,
  ): Promise<{ data: ArrayBuffer }> {
    const buffer = Buffer.alloc(length);
    await readFileBytes(this.fd, buffer, offset);
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
    return { data: ab };
  }
}

/**
 * Reads bytes from a file asynchronously.
 * @param {number} fd - The file descriptor.
 * @param {Buffer} buffer - The buffer to read data into.
 * @param {number} offset - The offset to read from in the file.
 * @returns {Promise<void>} A Promise that resolves when the bytes are read or rejects if an error occurs.
 * @throws If an error occurs while reading the file or the correct amount of data isn't read.
 */
async function readFileBytes(
  fd: number,
  buffer: Buffer,
  offset: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.read(fd, buffer, 0, buffer.length, offset, (err, bytesRead, _buff) => {
      if (err) {
        return reject(err);
      }
      if (bytesRead !== buffer.length) {
        return reject(
          new Error(
            `Failed to read the requested amount of bytes, got ${bytesRead} expected ${buffer.length}`,
          ),
        );
      }
      resolve();
    });
  });
}

/**
 * Opens a PMTiles file or resource, creating a PMTiles object.
 * @param {string} FilePath - The path to a local PMTiles file or a URL for a remote resource.
 * @returns {PMTiles} A PMTiles object.
 */
export function openPMtiles(FilePath: string): PMTiles {
  let pmtiles: PMTiles;
  let fd: number | undefined;

  try {
    if (httpTester.test(FilePath)) {
      const source = new FetchSource(FilePath);
      pmtiles = new PMTiles(source);
    } else {
      fd = fs.openSync(FilePath, "r");
      const source = new PMTilesFileSource(fd);
      pmtiles = new PMTiles(source);
    }
    return pmtiles;
  } finally {
    // No need to close here; the PMTiles object is responsible for cleaning up the source.
  }
}

/**
 * Retrieves a tile from a PMTiles archive by its ZXY coordinates.
 * @param {PMTiles} pmtiles - The PMTiles object to query.
 * @param {number} z - The zoom level of the tile.
 * @param {number} x - The X coordinate of the tile.
 * @param {number} y - The Y coordinate of the tile.
 * @returns {Promise<{ data: ArrayBuffer | undefined }>} A Promise that resolves with the tile data as an ArrayBuffer, or undefined if the tile is not found.
 */
export async function getPMtilesTile(
  pmtiles: PMTiles,
  z: number,
  x: number,
  y: number,
): Promise<{ data: ArrayBuffer | undefined }> {
  try {
    const zxyTile = await pmtiles.getZxy(z, x, y);

    if (zxyTile && zxyTile.data) {
      return { data: zxyTile.data };
    } else {
      return { data: undefined };
    }
  } catch (error) {
    console.error("Error fetching tile:", error);
    return { data: undefined };
  }
}

/**
 * Processes image data from a blob.
 * @param {Blob} blob - The image data as a Blob.
 * @param {Encoding} encoding - The encoding to use when decoding.
 * @param {AbortController} abortController - An AbortController to cancel the image processing.
 * @returns {Promise<DemTile>} - A Promise that resolves with the processed image data, or throws if aborted.
 * @throws If an error occurs during image processing.
 */
export async function GetImageData(
  blob: Blob,
  encoding: Encoding,
  abortController: AbortController,
): Promise<DemTile> {
  if (abortController?.signal?.aborted) {
    throw new Error("Image processing was aborted.");
  }
  try {
    const buffer = await blob.arrayBuffer();
    const image = sharp(Buffer.from(buffer));

    if (abortController?.signal?.aborted) {
      throw new Error("Image processing was aborted.");
    }

    const { data, info } = await image
      .ensureAlpha() // Ensure RGBA output
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (abortController?.signal?.aborted) {
      throw new Error("Image processing was aborted.");
    }
    const parsed = decodeParsedImage(
      info.width,
      info.height,
      encoding,
      data as any as Uint8ClampedArray,
    );
    if (abortController?.signal?.aborted) {
      throw new Error("Image processing was aborted.");
    }

    return parsed;
  } catch (error) {
    console.error("Error processing image:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("An unknown error has occurred.");
  }
}
