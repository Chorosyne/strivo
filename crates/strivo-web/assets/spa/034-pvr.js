  // Filename template live preview — updates #stg-fn-preview as user types.
  const fnInput = pane.querySelector('[data-stg-path="recording.filename_template"]');
  const fnPreview = pane.querySelector("#stg-fn-preview");
  if (fnInput && fnPreview) {
    const updatePreview = () => {
      const tpl = fnInput.value || "{channel}_{date}_{title}.mkv";
      const d = new Date();
      const preview = tpl
        .replace("{channel}", "mychannel")
        .replace("{platform}", "twitch")
        .replace("{date}", d.toISOString().slice(0, 10))
        .replace("{time}", d.toTimeString().replace(/\D/g, "").slice(0, 6))
        .replace("{title}", "stream_title")
        .replace("{id}", "1234567890");
      fnPreview.textContent = preview;
    };
    fnInput.addEventListener("input", updatePreview);
  }

  // Capture profile add / delete (Task 1).
  pane.querySelector("#stg-profile-add")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInp = pane.querySelector("#stg-profile-name-inp");
    const tierSel = pane.querySelector("#stg-profile-tier-sel");
    if (!nameInp) return;
    const name = nameInp.value.trim();
    if (!name) return;
    const quality_tier = tierSel ? (tierSel.value || null) : null;
    try {
      await API.captureProfileCreate({ name, quality_tier });
      Toast.success(`Profile '${name}' created`);
      renderSettings();
    } catch (err) {
      Toast.error(`Couldn't create profile: ${err.message}`);
    }
  });
  pane.querySelectorAll(".stg-profile-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.profileName;
      if (!(await confirmDialog(`Delete capture profile '${name}'?`, { danger: true, ok: "Delete" }))) return;
      try {
        await API.captureProfileDelete(name);
        Toast.success(`Profile '${name}' deleted`);
        renderSettings();
      } catch (err) {
        Toast.error(`Couldn't delete: ${err.message}`);
      }
    });
  });

  // Channel export / import (Task 4).
  pane.querySelector(".stg-channels-export")?.addEventListener("click", async () => {
    try {
      const data = await API.channelsExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `strivo-channels-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      Toast.error(`Export failed: ${err.message}`);
    }
  });
  const importFileInput = pane.querySelector("#stg-channels-import-file");
  pane.querySelector(".stg-channels-import-btn")?.addEventListener("click", () => {
    importFileInput?.click();
  });
  importFileInput?.addEventListener("change", async () => {
    const file = importFileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await API.channelsImport(data);
      Toast.success(`Imported: ${result.added ?? 0} added, ${result.updated ?? 0} updated`);
      renderSettings();
    } catch (err) {
      Toast.error(`Import failed: ${err.message}`);
    } finally {
      importFileInput.value = "";
    }
  });

  pane.querySelectorAll("[data-stg-path]").forEach((el) => {
    el.addEventListener("change", async () => {
      const path = el.getAttribute("data-stg-path");
      let value;
      if (el.type === "checkbox") value = el.checked;
      else if (el.type === "number") value = el.value === "" && el.dataset.stgNullEmpty === "true"
        ? null
        : Number(el.value);
      else if (el.dataset.stgNullEmpty === "true" && !el.value.trim()) value = null;
      else value = (el.value || "").trim();
      const previous = el.type === "checkbox"
        ? !el.checked
        : el.getAttribute("data-prev") || "";
      // Inline field validation (item 25) — same idiom as the poll-interval
      // input. The webhook URL may be blank (clears the setting) but a
      // non-blank value must be a valid http(s) URL before we round-trip
      // to the server, which enforces the same rule.
      if (path === "notifications.webhook.url" && value) {
        let validUrl = false;
        try {
          const u = new URL(value);
          validUrl = u.protocol === "http:" || u.protocol === "https:";
        } catch { validUrl = false; }
        if (!validUrl) {
          setSettingsFieldError(el, "Webhook URL must be a valid http:// or https:// URL");
          Toast.error("Webhook URL must be a valid http:// or https:// URL");
          return;
        }
      }
      if (path === "recording_dir" && (!value || /[\u0000-\u001F\u007F]/.test(value))) {
        setSettingsFieldError(el, "Recording directory cannot be empty or contain control characters.");
        Toast.error("Recording directory cannot be empty or contain control characters");
        return;
      }
      if (path === "recording.format.bitrate_kbps" && value !== null
          && (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000)) {
        setSettingsFieldError(el, "Bitrate preference must be a whole number from 1 through 1000000 kbps.");
        Toast.error("Bitrate preference must be a whole number from 1 through 1000000 kbps");
        return;
      }
      clearSettingsFieldError(el);
      const resetBtn = pane.querySelector(`[data-stg-reset="${path}"]`);
      el.disabled = true;
      if (resetBtn) resetBtn.disabled = true;
      try {
        await API.updateSetting(path, value);
        if (el.type !== "checkbox") el.setAttribute("data-prev", value == null ? "" : String(value));
        if (path === "ui.reduce_motion") {
          REDUCE_MOTION_SETTING = !!value;
          applyReducedMotion();
        }
        const restartRequired = el.dataset.stgRestartRequired === "true";
        Toast.success(restartRequired ? "Saved — restart the daemon to apply" : `Saved · ${path}`);
      } catch (err) {
        if (el.type === "checkbox") el.checked = previous;
        else el.value = previous;
        setSettingsFieldError(el, String(err.message || "The daemon rejected this value.").replace(/^HTTP \d+: /, ""));
        Toast.error(`Couldn't save ${path}: ${err.message}`);
      } finally {
        el.disabled = false;
        if (resetBtn) resetBtn.disabled = false;
      }
    });
  });

  pane.querySelectorAll("[data-stg-reset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = btn.dataset.stgReset;
      const el = pane.querySelector(`[data-stg-path="${path}"]`);
      if (!el) return;
      btn.disabled = true;
      el.disabled = true;
      clearSettingsFieldError(el);
      try {
        await API.updateSetting(path, null);
        el.value = "";
        el.setAttribute("data-prev", "");
        Toast.success("Reset to the daemon default — restart the daemon to apply");
      } catch (err) {
        setSettingsFieldError(el, String(err.message || "The daemon rejected this reset.").replace(/^HTTP \d+: /, ""));
        Toast.error(`Couldn't reset ${path}: ${err.message}`);
      } finally {
        btn.disabled = false;
        el.disabled = false;
      }
    });
  });
}

function clearSettingsFieldError(el) {
  el.removeAttribute("aria-invalid");
  el.closest(".stg-field")?.querySelector(".stg-field-error")?.remove();
}

function setSettingsFieldError(el, message) {
  clearSettingsFieldError(el);
  el.setAttribute("aria-invalid", "true");
  const field = el.closest(".stg-field");
  if (!field) return;
  const error = document.createElement("div");
  error.className = "stg-field-error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  field.append(error);
}

// Build the right-pane HTML for a section. Each section is a sequence of
// sub-headed groups, then a flat list of rows: label · value · hint.
function renderSettingsPane(slug, s) {
  const rec = s.recording || {};
  const ui = s.ui || {};
  const badge = (ok, okText, noText) =>
    `<span class="cfg-badge ${ok ? "ok" : "warn"}">${ok ? okText : noText}</span>`;
  const code = (v) => `<code>${htmlEscape(v || "—")}</code>`;
  // Editable controls: rendered as live inputs bound to a config path.
  // wireSettingsControls() picks them up via [data-stg-path].
  const toggle = (path, checked) => `
    <label class="stg-toggle">
      <input type="checkbox" data-stg-path="${htmlEscape(path)}" ${checked ? "checked" : ""} />
      <span class="stg-toggle-track"><span class="stg-toggle-knob"></span></span>
    </label>`;
  const numInput = (path, value, min, max) => `
    <input class="stg-num" type="number" data-stg-path="${htmlEscape(path)}"
           data-prev="${value ?? ""}" value="${value ?? ""}"
           min="${min}" max="${max}" step="1" />`;
  const textInput = (path, value, placeholder = "") => `
    <input class="stg-text" type="text" data-stg-path="${htmlEscape(path)}"
           data-prev="${htmlEscape(value ?? "")}" value="${htmlEscape(value ?? "")}"
           placeholder="${htmlEscape(placeholder)}" spellcheck="false" />`;
  const restartTextInput = (path, value, placeholder = "", optional = false) => `
    <div class="stg-field">
      <input class="stg-text" type="text" data-stg-path="${htmlEscape(path)}"
             data-stg-restart-required="true" ${optional ? 'data-stg-null-empty="true"' : ""}
             data-prev="${htmlEscape(value ?? "")}" value="${htmlEscape(value ?? "")}"
             placeholder="${htmlEscape(placeholder)}" spellcheck="false" />
      ${optional ? `<button class="sm stg-reset" type="button" data-stg-reset="${htmlEscape(path)}">Reset to default</button>` : ""}
    </div>`;
  const restartNumInput = (path, value, min, max) => `
    <div class="stg-field">
      <input class="stg-num" type="number" data-stg-path="${htmlEscape(path)}"
             data-stg-restart-required="true" data-stg-null-empty="true"
             data-prev="${value ?? ""}" value="${value ?? ""}" min="${min}" max="${max}" step="1" />
      <button class="sm stg-reset" type="button" data-stg-reset="${htmlEscape(path)}">Reset to default</button>
    </div>`;
  const selectInput = (path, value, opts) => {
    const options = opts
      .map((o) => `<option value="${htmlEscape(o)}"${o === value ? " selected" : ""}>${htmlEscape(o)}</option>`)
      .join("");
    return `<select class="stg-select" data-stg-path="${htmlEscape(path)}" data-prev="${htmlEscape(value ?? "")}">${options}</select>`;
  };
  // Filename template token browser — collapsible <details> with live preview.
  const TEMPLATE_TOKENS = [
    ["{channel}",  "Channel name"],
    ["{platform}", "twitch / youtube / patreon"],
    ["{date}",     "YYYY-MM-DD (local)"],
    ["{time}",     "HHmmss (local)"],
    ["{title}",    "Stream title (path-safe)"],
    ["{id}",       "Broadcast / video ID"],
  ];
  const tokenBrowserHtml = (currentTpl) => {
    const rows = TEMPLATE_TOKENS.map(([tok, desc]) =>
      `<tr><td><code class="stg-tok">${htmlEscape(tok)}</code></td>` +
      `<td class="muted stg-tok-desc">${htmlEscape(desc)}</td></tr>`
    ).join("");
    const example = (currentTpl || "{channel}_{date}_{title}.mkv")
      .replace("{channel}", "mychannel")
      .replace("{platform}", "twitch")
      .replace("{date}", new Date().toISOString().slice(0, 10))
      .replace("{time}", new Date().toTimeString().replace(/\D/g, "").slice(0, 6))
      .replace("{title}", "stream_title")
      .replace("{id}", "1234567890");
    return `<details class="stg-token-browser">
      <summary class="stg-token-summary">Tokens ▸</summary>
      <table class="stg-token-table">${rows}</table>
      <div class="stg-token-preview">Preview: <code id="stg-fn-preview">${htmlEscape(example)}</code></div>
    </details>`;
  };
  // Row helper. `hint` is rendered as a tooltip on a ⓘ glyph so the
  // layout stays clean; long-form text only appears on hover.
  const row = (label, value, hint) => `
    <div class="stg-row">
      <div class="stg-row-label">
        ${htmlEscape(label)}
        ${hint ? `<span class="stg-hint" title="${htmlEscape(hint)}" aria-label="${htmlEscape(hint)}">ⓘ</span>` : ""}
      </div>
      <div class="stg-row-value">${value}</div>
    </div>`;
  // Sweet-folders glyphs picked by category semantic. Falls back to
  // generic folder.svg for unknown categories.
  const categoryIcon = (title) => {
    const t = (title || "").toLowerCase();
    if (t.includes("editor") || t.includes("publish")) return "folder-templates.svg";
    if (t.includes("audio") || t.includes("music")) return "folder-music.svg";
    if (t.includes("video") || t.includes("recording") || t.includes("watch")) return "folder-videos.svg";
    if (t.includes("archive") || t.includes("download")) return "folder-download.svg";
    if (t.includes("brand") || t.includes("thumbnail") || t.includes("picture")) return "folder-pictures.svg";
    if (t.includes("transcript") || t.includes("caption") || t.includes("report") || t.includes("doc")) return "folder-documents.svg";
    if (t.includes("share") || t.includes("multi") || t.includes("stream")) return "folder-publicshare.svg";
    if (t.includes("home") || t.includes("glance")) return "folder-home.svg";
    if (t.includes("chat") || t.includes("network") || t.includes("remote")) return "folder-remote-symbolic.svg";
    return "folder.svg";
  };
  const group = (title, rows) => `
    <section class="stg-group">
      <h3 class="stg-group-title"><img class="stg-group-icon" src="/assets/icons/sweet-folders/${categoryIcon(title)}" alt="" aria-hidden="true"/> ${htmlEscape(title)}</h3>
      <div class="stg-rows">${rows}</div>
    </section>`;

  switch (slug) {
    case "multiview": {
      const q = multiviewQuality();
      const opts = (current) =>
        MULTIVIEW_QUALITY_CHOICES.map(
          ([v, label]) =>
            `<option value="${v}"${v === current ? " selected" : ""}>${htmlEscape(label)}</option>`,
        ).join("");
      return [
        group("Stream quality", [
          row(
            "Twitch",
            `<select class="stg-select" data-mv-quality="twitch">${opts(q.twitch)}</select>`,
            "Applied per tile without reloading the stream. The options a stream " +
              "actually offers are discovered from the player at runtime, so this " +
              "picks an end of that list rather than a fixed resolution.",
          ),
          row(
            "YouTube",
            `<select class="stg-select" disabled><option>Controlled by YouTube</option></select>`,
            "YouTube decommissioned quality control in its player API — setPlaybackQuality " +
              "is now a no-op, so nothing here could take effect. The only remaining " +
              "influence is how large the tile is drawn.",
          ),
        ].join("")),
        group("About these settings", [
          row(
            "Why no single scale",
            "&mdash;",
            "A resolution label is not a quality measure: the same \"1080p\" is a " +
              "different bitrate between platforms and between streamers on one " +
              "platform. Each provider is therefore offered on its own terms rather " +
              "than flattened into a shared ladder.",
          ),
          row(
            "Where this is stored",
            "&mdash;",
            "Per browser, alongside your layout and volume preferences — a laptop on " +
              "hotel wifi and a desktop on gigabit want different answers.",
          ),
        ].join("")),
      ].join("");
    }
    case "general":
      return [
        group("At a glance", [
          row(
            "Tracked channels",
            `<a href="#/library" class="stg-linkbtn">${channelCache.length} channel${channelCache.length === 1 ? "" : "s"} →</a>`,
            "Click to manage channels in Library.",
          ),
          row(
            "Active recordings",
            `<a href="#/recordings" class="stg-linkbtn">${recCache.filter((r) => isInProgress(r.state)).length} in progress →</a>`,
            "Live captures + VOD pulls in flight.",
          ),
          row(
            "Patreon creators",
            `${(patreonState.creators || []).length}`,
            "Followed Patreon creators (read-only here; manage via the rail).",
          ),
        ].join("")),
        group("Polling", [
          row(
            "Channel poll interval",
            `<a class="stg-linkbtn" href="#/system">${s.poll_interval_secs ?? "?"} s →</a>`,
            "How often StriVo checks each tracked channel for a live-state change. Twitch EventSub + YouTube WebSub push live signals in real time; this poll is the fallback.",
          ),
          row(
            "Auto-record channels",
            `${(s.auto_record_channels || []).length}`,
            "Channels whose new live broadcasts are recorded automatically. Managed from the Library page.",
          ),
        ].join("")),
        group("Storage", [
          row(
            "Recording directory",
            `<a class="stg-linkbtn" href="#/settings/recording">${code(s.recording_dir)} →</a>`,
            "Root directory for all recordings. Edit it in Recording settings.",
          ),
        ].join("")),
        group("Channels", [
          row(
            "Export / Import",
            `<button class="sm stg-channels-export" type="button">Export channels JSON</button>
             <button class="sm stg-channels-import-btn" type="button">Import channels JSON</button>
             <input id="stg-channels-import-file" type="file" accept=".json" style="display:none" />`,
            "Export all tracked channels + capture profiles as a JSON file. Import merges new channels and updates existing ones by platform + channel ID.",
          ),
        ].join("")),
      ].join("");

    case "notifications": {
      const n = s.notifications || {};
      const masterOn = n.desktop_enabled !== false;
      const noteAttr = masterOn ? "" : ' style="opacity:0.55;pointer-events:none"';
      const wh = n.webhook || {};
      const whOn = wh.enabled === true;
      const whNoteAttr = whOn ? "" : ' style="opacity:0.55;pointer-events:none"';
      return [
        group("Desktop notifications", [
          row(
            "Master switch",
            toggle("notifications.desktop_enabled", n.desktop_enabled !== false),
            "When off, the daemon skips every notify-rust banner regardless of the toggles below. Useful for headless / kiosk setups.",
          ),
        ].join("")),
        `<div class="stg-subgroup-conditional" data-conditional-master="notifications.desktop_enabled"${noteAttr}>${[
          group("Events", [
            row(
              "Channel goes live",
              toggle("notifications.on_go_live", n.on_go_live !== false),
              "Banner when a tracked channel transitions offline → live.",
            ),
            row(
              "Recording finished",
              toggle("notifications.on_recording_finished", n.on_recording_finished !== false),
              "Banner when a live capture or VOD pull completes successfully.",
            ),
            row(
              "Recording failed",
              toggle("notifications.on_recording_failed", n.on_recording_failed !== false),
              "Recommended — notifies you the moment a capture fails so it doesn't go silently missed.",
            ),
            row(
              "VOD backfill ready",
              toggle("notifications.on_vod_ready", n.on_vod_ready === true),
              "Notify when a VOD becomes available after a live stream finishes. Off by default.",
            ),
          ].join("")),
        ].join("")}</div>`,
        group("Webhook", [
          row(
            "Enable webhook",
            toggle("notifications.webhook.enabled", whOn),
            "Fires on recording events — POSTs a JSON payload (streamerREC-compatible: event, channel, platform, recording ID, status, error) to the URL below for channel-live, recording-started/finished/failed, and generic notifications. Independent of the desktop notifications above.",
          ),
        ].join("")),
        `<div class="stg-subgroup-conditional" data-conditional-master="notifications.webhook.enabled"${whNoteAttr}>${[
          group("Webhook target", [
            row(
              "Webhook URL",
              textInput("notifications.webhook.url", wh.url || "", "https://example.com/hooks/strivo"),
              "Full http(s) URL to POST events to. Required for the webhook to fire; validated before saving.",
            ),
          ].join("")),
        ].join("")}</div>`,
      ].join("");
    }

    case "recording": {
      const format = rec.format || {};
      // Capture-profile rows (Task 1).
      const profiles = s.capture_profiles || [];
      const QUALITY_TIER_LABELS = {
        best: "Best", "1080p": "1080p", "720p": "720p", "480p": "480p", audio_only: "Audio only",
      };
      const profileRows = profiles.length
        ? profiles.map((p) => `
          <div class="stg-row stg-profile-row" data-profile-name="${htmlEscape(p.name)}">
            <div class="stg-row-label">${htmlEscape(p.name)}</div>
            <div class="stg-row-value">
              ${p.quality_tier
                ? `<span class="cfg-badge ok">${htmlEscape(QUALITY_TIER_LABELS[p.quality_tier] || p.quality_tier)}</span>`
                : `<span class="muted">no tier</span>`}
              <button class="sm stg-profile-del" data-profile-name="${htmlEscape(p.name)}"
                      type="button" title="Delete profile '${htmlEscape(p.name)}'">✕</button>
            </div>
          </div>`).join("")
        : `<div class="empty sm">No capture profiles defined yet.</div>`;
      const tierOpts = ["", "best", "1080p", "720p", "480p", "audio_only"]
        .map((v) => `<option value="${htmlEscape(v)}">${htmlEscape(QUALITY_TIER_LABELS[v] || "(none)")}</option>`)
        .join("");
      const addProfileForm = `
        <form id="stg-profile-add" class="stg-profile-add">
          <input id="stg-profile-name-inp" type="text" placeholder="Profile name"
                 maxlength="64" required aria-label="New profile name" />
          <select id="stg-profile-tier-sel" aria-label="Quality tier">${tierOpts}</select>
          <button class="btn-primary" type="submit">Add</button>
        </form>`;
      return [
        group("Storage", [
          row("Recording directory",
            restartTextInput("recording_dir", s.recording_dir, "/absolute/path"),
            "New recordings use this existing, writable absolute directory after the daemon restarts. Changing it never moves existing recordings; active jobs keep their prior configuration."),
          `<p class="stg-effect-note" role="note">Changes in this section are saved to configuration. <a href="https://github.com/revoydotdev/strivo/blob/main/docs/DAEMON.md#lifecycle" target="_blank" rel="noopener">Restart the daemon</a> before they take effect. Existing recordings are not moved, and recordings already in progress keep their previous settings.</p>`,
        ].join("")),
        group("Output", [
          row("Filename template",
            textInput("recording.filename_template", rec.filename_template, "{channel}_{date}_{title}.mkv") +
            tokenBrowserHtml(rec.filename_template)),
          row("Container",
            selectInput("recording.container",
              (format.container || "matroska").toLowerCase(),
              ["matroska", "mp4", "webm"]),
            "Output muxer. Matroska is the browser-friendliest default; switch only if you have a downstream pipeline that needs MP4 or WebM."),
          row("Transcode", toggle("recording.transcode", rec.transcode),
            "Re-encode on the fly via h264_nvenc. Off = stream-copy (zero CPU, original bitrate)."),
        ].join("")),
        group("Advanced format", [
          row("yt-dlp format selector",
            restartTextInput("recording.format.format", format.format, "bestvideo+bestaudio", true),
            "Passed to yt-dlp for VOD downloads. Leave blank or use Reset to restore the daemon default."),
          row("Bitrate preference (kbps)",
            restartNumInput("recording.format.bitrate_kbps", format.bitrate_kbps, 1, 1000000),
            "Optional positive bitrate preference in kbps. It guides yt-dlp VOD selection and applies to h264_nvenc/libx264 encoding; it does not cap stream-copy output. Leave blank or reset to use the daemon default."),
          row("Video codec override",
            restartTextInput("recording.format.video_codec", format.video_codec, "for example: libx264", true),
            "Optional codec token forwarded to the recorder. Leave blank or reset to use the daemon default."),
          row("Audio codec override",
            restartTextInput("recording.format.audio_codec", format.audio_codec, "for example: aac", true),
            "Optional codec token forwarded to the recorder. Leave blank or reset to use the daemon default."),
        ].join("")),
        group("Twitch", [
          row("Record from start", toggle("recording.twitch_live_from_start", rec.twitch_live_from_start),
            "Pull from the first available HLS segment (~5 min back) instead of the live edge. Sub-only channels reject this and StriVo silently falls back to live edge."),
        ].join("")),
        group("YouTube / VOD", [
          row("Auto VOD backfill", toggle("recording.auto_vod_backfill", rec.auto_vod_backfill),
            "When a stream ends, automatically queue the resulting VOD for download via yt-dlp."),
          row("Auto-trim ads", toggle("recording.auto_trim_ads", rec.auto_trim_ads),
            "Run sponsorblock-style ad-segment trimming on completed Twitch VODs."),
        ].join("")),
        group("Capture Profiles", profileRows + addProfileForm),
      ].join("");
    }

    case "platforms": {
      const platformRow = (key, statusOk) => `
        <div class="stg-row">
          <div class="stg-row-label">Status</div>
          <div class="stg-row-value">
            ${badge(statusOk, "configured", "not configured")}
            <button class="stg-linkbtn stg-cfg-btn" data-platform="${htmlEscape(key)}" type="button">
              ${statusOk ? "Reconfigure" : "Configure"} →
            </button>
          </div>
        </div>`;
      return [
        group("Twitch",
          platformRow("twitch", s.twitch_configured) +
          `<div class="stg-row"><div class="stg-row-label">Setup
            <span class="stg-hint" title="Create at dev.twitch.tv/console/apps — type=Other, OAuth Redirect URL http://localhost:8181/oauth/twitch">ⓘ</span>
          </div><div class="stg-row-value muted">Twitch Developer Console → Register Your Application → Client ID + Secret.</div></div>`),
        group("YouTube",
          platformRow("youtube", s.youtube_configured) +
          `<div class="stg-row"><div class="stg-row-label">Setup
            <span class="stg-hint" title="Google Cloud Console → APIs &amp; Services → Credentials → OAuth client ID. Use Desktop type.">ⓘ</span>
          </div><div class="stg-row-value muted">OAuth client (Desktop type). Optional Netscape cookies.txt for member-only / age-gated VODs.</div></div>`),
        group("Patreon",
          platformRow("patreon", s.patreon_configured) +
          `<div class="stg-row"><div class="stg-row-label">Setup
            <span class="stg-hint" title="patreon.com/portal/registration/register-clients">ⓘ</span>
          </div><div class="stg-row-value muted">Optional. Enables Patreon-locked VOD pulls from creators you support.</div></div>`),
      ].join("");
    }
