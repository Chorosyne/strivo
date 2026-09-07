    case "plugins": {
      // Plugin manager. Lists every shipped plugin with a per-plugin
      // enable toggle bound to plugins.<name>.enabled, plus an 'Open'
      // CTA that deep-links into the plugin's own page (when one
      // exists) or the marketplace catalog card otherwise. Pre-existing
      // Archiver per-knob settings stay in their own group below.
      const arc = s.archiver || {};
      const toggles = s.plugin_toggles || {};
      // PLUGIN_REGISTRY is the same set the Plugins hub + marketplace
      // share — lives at the bottom of spa.js. category drives the
      // sub-group heading.
      const groups = {};
      for (const meta of PLUGIN_REGISTRY) {
        (groups[meta.category] ||= []).push(meta);
      }
      const enabledFor = (name) => {
        const t = toggles[name];
        return t == null ? true : t.enabled !== false;
      };
      const pluginRow = (meta) => {
        const open = meta.route
          ? `<a href="${htmlEscape(meta.route)}" class="stg-linkbtn">Open →</a>`
          : `<a href="#/plugins" class="stg-linkbtn">View in hub →</a>`;
        return `
          <div class="stg-row stg-plugin-row" data-plugin-name="${htmlEscape(meta.name)}">
            <div class="stg-row-label">
              <span class="stg-plugin-name">${htmlEscape(meta.label)}</span>
              <span class="stg-hint" title="${htmlEscape(meta.description)}">ⓘ</span>
              <span class="stg-plugin-tags">
                ${meta.proGated ? '<span class="cfg-badge ok" title="Strivo Pro plugin">Pro</span>' : ""}
                ${meta.installed === false ? '<span class="cfg-badge warn">not installed</span>' : ""}
              </span>
            </div>
            <div class="stg-row-value stg-plugin-actions">
              ${toggle(`plugins.${meta.name}.enabled`, enabledFor(meta.name))}
              <button class="sm stg-plugin-size" type="button" data-plugin="${htmlEscape(meta.name)}" title="View disk usage of this plugin's stored data">📦 Size</button>
              <button class="sm danger stg-plugin-clear" type="button" data-plugin="${htmlEscape(meta.name)}" title="Delete this plugin's stored data on disk. Cannot be undone.">🗑 Clear</button>
              ${open}
            </div>
          </div>`;
      };
      const archiverExtras = `
        <details class="stg-plugin-details">
          <summary>Archiver advanced</summary>
          ${row("Archive directory",
            textInput("archiver.archive_dir", arc.archive_dir, "/path/to/archives"),
            "Where archived VODs land. Defaults under the main recording dir.")}
          ${row("Format",
            textInput("archiver.format", arc.format, "best"),
            "yt-dlp format selector. Default targets bestvideo+bestaudio with a sensible cap.")}
          ${row("Concurrent fragments", numInput("archiver.concurrent_fragments", arc.concurrent_fragments ?? 4, 1, 16),
            "yt-dlp -N flag. 1–16; higher = faster but more rate-limit pressure.")}
        </details>`;
      const sections = Object.keys(groups).sort().map((cat) =>
        group(cat, groups[cat].map(pluginRow).join("") + (cat === "Archive" ? archiverExtras : ""))
      ).join("");
      return sections;
    }
