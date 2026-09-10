import { defineConfig, devices } from "@playwright/test";

// Isolated PVR lane: no Creator modules and no reused mock state. Supply
// STRIVO_E2E_ASSETS_DIR to exercise the actual build.rs release output.
const PORT = 8299;
export default defineConfig({
  testDir: "./tests",
  testMatch: "performance-*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "pvr-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node mock-server.mjs",
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), STRIVO_E2E_EDITION: "pvr" },
  },
});
