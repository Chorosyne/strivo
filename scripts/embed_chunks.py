#!/usr/bin/env python3
"""Local sentence-embedding helper for Crunchr vectorization.

Reads a JSON array of strings from the file given as argv[1], embeds each
with a local sentence-transformers model (GPU when available), and writes a
JSON array of float arrays (one vector per input) to stdout. Used by the
Rust `crunchr::embed` module, which persists the vectors to the
`chunks.embedding` BLOB column.

Model: all-MiniLM-L6-v2 (384-dim) — small, fast, fully local. Override with
the STRIVO_EMBED_MODEL env var. Vectors are L2-normalized so cosine
similarity reduces to a dot product.
"""
import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: embed_chunks.py <texts.json>\n")
        return 2
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        texts = json.load(fh)
    if not isinstance(texts, list):
        sys.stderr.write("input must be a JSON array of strings\n")
        return 2
    if not texts:
        json.dump([], sys.stdout)
        return 0

    import torch
    from sentence_transformers import SentenceTransformer

    model_name = os.environ.get("STRIVO_EMBED_MODEL", "all-MiniLM-L6-v2")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(model_name, device=device)
    emb = model.encode(
        texts,
        batch_size=64,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    json.dump([[float(x) for x in row] for row in emb], sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
