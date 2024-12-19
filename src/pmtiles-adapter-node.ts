import fs from "node:fs";
import { PMTiles, FetchSource, type Source } from "pmtiles";

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
