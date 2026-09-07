// Runs once before every `npm test` invocation, after Playwright's
// webServer has passed its health check (playwright.config.ts webServer.url).
//
// The mock server (mock-server.mjs) is deliberately reused across runs
// outside CI (webServer.reuseExistingServer), for developer iteration
// speed. It also holds module-level mutable state (abRenderStore,
// submixStore) that individual tests write to. Without an explicit reset,
// a server left running from an earlier invocation carries that state
// into the next one, so a "green" run can depend on leftover state from a
// prior run instead of proving the suite passes from a clean slate.
//
// Hitting /__test__/reset here — before any test runs, regardless of
// whether the server is fresh or reused — makes every invocation start
// from the same known-empty state.
const PORT = process.env.PORT || 8199;
const RESET_URL = `http://localhost:${PORT}/__test__/reset`;

export default async function globalSetup() {
  const deadline = Date.now() + 30_000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(RESET_URL, { method: "POST" });
      if (!resp.ok) {
        throw new Error(`reset endpoint returned ${resp.status}`);
      }
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`mock server never became ready for reset at ${RESET_URL}: ${lastErr}`);
}
