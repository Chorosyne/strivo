//! Per-IP login throttle (roadmap Phase 1, item 1).
//!
//! The loopback/Tailscale trust model already narrows who can reach
//! `/login`, but it doesn't stop a reachable client from brute-forcing the
//! API key. This caps failed attempts per source IP inside a sliding
//! window: after [`MAX_FAILURES`] failures the IP is blocked for the
//! remainder of [`WINDOW`], and a successful login clears its record.
//!
//! In-memory only — a daemon restart resets the counters, which is fine for
//! a single-process PVR.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Failed attempts allowed per IP before lock-out.
const MAX_FAILURES: u32 = 5;
/// Sliding window the failures are counted over (and the lock-out length).
const WINDOW: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Default)]
pub struct LoginLimiter {
    inner: Arc<Mutex<HashMap<IpAddr, Attempts>>>,
}

struct Attempts {
    count: u32,
    first: Instant,
}

pub enum Decision {
    Allow,
    /// Blocked; advise the client when to retry.
    Blocked {
        retry_after_secs: u64,
    },
}

impl LoginLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Gate a login attempt. Expired windows are pruned lazily here.
    pub fn check(&self, ip: IpAddr) -> Decision {
        let mut map = self.inner.lock().expect("login limiter poisoned");
        if let Some(a) = map.get(&ip) {
            let elapsed = a.first.elapsed();
            if elapsed >= WINDOW {
                map.remove(&ip);
            } else if a.count >= MAX_FAILURES {
                return Decision::Blocked {
                    retry_after_secs: (WINDOW - elapsed).as_secs().max(1),
                };
            }
        }
        Decision::Allow
    }

    /// Record a failed attempt, rolling the window if the previous one lapsed.
    pub fn record_failure(&self, ip: IpAddr) {
        let mut map = self.inner.lock().expect("login limiter poisoned");
        let entry = map.entry(ip).or_insert_with(|| Attempts {
            count: 0,
            first: Instant::now(),
        });
        if entry.first.elapsed() >= WINDOW {
            entry.count = 0;
            entry.first = Instant::now();
        }
        entry.count += 1;
    }

    /// Clear an IP's record on a successful login.
    pub fn record_success(&self, ip: IpAddr) {
        self.inner
            .lock()
            .expect("login limiter poisoned")
            .remove(&ip);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip() -> IpAddr {
        "127.0.0.1".parse().unwrap()
    }

    #[test]
    fn allows_until_threshold_then_blocks() {
        let lim = LoginLimiter::new();
        for _ in 0..MAX_FAILURES {
            assert!(matches!(lim.check(ip()), Decision::Allow));
            lim.record_failure(ip());
        }
        assert!(matches!(lim.check(ip()), Decision::Blocked { .. }));
    }

    #[test]
    fn success_clears_the_record() {
        let lim = LoginLimiter::new();
        for _ in 0..MAX_FAILURES {
            lim.record_failure(ip());
        }
        assert!(matches!(lim.check(ip()), Decision::Blocked { .. }));
        lim.record_success(ip());
        assert!(matches!(lim.check(ip()), Decision::Allow));
    }
}
