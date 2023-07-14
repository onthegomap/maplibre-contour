import Pbf from "pbf";
import encodeVectorTile, { GeomType } from "./vtpbf";
import { VectorTile } from "@mapbox/vector-tile";

test("empty tile", () => {
  expect(
    encodeVectorTile({
      layers: {},
    }).length,
  ).toBe(0);
});

test("simple line", () => {
  const encoded = encodeVectorTile({
    layers: {
      contours: {
        features: [
          {
            geometry: [[0, 1, 2, 3]],
            type: GeomType.LINESTRING,
            properties: {
              key: "value",
            },
          },
        ],
      },
    },
  });
  const result = new VectorTile(new Pbf(encoded));
  expect(result.layers).toHaveProperty("contours");
  expect(result.layers.contours.extent).toBe(4096);
  expect(result.layers.contours.version).toBe(2);
  expect(result.layers.contours.length).toBe(1);
  expect(result.layers.contours.feature(0).properties).toEqual({
    key: "value",
  });
  expect(result.layers.contours.feature(0).loadGeometry()).toEqual([
    [
      { x: 0, y: 1 },
      { x: 2, y: 3 },
    ],
  ]);
});

test("multi line", () => {
  const encoded = encodeVectorTile({
    layers: {
      contours: {
        features: [
          {
            geometry: [
              [0, 1, 2, 3],
              [9, 8, 7, 6],
            ],
            type: GeomType.LINESTRING,
            properties: {
              key: 1,
              key2: true,
            },
          },
        ],
      },
    },
  });
  const result = new VectorTile(new Pbf(encoded));
  expect(result.layers.contours.feature(0).properties).toEqual({
    key: 1,
    key2: true,
  });
  expect(result.layers.contours.feature(0).loadGeometry()).toEqual([
    [
      { x: 0, y: 1 },
      { x: 2, y: 3 },
    ],
    [
      { x: 9, y: 8 },
      { x: 7, y: 6 },
    ],
  ]);
});
