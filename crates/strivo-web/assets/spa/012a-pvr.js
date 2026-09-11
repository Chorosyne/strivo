// ── Login ────────────────────────────────────────────────────────────
function renderLogin(errorMsg, context = captureRouteContext()) {
  if (!isRouteCurrent(context)) return;
  root.removeAttribute("aria-busy");
  // "Remember me" pre-fills the API key from localStorage on a returning
  // visit. The session cookie itself already persists across reloads via
  // the server; this just spares typing after a browser restart or a
  // dropped cookie (audit M18). Stored under a distinct key per host so
  // sharing a browser across StriVo instances stays clean.
  const remembered = (() => {
    try { return localStorage.getItem("strivo:remembered-api-key") || ""; }
    catch (_) { return ""; }
  })();
  root.innerHTML = `
    <div class="login-screen">
      <form class="login-card" id="login-form">
        <h1>StriVo</h1>
        <p class="subtitle">Sign in to the web console</p>
        <label for="api-key">API Key</label>
        <input type="password" id="api-key" autocomplete="current-password"
               value="${htmlEscape(remembered)}" autofocus />
        <label class="login-remember">
          <input type="checkbox" id="api-remember" ${remembered ? "checked" : ""} />
          <span>Remember on this browser</span>
        </label>
        <button type="submit" class="primary">Sign in</button>
        ${errorMsg ? `<div class="error">${htmlEscape(errorMsg)}</div>` : ""}
        <div class="hint">
          API key lives in <code>~/.config/strivo/config.toml</code> under
          <code>[web]</code>. <br />
          Or run: <code>strivo config get web.api_key</code><br />
          <span class="login-recovery">Lost it? Stop the daemon, edit
          <code>~/.config/strivo/config.toml</code>, replace the
          <code>api_key</code> with anything random, and restart.</span>
        </div>
      </form>
    </div>
  `;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = document.getElementById("api-key").value.trim();
    if (!key) return;
    const remember = document.getElementById("api-remember").checked;
    try {
      await API.login(key);
      try {
        if (remember) localStorage.setItem("strivo:remembered-api-key", key);
        else localStorage.removeItem("strivo:remembered-api-key");
      } catch (_) {}
      // Login succeeded — this is the first authenticated call, so both
      // the SSE stream and the Patreon seed (which were held back at boot,
      // see fetchEdition() below) are cleared to run now.
      authed = true;
      events.start(); // (re)connect the now-authorized SSE stream
      seedPatreon();
      // fetchEdition() only ever ran once at script boot, unauthenticated —
      // /api/v1/settings 401'd and CREATOR_ENABLED stuck false for the rest
      // of the session, hiding every creator route (Archive included) until
      // a manual reload. Re-resolve it now that the session cookie is set.
      await fetchEdition();
      route("library");
      // The first-run tour belongs to the authenticated application
      // chrome. Starting it during the login paint blocks the sign-in
      // form with an overlay and leaves the spotlight without targets.
      setTimeout(startOnboardingTour, 600);
    } catch (err) {
      renderLogin("Invalid API key");
    }
  });
}

