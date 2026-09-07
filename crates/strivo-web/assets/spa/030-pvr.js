
  overlay.querySelector("[data-action=rec-info-remux]")?.addEventListener("click", async (e) => {
    if (!(await confirmDialog(
      "Remux this recording into a matroska container with the aac_adtstoasc filter? The original is kept as <name>.orig.<ext> until success.",
      { ok: "Remux" },
    )))
      return;
    const btn = e.currentTarget;
    await withBusy(btn, "Remuxing…", async () => {
      await API.remuxRecording(jobId);
      Toast.success("Remuxed — try Play again");
    }).catch((err) => Toast.error(`Remux failed: ${err.message}`));
  });
  overlay.querySelector("[data-action=rec-info-delete]")?.addEventListener("click", async (e) => {
    if (!(await confirmDialog("Delete this recording? File moves to the 7-day trash.", { ok: "Delete", danger: true })))
      return;
    const btn = e.currentTarget;
    await withBusy(btn, "Deleting…", async () => {
      await API.deleteRecordingFile(jobId);
      Toast.success("Deleted");
      recCache = recCache.filter((r) => r.id !== jobId);
      closeRecordingModals();
      if (currentRoute() === "recordings") renderRecordings().catch(() => {});
    }).catch((err) => Toast.error(`Delete failed: ${err.message}`));
  });
  overlay.querySelectorAll("[data-action=rec-info-route-close]").forEach((a) =>
    a.addEventListener("click", () => closeRecordingModals()));
  overlay.querySelectorAll(".rec-copy").forEach((b) =>
    b.addEventListener("click", () => {
      const v = b.dataset.copy || "";
      navigator.clipboard?.writeText(v).then(
        () => Toast.success("Path copied"),
        () => Toast.error("Couldn't copy to clipboard"),
      );
    }));
