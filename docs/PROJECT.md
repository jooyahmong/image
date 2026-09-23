# WOOJOO Image Project

## Product Direction

WOOJOO Image is expanding from an Image-to-SVG converter into a unified Creative Image Workspace. The product should remain simple, creator-friendly, fast, beginner-friendly, and reuse the existing SVG engine rather than replacing working systems.

## Product Areas

### 1. Image to SVG

The existing upload, color reduction, palette editing, background removal, crop, SVG/PNG/favicon export, and object export workflow remains supported.

### 2. Extract Elements

- Upload one image in V1.
- Detect and separate visual elements.
- Review extracted elements as individual previews.
- Select, deselect, rename, or exclude elements.
- Export PNG, JPG, SVG, and metadata CSV.
- Export selected elements or all elements as a ZIP.
- Generate content-based filenames in English or Korean, including automatic duplicate numbering.
- Generate a title and keywords for each element.

The detailed feature specification lives in `docs/EXTRACT_ELEMENTS.md`.

### 3. Stock Tools

Title, description, keyword, and CSV tools from WOOJOO Stock will be integrated gradually. No WOOJOO Stock implementation exists in this repository today.

### 4. Planner

Future support for multiple calendars, stock plans, general task planning, and records.

### 5. Journal

Future work logs, notes, and production records.

### 6. Image Generation

Future feature. It is not part of V1.

## Operating Policy

- V1 is free.
- V1 has no subscription or credit system.
- Optional coffee donations are allowed.
- Donation prompts must remain subtle and must not block the workflow.

## Current Technical Baseline

- React 19 and TypeScript, built with Vite 8.
- Static Cloudflare Workers Assets deployment from `dist/`; no Worker runtime entrypoint.
- Routes are selected from `window.location.pathname` in `main.tsx`; no routing library is installed.
- Image processing and SVG generation run in the browser.
- The Image-to-SVG engine is in `app/vector-utils.ts` and is consumed by `app/page.tsx`.
- Language support is currently component-level English/Korean copy plus query-string language selection.
- No backend, API routes, cloud storage, authentication, database, ZIP dependency, or Stock-specific code exists.
