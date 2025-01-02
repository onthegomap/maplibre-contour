import { writeFileSync, mkdir } from "fs";
import { LocalDemManager } from "./local-dem-manager";
import { getChildren } from "@mapbox/tilebelt";
import type { Tile, Encoding } from "./types";
import path from "path";

// Define an interface for parsed arguments
interface ParsedArgs {
  x: number;
  y: number;
  z: number;
  sFile: string;
  sEncoding: string;
  sMaxZoom: number;
  increment: number;
  oMaxZoom: number;
  oDir: string;
}

// Get command-line arguments
const args: string[] = process.argv.slice(2);

// Helper function to parse command-line arguments
function parseArgs(): ParsedArgs {
  let x: number | undefined;
  let y: number | undefined;
  let z: number | undefined;
  let sFile: string | undefined;
  let sEncoding: string | undefined;
  let sMaxZoom: number | undefined;
  let increment: number | undefined;
  let oMaxZoom: number | undefined;
  let oDir: string | undefined;

  for (let i = 0; i < args.length; i += 2) {
    const argName = args[i];
    const argValue = args[i + 1];
    if (argName === "--x") {
      x = parseInt(argValue);
    } else if (argName === "--y") {
      y = parseInt(argValue);
    } else if (argName === "--z") {
      z = parseInt(argValue);
    } else if (argName === "--sFile") {
      sFile = argValue;
    } else if (argName === "--sEncoding") {
      sEncoding = argValue;
    } else if (argName === "--sMaxZoom") {
      sMaxZoom = parseInt(argValue);
    } else if (argName === "--increment") {
      increment = parseInt(argValue);
    } else if (argName === "--oMaxZoom") {
      oMaxZoom = parseInt(argValue);
    } else if (argName === "--oDir") {
      oDir = argValue;
    }
  }

  // Error handling, default values
  if (isNaN(x as number)) {
    throw new Error("Invalid --x argument. Must be a number.");
  }
  if (isNaN(y as number)) {
    throw new Error("Invalid --y argument. Must be a number.");
  }
  if (isNaN(z as number)) {
    throw new Error("Invalid --z argument. Must be a number.");
  }
  if (!sFile) {
    throw new Error("Invalid --sFile argument. Must be a string.");
  }
  if (!sEncoding) {
    throw new Error("Invalid --sEncoding argument. Must be a string.");
  }
  if (isNaN(sMaxZoom as number)) {
    throw new Error("Invalid --sMaxZoom argument. Must be a number.");
  }
  if (isNaN(increment as number)) {
    throw new Error("Invalid --increment argument. Must be a number.");
  }
  if (isNaN(oMaxZoom as number)) {
    throw new Error("Invalid --oMaxZoom argument. Must be a number.");
  }
  if (!oDir) {
    throw new Error("Invalid --oDir argument. Must be a string.");
  }

  return {
    x: x as number,
    y: y as number,
    z: z as number,
    sFile: sFile as string,
    sEncoding: sEncoding as string,
    sMaxZoom: sMaxZoom as number,
    increment: increment as number,
    oMaxZoom: oMaxZoom as number,
    oDir: oDir as string,
  };
}

// Parse command line args and set defaults
let x: number,
  y: number,
  z: number,
  sFile: string,
  sEncoding: string,
  sMaxZoom: number,
  increment: number,
  oMaxZoom: number, // Renamed maxZoom to oMaxZoom
  oDir: string;
try {
  ({ x, y, z, sFile, sEncoding, sMaxZoom, increment, oMaxZoom, oDir } =
    parseArgs());
} catch (e: any) {
  console.error(e);
  console.error(
    "Usage: npx tsx ./src/generate-countour-tile-batch.ts --x <x> --y <y> --z <z> --sFile <sFile> --sEncoding <sEncoding> --sMaxZoom <sMaxZoom> --increment <increment> --oMaxZoom <oMaxZoom> --oDir <oDir>",
  );
  process.exit(1);
}

function getAllTiles(tile: Tile, maxZoom: number): Tile[] {
  let allTiles: Tile[] = [tile]; // Initialize with the input tile

  function getTileList(tile: Tile) {
    const children: Tile[] = getChildren(tile);
    allTiles = allTiles.concat(children);
    if (children.length === 0 || children[0][2] >= maxZoom) return;
    children.forEach(getTileList);
  }

  getTileList(tile);

  return allTiles;
}

async function processTile(v: Tile): Promise<void> {
  const z: number = v[2];
  const x: number = v[0];
  const y: number = v[1];
  const dirPath: string = path.join(oDir, `${z}`, `${x}`);
  const filePath: string = path.join(dirPath, `${y}.pbf`);

  return manager
    .fetchContourTile(z, x, y, { levels: [increment] }, new AbortController())
    .then((tile) => {
      return new Promise<void>((resolve, reject) => {
        mkdir(dirPath, { recursive: true }, (err) => {
          if (err) {
            reject(err);
            return;
          }
          writeFileSync(filePath, Buffer.from(tile.arrayBuffer));
          resolve();
        });
      });
    });
}

async function processQueue(
  queue: Tile[],
  batchSize: number = 25,
): Promise<void> {
  for (let i = 0; i < queue.length; i += batchSize) {
    const batch = queue.slice(i, i + batchSize);
    console.log(
      `Processing batch ${i / batchSize + 1} of ${Math.ceil(queue.length / batchSize)} of tile ${z}/${x}/${y}`,
    );
    await Promise.all(batch.map(processTile));
    console.log(
      `Processed batch ${i / batchSize + 1} of ${Math.ceil(queue.length / batchSize)} of tile ${z}/${x}/${y}`,
    );
  }
}

const manager: LocalDemManager = new LocalDemManager(
  sFile,
  200,
  sEncoding as Encoding,
  sMaxZoom,
  10000,
);
manager.initializePMTiles();

// Use parsed command line args
const children: Tile[] = getAllTiles([x, y, z], oMaxZoom);

children.sort((a, b) => {
  //Sort by Z first
  if (a[2] !== b[2]) return a[2] - b[2];
  //If Z is equal, sort by X
  if (a[0] !== b[0]) return a[0] - b[0];
  //If Z and X are equal, sort by Y
  return a[1] - b[1];
});

processQueue(children).then(() => {
  console.log(`All files for tile ${z}/${x}/${y} have been written!`);
});
