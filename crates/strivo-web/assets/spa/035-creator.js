  // Auto-download row delete + playlist edits.
  document.querySelectorAll(".mon-dl-rm").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Stop auto-downloading new uploads from this channel?")) return;
      try {
        await API.setArchiverTandem(btn.dataset.key, false);
        Toast.success("Stopped");
        renderSchedule();
      } catch (e) {
        Toast.error(`Couldn't stop: ${e.message}`);
      }
    });
  });
  // Debounced save on playlist field changes — split on comma/space.
  document.querySelectorAll(".mon-playlists").forEach((inp) => {
    let timer;
    inp.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const key = inp.dataset.key;
        const playlists = inp.value
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        try {
          await API.setArchiverPlaylists(key, playlists);
          Toast.success("Playlists saved");
        } catch (e) {
          Toast.error(`Couldn't save: ${e.message}`);
        }
      }, 600);
    });
  });

  // Add new auto-download channel.
  document.getElementById("mon-dl-add")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = document.getElementById("mon-dl-channel").value;
    if (!key) return;
    try {
      await API.setArchiverTandem(key, true);
      Toast.success("Enabled");
      renderSchedule();
    } catch (err) {
      Toast.error(`Couldn't enable: ${err.message}`);
    }
  });
