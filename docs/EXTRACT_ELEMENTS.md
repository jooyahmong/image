# Extract Elements V1

## Goal

Turn one uploaded image into a reviewable set of individually exportable creative assets while preserving the simple WOOJOO Image workflow.

## A. Upload

- Accept PNG, JPG, JPEG, and WebP.
- Stabilize V1 for one image at a time.
- Keep the architecture open to future multi-image batches without exposing batch UI in V1.
- Suggested file-size limit: 10 MB.

## B. Detect and Extract

- Detect visually separate design elements.
- Produce a transparent preview for each extracted asset where applicable.
- Do not assume text must always become an image asset.
- Keep text and background inclusion/exclusion separable so options can be added later.

### Official Fast Path limitation: touching / overlapping elements

Confirmed in Phase C.5/C.6 QA and not planned to be solved by the current
connectivity-based Fast Path:

- Elements that touch or overlap may be detected and returned as a single
  merged element instead of separate ones.
- An overlapping object cannot be reconstructed as separate, complete
  shapes -- there is no attempt to guess the hidden part of an occluded
  element.

This is a structural limit of 8-connected component detection, not a bug to
be tuned away, and is not something adding an AI model would fix on its own
either (a real segmentation/completion model is a separate, larger
capability -- see `docs/ELEMENT_DETECTION_SPIKE.md`). It is surfaced to the
user as a standing note in the Review step, not just in this document.

## C. Review

- Thumbnail grid.
- Select all and deselect all.
- Individual selection.
- Editable filename.
- Exclude/remove asset.

## D. Automatic Filenames

English examples:

- `cute_pink_flower_01`
- `green_bicycle_01`
- `pastel_rainbow_01`

Korean examples:

- `귀여운_분홍_꽃_01`
- `초록_자전거_01`
- `파스텔_무지개_01`

Filenames must be content-based, readable, unique, safe for export, automatically numbered when duplicated, and user-editable.

## E. Metadata

Each asset supports:

- filename
- title
- keywords
- language
- filetype
- category

Keyword count options are 10, 25, and 50. Metadata languages are English and Korean.

## F. Export

Formats:

- PNG
- JPG
- SVG
- CSV metadata

Required actions:

- Download Selected
- Download All ZIP

Only user-selected formats are included. Suggested structure:

```text
project-name.zip
├── png/
├── jpg/
├── svg/
└── metadata_en.csv or metadata_ko.csv
```

## G. SVG Reuse

- Reuse `createVectorResult` and related helpers from `app/vector-utils.ts` where possible.
- Do not build a second unrelated SVG converter.
- Refactor shared code only when reuse requires it and regression coverage protects the current converter.
- A later version may mark photo-like or unsuitable assets as SVG not recommended.

## H. Donation

After a successful export, a subtle call to action may appear.

Korean:

> WOOJOO Image가 도움이 되었나요? 무료 도구를 계속 운영할 수 있도록 개발자에게 커피 한 잔을 보내주세요.

English:

> Enjoying WOOJOO Image? Help keep these tools free by buying the developer a coffee.

Do not force a popup.

## I. Out of Scope for V1

- AI image generation
- subscriptions
- paid credits
- complex administration
- advanced Planner or Journal implementation
- cloud sync unless an existing requirement makes it necessary

## Implementation Boundary

### Safe in the Current Frontend

- Local upload and image decoding.
- Thumbnail/card review UI.
- Selection, rename, exclude, and export settings.
- Transparent canvas crops and basic connected-region extraction.
- PNG/JPG rendering, CSV creation, and SVG conversion through the existing engine.
- Client-side ZIP creation after selecting a small, browser-suitable ZIP implementation.

### Needs a Separate Technical Decision

Reliable semantic detection, content-based filenames, titles, descriptions, and keywords may require either a local browser model or an external API. The current repository has neither. Before implementing that part, confirm the privacy, download-size, performance, operating-cost, and Korean-language quality tradeoffs. Do not introduce a backend or paid API implicitly.

## Safest Integration Point

- Add `/extract-elements` through the existing pathname switch in `main.tsx`.
- Keep the route unlinked and hidden during development. Do not change production navigation before end-to-end approval.
- Keep the feature in its own page and stylesheet so the Image-to-SVG editor remains isolated.
- Import the existing SVG engine only when an extracted asset is ready for SVG export.
- Share small visual/navigation primitives only when doing so does not require a broad refactor.
