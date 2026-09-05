import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  target: "es2021",
  // Zero runtime dependencies - the SDK is fetch-only and ships nothing to bundle in.
  external: [],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
