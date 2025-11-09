import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    cache: false,
    clearMocks: true,
    environment: "node",
    watch: true,
    include: ["__tests__/**/*.test.ts"],
  },
})
