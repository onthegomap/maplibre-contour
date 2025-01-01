(async function () {
  function log(...args) {
    console.log(...args);
    if (typeof document !== "undefined") {
      results.innerText += `\n${args.join(" ")}`;
    }
  }

  if (typeof Benchmark === "undefined") {
    global.Benchmark = (await import("benchmark")).default;
    global.mlcontour = (await import("./dist/index.mjs")).default;
    global.PNG = (await import("pngjs")).default.PNG;
  }

  log("Running benchmarks...");

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
    10_000,
  );

  const demoManager = new LocalDemManager(
    "https://demotiles.maplibre.org/terrain-tiles/{z}/{x}/{y}.png",
    100,
    "mapbox",
    11,
    10_000,
  );
  let noMoreFetch = false;
  if (typeof document === "undefined") {
    demoManager.decodeImage = awsManager.decodeImage = (blob, encoding) =>
      blob.arrayBuffer().then((arrayBuffer) => {
        if (noMoreFetch) {
          throw new Error("fetches expected to be done");
        }
        const data = PNG.sync.read(toBuffer(arrayBuffer));
        return decodeParsedImage(data.width, data.height, encoding, data.data);
      });
  }

  const suite = new Benchmark.Suite();

  await demoManager.fetchContourTile(12, 1088 * 2, 717 * 2, {
    levels: [5],
    overzoom: 1,
  });

  async function addAsyncBench(name, fn) {
    await fn();
    suite.add(name, {
      defer: true,
      fn: (deferred) => {
        demoManager.contourCache.clear();
        awsManager.contourCache.clear();
        fn().then(
          () => deferred.resolve(),
          (err) => {
            throw err;
          },
        );
      },
    });
  }

  await addAsyncBench("switzerland 512px", () =>
    demoManager.fetchContourTile(12, 2176, 1435, {
      multiplier: 3.28084,
      levels: [50],
    }),
  );

  await addAsyncBench("switzerland 512px", () =>
    demoManager.fetchContourTile(12, 2176, 1435, {
      multiplier: 3.28084,
      levels: [100],
      overzoom: 1,
    }),
  );

  await addAsyncBench("switzerland 512px overzoomed hilly", () =>
    demoManager.fetchContourTile(15, 17413, 11488, {
      multiplier: 3.28084,
      levels: [10],
      overzoom: 1,
    }),
  );

  await addAsyncBench("switzerland 512px overzoomed flat", () =>
    demoManager.fetchContourTile(15, 17413, 11490, {
      multiplier: 3.28084,
      levels: [10],
      overzoom: 1,
    }),
  );

  await addAsyncBench("switzerland 512px very overzoomed", () =>
    demoManager.fetchContourTile(18, 17413 * (1 << 3), 11488 * (1 << 3), {
      multiplier: 3.28084,
      levels: [10],
      overzoom: 1,
    }),
  );

  await addAsyncBench("everest 256px overzoomed", () =>
    awsManager.fetchContourTile(15, 24295, 13728, {
      multiplier: 3.28084,
      levels: [10],
    }),
  );

  await addAsyncBench("everest 256px z12", () =>
    awsManager.fetchContourTile(
      15,
      Math.floor(24295 / (1 << 3)),
      Math.floor(13729 / (1 << 3)),
      {
        multiplier: 3.28084,
        levels: [100],
      },
    ),
  );

  await addAsyncBench("everest 256px overzoomed z15", () =>
    awsManager.fetchContourTile(15, 24295, 13729, {
      multiplier: 3.28084,
      levels: [10],
    }),
  );

  await addAsyncBench("everest 256px overzoomed z18", () =>
    awsManager.fetchContourTile(18, 24295 * (1 << 3), 13729 * (1 << 3), {
      multiplier: 3.28084,
      levels: [10],
    }),
  );

  noMoreFetch = true;

  let total = 0;

  suite
    .on("error", (event) => log(event.target.error))
    .on("cycle", (event) => {
      const time = 1_000 / event.target.hz;
      total += time;
      log(`${time.toPrecision(4)}ms ${event.target}`);
    })
    .on("complete", () => log(`${total.toPrecision(4)}ms total`))
    .run();
})();

/*
on m1 mac:
32.53ms switzerland 512px x 30.74 ops/sec ±0.50% (74 runs sampled)
18.60ms switzerland 512px x 53.75 ops/sec ±0.40% (85 runs sampled)
20.66ms switzerland 512px overzoomed hilly x 48.41 ops/sec ±0.42% (77 runs sampled)
2.780ms switzerland 512px overzoomed flat x 360 ops/sec ±0.29% (89 runs sampled)
5.376ms switzerland 512px very overzoomed x 186 ops/sec ±0.36% (87 runs sampled)
14.61ms everest 256px overzoomed x 68.45 ops/sec ±0.57% (82 runs sampled)
2.121ms everest 256px z12 x 472 ops/sec ±0.23% (92 runs sampled)
11.61ms everest 256px overzoomed z15 x 86.10 ops/sec ±0.53% (82 runs sampled)
3.492ms everest 256px overzoomed z18 x 286 ops/sec ±0.57% (89 runs sampled)
111.8ms total
*/
