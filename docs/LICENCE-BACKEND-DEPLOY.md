# Creator Edition release hold

The Creator Edition and its licence backend are not released, supported,
deployable, or available for purchase.

The source remains in this repository for internal design and test work, but
the public delivery paths are intentionally disabled:

- release archives and the official Docker image contain only the PVR edition;
- GitHub Actions has no Creator-image publishing or licence-backend deployment
  workflow;
- the web client reports Creator activation as unavailable and exposes no
  working purchase, trial, or activation path;
- a release build refuses Creator/Pro entitlement, including cached keys and
  `STRIVO_DEV_UNLOCK_ALL`.

`STRIVO_DEV_UNLOCK_ALL` is accepted only by debug builds for local development
and tests. It is not a deployment or distribution mechanism.

## Reopening this work

Do not re-enable any of these paths piecemeal. A future release proposal must
first document and independently verify the complete product boundary:

1. threat model, authentication, entitlement, refund/revocation, and machine
   binding;
2. security review and remediation of Creator routes, external tools, and
   data-handling paths;
3. reproducible packaged builds, end-to-end upgrade/rollback tests, and clear
   support terms;
4. explicit operator approval for a specific product, price, payment provider,
   and public release plan.

Until all four are complete, Creator Edition is an experimental development
surface only.
