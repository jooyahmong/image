# Element Detection: Architecture and AI Feasibility Spike

## Architecture Boundary (model-agnostic by construction)

The Review UI and everything downstream only depend on one call:

```ts
detectExtractElements(file: File): Promise<ExtractedElement[]>
// ExtractedElement = { id, x, y, width, height, area, previewUrl }
```

`app/extract-elements-page.tsx` never touches pixels, masks, or a specific
detector. A future backend (a local model, a remote API) only needs to
resolve to the same `ExtractedElement[]` shape; the page, the selection
state, and the card grid do not change. This is the actual "not tied to one
model" boundary — a formal interface/registry was skipped for now since
there is only one implementation; adding that ceremony before a second
backend exists would be speculative.

Inside `app/extract-elements-utils.ts`, the boundary is also kept between:
- Pure, Node-testable pixel math (`computeForegroundMask`, `detectFastPathElements`).
- Browser-only I/O (`decodeImageFileToRasterSource`, `renderElementPreview`), which need a real `canvas`/`createImageBitmap`.

## Fast Path (implemented this session)

1. **Background detection.** If the source has real alpha transparency, that
   wins outright. Otherwise, flood-fill near-white pixels inward from the
   image border (8-connected). This drops a white/near-white canvas around
   the artwork while keeping a white highlight that's fully enclosed inside
   a shape (it's never connected to the border through other near-white
   pixels).
2. **Connected components.** 8-connected labeling over the resulting
   foreground mask, with a dust-area cutoff and padded bounding boxes — the
   same shape as the existing Image-to-SVG disconnected-object detector in
   `vector-utils.ts` (`getSeparateObjectBounds`), reimplemented separately
   because it runs on raw RGBA pixels here rather than a palette-reduced
   `VectorResult`.
3. **Preview.** Each component is cropped to its padded bbox and redrawn to
   its own canvas, with alpha zeroed for any pixel that belongs to a
   different component or the background — a true per-pixel cutout, not a
   naive rectangular crop.

Zero new dependencies. Bundle impact: JS 371.07 KB → 377.10 KB gzipped
(115.47 KB → 117.88 KB), CSS +2.7 KB — noise, not a real cost.

## AI Segmentation Candidates (feasibility spike only — nothing shipped)

Per the task's priority, this is research to decide *if and when* to invest,
not a production implementation.

| Candidate | Browser path | Size | Notes |
|---|---|---|---|
| **SAM (ViT-H/B), Meta** | ONNX Runtime Web (WASM/WebGPU) | Hundreds of MB even quantized (ViT-B alone is generally cited around 375 MB unquantized) | Far too large to fetch client-side for a casual feature. |
| **SAM2** | ONNX Runtime Web / WebGPU (community ports, e.g. `webgpu-sam2`) | Smaller than SAM but still a multi-hundred-MB class model in practice | Actively demoed running fully client-side, but no compact browser-first quantized default yet. |
| **MobileSAM** | ONNX Runtime Web, WebGPU with WASM fallback (demoed in `MobileSAM-in-the-Browser`) | ~40 MB quantized | Smallest practical option found. Still ~100x the entire current JS bundle. |
| **Transformers.js** | Runs ONNX models (WASM `q8` default, WebGPU `fp16`/`fp32`) | Model-dependent; small general models land around 23 MB quantized, larger architectures exceed 100 MB | It's a runtime, not a model — it can load a SAM/MobileSAM checkpoint, but doesn't shrink the underlying weights. |

Shared, important caveat: **SAM-family models are promptable, not automatic.**
They segment one region per point/box prompt. Turning that into "detect
every element in this image" needs an automatic mask-generation pass (a grid
of sampled points, one forward pass per point, then de-duplication) — this
is meaningfully slower than a single click-to-segment demo and is usually
run offline/server-side, not tuned for snappy client-side UX.

**Browser compatibility:** WebGPU has been on by default in Chrome/Edge
since v113 desktop (Chrome 121 on Android), so a WebGPU-first path excludes
a real slice of users up front; Safari/iOS support is still behind and
inconsistent, so any ship plan needs a WASM fallback path, and WASM
inference for a ViT-scale encoder is slow (multi-second, worse on mobile).

**Verdict:** No AI backend is worth wiring into the main bundle or the
default flow yet. If pursued later, it should be:
- An explicit, opt-in action ("Try AI detection — downloads ~40 MB"), never
  automatic on upload.
- Gated behind a WebGPU capability check with a clear fallback message
  instead of a silent slow WASM run.
- Implemented as a second function that returns `ExtractedElement[]`, so the
  Review UI needs no changes.

Sources consulted: MobileSAM-in-the-Browser and webgpu-sam2 demos, the
Transformers.js / Xenova docs, and Ultralytics' MobileSAM docs (see chat
history for links; not vendored here since figures can drift and should be
re-checked before any real implementation decision).

## Known Limitations of the Shipped Fast Path

- Needs a clean transparent/white/near-white background; elements that
  touch or overlap, or sit on a photo/textured background, are not
  separated (they merge into one connected component or aren't detected).
- No text-vs-graphic distinction yet — text pixels are treated like any
  other foreground. `EXTRACT_ELEMENTS.md` asks for this to stay separable
  for later, which the pure mask/label split supports, but no actual
  text detection exists.
- No edge feathering on the near-white path: the alpha cutoff is a hard
  threshold, so a soft/anti-aliased source edge can look slightly clipped
  or keep a faint light fringe. Real alpha-channel sources are unaffected.
- Detection is capped at 40 elements per image as a sanity limit; busy or
  photographic images can hit that cap or produce many small, low-value
  regions.
- Filenames are placeholders ("Element 1" / "요소 1"); content-based naming
  is Phase D, not built.
- Rename and Exclude/remove are not implemented — this session's scope was
  Select / Deselect / Select all / Deselect all only.
- Export (PNG/JPG/SVG/CSV, ZIP) is not wired yet.
- No real-browser (Playwright/Chromium) verification was available in this
  environment. Verification here is Node unit tests against mocked
  `canvas`/`createImageBitmap`, `npm run typecheck`, `npm run build`,
  `npm run lint`, and an HTTP smoke check that the dev server serves
  `/extract-elements`. Manual verification of drag-drop, real image
  decoding, and the card grid in an actual browser is still needed.

## Recommended Next Phase

Phase D from `docs/CURRENT_TASK.md`: real filenames stay placeholder-only
until content-based naming is decided, but rename and exclude/remove are
small, self-contained additions to the existing card grid and would close
out the full Review spec in `EXTRACT_ELEMENTS.md` section C. After that,
Phase E (SVG export reuse) is the next natural step since the fast path
already produces a clean per-element transparent raster to feed into it.
