import fs from "node:fs";
import { PMTiles, FetchSource, type Source } from "pmtiles";
import { PNG } from "pngjs";
import { decode } from 'webp-wasm'; // Changed import
import { decodeParsedImage } from "./decode-image";
import type { Encoding } from "./types";

const httpTester = /^https?:\/\//i;

export class PMTilesFileSource implements Source {
  private fd: number;

  constructor(fd: number) {
    this.fd = fd;
  }

  getKey(): string {
    return String(this.fd); // Convert the fd to a string
  }

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

async function readFileBytes(
  fd: number,
  buffer: Buffer,
  offset: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.read(fd, buffer, 0, buffer.length, offset, (err, bytesRead, buff) => {
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
  }
}
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

function isWebP(buffer: Buffer): boolean {
    if (buffer.length < 12) {
        return false; // Too short to be a valid WebP
    }
  
    // Check for "RIFF" at bytes 0-3
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46
    ) {
      // Check for "WEBP" at bytes 8-11
      if (
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
      ) {
        return true; // Found WebP header
      }
    }
    return false; // Not a WebP
}


export async function GetImageData(
    blob: Blob,
    encoding: Encoding,
  ): Promise<any> {
  
    const buffer = await blob.arrayBuffer();
    const bufferAsNodeBuffer = Buffer.from(buffer);
  
    if (isWebP(bufferAsNodeBuffer)) {
        try {
            const decoded = await decode(bufferAsNodeBuffer);
            if (!decoded || !decoded.data || decoded.width === 0 || decoded.height === 0) {
                throw new Error("WebP decoding failed or invalid data");
            }
            
            const parsed = decodeParsedImage(
                decoded.width,
                decoded.height,
                encoding,
                decoded.data as any as Uint8ClampedArray
            );

            return parsed;

        } catch (webpError) {
           // Handle the case when neither PNG nor WebP decoding works
          console.error("Error decoding WebP:", webpError);
          throw new Error('Could not decode image as WebP.');
        }
    } else {
         try {
            // Attempt to decode as PNG 
            const png = PNG.sync.read(bufferAsNodeBuffer);
            const parsed = decodeParsedImage(
              png.width,
              png.height,
              encoding,
              png.data as any as Uint8ClampedArray,
            );
            return parsed;
    
        } catch (pngError) {
             // Handle the case when neither PNG nor WebP decoding works
            console.error("Error decoding PNG:", pngError);
            throw new Error('Could not decode image as PNG.');
         }
    }
}