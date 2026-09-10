// Creator-edition hook for the channel context menu's "Auto-download
// uploads" toggle (039-pvr.js). Kept in its own -creator.js module, purely
// as a thin wrapper around the existing API.setArchiverTandem (005-creator.
// js), so the PVR-only context-menu module never references an identifier
// that only exists in Creator source — it calls this wrapper instead,
// guarded by `typeof chCtxSetAutoDownload === "function"`, the same
// edition-detection idiom 028-pvr.js uses for buildCreatorPluginActionsPanel.
function chCtxSetAutoDownload(channelKey, enabled) {
  return API.setArchiverTandem(channelKey, enabled);
}
