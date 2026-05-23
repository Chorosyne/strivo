# Twitch Live-From-Start (Rewind) — Technical Intel

Companion to [`TWITCH-LIVE-FROM-START.md`](./TWITCH-LIVE-FROM-START.md). The scoping doc is the *plan*; this is the *recon report* underneath it. Updated 2026-05-22 after live DevTools capture against `twitch.tv/xqc` while broadcasting.

## Confirmed end-to-end (primary-source, 2026-05-22)

Captured against xqc's live broadcast on 2026-05-22. The complete chain works **anonymously**:

```
1. GQL POST gql.twitch.tv/gql  (Client-Id: kimne78kx3ncx6brgo4mv6wki5h1ko)
   operationName: "PlaybackAccessToken_Template"  (NOTE: _Template suffix)
   query: <full inline GraphQL string, see §3>     ← NOT a persistedQuery hash
   variables: {isLive: false, login: "", isVod: true, vodID: "<video_id>", ...}
   → response: { videoPlaybackAccessToken: { value: "<stringified JSON>", signature: "<hex>" } }

2. GET usher.ttvnw.net/vod/v2/<video_id>.m3u8?nauthsig=<sig>&nauth=<value>&...
   → master multivariant playlist, ~21 lines, variants per quality

3. GET <cdn>/<hash>_<channel>_<stream_id>_<unix_ts>/chunked/index-dvr.m3u8
   → EXT-X-PLAYLIST-TYPE:EVENT
   → EXT-X-MEDIA-SEQUENCE:0
   → segments numbered 0.ts, 1.ts, ... N.ts (relative URIs)
   → EXT-X-TWITCH-ELAPSED-SECS:0.000   (start of broadcast)
   → EXT-X-TWITCH-TOTAL-SECS:<seconds since broadcast start>
   → no EXT-X-ENDLIST while broadcast is live

4. GET <cdn>/<hash>_<channel>_<stream_id>_<unix_ts>/chunked/0.ts
   → 200 OK, content-type: video/MP2T, ~10MB at 1080p60
   → MPEG-TS sync byte 0x47 at offsets 0 and 188 — actual broadcast t=0 frames
```

For xqc: `video_id=2778422119`, master returned variant at `https://d1m7jfoe9zdc1j.cloudfront.net/ddd12bbba477cfc48042_xqc_319363286105_1779484389/chunked/index-dvr.m3u8`, 735 segments × 10s ≈ 2h2m matching the "2:02:05" duration shown in the channel's Videos tab while still live. **The Videos tab on a live channel is one straightforward way to discover the in-progress video_id** — it's at the top of the archives list with a growing duration.

## TL;DR — corrections to the scoping doc

- **There is no new GQL "rewind" operation.** Stream Rewind reuses `PlaybackAccessToken_Template` with `isVod=true` against the in-progress broadcast's archive `video_id`. **CONFIRMED 2026-05-22 via live capture** against xqc.
- **No persisted-query hash to pin or rotate for the token op.** Twitch sends `PlaybackAccessToken_Template` as a **full inline GraphQL query string**, not via `extensions.persistedQuery`. Embed it as a `const &str` and you're done — no quarterly maintenance for this op.
- **The playlist is a normal Twitch VOD playlist served while live.** `/vod/v2/<video_id>.m3u8` returns an HLS master; variants are `chunked/index-dvr.m3u8` with `EXT-X-PLAYLIST-TYPE:EVENT`, `EXT-X-MEDIA-SEQUENCE:0`, and segments `0.ts`...`N.ts` from broadcast t=0. **CONFIRMED — fetched the live playlist + segment 0 as 10MB of MPEG-TS data.**
- **VideoPreviewOverlay does NOT expose `archiveVideo.id`.** The earlier intel claim was wrong — that op only returns `stream.id` (live stream ID, distinct from video_id) and `previewImageURL`. **Confirmed paths to discover the in-progress video_id:** (a) helix `/videos?user_id=…&type=archive&first=1` — already wired up in `vod_backfill.rs`; (b) the channel's **Videos tab on twitch.tv** lists the in-progress broadcast at the top of "Past Broadcasts" with a growing duration. The GQL op behind the Videos tab is `FilterableVideoTower_Videos`, but its persisted hash has rotated since the public catalogs were written.
- **Anonymous Client-Id works for at least Partner channels** (tested against xqc — Partner, rewind on, not sub-gated). No `Authorization: OAuth …` needed. The sub-gate hypothesis from §2 of this doc **remains untested** — needs a known sub-only rewind channel to verify whether `authorization.forbidden=true` is returned.
- **No Rust prior art.** `twitch_api`/`twitch_api2` wrap helix only. A small handwritten GQL client + an HLS parser is the right shape.

## End-to-end flow

```
twitch.tv/<channel> live, rewind-enabled
        │
        ├─► GQL: VideoPreviewOverlay (or helix /videos archive=1)
        │       → user.stream.archiveVideo.id = <video_id>
        │
        ├─► GQL: PlaybackAccessToken (isVod=true, vodID=<video_id>)
        │       → { value: "<stringified JSON blob>", signature: "<hex hmac>" }
        │
        ├─► GET usher.ttvnw.net/vod/v2/<video_id>.m3u8?nauthsig=…&nauth=…
        │       → master multivariant playlist
        │
        ├─► GET <cdn>/<channel>_<broadcast_id>_<ts>/<quality>/index-dvr.m3u8
        │       → EVENT playlist, segments 0..N from broadcast t=0
        │
        ▼
        Loop:
          - Fetch variant playlist every EXT-X-TARGETDURATION (~10s)
          - Download new segments (2–4 concurrent)
          - Pipe to ffmpeg stdin (-i pipe:0 -c copy out.mkv)
          - On 403 segment: retry once, try alt CDN host
          - On 403 playlist: re-mint access token, continue
```

## GQL — concrete request bodies

`POST https://gql.twitch.tv/gql`

**Headers (anonymous live edge):**
```
Client-ID: kimne78kx3ncx6brgo4mv6wki5h1ko
Device-Id: <32 random alphanum>
Origin: https://www.twitch.tv
Referer: https://www.twitch.tv/
Content-Type: text/plain;charset=UTF-8
```

For sub-gated rewind, add `Authorization: OAuth <user_token>`.

**PlaybackAccessToken_Template — VOD form (the rewind workhorse, captured 2026-05-22):**

The Twitch web player sends this as an **inline GraphQL query**, not as a persisted-query hash. This is the actual payload, copy-pasteable:

```json
{
  "operationName": "PlaybackAccessToken_Template",
  "query": "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) {    value    signature   authorization { isForbidden forbiddenReasonCode }   __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) {    value    signature   __typename  }}",
  "variables": {
    "isLive": false,
    "login": "",
    "isVod": true,
    "vodID": "<video_id>",
    "playerType": "site",
    "platform": "web"
  }
}
```

For the live-edge token (separate from rewind, used for the standard `<channel>.m3u8` path) use the same query with `isLive: true, login: "<channel>", isVod: false, vodID: ""`. The `@include(if:)` directives gate which field is returned.

The intel-report claim that we'd need to pin and rotate a `sha256Hash` for this op is **incorrect**. Embed the query string as a Rust `const &str` and forget about it. Streamlink uses the inline form for the same reason.

**Response:**
```json
{ "data": { "videoPlaybackAccessToken":
   { "value": "{\"authorization\":{...},\"chansub\":{...},\"expires\":1700000000,\"vod_id\":456,...}",
     "signature": "def456…" } } }
```

`value` is **stringified JSON, not a JWT**. `signature` is opaque hex HMAC. Pass both verbatim as Usher query params; never try to recompute the signature.

## Usher URL

```
https://usher.ttvnw.net/vod/v2/<video_id>.m3u8
  ?nauthsig=<signature>
  &nauth=<url-encoded value>
  &allow_source=true
  &allow_audio_only=true
  &playlist_include_framerate=true
  &supported_codecs=h264,h265,av1
  &platform=web
  &p=<random 0-999999>
```

**Watch the prefix:** live-edge uses `sig`/`token`, VOD uses `nauthsig`/`nauth`. Mixing them up returns 403 with no useful body.

Source: `streamlink/plugins/twitch.py:332,519` (`UsherService.video`, `UsherService._create_url`).

## Playlist format

Master returns multivariant; each variant points to `<cdn>/<channel>_<broadcast_id>_<unix_ts>/<quality>/index-dvr.m3u8` where `<cdn>` is one of `*.cloudfront.net`, `*.hls.ttvnw.net`, `vod-metro.twitch.tv`, `fastly.vod.hls.ttvnw.net`. **Don't hardcode** — parse from the master response. TwitchRecover maintains a community-discovered list of CDN hostnames if origin fetch fails.

Variant `index-dvr.m3u8` while broadcast in progress:
```
#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:EVENT
#EXT-X-TWITCH-ELAPSED-SECS:0.000
#EXT-X-TWITCH-TOTAL-SECS:9876.123
#EXTINF:10.000,
0.ts
#EXTINF:10.000,
1.ts
...
```

- `EXT-X-PLAYLIST-TYPE:EVENT` → append-only growth, no `EXT-X-ENDLIST` until stream ends.
- `EXT-X-TARGETDURATION` typically **10s** (vs 2s on the live-edge path) — meaning the rewind playlist trails real-time by 30–90 seconds.
- Segment URIs are relative to the variant playlist URL, not the master.
- DMCA-muted segments expose as `*-muted.ts`; the original `.ts` may still be reachable in a window — worth a fallback fetch.

## Token semantics

- Decoded JSON `value` fields (VOD token): `authorization{forbidden,reason}`, `chansub{restricted_bitrates,view_until}`, `device_id`, `expires` (Unix seconds, ~now+30min), `https_required`, `privileged`, `user_id`, `version`, `vod_id`.
- **Refresh on demand only.** Don't pre-emptively re-mint — Twitch tolerates expired-by-a-few-minutes signatures and a refresh storm is detectable.
- For sub-gated channels: `authorization.forbidden=true` ⇒ this user can't access this VOD. Surface clearly; don't retry.

## Existing implementations — quoted code

### streamlink — the closest prior art

`src/streamlink/plugins/twitch.py:_get_hls_streams_video` (line ~980):
```python
def _get_hls_streams_video(self, video_id: str):
    sig, token, restricted_bitrates = self._access_token(False, video_id)
    url = self.usher.video(video_id, nauthsig=sig, nauth=token)
    # If the stream is a VOD that is still being recorded,
    # the stream should start at the beginning of the recording
    return self._get_hls_streams(url, restricted_bitrates, force_restart=True)
```

This is exactly the path we need — but streamlink doesn't bootstrap it from a live channel URL. The closure plumbing in `_get_hls_streams_video` requires the user to already know `video_id` (i.e., pass `twitch.tv/videos/<id>` rather than `twitch.tv/<channel>`). Our extractor needs to do the channel→video_id resolution itself.

### TwitchDownloader (C#)

Finalized-VOD only — `VideoDownloader.cs` precomputes the segment count and verifies byte sizes. Incompatible with a growing playlist. Useful only as a reference for the GQL op surface.

### twitch-dl (Python)

Same shape: `twitchdl/twitch.py` has clean `get_access_token` and `get_playlists` functions that mirror what we need, in 30-line Python. Good cross-reference.

### TwitchRecover (Java/Go)

Brute-forces CDN hostname + path from `(channel_name, stream_id, unix_timestamp)`. Useful **fallback** if Usher refuses to mint a token — you can construct the variant URL directly. Worth keeping as a secondary path.

### Rust crates.io

Empty. Searched `twitch`, `twitch_api`, `twitch-hls`, `twitchdl` — only helix wrappers exist. Build our own.

## Gotchas to bake into the implementation

1. **Persisted-query hash rotation.** Pin as `const`, fall back to APQ-with-query-body on `PersistedQueryNotFound`.
2. **Sub-gate.** BYO OAuth token for restricted channels. StriVo already has helix auth; reuse `twitch_access_token` from the keyring.
3. **Video ID race.** Archive video_id can take 30–120s to appear after stream start. Poll with backoff. Run the standard live-edge HLS pull **concurrently** so t=0 isn't lost in the worst case.
4. **Playlist lag.** The VOD path trails real-time by 30–90s. Fine for "save the whole stream," bad for low-latency monitoring.
5. **Streamer toggle.** No archive video_id ⇒ "Always publish VODs" is disabled. Bail to the existing post-stream backfill (which will also fail — they didn't archive).
6. **Muted segments.** Try unmuted `<n>.ts` first; on 403 fall back to `<n>-muted.ts`. Pattern from TwitchRecover.
7. **Client-integrity.** Anonymous calls increasingly hit integrity walls from VPN/datacenter IPs. Authenticated calls (`Authorization: OAuth …`) skip the gate — practical workaround for residential-IP users behind a corporate proxy or VPN.
8. **Rate limit.** Poll variant once per `EXT-X-TARGETDURATION`, 2–4 concurrent segment fetches. 50-way concurrency triggers 429 fast.

## Confidence inventory (updated 2026-05-22 after live capture)

| Claim | Confidence | Source |
|---|---|---|
| `PlaybackAccessToken_Template` sent as inline query (no hash) | **HIGH** | Captured live request body |
| Operation name has `_Template` suffix | **HIGH** | Captured |
| Usher VOD URL pattern `/vod/v2/<id>.m3u8?nauthsig=&nauth=` | **HIGH** | Captured + fetched successfully |
| Token `value` is stringified JSON, `signature` is hex HMAC (not JWT) | **HIGH** | Decoded and inspected |
| Rewind = in-progress VOD playlist, no new GQL op | **HIGH** | Fetched live |
| `index-dvr.m3u8` is `EXT-X-PLAYLIST-TYPE:EVENT`, segments from 0, grows live | **HIGH** | Fetched: 735 segments, `MEDIA-SEQUENCE:0`, no `ENDLIST`, `TWITCH-ELAPSED-SECS:0.000` |
| Variant URL pattern `<cdn>/<hash>_<channel>_<stream_id>_<unix_ts>/chunked/index-dvr.m3u8` | **HIGH** | Captured live |
| Segments are MPEG-TS (`video/MP2T`), relative URIs `0.ts`...`N.ts` | **HIGH** | Fetched segment 0 (10MB, sync byte `0x47`) |
| `EXT-X-TARGETDURATION` is ~10s, EXTINF ≈10s | HIGH | Captured `TARGETDURATION:12`, EXTINF:10.000 each |
| `VideoPreviewOverlay` exposes `archiveVideo.id` | **REFUTED** | Captured: only `stream.id` and `previewImageURL` |
| Bootstrap via helix `/videos?type=archive&first=1` works while live | HIGH | Already implemented in `vod_backfill.rs`, verified via Videos-tab UI |
| Anonymous Client-Id `kimne78kx3ncx6brgo4mv6wki5h1ko` mints VOD token for Partner channel | **HIGH** | Captured + fetched 10MB of segment data anonymously |
| Sub-gated rewind needs `Authorization: OAuth …` | **UNTESTED** | xqc isn't sub-gated; need a known sub-only rewind channel |
| Segments at cloudfront/hls.ttvnw.net/vod-metro | HIGH | Confirmed cloudfront variant URL |
| TOS/legal posture | LOW-MEDIUM | Unchanged from original intel; respect sub-gate when present |

## Next action before coding

**30-minute network capture on a known rewind-enabled channel** (any large affiliate/partner with the setting on — typical examples: xqc, summit1g, caedrel, but verify rewind is actually enabled on the day you capture):

1. DevTools → Network → XHR/Fetch, filter `gql.twitch.tv` and `usher`.
2. Load logged out, then logged in as a sub.
3. Click scrubber to seek back to broadcast start.
4. Save: every GQL request body, every Usher URL, the master and variant playlists.
5. Confirm: (a) no new op name, (b) `index-dvr.m3u8` is EVENT and grows, (c) signature/value pair from `videoPlaybackAccessToken`.

That single capture collapses three MEDIUM claims to HIGH. Then the Phase 2 plan in the scoping doc becomes straightforward — mostly mechanical translation of the streamlink VOD branch to Rust, plus the channel→video_id bootstrap.

## Sources

- [streamlink/streamlink — plugins/twitch.py](https://github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/twitch.py)
- [streamlink/streamlink#6090](https://github.com/streamlink/streamlink/issues/6090) — rewind not working (closed not-planned)
- [streamlink/streamlink#6720](https://github.com/streamlink/streamlink/pull/6720) — Nov 2025 hash rotation PR
- [yt-dlp/yt-dlp#10520](https://github.com/yt-dlp/yt-dlp/issues/10520) — live-from-start not working
- [fonsleenaars/twitch-hls-vods](https://github.com/fonsleenaars/twitch-hls-vods) — VOD URL patterns
- [TwitchRecover/TwitchGQL](https://pkg.go.dev/github.com/TwitchRecover/TwitchGQL) — Go GQL types
- [lay295/TwitchDownloader VideoDownloader.cs](https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/VideoDownloader.cs)
- [ihabunek/twitch-dl](https://github.com/ihabunek/twitch-dl) — Python reference
- [dudik/twitch-m3u8](https://github.com/dudik/twitch-m3u8) — minimal live extractor
- [Twitch Help — Stream Rewind announcement](https://help.twitch.tv/s/article/stream-rewind?language=en_US)
- [WunderGraph — GraphQL analysis of twitch.tv](https://wundergraph.com/blog/graphql_in_production_analyzing_public_graphql_apis_1_twitch_tv)
- [Chronophylos gist — gql.twitch.tv operation catalog](https://gist.github.com/Chronophylos/512675897009f26472dd3cfc6b6744cb)
