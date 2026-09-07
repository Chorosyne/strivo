// Coding Studio surfaces live in their own ES modules under assets/research/
// so they can be built without editing this file. build.rs deletes that whole
// directory from the PVR build, and this import block is stripped with it.
import { mount as mountCodebook } from "./research/codebook.js";
import { mount as mountCorpus } from "./research/corpus.js";
import { mount as mountNotebook } from "./research/notebook.js";

// Registry the Archive route paints from. Keyed by sub-tab id.
const RESEARCH_SURFACES = {
  codebook: { label: "Codebook", mount: mountCodebook },
  corpus: { label: "Corpus", mount: mountCorpus },
  notebook: { label: "Notebook", mount: mountNotebook },
};
