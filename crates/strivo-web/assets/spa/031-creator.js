  overlay.querySelectorAll("[data-action=rec-info-verb]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await withBusy(btn, "Queued…", async () => {
        await API.pluginRpc(btn.dataset.plugin, btn.dataset.verb, { selection: [jobId] });
        Toast.success(`${btn.dataset.verb} queued`);
      }).catch((err) => Toast.error(`${btn.dataset.verb} failed: ${err.message}`));
    });
  });
