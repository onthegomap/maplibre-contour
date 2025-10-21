/*
Adapted from vt-pbf https://github.com/mapbox/vt-pbf

The MIT License (MIT)

Copyright (c) 2015 Anand Thakker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import Pbf from "pbf";

export const enum GeomType {
  UNKNOWN = 0,
  POINT = 1,
  LINESTRING = 2,
  POLYGON = 3,
}

export type PropertyValue = string | boolean | number;

export interface Feature {
  type: GeomType;
  properties: { [key: string]: PropertyValue };
  geometry: number[][];
}

export interface Layer {
  features: Feature[];
  extent?: number;
}

export interface Tile {
  extent?: number;
  layers: { [id: string]: Layer };
}

interface Context {
  keys: string[];
  values: PropertyValue[];
  keycache: { [any: string]: number };
  valuecache: { [any: string]: number };
  feature?: Feature;
}

/**
 * Enodes and serializes a mapbox vector tile as an array of bytes.
 */
export default function encodeVectorTile(tile: Tile): Uint8Array {
  const pbf = new Pbf();
  for (const id in tile.layers) {
    const layer = tile.layers[id];
    if (!layer.extent) {
      layer.extent = tile.extent;
    }
    pbf.writeMessage(3, writeLayer, { ...layer, id });
  }
  return pbf.finish();
}

function writeLayer(layer: Layer & { id: string }, pbf?: Pbf) {
  if (!pbf) throw new Error("pbf undefined");

  pbf.writeStringField(1, layer.id || ""); // name (required, field 1)

  // Write all features (field 2)
  const context: Context = {
    keys: [],
    values: [],
    keycache: {},
    valuecache: {},
  };

  for (const feature of layer.features) {
    context.feature = feature;
    pbf.writeMessage(2, writeFeature, context);
  }

  // Write all keys (field 3)
  for (const key of context.keys) {
    pbf.writeStringField(3, key);
  }

  // Write all values (field 4)
  for (const value of context.values) {
    pbf.writeMessage(4, writeValue, value);
  }

  pbf.writeVarintField(5, layer.extent || 4096); // extent (field 5)
  pbf.writeVarintField(15, 2); // version (field 15, LAST)
}

function writeFeature(context: Context, pbf?: Pbf) {
  const feature = context.feature;
  if (!feature || !pbf) throw new Error();

  pbf.writeMessage(2, writeProperties, context);
  pbf.writeVarintField(3, feature.type);
  pbf.writeMessage(4, writeGeometry, feature);
}

function writeProperties(context: Context, pbf?: Pbf) {
  const feature = context.feature;
  if (!feature || !pbf) throw new Error();
  const keys = context.keys;
  const values = context.values;
  const keycache = context.keycache;
  const valuecache = context.valuecache;

  for (const key in feature.properties) {
    let value = feature.properties[key];

    let keyIndex = keycache[key];
    if (value === null) continue; // don't encode null value properties

    if (typeof keyIndex === "undefined") {
      keys.push(key);
      keyIndex = keys.length - 1;
      keycache[key] = keyIndex;
    }
    pbf.writeVarint(keyIndex);

    const type = typeof value;
    if (type !== "string" && type !== "boolean" && type !== "number") {
      value = JSON.stringify(value);
    }
    const valueKey = `${type}:${value}`;
    let valueIndex = valuecache[valueKey];
    if (typeof valueIndex === "undefined") {
      values.push(value);
      valueIndex = values.length - 1;
      valuecache[valueKey] = valueIndex;
    }
    pbf.writeVarint(valueIndex);
  }
}

function command(cmd: number, length: number) {
  return (length << 3) + (cmd & 0x7);
}

function zigzag(num: number) {
  return (num << 1) ^ (num >> 31);
}

function writeGeometry(feature: Feature, pbf?: Pbf) {
  if (!pbf) throw new Error();
  const geometry = feature.geometry;
  const type = feature.type;
  let x = 0;
  let y = 0;
  for (const ring of geometry) {
    let count = 1;
    if (type === GeomType.POINT) {
      count = ring.length / 2;
    }
    pbf.writeVarint(command(1, count)); // moveto
    // do not write polygon closing path as lineto
    const length = ring.length / 2;
    const lineCount = type === GeomType.POLYGON ? length - 1 : length;
    for (let i = 0; i < lineCount; i++) {
      if (i === 1 && type !== 1) {
        pbf.writeVarint(command(2, lineCount - 1)); // lineto
      }
      const dx = ring[i * 2] - x;
      const dy = ring[i * 2 + 1] - y;
      pbf.writeVarint(zigzag(dx));
      pbf.writeVarint(zigzag(dy));
      x += dx;
      y += dy;
    }
    if (type === GeomType.POLYGON) {
      pbf.writeVarint(command(7, 1)); // closepath
    }
  }
}

function writeValue(value: PropertyValue, pbf?: Pbf) {
  if (!pbf) throw new Error();
  if (typeof value === "string") {
    pbf.writeStringField(1, value);
  } else if (typeof value === "boolean") {
    pbf.writeBooleanField(7, value);
  } else if (typeof value === "number") {
    if (value % 1 !== 0) {
      pbf.writeDoubleField(3, value);
    } else if (value < 0) {
      pbf.writeSVarintField(6, value);
    } else {
      pbf.writeVarintField(5, value);
    }
  }
}
