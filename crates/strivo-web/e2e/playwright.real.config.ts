import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// S04 — a second E2E lane that drives the REAL compiled `strivo` binary
// (daemon + web server, boot-strapped by real-server.sh in a sandboxed
// $HOME so it can't see or touch a real installation on this machine),
// instead of playwright.config.ts's Node mock backend. Kept as a
// separate project/config (own testDir, own port) so `npm test` (the
// mock lane) is unaffected and this lane can be invoked on its own via
// `npm run test:real`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8281;

// Prefer a release binary (what CI's "build (PVR — default edition)"
// step already produces) and fall back to a debug build for local runs
// that skip --release.
const repoRoot = path.resolve(__dirname, "../../..");
const defaultBin = [
  path.join(repoRoot, "target/release/strivo"),
  path.join(repoRoot, "target/debug/strivo"),
].find((p) => existsSync(p));

export default defineConfig({
  testDir: "./tests-real",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bash ./real-server.sh",
    // Not /api/v1/health: it's a readiness probe of its own (daemon IPC +
    // jobs DB + disk) and can legitimately 503 for reasons unrelated to
    // "is the HTTP server up", which is all this webServer check needs.
    // /app is the SPA shell — 200 the instant the listener is bound.
    url: `http://localhost:${PORT}/app`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      STRIVO_BIN: process.env.STRIVO_BIN || defaultBin || "",
    },
  },
});
