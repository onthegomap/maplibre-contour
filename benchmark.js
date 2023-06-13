import Benchmark from "benchmark";
import mlcontour from "./dist/index.mjs";
import { PNG } from "pngjs";

/** @type {import('./src/index.d.ts')['default']} */
const { decodeParsedImage, LocalDemManager } = mlcontour;

function toBuffer(arrayBuffer) {
  const buffer = Buffer.alloc(arrayBuffer.byteLength);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buffer.length; ++i) {
    buffer[i] = view[i];
  }
  return buffer;
}

const awsManager = new LocalDemManager(
  "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
  100,
  "terrarium",
  12,
  10_000
);

const demoManager = new LocalDemManager(
  "https://demotiles.maplibre.org/terrain-tiles/{z}/{x}/{y}.png",
  100,
  "mapbox",
  11,
  10_000
);
let noMoreFetch = false;
demoManager.decodeImage = awsManager.decodeImage = (blob, encoding) => ({
  cancel() {},
  value: blob.arrayBuffer().then((arrayBuffer) => {
    if (noMoreFetch) {
      throw new Error("fetches expected to be done");
    }
    const data = PNG.sync.read(toBuffer(arrayBuffer));
    return decodeParsedImage(data.width, data.height, encoding, data.data);
  }),
});

const suite = new Benchmark.Suite();

await demoManager.fetchContourTile(12, 1088 * 2, 717 * 2, {
  levels: [5],
  overzoom: 1,
}).value;

async function addAsyncBench(name, fn) {
  await fn().value;
  suite.add(name, {
    defer: true,
    fn: (deferred) => {
      demoManager.contourCache.clear();
      awsManager.contourCache.clear();
      fn().value.then(
        () => deferred.resolve(),
        (err) => {
          throw err;
        }
      );
    },
  });
}

await addAsyncBench("switzerland 512px", () =>
  demoManager.fetchContourTile(12, 2176, 1435, {
    multiplier: 3.28084,
    levels: [50],
  })
);

await addAsyncBench("switzerland 512px", () =>
  demoManager.fetchContourTile(12, 2176, 1435, {
    multiplier: 3.28084,
    levels: [100],
    overzoom: 1,
  })
);

await addAsyncBench("switzerland 512px overzoomed hilly", () =>
  demoManager.fetchContourTile(15, 17413, 11488, {
    multiplier: 3.28084,
    levels: [10],
    overzoom: 1,
  })
);

await addAsyncBench("switzerland 512px overzoomed flat", () =>
  demoManager.fetchContourTile(15, 17413, 11490, {
    multiplier: 3.28084,
    levels: [10],
    overzoom: 1,
  })
);

await addAsyncBench("switzerland 512px very overzoomed", () =>
  demoManager.fetchContourTile(18, 17413 * (1 << 3), 11488 * (1 << 3), {
    multiplier: 3.28084,
    levels: [10],
    overzoom: 1,
  })
);

await addAsyncBench("everest 256px overzoomed", () =>
  awsManager.fetchContourTile(15, 24295, 13728, {
    multiplier: 3.28084,
    levels: [10],
  })
);

await addAsyncBench("everest 256px z12", () =>
  awsManager.fetchContourTile(
    15,
    Math.floor(24295 / (1 << 3)),
    Math.floor(13729 / (1 << 3)),
    {
      multiplier: 3.28084,
      levels: [100],
    }
  )
);

await addAsyncBench("everest 256px overzoomed z15", () =>
  awsManager.fetchContourTile(15, 24295, 13729, {
    multiplier: 3.28084,
    levels: [10],
  })
);

await addAsyncBench("everest 256px overzoomed z18", () =>
  awsManager.fetchContourTile(18, 24295 * (1 << 3), 13729 * (1 << 3), {
    multiplier: 3.28084,
    levels: [10],
  })
);

noMoreFetch = true;

let total = 0;

suite
  .on("error", (event) => console.log(event.target.error))
  .on("cycle", (event) => {
    const time = 1_000 / event.target.hz;
    total += time;
    console.log(`${time.toPrecision(4)}ms ${event.target}`);
  })
  .on("complete", () => console.log(`${total.toPrecision(4)}ms total`))
  .run();

/*
on m1 mac:
53.62ms switzerland 512px x 18.65 ops/sec ±0.51% (88 runs sampled)
29.16ms switzerland 512px x 34.29 ops/sec ±0.51% (82 runs sampled)
32.83ms switzerland 512px overzoomed hilly x 30.46 ops/sec ±0.59% (74 runs sampled)
3.307ms switzerland 512px overzoomed flat x 302 ops/sec ±0.34% (89 runs sampled)
6.839ms switzerland 512px very overzoomed x 146 ops/sec ±0.42% (86 runs sampled)
31.39ms everest 256px overzoomed x 31.85 ops/sec ±0.49% (77 runs sampled)
2.153ms everest 256px z12 x 464 ops/sec ±0.35% (91 runs sampled)
25.39ms everest 256px overzoomed z15 x 39.38 ops/sec ±0.62% (65 runs sampled)
5.312ms everest 256px overzoomed z18 x 188 ops/sec ±0.37% (89 runs sampled)
190.0ms total
*/
