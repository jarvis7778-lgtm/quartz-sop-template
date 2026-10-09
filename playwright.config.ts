import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  testMatch: process.env.TEST_SITE_DIR ? "collab.spec.ts" : "product-defects.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:8791",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  },
  webServer: {
    command: "node scripts/serve-test-site.mjs",
    url: "http://127.0.0.1:8791",
    reuseExistingServer: false,
  },
})
