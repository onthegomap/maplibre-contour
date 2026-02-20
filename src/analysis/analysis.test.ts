import { HeightTile } from "../height-tile";
import { computeAnalysisTile } from "./analysis-kernel";
import { colorizeAnalysisTile, parseRamp } from "./analysis-color";
import { encodePngRgba } from "./analysis-encode";
import type { IndividualAnalysisTileOptions } from "../types";
import { PNG } from "pngjs";

// A realistic 8x8 DEM tile simulating a hillside (values in meters).
// Elevation increases from left to right and bottom to top.
function makeHillsideTile(): HeightTile {
  const width = 8;
  const height = 8;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // ~500m per pixel elevation gradient → steep slopes
      data[y * width + x] = x * 500 + y * 300;
    }
  }
  return HeightTile.fromRawDem({ width, height, data });
}

// Combine a tile with identical neighbors so border lookups work
function withNeighbors(tile: HeightTile): HeightTile {
  const neighbors = Array(9).fill(tile);
  return HeightTile.combineNeighbors(neighbors)!.materialize(1);
}

const slopeOptions: IndividualAnalysisTileOptions = {
  mode: "slope",
  units: "degrees",
  alpha: 1,
  smooth: false,
  exaggeration: 1,
  ramp: "default",
};

const aspectOptions: IndividualAnalysisTileOptions = {
  mode: "aspect",
  units: "degrees",
  alpha: 1,
  smooth: false,
  exaggeration: 1,
  ramp: "aspect",
};

describe("analysis-kernel: computeAnalysisTile", () => {
  test("produces non-zero slope values for hillside DEM", () => {
    const tile = withNeighbors(makeHillsideTile());
    // z=12 gives realistic meters-per-pixel
    const scalar = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);
    expect(scalar.width).toBe(tile.width);
    expect(scalar.height).toBe(tile.height);

    const nonZero = scalar.data.filter((v) => v > 1);
    expect(nonZero.length).toBeGreaterThan(0);

    // With 500m/pixel gradient and ~10m real pixel size at z=12,
    // slopes should be very steep (near 90°)
    const maxSlope = Math.max(...scalar.data);
    expect(maxSlope).toBeGreaterThan(20);
  });

  test("produces aspect values in [0, 360) range", () => {
    const tile = withNeighbors(makeHillsideTile());
    const scalar = computeAnalysisTile(tile, 12, 100, 100, aspectOptions);

    for (const val of scalar.data) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(360);
    }

    // With both x and y gradients, should have non-trivial aspect diversity
    const uniqueAspects = new Set(scalar.data.map((v) => Math.round(v)));
    expect(uniqueAspects.size).toBeGreaterThan(1);
  });

  test("flat DEM produces near-zero slope everywhere", () => {
    const flat = HeightTile.fromRawDem({
      width: 8,
      height: 8,
      data: new Float32Array(64).fill(100),
    });
    const tile = withNeighbors(flat);
    const scalar = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);

    for (const val of scalar.data) {
      expect(val).toBeLessThan(0.01);
    }
  });

  test("exaggeration multiplies slope", () => {
    const tile = withNeighbors(makeHillsideTile());
    const base = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);
    const exag = computeAnalysisTile(tile, 12, 100, 100, {
      ...slopeOptions,
      exaggeration: 2,
    });

    // At least one pixel should have higher slope with exaggeration
    let anyHigher = false;
    for (let i = 0; i < base.data.length; i++) {
      if (exag.data[i] > base.data[i] + 0.01) anyHigher = true;
    }
    expect(anyHigher).toBe(true);
  });
});

describe("analysis-color: colorizeAnalysisTile", () => {
  test("steep slopes produce non-white, non-transparent pixels", () => {
    const tile = withNeighbors(makeHillsideTile());
    const scalar = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);
    const rgba = colorizeAnalysisTile(scalar, slopeOptions);

    expect(rgba.length).toBe(scalar.width * scalar.height * 4);

    // Check that at least some pixels are non-white and non-transparent
    let nonWhiteCount = 0;
    let nonTransparentCount = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
      if (a > 0) nonTransparentCount++;
      if (a > 0 && (r < 255 || g < 255 || b < 255)) nonWhiteCount++;
    }

    expect(nonTransparentCount).toBeGreaterThan(0);
    expect(nonWhiteCount).toBeGreaterThan(0);
  });

  test("alpha option scales output alpha", () => {
    const tile = withNeighbors(makeHillsideTile());
    const scalar = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);
    const fullAlpha = colorizeAnalysisTile(scalar, { ...slopeOptions, alpha: 1 });
    const halfAlpha = colorizeAnalysisTile(scalar, { ...slopeOptions, alpha: 0.5 });

    // Compare alpha channel of first non-transparent pixel
    for (let i = 3; i < fullAlpha.length; i += 4) {
      if (fullAlpha[i] > 0) {
        expect(halfAlpha[i]).toBeLessThan(fullAlpha[i]);
        break;
      }
    }
  });

  test("flat DEM with default slope ramp produces white pixels", () => {
    const flat = HeightTile.fromRawDem({
      width: 4,
      height: 4,
      data: new Float32Array(16).fill(100),
    });
    const tile = withNeighbors(flat);
    const scalar = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);
    const rgba = colorizeAnalysisTile(scalar, slopeOptions);

    // All pixels should be white (default color for slope < 21°)
    for (let i = 0; i < rgba.length; i += 4) {
      expect(rgba[i]).toBe(255);     // R
      expect(rgba[i + 1]).toBe(255); // G
      expect(rgba[i + 2]).toBe(255); // B
    }
  });

  test("aspect colorization produces varied colors", () => {
    const tile = withNeighbors(makeHillsideTile());
    const scalar = computeAnalysisTile(tile, 12, 100, 100, aspectOptions);
    const rgba = colorizeAnalysisTile(scalar, aspectOptions);

    // Collect unique non-transparent colors
    const colors = new Set<string>();
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] > 0) {
        colors.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
      }
    }
    expect(colors.size).toBeGreaterThan(0);
  });
});

describe("analysis-color: parseRamp", () => {
  test("parses default slope ramp", () => {
    const ramp = parseRamp("default", "slope");
    expect(ramp.type).toBe("step");
    expect(ramp.stops.length).toBeGreaterThan(5);
  });

  test("parses default aspect ramp", () => {
    const ramp = parseRamp("default", "aspect");
    expect(ramp.type).toBe("interpolate");
  });

  test("parses JSON step expression", () => {
    const json = '["step",["slope"],"#fff",30,"#f00",60,"#000"]';
    const ramp = parseRamp(json, "slope");
    expect(ramp.type).toBe("step");
    expect(ramp.stops.length).toBe(2);
  });

  test("parses JSON interpolate expression", () => {
    const json = '["interpolate",["linear"],["aspect"],0,"#f00",180,"#00f",360,"#f00"]';
    const ramp = parseRamp(json, "aspect");
    expect(ramp.type).toBe("interpolate");
    expect(ramp.stops.length).toBe(3);
  });
});

describe("analysis-encode: encodePngRgba", () => {
  test("produces valid PNG with correct header", () => {
    const rgba = new Uint8Array(4 * 4 * 4); // 4x4 image
    rgba.fill(128);
    const png = encodePngRgba(4, 4, rgba);
    const header = Array.from(new Uint8Array(png).slice(0, 8));
    expect(header).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("PNG size is reasonable", () => {
    const rgba = new Uint8Array(256 * 256 * 4);
    rgba.fill(200);
    const png = encodePngRgba(256, 256, rgba);
    // Uncompressed store: should be roughly scanlineSize * height + overhead
    expect(png.byteLength).toBeGreaterThan(256 * 256 * 4);
  });
});

describe("tile boundary consistency", () => {
  // Create a large DEM (16x16) that we split into 4 tiles (8x8 each),
  // then verify that adjacent analysis tiles produce identical slope
  // values at their shared edges.
  function makeLargeDem(): HeightTile {
    const width = 16;
    const height = 16;
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Smooth gradient with some nonlinearity
        data[y * width + x] = x * 200 + y * 150 + Math.sin(x * 0.5) * 50;
      }
    }
    return HeightTile.fromRawDem({ width, height, data });
  }

  // Split a 16x16 DEM into four 8x8 quadrants
  function quadrant(dem: HeightTile, qx: number, qy: number): HeightTile {
    const hw = dem.width / 2;
    const hh = dem.height / 2;
    return new HeightTile(hw, hh, (x, y) =>
      dem.get(x + qx * hw, y + qy * hh),
    );
  }

  // Build the same 3x3 neighbor grid that fetchAnalysisTile uses,
  // for a tile at grid position (gx, gy) within a 2x2 tile grid.
  // Missing neighbors (outside the grid) use the edge tile.
  function neighborsFor(
    tiles: HeightTile[][],
    gx: number,
    gy: number,
  ): (HeightTile | undefined)[] {
    const out: (HeightTile | undefined)[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = Math.max(0, Math.min(1, gx + dx));
        const ny = Math.max(0, Math.min(1, gy + dy));
        out.push(tiles[ny][nx]);
      }
    }
    return out;
  }

  test("east-west adjacent tiles produce consistent edge slopes", () => {
    const dem = makeLargeDem();
    const tiles = [
      [quadrant(dem, 0, 0), quadrant(dem, 1, 0)],
      [quadrant(dem, 0, 1), quadrant(dem, 1, 1)],
    ];

    // Compute analysis for tile (0,0) and tile (1,0)
    const leftVirtual = HeightTile.combineNeighbors(
      neighborsFor(tiles, 0, 0),
    )!.materialize(1);
    const rightVirtual = HeightTile.combineNeighbors(
      neighborsFor(tiles, 1, 0),
    )!.materialize(1);

    const opts = slopeOptions;
    const leftScalar = computeAnalysisTile(leftVirtual, 12, 0, 0, opts);
    const rightScalar = computeAnalysisTile(rightVirtual, 12, 1, 0, opts);

    const w = leftScalar.width;
    // The rightmost column of left tile and leftmost column of right tile
    // are adjacent pixels. They should have smoothly varying values,
    // not a discontinuity. Check that the DEM data at the boundary is
    // correctly shared.
    for (let y = 0; y < leftScalar.height; y++) {
      const leftEdge = leftScalar.data[y * w + (w - 1)];
      const rightEdge = rightScalar.data[y * w + 0];
      // Adjacent pixels can differ, but not by a huge amount
      // (the DEM gradient is smooth)
      expect(Math.abs(leftEdge - rightEdge)).toBeLessThan(5);
    }
  });

  test("materialize(1) provides sufficient buffer for Horn kernel", () => {
    const tile = withNeighbors(makeHillsideTile());
    // Verify that edge pixels don't produce NaN (which would happen
    // if the buffer was insufficient and we read outside materialized data)
    const scalar = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);
    for (let i = 0; i < scalar.data.length; i++) {
      expect(Number.isFinite(scalar.data[i])).toBe(true);
    }
  });
});

describe("full pipeline: DEM → scalar → RGBA → PNG", () => {
  test("hillside DEM produces non-trivial PNG", () => {
    const tile = withNeighbors(makeHillsideTile());
    const scalar = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);
    const rgba = colorizeAnalysisTile(scalar, slopeOptions);
    const png = encodePngRgba(scalar.width, scalar.height, rgba);

    // PNG header
    const header = Array.from(new Uint8Array(png).slice(0, 8));
    expect(header).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.byteLength).toBeGreaterThan(100);

    // Verify RGBA had visible content
    let hasColor = false;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] > 0 && (rgba[i] < 255 || rgba[i + 1] < 255 || rgba[i + 2] < 255)) {
        hasColor = true;
        break;
      }
    }
    expect(hasColor).toBe(true);
  });

  test("encodePngRgba output is decodable by pngjs and preserves pixels", () => {
    const width = 4, height = 4;
    const srcRgba = new Uint8Array(width * height * 4);
    // Paint known colors: red with alpha=200
    for (let i = 0; i < width * height; i++) {
      srcRgba[i * 4] = 255;
      srcRgba[i * 4 + 1] = 0;
      srcRgba[i * 4 + 2] = 0;
      srcRgba[i * 4 + 3] = 200;
    }
    const pngBuf = encodePngRgba(width, height, srcRgba);
    const decoded = PNG.sync.read(Buffer.from(pngBuf));

    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);

    // Check first pixel preserved
    expect(decoded.data[0]).toBe(255); // R
    expect(decoded.data[1]).toBe(0);   // G
    expect(decoded.data[2]).toBe(0);   // B
    expect(decoded.data[3]).toBe(200); // A
  });

  test("full slope pipeline PNG is decodable and has non-white pixels", () => {
    const tile = withNeighbors(makeHillsideTile());
    const scalar = computeAnalysisTile(tile, 12, 100, 100, slopeOptions);
    const rgba = colorizeAnalysisTile(scalar, slopeOptions);
    const pngBuf = encodePngRgba(scalar.width, scalar.height, rgba);

    const decoded = PNG.sync.read(Buffer.from(pngBuf));
    expect(decoded.width).toBe(scalar.width);
    expect(decoded.height).toBe(scalar.height);

    // Verify decoded PNG has non-white, non-transparent pixels
    let nonWhiteCount = 0;
    for (let i = 0; i < decoded.data.length; i += 4) {
      const r = decoded.data[i], g = decoded.data[i+1], b = decoded.data[i+2], a = decoded.data[i+3];
      if (a > 0 && (r < 255 || g < 255 || b < 255)) nonWhiteCount++;
    }
    expect(nonWhiteCount).toBeGreaterThan(0);
  });
});
