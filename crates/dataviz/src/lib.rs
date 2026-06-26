//! Research-grade analytics — aggregate transcribed/diarised data
//! across an arbitrary set of recordings, run pure-data experiments
//! over it, and emit chartable series the SPA can hand straight to a
//! plotting library.
//!
//! The happy path: user pulls a YouTube podcast playlist, lets the
//! Archiver + Crunchr pipeline transcribe + diarise every episode,
//! then opens the Data Viz hub. The hub asks the host for a
//! [`Corpus`] (one [`Episode`] per recording), runs the chosen
//! [`Experiment`], and the result is a [`Series`] the SPA renders as
//! a bar / line / scatter / treemap chart.
//!
//! Pure-data: no IO. The host owns transcript fetch + diarisation
//! integration. This crate's signature surface is types + pure
//! transforms.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single transcribed line — usually one diarised utterance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Utterance {
    pub speaker: String,
    pub text: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

/// One recording's worth of structured speech data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Episode {
    /// Stable id from the source recording.
    pub id: String,
    /// User-visible title.
    pub title: String,
    /// ISO-8601 broadcast / publish stamp. Used for historical viz.
    pub date: String,
    pub utterances: Vec<Utterance>,
}

impl Episode {
    /// Total speaking duration in seconds across all utterances.
    pub fn total_seconds(&self) -> f64 {
        self.utterances
            .iter()
            .map(|u| (u.end_sec - u.start_sec).max(0.0))
            .sum()
    }

    /// Concatenated speech text — convenient for word frequency runs.
    pub fn flat_text(&self) -> String {
        self.utterances
            .iter()
            .map(|u| u.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// A whole corpus of episodes — typically one YouTube playlist worth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Corpus {
    pub label: String,
    pub episodes: Vec<Episode>,
}

/// What kind of experiment to run over the corpus.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Experiment {
    /// Word-frequency table over the entire corpus, stop-words
    /// stripped. `top_n` caps the result so a podcast's "the / and /
    /// you" don't dominate.
    WordFrequency { top_n: usize },
    /// Per-speaker total speaking seconds across the corpus.
    SpeakerTime,
    /// Episode count grouped by ISO-8601 month — the historical
    /// timeline view.
    EpisodesPerMonth,
    /// How often each speaker shows up across episodes (mention
    /// count, not seconds). Useful for guest-frequency tracking.
    SpeakerEpisodeCount,
    /// Episode duration ladder — points are (episode title, total
    /// speaking minutes). Useful to spot the runaway 4h specials.
    EpisodeDurations,
    /// Co-occurrence — how often each pair of speakers shows up
    /// together in the same episode. Squared symmetric matrix
    /// flattened into (pair, count) entries.
    SpeakerCooccurrence,
}

/// One data point on a chart.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataPoint {
    pub label: String,
    pub value: f64,
}

/// Chart-ready output. The host's SPA picks the renderer
/// (`series.chart_hint`) and feeds `series.points` straight into a
/// `<canvas>` or `<svg>`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Series {
    pub label: String,
    /// "bar" / "line" / "treemap" / "scatter" — hints; the SPA picks
    /// the actual renderer.
    pub chart_hint: String,
    pub points: Vec<DataPoint>,
}

/// Run an experiment. Pure — given the same corpus + experiment,
/// always returns the same series. No allocation outside the result.
pub fn run(corpus: &Corpus, exp: &Experiment) -> Series {
    match exp {
        Experiment::WordFrequency { top_n } => word_frequency(corpus, *top_n),
        Experiment::SpeakerTime => speaker_time(corpus),
        Experiment::EpisodesPerMonth => episodes_per_month(corpus),
        Experiment::SpeakerEpisodeCount => speaker_episode_count(corpus),
        Experiment::EpisodeDurations => episode_durations(corpus),
        Experiment::SpeakerCooccurrence => speaker_cooccurrence(corpus),
    }
}

// ── Implementations ────────────────────────────────────────────────

const STOPWORDS: &[&str] = &[
    "the", "and", "of", "to", "a", "in", "is", "you", "that", "it", "for", "on", "with", "as",
    "are", "i", "this", "be", "or", "by", "but", "we", "an", "have", "not", "they", "from", "at",
    "your", "all", "was", "so", "if", "what", "can", "do", "just", "like", "my", "me", "he", "she",
    "his", "her", "its", "their", "out", "about", "up", "than", "then", "there", "here", "when",
    "how", "who", "yeah", "okay", "ok", "um", "uh",
];

fn word_frequency(corpus: &Corpus, top_n: usize) -> Series {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let stop: std::collections::HashSet<&&str> = STOPWORDS.iter().collect();
    for ep in &corpus.episodes {
        for w in ep.flat_text().split_whitespace() {
            let lower: String = w
                .chars()
                .filter(|c| c.is_alphabetic() || *c == '\'')
                .collect::<String>()
                .to_lowercase();
            if lower.is_empty() || lower.len() < 3 || stop.contains(&lower.as_str()) {
                continue;
            }
            *counts.entry(lower).or_insert(0) += 1;
        }
    }
    let mut paired: Vec<(String, usize)> = counts.into_iter().collect();
    paired.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let take = top_n.max(1);
    let points = paired
        .into_iter()
        .take(take)
        .map(|(w, c)| DataPoint {
            label: w,
            value: c as f64,
        })
        .collect();
    Series {
        label: format!("Top {take} words"),
        chart_hint: "bar".into(),
        points,
    }
}

fn speaker_time(corpus: &Corpus) -> Series {
    let mut totals: HashMap<String, f64> = HashMap::new();
    for ep in &corpus.episodes {
        for u in &ep.utterances {
            *totals.entry(u.speaker.clone()).or_insert(0.0) += (u.end_sec - u.start_sec).max(0.0);
        }
    }
    let mut points: Vec<DataPoint> = totals
        .into_iter()
        .map(|(s, sec)| DataPoint {
            label: s,
            value: sec / 60.0,
        })
        .collect();
    points.sort_by(|a, b| {
        b.value
            .partial_cmp(&a.value)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Series {
        label: "Speaker minutes (across corpus)".into(),
        chart_hint: "bar".into(),
        points,
    }
}

fn episodes_per_month(corpus: &Corpus) -> Series {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for ep in &corpus.episodes {
        let m = ep.date.get(..7).unwrap_or("unknown").to_string();
        *counts.entry(m).or_insert(0) += 1;
    }
    let mut points: Vec<DataPoint> = counts
        .into_iter()
        .map(|(m, c)| DataPoint {
            label: m,
            value: c as f64,
        })
        .collect();
    points.sort_by(|a, b| a.label.cmp(&b.label));
    Series {
        label: "Episodes per month".into(),
        chart_hint: "line".into(),
        points,
    }
}

fn speaker_episode_count(corpus: &Corpus) -> Series {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for ep in &corpus.episodes {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for u in &ep.utterances {
            if seen.insert(u.speaker.clone()) {
                *counts.entry(u.speaker.clone()).or_insert(0) += 1;
            }
        }
    }
    let mut points: Vec<DataPoint> = counts
        .into_iter()
        .map(|(s, n)| DataPoint {
            label: s,
            value: n as f64,
        })
        .collect();
    points.sort_by(|a, b| {
        b.value
            .partial_cmp(&a.value)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Series {
        label: "Episodes each speaker appears in".into(),
        chart_hint: "bar".into(),
        points,
    }
}

fn episode_durations(corpus: &Corpus) -> Series {
    let mut points: Vec<DataPoint> = corpus
        .episodes
        .iter()
        .map(|ep| DataPoint {
            label: ep.title.clone(),
            value: ep.total_seconds() / 60.0,
        })
        .collect();
    points.sort_by(|a, b| {
        b.value
            .partial_cmp(&a.value)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Series {
        label: "Episode durations (min)".into(),
        chart_hint: "bar".into(),
        points,
    }
}

fn speaker_cooccurrence(corpus: &Corpus) -> Series {
    let mut pairs: HashMap<String, usize> = HashMap::new();
    for ep in &corpus.episodes {
        let mut present: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for u in &ep.utterances {
            present.insert(u.speaker.clone());
        }
        let v: Vec<&String> = present.iter().collect();
        for i in 0..v.len() {
            for j in (i + 1)..v.len() {
                let k = format!("{} ↔ {}", v[i], v[j]);
                *pairs.entry(k).or_insert(0) += 1;
            }
        }
    }
    let mut points: Vec<DataPoint> = pairs
        .into_iter()
        .map(|(k, n)| DataPoint {
            label: k,
            value: n as f64,
        })
        .collect();
    points.sort_by(|a, b| {
        b.value
            .partial_cmp(&a.value)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Series {
        label: "Speaker pair co-occurrence".into(),
        chart_hint: "treemap".into(),
        points,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn corpus() -> Corpus {
        Corpus {
            label: "demo".into(),
            episodes: vec![
                Episode {
                    id: "ep1".into(),
                    title: "Pilot".into(),
                    date: "2026-01-15T00:00:00Z".into(),
                    utterances: vec![
                        Utterance {
                            speaker: "Alice".into(),
                            text: "the quick brown fox".into(),
                            start_sec: 0.0,
                            end_sec: 30.0,
                        },
                        Utterance {
                            speaker: "Bob".into(),
                            text: "fox jumps over".into(),
                            start_sec: 30.0,
                            end_sec: 60.0,
                        },
                    ],
                },
                Episode {
                    id: "ep2".into(),
                    title: "Sequel".into(),
                    date: "2026-02-10T00:00:00Z".into(),
                    utterances: vec![
                        Utterance {
                            speaker: "Alice".into(),
                            text: "fox returns".into(),
                            start_sec: 0.0,
                            end_sec: 60.0,
                        },
                        Utterance {
                            speaker: "Carol".into(),
                            text: "and a new fox".into(),
                            start_sec: 60.0,
                            end_sec: 90.0,
                        },
                    ],
                },
            ],
        }
    }

    #[test]
    fn word_frequency_drops_stop_words_and_caps_top_n() {
        let s = run(&corpus(), &Experiment::WordFrequency { top_n: 3 });
        assert!(s.points.len() <= 3);
        let top = &s.points[0];
        assert_eq!(top.label, "fox");
        assert_eq!(top.value as i64, 4);
    }

    #[test]
    fn speaker_time_sums_to_episode_total() {
        let s = run(&corpus(), &Experiment::SpeakerTime);
        let total: f64 = s.points.iter().map(|p| p.value).sum();
        // 30 + 30 + 60 + 30 = 150 sec = 2.5 min
        assert!((total - 2.5).abs() < 1e-6);
    }

    #[test]
    fn episodes_per_month_groups_by_yyyy_mm() {
        let s = run(&corpus(), &Experiment::EpisodesPerMonth);
        let labels: Vec<&str> = s.points.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, vec!["2026-01", "2026-02"]);
        assert_eq!(s.points.iter().map(|p| p.value as i64).sum::<i64>(), 2);
    }

    #[test]
    fn speaker_episode_count_counts_distinct_appearances() {
        let s = run(&corpus(), &Experiment::SpeakerEpisodeCount);
        let m: HashMap<String, f64> = s
            .points
            .iter()
            .map(|p| (p.label.clone(), p.value))
            .collect();
        assert_eq!(m.get("Alice"), Some(&2.0)); // both episodes
        assert_eq!(m.get("Bob"), Some(&1.0));
        assert_eq!(m.get("Carol"), Some(&1.0));
    }

    #[test]
    fn episode_durations_sorted_desc() {
        let s = run(&corpus(), &Experiment::EpisodeDurations);
        let vals: Vec<f64> = s.points.iter().map(|p| p.value).collect();
        for w in vals.windows(2) {
            assert!(w[0] >= w[1]);
        }
    }

    #[test]
    fn cooccurrence_emits_one_entry_per_distinct_pair() {
        let s = run(&corpus(), &Experiment::SpeakerCooccurrence);
        let labels: Vec<&str> = s.points.iter().map(|p| p.label.as_str()).collect();
        // Ep1: Alice+Bob → "Alice ↔ Bob"
        // Ep2: Alice+Carol → "Alice ↔ Carol"
        assert!(labels.contains(&"Alice ↔ Bob"));
        assert!(labels.contains(&"Alice ↔ Carol"));
    }

    #[test]
    fn empty_corpus_returns_empty_series() {
        let s = run(&Corpus::default(), &Experiment::WordFrequency { top_n: 5 });
        assert!(s.points.is_empty());
    }

    #[test]
    fn experiment_round_trips_through_serde() {
        for e in [
            Experiment::WordFrequency { top_n: 50 },
            Experiment::SpeakerTime,
            Experiment::EpisodesPerMonth,
            Experiment::SpeakerEpisodeCount,
            Experiment::EpisodeDurations,
            Experiment::SpeakerCooccurrence,
        ] {
            let s = serde_json::to_string(&e).unwrap();
            let back: Experiment = serde_json::from_str(&s).unwrap();
            assert_eq!(format!("{e:?}"), format!("{back:?}"));
        }
    }
}
