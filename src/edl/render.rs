//! Translate an [`EdlDoc`] into a [`Pipeline`] for the host DAG engine.
//!
//! This is the one-way bridge: EDL is the user-facing serializable
//! artifact; Pipeline is the in-memory executable form. Round-trip
//! (Pipeline → EDL) is not needed today — the EDL is always authored
//! first.

use super::schema::{EdlDoc, EdlKind, EdlOp};
use crate::pipeline::{Pipeline, ResourceRegistry, Stage, StageId, StageKind};

/// Build a Pipeline from an EDL. The resulting graph is linear for the
/// MVP: each op becomes a stage whose input is the prior stage. Concat
/// fan-in is preserved via explicit input references.
///
/// The returned Pipeline is *not* submitted to the registry — the caller
/// (plugin) does that after attaching plugin-specific metadata
/// (cost estimates, fallback providers, resource locks).
pub fn pipeline_from_edl(doc: &EdlDoc, _resources: &ResourceRegistry) -> Pipeline {
    let mut p = Pipeline::new(format!("{}::{}", kind_label(&doc.kind), doc.name));
    // Map op-index → stage-id so Concat ops can reference earlier Clip
    // stages by index in the EDL.
    let mut op_to_stage: Vec<Option<StageId>> = Vec::with_capacity(doc.ops.len());
    let mut prev: Option<StageId> = None;

    for op in &doc.ops {
        let kind = match op {
            EdlOp::Extract => StageKind::Extract,
            EdlOp::Transcribe { provider, .. } => StageKind::Transcribe {
                provider: provider.clone(),
            },
            EdlOp::Diarize { provider, .. } => StageKind::Diarize {
                provider: provider.clone(),
            },
            EdlOp::Subtitle => StageKind::Subtitle,
            EdlOp::Analyze { provider, .. } => StageKind::Analyze {
                provider: provider.clone(),
            },
            EdlOp::Clip { .. } => StageKind::ExportClip,
            EdlOp::Concat { .. } => StageKind::Concat,
            EdlOp::Archive { .. } => StageKind::Archive,
            EdlOp::FilterSpeaker { .. } => StageKind::Custom("filter_speaker".into()),
        };

        let inputs = match op {
            // Concat fans in from referenced Clip stages.
            EdlOp::Concat { clips, .. } => clips
                .iter()
                .filter_map(|&i| op_to_stage.get(i).and_then(|x| *x))
                .collect(),
            // Everything else chains linearly on the previous stage.
            _ => prev.iter().copied().collect(),
        };

        let stage = Stage::new(op_label(op), kind).with_inputs(inputs);
        let id = p.add_stage(stage);
        op_to_stage.push(Some(id));
        // Concat is a terminal join; downstream chains keep flowing from it.
        prev = Some(id);
    }
    p
}

fn kind_label(k: &EdlKind) -> &'static str {
    match k {
        EdlKind::Batch => "batch",
        EdlKind::Edit => "edit",
        EdlKind::Preset => "preset",
    }
}

fn op_label(op: &EdlOp) -> String {
    match op {
        EdlOp::Extract => "extract".into(),
        EdlOp::Transcribe { provider, .. } => format!("transcribe:{provider}"),
        EdlOp::Diarize { provider, .. } => format!("diarize:{provider}"),
        EdlOp::Subtitle => "subtitle".into(),
        EdlOp::Analyze { provider, .. } => format!("analyze:{provider}"),
        EdlOp::Clip { label, .. } => {
            if label.is_empty() {
                "clip".into()
            } else {
                format!("clip:{label}")
            }
        }
        EdlOp::Concat { output, .. } => format!("concat→{output}"),
        EdlOp::Archive { .. } => "archive".into(),
        EdlOp::FilterSpeaker { .. } => "filter-speaker".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edl::schema::*;

    #[test]
    fn linear_pipeline_from_preset() {
        let doc = EdlDoc {
            version: EDL_VERSION,
            kind: EdlKind::Preset,
            name: "p".into(),
            inputs: vec![],
            ops: vec![
                EdlOp::Extract,
                EdlOp::Transcribe {
                    provider: "whisper-cli".into(),
                    params: Default::default(),
                },
                EdlOp::Subtitle,
            ],
            created_at: "now".into(),
            created_by: "test".into(),
        };
        let p = pipeline_from_edl(&doc, &ResourceRegistry::new());
        assert_eq!(p.stages.len(), 3);
        // Linear chain: stage 1 depends on stage 0, stage 2 on stage 1.
        assert!(p.stages[0].inputs.is_empty());
        assert_eq!(p.stages[1].inputs, vec![p.stages[0].id]);
        assert_eq!(p.stages[2].inputs, vec![p.stages[1].id]);
        assert!(p.assert_acyclic().is_ok());
    }

    #[test]
    fn concat_fans_in_from_clips() {
        let doc = EdlDoc {
            version: EDL_VERSION,
            kind: EdlKind::Edit,
            name: "highlight-reel".into(),
            inputs: vec![EdlInput {
                vod_id: "x".into(),
                path: None,
            }],
            ops: vec![
                EdlOp::Clip {
                    in_word: 0,
                    out_word: 10,
                    label: "a".into(),
                },
                EdlOp::Clip {
                    in_word: 20,
                    out_word: 30,
                    label: "b".into(),
                },
                EdlOp::Concat {
                    clips: vec![0, 1],
                    output: "out.mkv".into(),
                },
            ],
            created_at: "now".into(),
            created_by: "test".into(),
        };
        let p = pipeline_from_edl(&doc, &ResourceRegistry::new());
        assert_eq!(p.stages.len(), 3);
        // Concat depends on both Clip stages.
        let concat_inputs = &p.stages[2].inputs;
        assert_eq!(concat_inputs.len(), 2);
        assert!(concat_inputs.contains(&p.stages[0].id));
        assert!(concat_inputs.contains(&p.stages[1].id));
    }
}
