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
- The page includes a one-image upload surface, PNG/JPG/JPEG/WebP and 10 MB validation, empty/valid/error UI states, and clear Upload → Review → Export framing.
- Production editor and landing navigation remain unchanged and contain no Extract Elements link.
- Local responsive checks passed at 1920px, 768px, and 390px without horizontal overflow.
- Build, lint, typecheck, and all automated tests pass, including the existing Image-to-SVG regressions.

## In Progress

- No Phase C element-detection implementation has started.

## Next

1. Phase C: choose and implement local element detection/extraction while keeping text and background handling separable.
2. Phase D: add real element cards with select-all, individual selection, rename, and exclude actions.
3. Phase E: reuse the existing SVG engine for extracted SVG assets and add PNG/JPG export.
4. Decide the semantic-metadata architecture before Phase F filenames and Phase G keywords.
5. Keep the route hidden until Phases C–J pass end to end and navigation exposure is explicitly approved.

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
