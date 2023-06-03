import { flattenDeep } from "lodash";
import { HeightTile } from "./height-tile";
import generateIsolines from "./isolines";

runTestWithRotations("corner halfway", 2, heightTile(1, 1, 1, 3), {
  2: [[1, 0.5, 0.5, 1]],
});

runTestWithRotations(
  "corner above most of the way",
  2,
  heightTile(1, 1, 1, 2.33333),
  {
    2: [[1, 0.75, 0.75, 1]],
  }
);

runTestWithRotations("two contours", 2, heightTile(1, 1, 1, 5), {
  2: [[1, 0.25, 0.25, 1]],
  4: [[1, 0.75, 0.75, 1]],
});

runTestWithRotations(
  "edge above threshold",
  2,
  heightTile(1, 1, 2.33333, 2.33333),
  {
    2: [[1, 0.75, 0, 0.75]],
  }
);

runTestWithRotations(
  "edge above threshold",
  2,
  heightTile(1, 1, 2.33333, 2.33333),
  {
    2: [[1, 0.75, 0, 0.75]],
  }
);

runTestWithRotations("corner up to threshold", 2, heightTile(1, 1, 1, 2), {});
runTestWithRotations("omit empty point??", 2, heightTile(2, 3, 3, 3), {
  2: [[0, 0, 0, 0]],
});
runTestWithRotations("side up to threshold", 2, heightTile(1, 2, 1, 2), {});
runTestWithRotations("side down to threshold", 2, heightTile(2, 3, 2, 3), {
  2: [[0, 0, 0, 1]],
});
runTestWithRotations(
  "threshold middle",
  2,
  heightTile([
    [1, 1, 1, 1],
    [1, 2, 1, 1],
    [1, 2, 1, 1],
    [1, 1, 1, 1],
  ]),
  {}
);
runTestWithRotations(
  "corner below threshold",
  2,
  heightTile([
    [1, 2.3333333],
    [2.3333333, 2.3333333],
  ]),
  {
    2: [[0.75, 0, 0, 0.75]],
  }
);
runTest(
  "saddle",
  0,
  2,
  heightTile([
    [1, 2.3333333],
    [2.3333333, 1],
  ]),
  {
    2: [
      [0.75, 0, 1, 0.25],
      [0.25, 1, 0, 0.75],
    ],
  }
);
runTestWithRotations("no contours", 2, heightTile(1, 1, 1, 1), {});
runTestWithRotations(
  "connect segments",
  2,
  heightTile([
    [1, 3, 3],
    [1, 1, 3],
    [1, 1, 1],
  ]),
  {
    2: [[0.5, 0, 1, 0.5, 1.5, 1, 2, 1.5]],
  }
);
runTest(
  "center point above",
  0,
  2,
  heightTile([
    [1, 1, 1],
    [1, 3, 1],
    [1, 1, 1],
  ]),
  {
    2: [[1.5, 1, 1, 0.5, 0.5, 1, 1, 1.5, 1.5, 1]],
  }
);
runTest(
  "center point below",
  0,
  2,
  heightTile([
    [3, 3, 3],
    [3, 1, 3],
    [3, 3, 3],
  ]),
  {
    2: [[1, 1.5, 0.5, 1, 1, 0.5, 1.5, 1, 1, 1.5]],
  }
);

function heightTile(...values: number[] | number[][][]): HeightTile {
  const flattened = flattenDeep(values);
  const size = Math.sqrt(flattened.length);
  return HeightTile.fromRawDem({
    width: size,
    height: size,
    data: Float32Array.from(flattened),
  });
}

function runTestWithRotations(
  name: string,
  interval: number,
  heightTile: HeightTile,
  expected: { [ele: number]: number[][] }
) {
  for (const rotation of [0, 90, 180, 270]) {
    runTest(
      `${name} (rotation=${rotation})`,
      rotation,
      interval,
      heightTile,
      expected
    );
  }
}

function rotate(
  [x, y]: [number, number],
  [ax, ay]: [number, number],
  angle: number
): [number, number] {
  const theta = (angle * Math.PI) / 180;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);

  const rx = x - ax;
  const ry = y - ay;

  return [round(ax + rx * cos - ry * sin), round(ay + ry * cos + rx * sin)];
}

function round(n: number): number {
  return Math.round(n * 1000 + 0.001) / 1000;
}

function runTest(
  name: string,
  rotation: number,
  interval: number,
  heightTile: HeightTile,
  expected: { [ele: number]: number[][] }
) {
  test(name, () => {
    const size = heightTile.width;
    const center = (size - 1) / 2;
    const rotatedHeightTile = new HeightTile(
      heightTile.width,
      heightTile.height,
      (x, y) => {
        if (x < 0 || x >= size) {
          throw new Error(`x=${x}`);
        } else if (y < 0 || y >= size) {
          throw new Error(`y=${y}`);
        }
        const [nx, ny] = rotate([x, y], [center, center], rotation).map(
          round
        ) as [number, number];
        return heightTile.get(nx, ny);
      }
    );
    const isolines = generateIsolines(interval, rotatedHeightTile, 4096, 0);
    const rotatedResult: { [ele: number]: number[][] } = {};
    for (const ele in isolines) {
      rotatedResult[ele] = isolines[ele].map((eles) => {
        const rotatedLine: number[] = [...eles];
        for (let i = 0; i < rotatedLine.length; i += 2) {
          const [x, y] = rotate(
            [
              (rotatedLine[i] * (size - 1)) / 4096,
              (rotatedLine[i + 1] * (size - 1)) / 4096,
            ],
            [center, center],
            rotation
          );
          rotatedLine[i] = x;
          rotatedLine[i + 1] = y;
        }
        return rotatedLine;
      });
    }
    expect(rotatedResult).toEqual(expected);
  });
}
