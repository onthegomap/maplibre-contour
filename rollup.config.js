import fs from "fs";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

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

export default [
  {
    input: ["src/index.ts", "src/worker.ts"],
    output: {
      dir: "dist/staging",
      format: "amd",
      indent: false,
      chunkFileNames: "shared.js",
    },
    onwarn: (message) => {
      console.error(message);
      throw message;
    },
    treeshake: true,
    plugins: [nodeResolve, typescript(), commonjs()],
  },
  create("dist/index.cjs", "cjs"),
  create("dist/index.mjs", "esm"),
  create("dist/index.js", "umd"),
  create("dist/index.min.js", "umd", [terser()]),
];
