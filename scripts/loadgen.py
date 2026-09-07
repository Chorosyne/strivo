#!/usr/bin/env python3
"""Minimal load generator for the V07 jobs.db A/B/C benchmark.

Drives GET {base_url}/api/v1/history?limit=50 (the paginated history route,
the one the SPA actually calls) with a fixed API key header, N total
requests, at a given concurrency. Reports:
  - total wall-clock ms for the whole batch
  - avg ms/request  (= total / N — the same denominator across every arm
    and workload, so it stays a fair, if coarse, cross-arm comparison; it is
    NOT per-request p50/p99 latency)
  - error count (non-200 or exception)

No third-party load tool (hey/wrk/ab) was available on this box, so this
script exists to keep the measurement reproducible rather than a one-off
shell/curl loop.
"""
import argparse
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def one_request(url, api_key):
    req = urllib.request.Request(url, headers={"X-Api-Key": api_key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
            return resp.status
    except Exception as e:  # noqa: BLE001
        return f"ERR:{e}"


def run(base_url, api_key, n, concurrency):
    url = f"{base_url}/api/v1/history?limit=50"
    errors = 0
    start = time.perf_counter()
    if concurrency <= 1:
        for _ in range(n):
            status = one_request(url, api_key)
            if status != 200:
                errors += 1
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            futures = [ex.submit(one_request, url, api_key) for _ in range(n)]
            for f in futures:
                status = f.result()
                if status != 200:
                    errors += 1
    elapsed = time.perf_counter() - start
    return {
        "n": n,
        "concurrency": concurrency,
        "total_ms": round(elapsed * 1000, 2),
        "avg_ms_per_request": round((elapsed * 1000) / n, 4),
        "errors": errors,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--api-key", required=True)
    ap.add_argument("--n", type=int, default=500)
    ap.add_argument("--concurrency", type=int, default=1)
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    # One warm-up request so connection setup / first-query cold cache isn't
    # counted in the timed batch.
    one_request(f"{args.base_url}/api/v1/history?limit=50", args.api_key)

    result = run(args.base_url, args.api_key, args.n, args.concurrency)
    result["label"] = args.label
    print(json.dumps(result))


if __name__ == "__main__":
    main()
