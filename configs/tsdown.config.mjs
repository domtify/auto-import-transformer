import { defineConfig } from "tsdown"

export default defineConfig({
  sourcemap: true,
  clean: true,
  outDir: "dist",
  format: ["esm", "cjs"],
  minify: false,
  dts: true,
})
