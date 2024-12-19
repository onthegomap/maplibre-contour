import fs from "fs";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from '@rollup/plugin-replace';
import alias from '@rollup/plugin-alias';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const nodeResolve = resolve({
  browser: true,
  preferBuiltins: false,
});

const create = (file, format, plugins = []) => ({
  input: "build/mlcontour.js",
  output: {
   name: "mlcontour",
   file,
   format,
   intro: fs.readFileSync("build/bundle_prelude.js", "utf8"),
  },
  treeshake: false,
  plugins,
});

/** @type {import('rollup').RollupOptions[]} */
export default (args) => {
  const isNode = process.env.NODE_ENV === 'node';
  
  const aliasPlugin = alias({
    entries: [
      {
        find: './pmtiles-adapter-node',
        replacement: isNode
        ? path.resolve(__dirname, './src/pmtiles-adapter-node')
        : path.resolve(__dirname, './src/pmtiles-adapter-web')
      },
    ]
  });

  return [
    {
      input: ["src/index.ts", "src/worker.ts"],
      output: {
        dir: "dist/staging",
        format: "amd",
        indent: false,
        chunkFileNames: "shared.js",
        minifyInternalExports: true,
      },
      onwarn: (message) => {
        console.error(message);
        throw message;
      },
      treeshake: true,
      plugins: [aliasPlugin, nodeResolve, typescript(), commonjs()],
    },
    create("dist/maplibre-contour-pmtiles.cjs", "cjs"),
    create("dist/maplibre-contour-pmtiles.mjs", "esm"),
    create("dist/maplibre-contour-pmtiles.js", "umd"),
    create("dist/maplibre-contour-pmtiles.min.js", "umd", [terser()]),
  ];
};