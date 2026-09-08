
    case "interface":
      return [
        group("Layout", [
          row("Top-nav order",
            `<div class="stg-reorder" data-reorder-key="strivo-layout-topnav" data-default='${JSON.stringify(["library","recordings","schedule","pipelines","plugins","watch","chat","history","logs","system","settings"]).replace(/'/g, "&apos;")}'><div class="stg-reorder-list"></div><button class="sm stg-reorder-reset" type="button">Reset</button></div>`,
            "Drag entries up/down to reorder the top navigation bar. Order persists locally."),
          row("Rail platform order",
            `<div class="stg-reorder" data-reorder-key="strivo-layout-rail-platforms" data-default='${JSON.stringify(["Twitch","YouTube","Patreon"]).replace(/'/g, "&apos;")}'><div class="stg-reorder-list"></div><button class="sm stg-reorder-reset" type="button">Reset</button></div>`,
            "Group the live-channel rail by platform in your preferred order. Order persists locally."),
          row("Recordings group-by default",
            `<select class="stg-layout-select" data-layout-key="strivo-layout-rec-groupby">
              <option value="channel">By channel</option>
              <option value="platform">By platform</option>
              <option value="date">By date</option>
              <option value="state">By state</option>
              <option value="none">Flat list</option>
            </select>`,
            "Default group-by applied when you open Recordings."),
          row("Plugin hub category order",
            `<div class="stg-reorder" data-reorder-key="strivo-layout-plugin-cats" data-default='${JSON.stringify(["Editor","Publish","Viewer","Analytics","Archive","Transcription","Reports"]).replace(/'/g, "&apos;")}'><div class="stg-reorder-list"></div><button class="sm stg-reorder-reset" type="button">Reset</button></div>`,
            "Reorder how categories appear when the plugin hub or Settings → Plugins groups by category."),
        ].join("")),
        group("Onboarding", [
          row("Welcome tour",
            `<button class="sm" id="stg-replay-tour" type="button">Replay tour</button>`,
            "Walk through the topbar one stop at a time. Useful after a major UI change."),
        ].join("")),
        group("Accessibility", [
          row("Reduce motion", toggle("ui.reduce_motion", ui.reduce_motion),
            "Disables non-essential transitions across the UI. Mirrors the OS-level prefers-reduced-motion."),
          row("Verbose status", toggle("ui.verbose_status", ui.verbose_status),
            "Adds extra status text to long-running operations. Useful on screen readers."),
        ].join("")),
        group("Scheduling", [
          row("Scheduled recordings", `${(s.schedule || []).length}`,
            "Cron-style fixed-time recordings. Edit via TUI."),
        ].join("")),
      ].join("");

    case "advanced":
      return [
        group("Daemon", [
          row("IPC socket", code("~/.local/share/strivo/strivo.sock"),
            "Unix socket the web UI uses to talk to the daemon. Path is fixed."),
          row("Persist DB", code("~/.local/share/strivo/jobs.db"),
            "Recording history + retry queue. SQLite."),
          row("Log file", code("~/.local/share/strivo/strivo.<date>.log"),
            "Rolling daily log. See the Logs page for live tail."),
        ].join("")),
        group("Developer", [
          row("Dev unlock", code(envOrDefault("STRIVO_DEV_UNLOCK_ALL", "off")),
            "Set STRIVO_DEV_UNLOCK_ALL=1 in the daemon's environment to bypass all Strivo Pro gating. Use during plugin development; never in shipped builds."),
        ].join("")),
      ].join("");

    case "about":
    default:
      return [
        group("Build", [
          row("Application", "StriVo",
            "Live-stream PVR for Twitch and YouTube."),
          // Source link points at the home docs site to survive the
          // private-repo flip (audit U19). chorosyne.com → strivo will
          // 404 today but won't link to a 404'd github repo after the
          // visibility flip.
          row("Project", `<a href="https://chorosyne.com" class="stg-linkbtn" target="_blank" rel="noopener">chorosyne.com →</a>`),
        ].join("")),
