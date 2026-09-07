
// Single source of truth for the plugin set across the Settings →
// Plugins manager AND the hub. Every shipped plugin appears once with
// the metadata the SPA needs to render its enable toggle + open link.
const PLUGIN_REGISTRY = [
  // First-party Pro plugins with dedicated SPA sub-routes.
  { name: "crunchr",   label: "Crunchr",   category: "Transcription", route: "#/plugins/crunchr",   proGated: true,  description: "Transcribe every recording — speaker timeline, quote search, exportable subtitles." },
  { name: "archiver",  label: "Archiver",  category: "Archive",       route: "#/plugins/archiver",  proGated: true,  description: "Auto-catalog the full back-catalog of any followed channel." },
  { name: "insights",  label: "Insights",  category: "Analytics",     route: "#/plugins/insights",  proGated: true,  description: "Cross-stream analytics, word frequency, topic shifts, retention proxy." },
  { name: "viewguard", label: "Viewguard", category: "Analytics",     route: "#/plugins/viewguard", proGated: true,  description: "Live fraud-signal scoring during captures + cross-stream trend dashboard." },
  // Editor stack.
  { name: "editor",     label: "EDL editor",   category: "Editor", proGated: true, description: "Non-destructive EDL with split / ripple-delete / dead-air trim / branding overlay + revision history." },
  { name: "deadair",    label: "Dead-air trim", category: "Editor", proGated: true, description: "Silence detection + one-click EDL trim from inside the editor." },
  { name: "branding",   label: "Branding",      category: "Editor", proGated: true, description: "Watermark + intro/outro banner overlay spec, applied via ffmpeg filter_complex on render." },
  { name: "broll",      label: "B-roll finder", category: "Editor", proGated: true, description: "Suggest B-roll cuts from a tagged local library based on transcript topics." },
  { name: "loudness",   label: "Loudness",      category: "Editor", proGated: true, description: "EBU R128 master-bus loudness check with per-platform presets (YouTube/Spotify/Apple/EBU/Twitch)." },
  { name: "structure",  label: "Structure",     category: "Editor", proGated: true, description: "DAW-style section labeller — intro / gameplay / break / outro tiling from chapters + chat density + scene cuepoints." },
  { name: "automation", label: "Automation",    category: "Editor", proGated: true, description: "Volume automation curves — time-keyed gain with linear/cosine/step interpolation, baked via ffmpeg asendcmd." },
  { name: "scenes",     label: "Scene snapshots", category: "Editor", proGated: true, description: "DAW-style session save/recall — bundle every per-recording plugin state as a named scene." },
  { name: "schedule-optimizer", label: "Schedule optimizer", category: "Publish", proGated: true, description: "Publish-slot recommender — engagement samples → top weekly publish times with confidence + plateau coverage." },
  { name: "beat-detect",        label: "Beat detection",     category: "Editor", proGated: true, description: "DAW-style tempo grid — onset detector + BPM autocorrelation for music-sync montage cuts." },
  { name: "vad",                label: "Voice gate",         category: "Editor", proGated: true, description: "DAW-style noise gate — hysteresis VAD that surfaces auto-tighten ripple-deletes for podcast/commentary recordings." },
  { name: "sidechain",          label: "Sidechain compressor", category: "Editor", proGated: true, description: "DAW sidechain — VAD voice intervals → ducking automation curve baked via the existing volume-automation render path." },
  { name: "insert-fx",          label: "Insert FX chain",      category: "Editor", proGated: true, description: "DAW-style ordered insert chain per recording: HP, NR, de-esser, comp, limiter, reverb. Voice + game bus presets. Composes into one ffmpeg -af baked at render." },
  { name: "pitch",              label: "Pitch / time-stretch", category: "Editor", proGated: true, description: "Independent tempo + pitch. Fit a 1h45 stream to a 1h slot without changing voices' pitch, or transpose a stinger without changing tempo. Wraps ffmpeg rubberband, formant-preserving by default." },
  // Asset / analytics / publishing.
  { name: "chapters",         label: "Chapters",         category: "Analytics", proGated: true, description: "Heuristic chapter markers extracted from pacing." },
  { name: "cuepoints",        label: "Cuepoints",        category: "Analytics", proGated: true, description: "Scene-change detection from ffmpeg's select filter." },
  { name: "thumbnails",       label: "Thumbnails",       category: "Analytics", proGated: true, description: "Frame ranking + facecam crop candidates." },
  { name: "clipper",          label: "Clipper",          category: "Editor",    proGated: true, description: "Highlight detection + one-click clip extraction." },
  { name: "captions",         label: "Captions",         category: "Transcription", proGated: true, description: "SRT / VTT / TXT export with translator-trait pluggable backend." },
  { name: "multitrack",       label: "Multitrack",       category: "Editor",    proGated: true, description: "Audio track enumeration + extraction." },
  { name: "brandsafe",        label: "Brand safety",     category: "Publish",   proGated: true, description: "Pre-publish content classifier." },
  { name: "reuse",            label: "Reuse",            category: "Publish",   proGated: true, description: "Cross-format publish-queue drafter." },
  { name: "casebook",         label: "Casebook",         category: "Reports",   proGated: true, description: "Post-stream markdown briefing." },
  { name: "heatmap",          label: "Heatmap",          category: "Analytics", proGated: true, description: "Multi-signal retention overlay." },
  { name: "insights-compare", label: "Compare", category: "Analytics", proGated: true, description: "Stream-vs-stream side-by-side." },
  { name: "viewguard-trend",  label: "Viewguard trend",  category: "Analytics", proGated: true, description: "Cross-stream fraud trend dashboard." },
  { name: "chat-density",     label: "Chat density",     category: "Analytics", proGated: true, description: "Audience-retention proxy from chat rate." },
  // Viewer layer.
  { name: "multistream", label: "Multistream viewer", category: "Viewer", route: "#/watch", proGated: true, description: "Auto-tile any subset of currently-live followed channels." },
  { name: "chat",        label: "Chat client",       category: "Viewer", route: "#/chat",  proGated: true, description: "Chatterino-class IRC + tokenizer + filter pipeline + ring buffer." },
  // Cross-cutting.
  { name: "pipelines-dag", label: "Pipelines DAG", category: "Reports", route: "#/pipelines", proGated: true, description: "Cross-plugin pipeline graph." },
  { name: "marketplace",   label: "Marketplace",   category: "Reports", route: "#/plugins",   proGated: true, description: "Third-party plugin catalog stub." },
];

