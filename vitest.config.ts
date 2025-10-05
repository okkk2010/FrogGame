import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["client/src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: []
  }
});
