/**
 * This module provides utilities for working with PMTiles in a web environment.
 */

import { PMTiles, FetchSource } from "pmtiles";
import type { Encoding } from "./types";

/**
 * Opens a PMTiles resource using a URL.
 * @param {string} FilePath - The URL of the PMTiles resource.
 * @returns {PMTiles} A PMTiles object.
 */
export function openPMtiles(FilePath: string): PMTiles {
  const source = new FetchSource(FilePath);
  const pmtiles = new PMTiles(source);
  return pmtiles;
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
 * Placeholder function for processing image data when built for the web.
 * This function does not perform any processing and always returns undefined.
 * @param {Blob} _blob - The image data as a Blob (not used).
 * @param {Encoding} _encoding - The encoding (not used).
 * @param {AbortController} _abortController - The abort controller (not used).
 * @returns {Promise<undefined>} A Promise that always resolves with undefined.
 */
export async function GetImageData(
  _blob: Blob,
  _encoding: Encoding,
  _abortController: AbortController,
): Promise<undefined> {
  return undefined;
}
