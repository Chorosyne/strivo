//! Best-effort clipboard write via OS-native helpers.
//!
//! Avoids pulling `arboard` (and its X11/Wayland conditional-compile
//! bag) for a one-call need. Tries `wl-copy` (Wayland), `xclip`
//! (X11), `pbcopy` (macOS), and `clip` (Windows) in order; first
//! success wins.
//!
//! Returns an error label suitable for the status bar. Callers ignore
//! the failure case visually but surface the message.

use std::io::Write;
use std::process::{Command, Stdio};

const HELPERS: &[(&str, &[&str])] = &[
    ("wl-copy", &[]),
    ("xclip", &["-selection", "clipboard"]),
    ("pbcopy", &[]),
    ("clip", &[]),
];

pub fn copy(text: &str) -> Result<&'static str, String> {
    for (bin, args) in HELPERS {
        // Spawn directly — Command::spawn returns an error if the
        // binary is missing on PATH, so a probe step is redundant.
        let mut child = match Command::new(bin)
            .args(args.iter().copied())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => continue,
        };
        let Some(mut stdin) = child.stdin.take() else {
            continue;
        };
        if stdin.write_all(text.as_bytes()).is_err() {
            continue;
        }
        drop(stdin);
        if child.wait().map(|s| s.success()).unwrap_or(false) {
            return Ok(bin);
        }
    }
    Err("no clipboard helper available (install wl-copy/xclip/pbcopy)".into())
}
