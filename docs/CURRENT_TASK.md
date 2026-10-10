# Current Task

## Project

WOOJOO Image

## Current Feature

Bulk SVG Convert V1 (new, on `feature/bulk-svg-convert`). Extract Elements
V1 is paused at its accepted Phase E checkpoint (`c98ca80`); its E.1/E.2/E.3
export-quality experiments are preserved, uncommitted-to-main, on
`experiment/extract-export-quality` -- see "Branch Split" below.

## Branch Split (handoff safety gate)

A later session found Phase E.1/E.2/E.3 (PNG edge/mask quality, Unicode
filenames, 1x/2x/4x export, shared SVG helper) sitting uncommitted on `main`
on top of the accepted `c98ca80` checkpoint, with no other uncommitted or
unexpected changes. Per instruction, that research is kept but kept out of
Bulk:

- `experiment/extract-export-quality` -- local-only branch, one commit
  (`experiment: preserve extract export quality research`) holding exactly
  the E.1/E.2/E.3 diff (the 9 files: `extract-elements-utils.ts`,
  `extract-elements-export.ts`, `extract-elements-page.tsx`,
  `extract-elements-worker.ts`, `extract-elements.css`, `vector-utils.ts`,
  both test files, and `docs/CURRENT_TASK.md`'s own E.1/E.2/E.3 writeup).
  Not merged, not cherry-picked, not pushed. Will not be brought back into
  `main` or `feature/bulk-svg-convert` without explicit user approval (see
  `docs/DECISIONS.md`).
- `main` -- reset to exactly `c98ca80` (clean, verified: typecheck/build/79
  tests all pass at this checkpoint).
- `feature/bulk-svg-convert` -- branched from clean `main`; all Bulk SVG
  Convert work happens here. Not merged to `main`, not pushed.

## Current Repository State

- Branch: `feature/bulk-svg-convert` (off clean `main` @ `c98ca80`).
- Working tree at session start: no modified or staged source files; `tests/artifacts/` contains existing untracked SVG diagnostic output and must be preserved.
- Framework/build: React 19 + TypeScript + Vite 8.
- Routing: pathname switch in `main.tsx`; `/landing` renders `app/landing-page.tsx`, and all other paths currently render `app/page.tsx`.
- Existing relevant UI: the Image-to-SVG workspace is `app/page.tsx` with global styles in `app/globals.css`; the marketing page is separate.
- Existing Image-to-SVG implementation: upload, crop, palette reduction/editing, background deletion, SVG/PNG/favicon export, and disconnected-object export are implemented.
- SVG conversion logic: `app/vector-utils.ts`, including `createVectorResult`, object bounds, object extraction, crop, and download helpers.
- Language handling: English/Korean component copy selected with `?lang=ko`; no i18n library.
- Downloads/dependencies: direct browser downloads exist; `fflate` (^0.8.3, zero transitive deps) was added for Bulk SVG Convert's ZIP packaging -- see `docs/BULK_SVG_CONVERT.md`.
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

## Smart Extract — Feasibility Spike (docs only, `docs/SMART_EXTRACT_SPIKE.md`, committed as `5586c67`)

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

## Phase D — Quick Extract Review Tools (committed as `57fbcb8`)

Decision: Smart Extract stays deferred (see `docs/DECISIONS.md`); Quick
Extract is being finished first. This phase adds Review-step editing to
Quick Extract only -- no Smart Extract, no export formats yet.

- **Merge selected.** New pure functions in `extract-elements-utils.ts`
  (`planMerge`, `applyMerge`, `computeUnionBounds`) combine 2+ selected
  cards into one transparent asset using each member's real source
  coordinates -- not a thumbnail collage. The result is rendered with a
  new `renderCombinedPreview` (a sibling of the existing
  `renderElementPreview`, testing membership against a set of original
  label ids instead of one) onto a canvas sized to the members' union
  bounding box, so real gaps between elements stay transparent and nothing
  is stretched. `detectExtractElements`'s "ok" outcome now also returns
  the decoded `source` and `labels`, since merging needs the original
  pixels, not just the already-cropped previews. Every card (plain or
  merged) carries `sourceRegionIds`, so merging a previously-merged card
  with something else works by flattening those ids -- no recursion limit
  in practice.
- **Undo merge / Reset extraction.** `undoMerge` restores a merged card's
  exact member snapshot in its place; `buildInitialCards` rebuilds the
  whole card list from the untouched original `elements` for Reset. Both
  are pure functions operating on the card list; the component only owns
  the object-URL cleanup side effect (`collectMergedPreviewUrls`, also
  moved into utils, walks nested merge-of-merge previews without ever
  touching the original detected elements' previews).
- **Rename.** Inline edit per card (pencil-labeled name button -> input,
  Enter/Save or Escape/Cancel). `renameCard` trims and rejects an empty
  result (`{ applied: false }`), leaving the card unchanged. No AI/content-
  based naming -- manual only, as scoped.
- **Exclude / Restore.** `toggleCardExcluded` flips a card's own
  `excluded` flag, fully independent of `selectedIds` (selection = current
  bulk-action target; excluded = won't be part of export later). Original
  card data is never deleted.
- UI: same card grid, no new modals. Top bar gained Merge selected (needs
  2+) and Reset extraction. Each card gained the rename control, an
  Exclude/Restore button, an "Excluded" badge, and, for merged cards, a
  "Merged from N elements" line with Undo merge.
- Tests: 14 new (merge x2, union bbox, area sum, applyMerge shape, undo,
  reset, collectMergedPreviewUrls incl. merge-of-merge, spatial-position +
  transparency via a real rendered preview, rename x3, exclude x2) -- all
  in `extract-elements-utils.ts`'s pure layer, since this codebase has no
  React-rendering test setup; the component was kept thin specifically so
  this logic could move out and be tested directly. 69 tests total, all
  passing, including every existing Image-to-SVG regression (untouched --
  `app/page.tsx` and `app/vector-utils.ts` were not touched this phase).

## Phase E — Export PNG / JPG / SVG (not committed yet)

Review cards can now actually leave the browser as files. Export is scoped
to `!excluded && selected` cards -- the same "selected" checkbox Merge
already uses, not a second notion of "chosen." No CSV, keywords, ZIP,
automatic filenames, or donation UI yet, as scoped.

- **New file `app/extract-elements-export.ts`**, deliberately separate
  from `extract-elements-utils.ts`. It's the only place Extract Elements
  imports `vector-utils.ts`. Reason: when the vector-utils import lived in
  `extract-elements-utils.ts` itself, the Fast Path Worker bundle (which
  only needs the pure detection functions) ballooned from 2.4 KB to
  70.75 KB, because Vite bundles per module graph and `extract-elements-worker.ts`
  transitively imports `extract-elements-utils.ts`. Splitting export into
  its own module fixed the worker back to 2.41 KB without changing either
  side's behavior.
- **PNG**: `exportCardAsPngBlob` re-crops the card's real source pixels via
  the shared `extractCardPixels` (now used by every renderer/exporter, not
  just previews) -- never a screenshot of the rendered preview -- and keeps
  alpha exactly as detected/merged.
- **JPG**: `exportCardAsJpgBlob` draws the same crop onto its own scratch
  canvas, then `drawImage`s that onto a canvas pre-filled with a solid
  background (white by default; the function already takes a `background`
  parameter for a later color option, not exposed in this UI). `drawImage`
  is what actually alpha-composites it -- `putImageData` alone would just
  overwrite pixels with no blending.
- **SVG**: `exportCardAsSvgString` reuses `createVectorResult` from
  `vector-utils.ts` unmodified -- it only builds the `RasterSource` wrapper
  `createVectorResult` expects (fixed `colorCount=8`, `cleanup="medium"`,
  `anchorSimplification=50`, matching the main editor's own defaults) and
  returns `.svg`. No second SVG engine. A test asserts the output actually
  contains `data-vector-engine="imagetracer-regionfill-v9"`, the real
  engine's own marker, not a stub's.
- **Filenames**: `sanitizeFilenameBase` matches the existing
  `cleanFilename` in `app/page.tsx` (strip a trailing extension, replace
  anything outside `[a-zA-Z0-9-_]` with `-`, fallback if empty) so exports
  look like every other download this app produces.
  `buildExportFilename` numbers collisions (`flower.png`, `flower-2.png`,
  ...) case-insensitively against every filename handed out so far this
  session.
- **Download**: new `downloadBlob` in `vector-utils.ts` (purely additive --
  reuses the existing private `requestSaveHandle`/`finishDownload` helpers
  `downloadText`/`downloadPng` already call, so the save UX is identical;
  neither existing function was changed).
- **UI**: each card gained a `[PNG] [JPG] [SVG]` row, disabled unless the
  card is an active export candidate, with a per-button spinner and a
  short inline error that doesn't block other cards' exports. The "next"
  aside now correctly advertises only what's still missing (CSV, ZIP), not
  PNG/JPG/SVG, which are done.
- **Tooling note**: fixed `tsconfig.json` to set `allowImportingTsExtensions: true`
  and gave relevant relative imports explicit `.ts` extensions, because
  Node's native TS execution (used by `node --test`) does not resolve
  extensionless relative specifiers the way Vite does -- needed once
  `extract-elements-utils.ts`/`extract-elements-export.ts` started
  importing each other and `vector-utils.ts` directly.
- Tests: 15 new (PNG transparency + dimensions, PNG on a merged card, JPG
  white-background compositing (real alpha math in the mock, not just a
  function-was-called check), export-candidate gating, SVG reuses the real
  engine (asserted via its own marker), SVG on a merged card, 2 filename-
  sanitize cases, 2 collision-numbering cases) -- 79 tests total, all
  passing, including every existing Image-to-SVG regression.

## Bulk SVG Convert V1 (not committed yet, on local `feature/bulk-svg-convert`)

New, separate feature: convert many images to SVG at once through the
existing Image-to-SVG engine, not a new converter. Hidden at `/bulk-convert`
until explicitly approved for navigation. Full scope/architecture in
`docs/BULK_SVG_CONVERT.md`.

- **New files, isolated from Extract Elements and from
  `experiment/extract-export-quality`**: `app/bulk-convert-utils.ts` (pure
  logic), `app/bulk-convert-page.tsx` (the page), `app/bulk-convert.css`
  (its own stylesheet). Nothing here imports `extract-elements-*`; a
  regression test (`tests/rendered-html.test.mjs`) asserts that directly.
- **Same pipeline, proven not assumed.** `convertBulkFile` calls exactly
  `loadRaster` then `createVectorResult` from `vector-utils.ts` --
  unmodified, no wrapper. A test runs one fake file through (A) that same
  pair of calls directly (what `page.tsx`'s own conversion does for an
  upload with no interactive crop) and (B) `convertBulkFile`, and asserts
  byte-identical SVG output. `page.tsx`/`vector-utils.ts` were not touched.
- **Shared settings.** Only `colorCount` (2-20, default 8) is user-
  adjustable, matching the single editor's own slider; `cleanup="medium"`
  and `anchorSimplification=50` are fixed, matching the single editor's own
  non-adjustable constants -- Bulk invents no new knob the single editor
  doesn't already have.
- **Queue.** Bounded worker-pool (`runBulkQueue`), concurrency 2. Per-job
  `queued -> converting -> done | failed`; one job's failure never stops
  the batch (caught per-job). Documented honestly in
  `docs/BULK_SVG_CONVERT.md`: since `createVectorResult` is synchronous and
  there's no Worker for vectorization (adding one was out of scope),
  concurrency mainly bounds in-flight decodes, not CPU parallelism that
  doesn't exist for the trace step.
- **Filenames.** Fresh, Bulk-only `sanitizeBulkFilenameBase`/
  `buildBulkSvgFilename` -- a denylist (forbidden/control chars,
  whitespace), not an ASCII allowlist, so Korean/Unicode names survive.
  Independently written, not imported from the quarantined experiment.
  Duplicate numbering matches the main editor's own case-insensitive,
  case-preserving contract.
- **ZIP.** New dependency `fflate` (^0.8.3, zero deps of its own) -- no ZIP
  library existed before. `buildBulkZip` packages only the entries it's
  handed; the page filters to `selected && done` jobs first. Verified by
  round-tripping a built ZIP (including a Korean filename) through
  `unzipSync` in tests. Bundle impact measured: main bundle 388.27 KB
  (121.54 KB gzip) -> 410.20 KB (129.39 KB gzip) after all of Bulk's code +
  CSS + fflate together (~7.85 KB gzip combined delta; no per-route
  code-splitting exists in this project, so this lands in everyone's
  bundle the same way Extract Elements' own page code already does).
- **Memory.** `convertBulkFile` returns only `{ svg, width, height }` -- no
  decoded raster is ever stored past that call, so nothing holds 50
  rasters in memory regardless of batch size. Thumbnails use
  `URL.createObjectURL`, not the conversion pipeline. Object URLs are
  revoked on remove/clear/unmount.
- **UI.** Upload (drag-drop + picker, multi-file, up to 50), per-row
  thumbnail/filename/dimensions/status, select/deselect/remove/clear,
  Convert All / Cancel, Retry / Retry Failed, per-row Download SVG,
  Download All ZIP, progress counter. Same visual identity (own `--bulk-*`
  CSS variables mirroring `--extract-*`'s pattern), bilingual EN/KO.
- **Tests**: 17 new in `tests/bulk-convert.test.mjs` (upload validation x2,
  job list ops, 4 filename cases, 5 queue cases incl. concurrency bound/
  failure isolation/retry/selected-only, the real-engine parity test, a
  memory-shape test, 2 ZIP tests incl. Korean round-trip) plus 1 new in
  `tests/rendered-html.test.mjs` (route isolation + no Extract Elements
  import). 97 tests total, all passing, including every existing
  Image-to-SVG regression and the existing Extract Elements isolation test
  (unchanged, confirming the accepted main checkpoint's own behavior holds).
- Full report (pipeline audit, parity proof, queue/ZIP/memory design,
  dependency impact) delivered alongside this update; committed locally
  only to `feature/bulk-svg-convert`, not pushed, not merged to `main`.

## Next (Bulk SVG Convert)

1. Get sign-off on Bulk SVG Convert V1 before deciding whether to merge
   `feature/bulk-svg-convert` into `main` (not merged yet -- report first).
2. Real-browser QA: upload a real mixed batch (PNG/JPG/WebP, some large,
   some small, a few over 20 MB or wrong-type to confirm per-file failure
   isolation), run Convert All, try Cancel mid-batch, Retry a failed file,
   Retry Failed, download individual SVGs and the ZIP, and open the ZIP in
   a real unzip tool to confirm Korean filenames display correctly outside
   of Node's own `unzipSync`.
3. No per-image settings override exists yet -- confirm that's acceptable
   for V1 before considering it for a later phase.
4. Keep `/bulk-convert` hidden until explicitly approved for navigation.

## Next (Extract Elements, paused)

1. Extract Elements E.1/E.2/E.3 sign-off is on hold -- that research lives
   on `experiment/extract-export-quality`, untouched, pending explicit
   user approval before any merge back.
2. Phase E's own real-browser QA (3 real templates, PNG/JPG/SVG download
   check) is still outstanding whenever Extract Elements resumes.
3. Decide the semantic-metadata architecture before Phase F filenames and
   Phase G keywords — cards still use placeholder/manually-renamed names,
   no content-based automatic naming.
4. Phase H (per this task's own numbering): CSV metadata and a Download
   All ZIP for every selected asset at once -- explicitly deferred again
   this phase.
5. Smart Extract stays deferred per `docs/DECISIONS.md`; whoever revisits
   it needs model access first (see `docs/SMART_EXTRACT_SPIKE.md` §7) --
   not blocking Quick Extract V1.
6. Keep the route hidden until Phases C–J pass end to end and navigation
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
