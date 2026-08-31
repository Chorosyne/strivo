# StriVo

StriVo is a self-hosted live-stream PVR for Twitch, YouTube, and Patreon. It
monitors channels, records broadcasts, maintains a local library, and provides
a browser-based control surface for playback, scheduling, and repair.

## Released product

The supported public product is the PVR edition:

- live monitoring, scheduled and manual capture, and back-catalog pulls;
- local browser playback, search, recording repair, and durable job recovery;
- Linux, macOS, and Windows releases, plus the official PVR Docker image.

It is alpha software. Configuration, daemon IPC, and the dynamic-plugin ABI
may change before 1.0; review the changelog before upgrading and keep copies of
your configuration and recordings.

## Creator Edition: unavailable

Creator/research tooling in this source tree is experimental development work,
not a product offering. It is not packaged, supported, deployable, or available
for activation, trial, or purchase. Do not use it for production work or rely
on it for a delivery commitment.

The release hold and the conditions for reopening it are documented in
[LICENCE-BACKEND-DEPLOY.md](../LICENCE-BACKEND-DEPLOY.md).

## Install

Use a release archive from the
[Releases](https://github.com/revoydotdev/strivo/releases) page, or build the
supported PVR edition from source following the repository [README](../../README.md).

## Source

[github.com/revoydotdev/strivo](https://github.com/revoydotdev/strivo) — MIT.
