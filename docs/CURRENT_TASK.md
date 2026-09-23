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

## Next

1. Resolve the Phase C.5 findings above before continuing (fix/scope the near-white gap, decide on the fallback message, assess main-thread performance) — see `docs/PHASE_C5_QA.md`.
2. Phase D: add rename and exclude/remove to the existing element cards (select-all/deselect-all and individual selection are already done).
3. Phase E: reuse the existing SVG engine for extracted SVG assets and add PNG/JPG export.
4. Decide the semantic-metadata architecture before Phase F filenames and Phase G keywords — current cards use placeholder names ("Element 1" / "요소 1").
5. Revisit AI-assisted detection only as an explicit opt-in, WebGPU-gated addition later (see `docs/ELEMENT_DETECTION_SPIKE.md`); it is not required for V1's fast path to work, and would not fix the cream-background or performance findings above on its own either.
6. Manually verify the Fast Path in a real browser (drag-drop, real decode, card grid) — this session's environment had no browser-automation tool, so verification was Node unit tests (mocked canvas), typecheck/build/lint, an HTTP smoke check, and the Phase C.5 algorithmic QA only.
7. Keep the route hidden until Phases C–J pass end to end and navigation exposure is explicitly approved.

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
