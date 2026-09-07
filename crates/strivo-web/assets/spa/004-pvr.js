  bulkDownload: (channelId, body) =>
    API._fetch(`/channels/${encodeURIComponent(channelId)}/bulk`, {
      method: "POST",
      body,
    }),
  requestPlaylists: (channelId) =>
    API._fetch(`/channels/${encodeURIComponent(channelId)}/playlists`, {
      method: "POST",
    }),
  resolveChannel: (platform, query) =>
    API._fetch("/channels/resolve", { method: "POST", body: { platform, query } }),
  requestChannelVods: (channelId, platform) =>
    API._fetch(`/channels/${encodeURIComponent(channelId)}/vods`, {
      method: "POST",
      body: { platform },
    }),
  schedule: () => API._fetch("/schedule"),
  scheduleAdd: (body) => API._fetch("/schedule", { method: "POST", body }),
  scheduleDelete: (index) =>
    API._fetch(`/schedule/${encodeURIComponent(index)}`, { method: "DELETE" }),
  // Monitor (record-when-live + auto-download new uploads).
  monitor: () => API._fetch("/monitor"),
