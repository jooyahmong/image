# Current Task

## Project

WOOJOO Image

## Current Feature

Extract Elements V1

## Current Repository State

- Branch: `main`
- Working tree at session start: no modified or staged source files; `tests/artifacts/` contains existing untracked SVG diagnostic output and must be preserved.
- Framework/build: React 19 + TypeScript + Vite 8.
- Routing: pathname switch in `main.tsx`; `/landing` renders `app/landing-page.tsx`, and all other paths currently render `app/page.tsx`.
- Existing relevant UI: the Image-to-SVG workspace is `app/page.tsx` with global styles in `app/globals.css`; the marketing page is separate.
- Existing Image-to-SVG implementation: upload, crop, palette reduction/editing, background deletion, SVG/PNG/favicon export, and disconnected-object export are implemented.
- SVG conversion logic: `app/vector-utils.ts`, including `createVectorResult`, object bounds, object extraction, crop, and download helpers.
- Language handling: English/Korean component copy selected with `?lang=ko`; no i18n library.
- Downloads/dependencies: direct browser downloads exist; no ZIP library is installed.
- Backend/API: none. The site is built and deployed as static assets.
- Existing WOOJOO Stock code: none found in this repository.

## Completed

- Existing Image-to-SVG workflow and its regression suite were present before this feature session.
- Phase A: shared project documentation structure and codebase audit are complete.
- Extract Elements V1 product scope, confirmed decisions, UI rules, release safety, and technical boundary are documented.
- Phase B: the hidden `/extract-elements` route and isolated bilingual page shell are complete.
- Local checkpoint commit `b55ad02` captured Phase B + shared docs; `4e7b3ff` added a `.gitignore` rule for generated test diagnostics (`tests/artifacts/`).
- Phase C: local Fast Path element detection is implemented and connected to the Review step.
  - `app/extract-elements-utils.ts`: `computeForegroundMask` (real alpha, else near-white border flood fill) and `detectFastPathElements` (8-connected labeling, dust filter, padded bbox), both pure and Node-tested; `decodeImageFileToRasterSource` / `renderElementPreview` are the browser-only canvas glue; `detectExtractElements(file)` is the single model-agnostic entry point the page calls.
  - Review step now shows real detected-element cards (transparent PNG previews) with individual Select/Deselect, Select all, and Deselect all. An empty state and a detection-error state are handled.
  - AI segmentation (SAM/SAM2/MobileSAM/Transformers.js) was evaluated as a feasibility spike only, per `docs/ELEMENT_DETECTION_SPIKE.md`; none are wired in, and none are a dependency of this app.
- Build, lint, typecheck, and all automated tests pass (40), including the existing Image-to-SVG regressions and the new Extract Elements unit tests.

## In Progress

- Rename and Exclude/remove per-element actions (part of the Review spec in `EXTRACT_ELEMENTS.md` section C) are not built — Phase C's scope was detection + select/deselect only.

## Phase C.5 — Real Image QA (see `docs/PHASE_C5_QA.md` for full detail)

Ran the real, imported `computeForegroundMask`/`detectFastPathElements` (not a reimplementation) against constructed proxy images for the 6 required scenarios; no chromium/Playwright was available in this environment, so this is Node-level algorithmic QA with visually-inspected PNG output, not a real-browser click-through.

- **Works well:** real alpha-transparent backgrounds, and pure/near-white (≥~240 per channel, low spread) backgrounds, with elements separated by roughly 3px or more. 5/5, 4/4, and 12/12 (3-megapixel timing case) detected correctly with clean per-element transparent cutouts.
- **Confirmed broken:** cream/off-white backgrounds (e.g. RGB 250,247,238) are not recognized as background at all — the whole image comes back as a single "element" with an opaque, non-transparent background. This is one of the required test categories and it fails completely.
- **Confirmed known limitation (matches docs):** elements that touch or overlap merge into one element. A 1px gap also merges; a 3px gap does not.
- **New finding:** detection on a 3-megapixel image took ~166ms of synchronous main-thread work (mask 136ms + labeling 29ms) with no Web Worker offload. Scales with pixel count, so larger uploads (the feature allows up to 10 MB files) risk a real, noticeable UI freeze.

**Verdict:** Fast Path is not ready to ship as-is for V1. It works for a narrower slice than the product spec's own test list (transparent or clean-white backgrounds, non-touching elements only) but fails one of the five required categories outright (near-white/cream) and has an unverified large-image performance risk. AI extraction is not required to fix either issue — both are Fast Path bugs/gaps, not missing-model problems. Recommended before Phase D/E: (1) fix or explicitly scope out near-white/cream background support (widening the threshold is not risk-free — this product's own pastel presets mean loosening it could start deleting pale foreground artwork, so this needs a deliberate decision, not a blind number change), (2) decide and, if adopted, wire in the "not suited for automatic separation" fallback message for touching/overlapping and unsupported-background cases, (3) evaluate moving detection off the main thread (Web Worker) before raising the effective size ceiling. None of this was implemented this session per instructions (QA only, no code changes).

## Phase C.6 — Fast Path Stabilization (not yet committed)

Addressed all three Phase C.5 findings that were fixable without AI:

- **Adaptive background estimation** replaces the fixed near-white RGB
  threshold in `computeForegroundMask`. It samples the image border,
  buckets colors coarsely, takes the dominant bucket's average as the
  estimated background color (with a confidence score), then flood-fills
  from the border through pixels within a small RGB Euclidean distance of
  that estimate. White, off-white, cream, and light beige are now handled
  by one mechanism instead of a hardcoded cutoff. Re-running the Phase C.5
  QA harness against the real code confirms the cream case that used to
  collapse into 1 giant element now correctly returns 3.
- **Unsupported/fallback outcome.** `detectExtractElements` now returns
  `{ status: "ok", elements }` or `{ status: "unsupported", reason }`
  instead of always forcing a result. Reasons: `low-background-confidence`
  (noisy/photo-like border), `background-not-separated` (one component
  covers >85% of the canvas -- the exact shape of the old cream failure, as
  a safety net beyond the estimator itself), `no-elements-found`. The
  Review step shows this as a calm, informational panel (not styled as an
  error) with the exact KO/EN copy specified for this phase. Still hidden
  on `/extract-elements` only; no production navigation change.
- **Touching/overlapping elements were deliberately left unfixed.** Now
  recorded as an official Fast Path limitation in `EXTRACT_ELEMENTS.md`
  (new subsection under "B. Detect and Extract") and as a standing note in
  the Review step's UI copy, not just in docs.
- **Web Worker offload implemented.** `app/extract-elements-worker.ts`
  (new, Vite's native `new Worker(new URL(...), { type: "module" })`
  pattern -- no new dependency, own ~2.4 KB chunk) runs the pure mask +
  labeling pass off the main thread. `detectExtractElements(file)` keeps
  the same signature; the Review page has no idea whether a Worker ran.
  The pixel buffer is transferred to the worker and back (a disposable
  clone is sent outbound so a failed/errored worker never leaves the
  caller without valid pixels); if `Worker` is unavailable or throws,
  detection quietly falls back to the same functions synchronously on the
  main thread (this is what already happens in Node tests, with no mocking
  needed).
- Tests: kept everything from Phase C, added white/off-white/cream/light-
  beige background cases, a pale-pastel-foreground-survives case, an
  enclosed-highlight case, a non-uniform/photo-like-background →
  unsupported case, a background-collapse → unsupported case, a touching-
  elements-still-merge regression, a large-canvas regression, and direct
  unit tests for the new `assessExtractionOutcome` decision function. 55
  tests total, all passing, including every existing Image-to-SVG
  regression (untouched).

Full detail, before/after numbers, and remaining known limitations: see the
report given alongside this update and `docs/EXTRACT_ELEMENTS.md`. Committed
as `41e7ea1`.

## Smart Extract — Planning Phase (docs only, see `docs/SMART_EXTRACT.md`)

The real core user need identified: overlapping/touching template images
also need automatic separation, which Quick Extract's connectivity-based
Fast Path cannot do by construction (documented limitation, not a bug).
This planning pass, recorded in full in `docs/SMART_EXTRACT.md`:

- Split the concept into **Quick Extract** (shipped, free, local, instant --
  the current Fast Path) and **Smart Extract** (planned, not built -- real
  instance segmentation, likely with real compute cost).
- Distinguished **visible-only separation** (recover exactly what's visible,
  no invented pixels -- achievable with existing segmentation techniques)
  from **full asset reconstruction** (guessing the hidden/occluded part of
  an object -- generative, error-prone, explicitly out of scope for now).
  Smart Extract should target visible-only separation only.
- Recommended a **hybrid** posture: keep Quick Extract exactly as-is;
  treat Smart Extract as a separate, later, explicitly opt-in path whose
  local-vs-server architecture is not decided yet and should be chosen from
  real measurements, not assumption.
- Flagged a real conflict with `docs/DECISIONS.md` (no backend, V1 free,
  donation-only): a server-hosted segmentation model has real per-image
  cost that a voluntary-donation model likely can't cover, so Smart Extract
  is a candidate for a future paid/rate-limited tier, not a free V1 add-on.
- No AI pipeline was implemented. No code was changed. A UI sketch
  ("Quick Extract" / "Smart Extract (Beta)" as two distinct entry points)
  is described in `docs/SMART_EXTRACT.md` §12 but not built.

## Smart Extract — Feasibility Spike (docs only, `docs/SMART_EXTRACT_SPIKE.md`, not committed yet)

Attempted to install `onnxruntime-node` and run 1-2 candidate models
against synthetic overlapping-artwork images in an isolated scratchpad
project (outside this repo). The runtime installed cleanly. **Getting an
actual model file did not work**: `huggingface.co` (and its `hf.co`
short-domain redirect, and an `hf-mirror.com` proxy that itself redirected
back into the block) was unreachable from this environment on every
attempt across two different HTTP clients, while `github.com`,
`registry.npmjs.org`, and `cdn.jsdelivr.net` were all fine. No complete
SAM-family ONNX file could be obtained; a GitHub-hosted MobileSAM mirror
only had the decoder, not the encoder. Treated as a spike-environment
limitation, not a claim about real users' browsers -- but flagged as a
real operational risk (§0/§5/§8 of the spike doc) for whatever eventually
lazy-loads a model in production.

Given that, delivered a rigorous, cited desk comparison instead of a
personally-run benchmark:

- Compared SAM, SAM2 (hiera-tiny), MobileSAM, FastSAM-S, and (flagged,
  less vetted) EfficientSAM on size, license (all Apache 2.0 except
  EfficientSAM's varies by checkpoint), browser/WebGPU/WASM feasibility,
  and -- critically -- **automatic "everything" mode support**.
  **FastSAM-S (47.3 MB, single file) is the only candidate with a native
  automatic mode**; the whole SAM family is prompt-native (point/box) by
  design, not just missing a feature.
- Key synthesis: FastSAM's automatic mode and SAM2/MobileSAM's prompt
  design aren't competitors -- they map to the two stages of the
  semi-automatic flow the task itself sketched (auto-generate candidates,
  then click to refine one).
- Recommended V1 UX: Quick Extract stays default; Smart Extract is a
  separate opt-in beta running automatic candidates first, then
  prompt-based user refinement, never presenting unreviewed automatic
  masks as final assets (accuracy on this product's actual flat/decorative
  art is still unproven by any source found).
- Local-only is plausible for FastSAM-S/MobileSAM specifically, not for
  full SAM/SAM2; a server is not proven necessary but not ruled out either
  -- conditional on real-template accuracy testing that this spike could
  not run.
- No model integrated into the app. No accuracy numbers exist yet -- the
  next step is getting one real model file running against real
  (non-synthetic) overlapping template images, in an environment that can
  actually reach the model host.

## Next

1. Get sign-off on this spike's findings before deciding whether to commit
   `docs/SMART_EXTRACT_SPIKE.md` (per instruction, not committed yet).
2. Whoever continues this needs model access first, not a model choice --
   get one real SAM-family/FastSAM ONNX file loading in an environment
   that can reach Hugging Face (or a confirmed-reachable mirror), then run
   it against 3-5 real overlapping template images per
   `docs/SMART_EXTRACT_SPIKE.md` §7.
3. Real-user QA per Phase C.5/C.6 instructions: run at least 3 real
   templates through `/extract-elements` before calling Quick Extract
   production-ready -- (A) a white/transparent asset sheet, (B) a
   cream/pastel-background asset sheet, (C) a template with some elements
   close together or overlapping. Synthetic QA only goes so far, and this
   is also the same evidence Smart Extract's §11 step 1 needs.
4. Per `docs/SMART_EXTRACT.md` §11: feasibility-spike a real segmentation
   model against real template images (not natural-photo benchmarks)
   before committing to local, server, or hybrid for Smart Extract.
5. Phase D: add rename and exclude/remove to the existing element cards
   (select-all/deselect-all and individual selection are already done).
6. Phase E: reuse the existing SVG engine for extracted SVG assets and add
   PNG/JPG export.
7. Decide the semantic-metadata architecture before Phase F filenames and
   Phase G keywords — current cards use placeholder names ("Element 1" /
   "요소 1").
8. AI-assisted detection for Quick Extract itself is still not required
   (see `docs/ELEMENT_DETECTION_SPIKE.md`); Smart Extract is the separate,
   deliberate path for the overlapping-template need instead.
9. Keep the route hidden until Phases C–J pass end to end and navigation
   exposure is explicitly approved.

## Release Safety

WOOJOO Image is a live production site.
New features must remain unlinked/hidden until end-to-end testing is complete.
Navigation exposure is the final release step.

## Do Not

- Push.
- Deploy.
- Break existing Image-to-SVG.
- Add image generation.
- Add subscription or credit billing.
- Rewrite working systems without need.
