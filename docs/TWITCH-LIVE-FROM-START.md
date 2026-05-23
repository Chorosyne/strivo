# Twitch Live-From-Start: GQL Extractor (scoping)

**Status:** Not implemented. This is design scoping for the future replacement of the live HLS pull on rewind-enabled Twitch channels.

## Why this exists

Twitch added a viewer-side "Rewind" feature in 2024/2025 — on enabled channels, the player can seek back to broadcast start. The underlying playlist mechanism is not the standard HLS DVR window (which is bounded at ~5 minutes). Neither streamlink (`--hls-live-restart`) nor yt-dlp (`--live-from-start`) currently expose this:

- [streamlink #6090](https://github.com/streamlink/streamlink/issues/6090) — closed, not planned.
- [yt-dlp #10520](https://github.com/yt-dlp/yt-dlp/issues/10520) — open, no progress.
- [yt-dlp #6491](https://github.com/yt-dlp/yt-dlp/issues/6491) — live-VOD pulls truncate at command start time.

We've shipped two partial workarounds:

1. `-live_start_index 0` on the HLS pull — gives us ~5 minutes back, the standard DVR window.
2. **Post-stream VOD backfill** (M5.7) — queries helix `/videos` after the broadcast ends and downloads the archive. This is the full-stream capture; the live pull becomes a real-time safety net.

The VOD backfill is the right pragmatic answer for archiving. This document scopes a *third* approach for users who need the recording to be complete *during* the broadcast (e.g., catching a stream that gets DMCA'd before the VOD finalizes, or that the streamer deletes).

## What the player actually does

> **Corrected 2026-05-22 after recon.** See [`TWITCH-LIVE-FROM-START-INTEL.md`](./TWITCH-LIVE-FROM-START-INTEL.md) for the full intel report.

**There is no new "rewind" GQL operation.** Stream Rewind reuses the existing `PlaybackAccessToken` mutation with `isVod=true` against the in-progress broadcast's archive `video_id`. The "rewind playlist" is just the normal Twitch VOD playlist (`/vod/v2/<video_id>.m3u8`) served while the broadcast is still live — `EXT-X-PLAYLIST-TYPE:EVENT`, segments numbered from 0, growing append-only over the broadcast.

The Twitch web player on a rewind-enabled channel:

1. **Live edge playlist** — usual `usher.ttvnw.net/api/v2/channel/hls/<channel>.m3u8` with `sig`/`token` from `PlaybackAccessToken(isVod=false)`. Bounded ~5min DVR.
2. **Rewind playlist** — same `PlaybackAccessToken` op with `isVod=true, vodID=<archive_video_id>` → `usher.ttvnw.net/vod/v2/<video_id>.m3u8?nauthsig=…&nauth=…`. Master playlist; variants are `index-dvr.m3u8` that grow live.

The **bootstrap problem** is "what's the archive video_id for the live channel right now." Either:
- Helix `GET /videos?user_id=<channel_id>&type=archive&first=1` — appears 30–120s after stream start, with `published_at` ≈ broadcast start.
- GQL `VideoPreviewOverlay` op — `data.user.stream.archiveVideo.id`.

## Implementation outline

### Phase 1 — capture confirmation (30 min)

The intel report has answered most open questions from primary sources. One thing still needs a live capture:

- [ ] 30-minute network capture on a known rewind-enabled channel (xqc, summit1g, caedrel etc. — verify rewind is on the day you capture). Logged out + logged-in-as-sub passes. Confirm: (a) no new op name appears, (b) `index-dvr.m3u8` is EVENT and grows, (c) signature/value pair from `videoPlaybackAccessToken`. Collapses three MEDIUM-confidence claims to HIGH.

### Phase 2 — extractor (2–3 days, less than the original estimate)

The path is mostly mechanical translation of the streamlink VOD branch into Rust:

- [ ] New module `src/stream/twitch_rewind.rs` exposing `async fn resolve_rewind_playlist(channel: &str) -> Result<RewindHandle>`.
- [ ] GQL client: POST to `gql.twitch.tv/gql` with `PlaybackAccessToken` operation, sha256Hash pinned as `const`. Support **APQ fallback** — on `PersistedQueryNotFound` retry with the full query body embedded.
- [ ] Bootstrap: helix-first (we already have helix auth wired up), GQL `VideoPreviewOverlay` as fallback. Poll with backoff for up to ~120s after stream start.
- [ ] Token mint: `PlaybackAccessToken(isVod=true, vodID=<video_id>)`. Token is stringified JSON + HMAC signature, **not a JWT** — pass `value` and `signature` verbatim to Usher as `nauth`/`nauthsig`.
- [ ] Refresh on demand only (on 403 from Usher or segment), not proactively.
- [ ] Sub-gated channels: detect `authorization.forbidden=true` in the decoded `value` JSON; require `Authorization: OAuth <token>` from the user's keyring entry.
- [ ] Resolver integration: when a Twitch channel has rewind enabled (probe by attempting `PlaybackAccessToken(isVod=true)` against the resolved video_id), prefer the rewind playlist over the live HLS. Run the **standard live-edge HLS pull concurrently** as a safety net during the 30–120s video_id race window.

### Phase 3 — downloader (2–3 days)

The hard part. We can't shell out to streamlink or yt-dlp here — they don't speak this API. We need our own segment downloader.

- [ ] HLS `EVENT` playlist tail-follower: poll the playlist URL, fetch new segments as they appear, write them in order to disk. Re-fetch the playlist every `EXT-X-TARGETDURATION` seconds (typically 2s for Twitch live).
- [ ] On first connect, fetch the *full* current playlist and download every segment from `EXTINF` index 0 (this is the "from the beginning" bit).
- [ ] Concurrency: 3–5 concurrent segment fetches with bounded backpressure. Don't hammer Twitch.
- [ ] On segment 404 (token expired, segment GC'd), refresh the token and retry once; if it 404s again, treat as permanent gap and log it.
- [ ] Output: stream `.ts` segments into ffmpeg via stdin pipe, ffmpeg copies to mkv. Avoids an intermediate concat step.

### Phase 4 — wiring (1 day)

- [ ] Config flag `recording.twitch_live_from_start: bool` (default `false` — opt-in until proven stable).
- [ ] When enabled and the channel is rewind-capable, the resolver returns a `RewindStream` instead of a streamlink URL, and the recording manager routes it through the new downloader instead of the FfmpegBuilder URL-input path.
- [ ] Backfill stays as the safety net — if the rewind extractor fails partway through, the catalog/VOD-backfill path still grabs the archive.

## Risks

- **API churn.** Twitch rotates GQL persisted-query hashes and operation names. We need a CI smoke test against a known public live channel, and a clear failure mode (fall through to standard HLS + VOD backfill) when the API breaks.
- **TOS.** Twitch's TOS prohibits some forms of scraping. Using documented player traffic on channels the authenticated user can already access (which is what the web player does) is the safest stance. Don't bypass paywalls / sub-only.
- **Maintenance load.** The GQL surface area is large and undocumented. Plan for ~quarterly patches when Twitch rolls out player changes.
- **Detection.** Pulling all-segments-from-start hits Twitch's CDN differently from a normal player session. Stick to player-realistic concurrency (3–5 segments, target-duration polling) to stay under any rate-limiting heuristics.

## Decision

Until we have a concrete user request that VOD backfill can't satisfy (e.g., DMCA'd content disappearing before the archive finalizes), **stay with the M5.7 backfill approach**. Revisit when:

- A user reports losing a stream they wanted that VOD backfill didn't catch.
- A community Rust crate appears that already implements the GQL surface (would cut Phase 1–2 to a day).
- Streamlink upstream changes its mind on issue #6090.

## References

- [TwitchDownloader](https://github.com/lay295/TwitchDownloader) — C#, uses GQL for VOD downloads. Useful for understanding the API surface, not directly portable.
- [twitch-dl](https://github.com/ihabunek/twitch-dl) — Python, similar.
- [Twitch HLS protocol notes (unofficial)](https://gist.github.com/Hubro/4cd76840d8074c9d9bd5deca2772bb22) — community-maintained scratchpad.
