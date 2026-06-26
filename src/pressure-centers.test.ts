import {
  findPressureCentersInTiles,
  mercatorPixelToLngLat,
} from "./pressure-centers";
import type { DemTile } from "./types";

function dem(width: number, rows: number[][]): DemTile {
  return {
    width,
    height: rows.length,
    data: Float32Array.from(rows.flat()),
  };
}

const detectionDefaults = {
  smoothRadiusPx: 0,
  neighborhoodRadiusPx: 1,
  sampleStridePx: 1,
  closedContourDelta: 2,
  closedContourRadiusKm: 20_000,
  minDistanceKm: 0,
  maxCentersPerType: 10,
};

test("converts Web Mercator global pixels to lng/lat", () => {
  const center = mercatorPixelToLngLat(0, 128, 128, 256);
  expect(center.lng).toBeCloseTo(0, 10);
  expect(center.lat).toBeCloseTo(0, 10);

  const northWest = mercatorPixelToLngLat(1, 0, 0, 256);
  expect(northWest.lng).toBeCloseTo(-180, 10);
  expect(northWest.lat).toBeCloseTo(85.05112878, 8);
});

test("detects a closed high pressure center", () => {
  const tile = dem(5, [
    [1000, 1000, 1000, 1000, 1000],
    [1000, 1004, 1006, 1004, 1000],
    [1000, 1006, 1012, 1006, 1000],
    [1000, 1004, 1006, 1004, 1000],
    [1000, 1000, 1000, 1000, 1000],
  ]);

  const centers = findPressureCentersInTiles(
    [{ z: 0, x: 0, y: 0, tile }],
    detectionDefaults,
  );

  expect(centers).toHaveLength(1);
  expect(centers[0]).toMatchObject({
    type: "H",
    value: 1012,
    sourceTile: { z: 0, x: 0, y: 0 },
  });
  expect(centers[0].lng).toBeCloseTo(0, 10);
  expect(centers[0].lat).toBeCloseTo(0, 10);
});

test("detects a flat high pressure plateau at its center", () => {
  const tile = dem(7, [
    [1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [1000, 1005, 1008, 1008, 1008, 1005, 1000],
    [1000, 1008, 1012, 1012, 1012, 1008, 1000],
    [1000, 1008, 1012, 1012, 1012, 1008, 1000],
    [1000, 1008, 1012, 1012, 1012, 1008, 1000],
    [1000, 1005, 1008, 1008, 1008, 1005, 1000],
    [1000, 1000, 1000, 1000, 1000, 1000, 1000],
  ]);

  const centers = findPressureCentersInTiles(
    [{ z: 0, x: 0, y: 0, tile }],
    detectionDefaults,
  );

  expect(centers).toHaveLength(1);
  expect(centers[0]).toMatchObject({
    type: "H",
    value: 1012,
  });
  expect(centers[0].pixel.x).toBeCloseTo(3.5, 10);
  expect(centers[0].pixel.y).toBeCloseTo(3.5, 10);
});

test("detects a closed low pressure center", () => {
  const tile = dem(5, [
    [1010, 1010, 1010, 1010, 1010],
    [1010, 1006, 1004, 1006, 1010],
    [1010, 1004, 998, 1004, 1010],
    [1010, 1006, 1004, 1006, 1010],
    [1010, 1010, 1010, 1010, 1010],
  ]);

  const centers = findPressureCentersInTiles(
    [{ z: 0, x: 0, y: 0, tile }],
    detectionDefaults,
  );

  expect(centers).toHaveLength(1);
  expect(centers[0]).toMatchObject({
    type: "L",
    value: 998,
  });
});

test("rejects open contours that leak to the search radius", () => {
  const tile = dem(5, [
    [1008, 1007, 1006, 1005, 1004],
    [1007, 1008, 1007, 1006, 1005],
    [1006, 1007, 1012, 1007, 1006],
    [1005, 1006, 1007, 1008, 1007],
    [1004, 1005, 1006, 1007, 1008],
  ]);

  const centers = findPressureCentersInTiles(
    [{ z: 0, x: 0, y: 0, tile }],
    detectionDefaults,
  );

  expect(centers).toHaveLength(0);
});

test("merges nearby centers of the same type by pressure strength", () => {
  const tile = dem(9, [
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [1000, 1005, 1004, 1000, 1000, 1004, 1006, 1004, 1000],
    [1000, 1004, 1010, 1004, 1000, 1006, 1014, 1006, 1000],
    [1000, 1005, 1004, 1000, 1000, 1004, 1006, 1004, 1000],
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
  ]);

  const centers = findPressureCentersInTiles(
    [{ z: 0, x: 0, y: 0, tile }],
    {
      ...detectionDefaults,
      minDistanceKm: 20_000,
    },
  );

  expect(centers).toHaveLength(1);
  expect(centers[0]).toMatchObject({
    type: "H",
    value: 1014,
  });
});

test("keeps tile-local pixel position when detecting across neighboring tiles", () => {
  const west = dem(3, [
    [1000, 1000, 1000],
    [1000, 1005, 1008],
    [1000, 1000, 1000],
  ]);
  const east = dem(3, [
    [1000, 1000, 1000],
    [1012, 1008, 1000],
    [1000, 1000, 1000],
  ]);

  const centers = findPressureCentersInTiles(
    [
      { z: 1, x: 0, y: 0, tile: west },
      { z: 1, x: 1, y: 0, tile: east },
    ],
    detectionDefaults,
  );

  expect(centers).toHaveLength(1);
  expect(centers[0]).toMatchObject({
    type: "H",
    value: 1012,
    sourceTile: { z: 1, x: 1, y: 0 },
  });
  expect(centers[0].pixel.x).toBeCloseTo(0.5, 10);
  expect(centers[0].pixel.y).toBeCloseTo(1.5, 10);
});
