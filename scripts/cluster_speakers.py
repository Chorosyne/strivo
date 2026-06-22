#!/usr/bin/env python3
"""Speaker re-diarization for Crunchr.

Voxtral's own diarization is unreliable on fast, overlapping speech — it tends
to lump most audio onto one label and scatter the rest across short fragments.
Rather than trust its speaker assignment, this pass keeps only Voxtral's time +
text segmentation and re-diarizes from the audio: it embeds each segment with a
voice-verification model (WavLM x-vector), clusters the embeddings into the
true set of speakers, and emits a per-segment `{index: "Speaker N"}` map. Labels
are ordered by airtime (Speaker 1 = most talking).

Inputs (argv):
  1. audio path (the 16 kHz mono mp3 the runner extracted)
  2. segments JSON: [{"index": i, "start": f, "end": f}, ...]   (order = index)
Output (stdout): JSON {segment_index: "Speaker N"}

No torchaudio/librosa: audio is decoded with ffmpeg to raw PCM. Tunables:
STRIVO_SPK_MODEL, STRIVO_SPK_THRESHOLD (cosine distance on mean-centered
x-vectors — larger merges more), STRIVO_SPK_MINDUR (shortest segment embedded).
"""
import json
import os
import subprocess
import sys

import numpy as np


SR = 16000
MODEL = os.environ.get("STRIVO_SPK_MODEL", "microsoft/wavlm-base-plus-sv")
THRESHOLD = float(os.environ.get("STRIVO_SPK_THRESHOLD", "0.55"))
TARGET_K = int(os.environ.get("STRIVO_SPK_K", "0"))   # >0 → force exactly K speakers
MIN_DUR = float(os.environ.get("STRIVO_SPK_MINDUR", "1.0"))   # embed segments at least this long
MIN_AIRTIME = float(os.environ.get("STRIVO_SPK_MINAIRTIME", "90"))  # a real speaker holds at least this many seconds
MAX_CLIP = 6.0       # cap clip length fed to the model (seconds)
BATCH = 24


def decode_pcm(path):
    out = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True,
    ).stdout
    return np.frombuffer(out, dtype=np.float32)


def main() -> int:
    audio_path, segs_path = sys.argv[1], sys.argv[2]
    segments = json.load(open(segs_path))
    if not segments:
        json.dump({}, sys.stdout)
        return 0
    for i, s in enumerate(segments):
        s.setdefault("index", i)

    wav = decode_pcm(audio_path)

    long_idx = [s["index"] for s in segments
                if float(s["end"]) - float(s["start"]) >= MIN_DUR]
    if len(long_idx) < 2:
        json.dump({str(s["index"]): "Speaker 1" for s in segments}, sys.stdout)
        return 0

    import torch
    from transformers import AutoFeatureExtractor, WavLMForXVector

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    fe = AutoFeatureExtractor.from_pretrained(MODEL)
    model = WavLMForXVector.from_pretrained(MODEL).to(dev).eval()
    by_index = {s["index"]: s for s in segments}

    def clip(idx):
        s = by_index[idx]
        st = float(s["start"])
        a = wav[int(st * SR): int(min(float(s["end"]), st + MAX_CLIP) * SR)]
        return a if len(a) >= int(0.4 * SR) else None

    embs, kept = [], []
    batch_clips, batch_idx = [], []

    def flush():
        if not batch_clips:
            return
        inp = fe(batch_clips, sampling_rate=SR, return_tensors="pt", padding=True)
        with torch.no_grad():
            e = model(**{k: v.to(dev) for k, v in inp.items()}).embeddings
        e = torch.nn.functional.normalize(e, dim=-1).cpu().numpy()
        embs.extend(list(e))
        kept.extend(batch_idx)
        batch_clips.clear()
        batch_idx.clear()

    for idx in long_idx:
        a = clip(idx)
        if a is None:
            continue
        batch_clips.append(a)
        batch_idx.append(idx)
        if len(batch_clips) >= BATCH:
            flush()
    flush()

    if len(embs) < 2:
        json.dump({str(s["index"]): "Speaker 1" for s in segments}, sys.stdout)
        return 0

    X = np.stack(embs)
    Xc = X - X.mean(axis=0, keepdims=True)          # center: spread WavLM's compressed cone
    Xc = Xc / (np.linalg.norm(Xc, axis=1, keepdims=True) + 1e-9)

    from sklearn.cluster import AgglomerativeClustering

    if TARGET_K > 0:
        # Caller knows the cast size: cluster straight to K and treat every
        # cluster as a real speaker (no airtime consolidation). KMeans on the
        # length-normalized vectors (≈ spherical/cosine) gives balanced
        # clusters; agglomerative average-linkage chains everything into a
        # couple of blobs at a forced K.
        from sklearn.cluster import KMeans
        k = min(TARGET_K, len(kept))
        labels = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(Xc)
        emb_air = {}
        for idx, lab in zip(kept, labels):
            s = by_index[idx]
            emb_air[int(lab)] = emb_air.get(int(lab), 0.0) + (float(s["end"]) - float(s["start"]))
        major = list(emb_air.keys())
    else:
        labels = AgglomerativeClustering(
            n_clusters=None, metric="cosine", linkage="average",
            distance_threshold=THRESHOLD,
        ).fit_predict(Xc)
        # Per-segment clustering leaves a long tail of tiny/singleton clusters
        # (noisy short utterances, character voices). Keep only clusters with
        # real airtime as speakers and fold everything else into the nearest
        # major speaker's centroid — collapses the tail without losing the cast.
        emb_air = {}
        for idx, lab in zip(kept, labels):
            s = by_index[idx]
            emb_air[int(lab)] = emb_air.get(int(lab), 0.0) + (float(s["end"]) - float(s["start"]))
        major = [c for c, a in emb_air.items() if a >= MIN_AIRTIME]
        if not major:                               # fallback: top-6 by airtime
            major = sorted(emb_air, key=lambda c: -emb_air[c])[:6]
    pos = {idx: i for i, idx in enumerate(kept)}
    centroid = {}
    for c in major:
        rows = [Xc[pos[idx]] for idx, lab in zip(kept, labels) if int(lab) == c]
        v = np.mean(rows, axis=0)
        centroid[c] = v / (np.linalg.norm(v) + 1e-9)
    major_set = set(major)
    seg_label = {}
    for idx, lab in zip(kept, labels):
        lab = int(lab)
        if lab in major_set:
            seg_label[idx] = lab
        else:
            v = Xc[pos[idx]]
            seg_label[idx] = max(major, key=lambda c: float(np.dot(v, centroid[c])))

    # short / unembedded segments inherit the nearest embedded segment in time
    kept_sorted = sorted(kept, key=lambda i: float(by_index[i]["start"]))
    kept_mid = [(float(by_index[i]["start"]) + float(by_index[i]["end"])) / 2 for i in kept_sorted]
    import bisect
    for s in segments:
        if s["index"] in seg_label:
            continue
        mid = (float(s["start"]) + float(s["end"])) / 2
        j = bisect.bisect_left(kept_mid, mid)
        cands = [k for k in (j - 1, j) if 0 <= k < len(kept_sorted)]
        nearest = min(cands, key=lambda k: abs(kept_mid[k] - mid))
        seg_label[s["index"]] = seg_label[kept_sorted[nearest]]

    # order clusters by airtime → Speaker 1..K
    airtime = {}
    for s in segments:
        lab = seg_label[s["index"]]
        airtime[lab] = airtime.get(lab, 0.0) + (float(s["end"]) - float(s["start"]))
    order = sorted(airtime, key=lambda c: -airtime[c])
    rename = {c: f"Speaker {i}" for i, c in enumerate(order, 1)}

    out = {str(s["index"]): rename[seg_label[s["index"]]] for s in segments}
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
