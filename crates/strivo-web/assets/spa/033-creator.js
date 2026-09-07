  // Per-plugin Size / Clear actions — wired here so all plugin rows
  // pick up the handlers via a single querySelectorAll regardless of
  // which section painted them.
  pane.querySelectorAll(".stg-plugin-size").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.plugin;
      try {
        const r = await API.pluginStorageSize(name);
        Toast.success(`${name}: ${formatBytes(r.bytes || 0)} across ${r.file_count || 0} file(s)${r.path ? ` (${r.path})` : ""}`);
      } catch (err) {
        Toast.error(`Size lookup failed: ${err.message}`);
      }
    });
  });
  pane.querySelectorAll(".stg-plugin-clear").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.plugin;
      const ok = confirm(`Permanently delete all stored data for plugin '${name}'?\n\nThis removes per-recording SQLite databases, JSON spec files, and any cached output. Cannot be undone.`);
      if (!ok) return;
      try {
        const r = await API.pluginStorageClear(name);
        Toast.success(`${name}: deleted ${r.files_removed || 0} file(s), reclaimed ${formatBytes(r.bytes_removed || 0)}`);
      } catch (err) {
        Toast.error(`Clear failed: ${err.message}`);
      }
    });
  });
