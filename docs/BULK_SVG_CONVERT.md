# Bulk SVG Convert V1

## Scope

Convert many images to SVG at once, through the exact same WOOJOO Image
SVG engine the single-image editor uses. Bulk is not a second converter --
it is a batch-oriented front end over the existing pipeline.

V1 scope: upload many files, convert them with one shared setting, review
progress, retry failures, and download individually or as one ZIP.
Out of scope for V1 (deferred, not built): per-image settings overrides,
content-based filenames/keywords/CSV metadata, donation UI, Smart Extract,
Planner/Journal, and the Extract Elements E.1/E.2/E.3 export-quality
experiments (`docs/DECISIONS.md`) -- none of that is imported here.

**Decision: Bulk output is SVG-only in V1.** No PNG/JPG/favicon batch
export exists or is planned for this version -- the intro copy on
`/bulk-convert` says so explicitly (see UX below) so this is never a
surprise discovered only at download time.

## Architecture

- `app/bulk-convert-utils.ts` -- pure logic: upload validation, job/queue
  state, the Unicode-safe filename utility, and ZIP packaging. No React,
  no DOM except where it must call the real conversion pipeline.
- `app/bulk-convert-page.tsx` -- the `/bulk-convert` page: upload UI, job
  list, settings, progress, retry/cancel, downloads.
- `app/bulk-convert.css` -- its own stylesheet, isolated from
  `extract-elements.css` and `globals.css`, same pattern Extract Elements
  already uses to keep features from leaking into each other's styles.
- Nothing here imports from `extract-elements-*` or from the
  `experiment/extract-export-quality` branch.

## Single pipeline reuse

Traced the real single-image flow in `app/page.tsx` / `app/vector-utils.ts`:
upload -> `loadRaster` (decode, downscale-only to 1600px, trim to content
bounds) -> (optional interactive crop, not applicable to a batch) ->
`createVectorResult(source, colorCount, cleanup, anchorSimplification)` ->
`.svg` string -> download.

`convertBulkFile` in `bulk-convert-utils.ts` calls exactly those same two
exported functions, unmodified, with no preprocessing of its own:

```ts
const source = await loadRaster(file);
const result = createVectorResult(source, colorCount, cleanup, anchorSimplification);
return { svg: result.svg, width: source.width, height: source.height };
```

**Proven, not assumed**: `tests/bulk-convert.test.mjs` includes a test that
runs the same fake file through (A) `loadRaster` + `createVectorResult`
directly (what `page.tsx`'s own conversion does for an upload with no
interactive crop) and (B) `convertBulkFile`, and asserts the two SVG
strings are byte-identical. `app/page.tsx` and `app/vector-utils.ts` were
not modified to build Bulk.

Shared settings: `colorCount` is the only user-adjustable control (2-20,
default 8), matching the single editor's own slider range and default.
`cleanup` is fixed at `"medium"` and `anchorSimplification` fixed at `50`,
matching the single editor's own `FIXED_CLEANUP`/`FIXED_ANCHOR_SIMPLIFICATION`
constants -- neither is a UI control in the single editor either, so Bulk
doesn't invent a new adjustable knob beyond what already exists.

## Supported files / limits

- PNG, JPEG, WebP (same accepted types as Extract Elements' upload step).
- Up to 50 files per batch (`BULK_MAX_FILES`). A drag-drop of more files
  than the remaining quota adds what fits and reports the rest as skipped,
  rather than rejecting the whole drop.
- Per-file size/type validation is enforced by `loadRaster` itself (throws
  for a file over 20 MB or an unsupported type) -- the existing single-image
  limit is reused as-is, not duplicated. A rejected file fails only its own
  job; the rest of the batch is unaffected.

## Queue / concurrency

Bounded worker-pool queue (`runBulkQueue`), default concurrency 2
(`BULK_CONCURRENCY`). `createVectorResult` is synchronous and CPU-bound --
same as the single editor, no Worker exists for vectorization, and adding
one was out of scope (it would start to look like a second pipeline).
Concurrency therefore mainly bounds how many files are in flight /
decoding at once (the one real async step, `loadRaster`'s image decode),
not CPU parallelism that doesn't exist in a single-threaded JS engine for
the trace step itself.

Per-job status: `queued` -> `converting` -> `done` | `failed`. A failure in
one job is caught per-job inside the worker loop and never stops the rest
of the batch. Progress is reported as "`done` / `total` converted" plus a
failed count when any exist.

## Filename rules

Original filename is kept (`flower.png` -> `flower.svg`). A fresh,
Bulk-only Unicode-safe utility (`sanitizeBulkFilenameBase` /
`buildBulkSvgFilename`) -- a denylist of filesystem-forbidden characters,
control characters, and whitespace (folded to a hyphen), not an ASCII
allowlist -- so Korean and other Unicode names survive untouched. This is
a new, independent implementation, not imported from
`experiment/extract-export-quality`, per instruction. Duplicate names are
numbered case-insensitively (`flower.svg`, `flower-2.svg`, ...; `봄꽃.svg`,
`봄꽃-2.svg`, ...), the same contract as the main editor's own
`buildExportFilename`.

Note: the existing single-editor filename helper (`cleanFilename` in
`app/page.tsx`) has the same ASCII-only limitation this Bulk utility fixes,
but it was **not** touched -- changing it was out of scope for this task
and risks altering the single editor's existing download behavior.

## ZIP

`buildBulkZip` (in `bulk-convert-utils.ts`) uses `fflate` (`zipSync`/`strToU8`,
plus `unzipSync` re-exported for tests) to package `{ filename, svg }` pairs
into a `woojoo-svg-export.zip`. Only entries the caller passes in are
included -- the page filters to `selected && status === "done"` jobs before
calling it, so failed and unselected files are excluded by construction,
not by a flag inside the ZIP builder itself. Verified by round-tripping a
built ZIP through `unzipSync` in tests, including a Korean filename.

**Dependency added**: `fflate` (`^0.8.3`), zero transitive dependencies of
its own. No ZIP library existed in this project before (`docs/PROJECT.md`).
Bundle impact measured via `npm run build`: the main bundle grew from
388.27 KB (121.54 KB gzip) to 410.20 KB (129.39 KB gzip) after adding all of
Bulk's code, CSS, and `fflate` together (~7.85 KB gzip combined delta -- not
isolated to fflate alone, since Vite bundles the whole app into one chunk
here, the same way Extract Elements' page code already does; there is no
per-route code-splitting in this project to begin with).

## Memory strategy

- `convertBulkFile` returns only `{ svg, width, height }` -- the decoded
  `RasterSource`/`ImageData`/canvas from `loadRaster` is never stored
  anywhere past that function's own stack and is eligible for GC
  immediately after each job, regardless of batch size.
- Only one file's raster is ever being decoded by a given worker at a
  time; `BULK_CONCURRENCY` (2) bounds how many such decodes can be in
  flight across the whole batch, so 50 files are never held as decoded
  rasters simultaneously.
- Review-step thumbnails use `URL.createObjectURL(file)` (the browser
  renders/decodes only what it displays) rather than running the full
  conversion pipeline just to preview a file.
- Object URLs are revoked when a job is removed, when the list is cleared,
  and on page unmount (tracked in a `Map<jobId, url>` ref, diffed against
  the current job list on every jobs-state change).

## Error / retry behavior

A per-job failure is caught in the queue worker and recorded on that job
only (`status: "failed"`, `error: <message>`); every other job keeps
converting. "Retry" re-runs one job; "Retry Failed" resets every failed
job to `queued` and re-runs all of them. A job that's already `done` is
never reconverted by Convert All, Retry Failed, or a second Convert All
click (`isBulkJobPending` excludes `done`).

## UX notes

The intro text on `/bulk-convert` states the SVG-only scope directly
("Bulk conversion currently supports SVG output only." / "현재 일괄 변환은
SVG 저장만 지원합니다.") inside the existing intro paragraph -- not a
separate warning banner, no new styling, so it reads as plain scope
information rather than an alert.

Bulk deliberately has **no** post-download success popup/message (unlike
the single-image editor's own "Upload another image" notice, added
separately for that flow). Bulk already shows per-job status and an
overall progress counter continuously; a batch workflow with up to 50
files shouldn't be interrupted by a message after every individual
download or after the ZIP. A regression test
(`tests/rendered-html.test.mjs`) asserts the single converter's
success-notice state/copy never appears in `bulk-convert-page.tsx`.

## Limitations

- No per-image settings override in V1 (one shared `colorCount`/cleanup/
  anchor-simplification for the whole batch).
- No true CPU parallelism for the trace step (see Queue/concurrency above)
  -- this is a property of the shared engine being synchronous, not a Bulk
  shortcut.
- Cancel stops any not-yet-started queued job; a job already mid-conversion
  when Cancel is pressed still finishes (the synchronous trace step can't
  be interrupted mid-call). Already-completed SVGs are kept.
- No content-based automatic filenames/titles/keywords/CSV -- original
  filename only, as scoped.

## Release safety

Hidden at `/bulk-convert`, reachable only by direct URL -- not linked from
production navigation, the landing page, or any public CTA. No push, no
deploy, and no navigation change were made as part of this work.
