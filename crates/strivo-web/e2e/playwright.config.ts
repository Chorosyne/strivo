import { defineConfig, devices } from "@playwright/test";

// W7 — E2E config. A Node mock server (mock-server.mjs) serves the real
// SPA assets and stubs the daemon API, so tests are deterministic and
// need no live daemon. Chromium only (matches the bundled browser).
const PORT = 8199;

export default defineConfig({
  testDir: "./tests",
  // Clears the mock server's module-level stores (abRenderStore,
  // submixStore) before each run, so a server left running from an
  // earlier `npm test` (see webServer.reuseExistingServer below) can't
  // leak state into this one. See global-setup.mjs.
  globalSetup: "./global-setup.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node mock-server.mjs",
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
