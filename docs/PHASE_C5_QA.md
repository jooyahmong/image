# Phase C.5 — Real Image QA

## Method

No browser-automation tool (Playwright/chromium-cli) was available in this
environment, so this could not be a real click-through of `/extract-elements`
in a browser. Instead, a Node script imported the actual, unmodified
`computeForegroundMask` and `detectFastPathElements` from
`app/extract-elements-utils.ts` (not a reimplementation) and ran them against
constructed proxy images for each required scenario, with a hand-written
PNG encoder (Node's built-in `zlib`, no new dependency) used only to save
the outputs for visual inspection. The dev server was also started and left
running at `http://localhost:5173/extract-elements` for manual browser
testing.

Proxy images are procedurally drawn (flat-color circles with a 1px
antialiased edge, to imitate a real exported asset's edge), not downloaded
clipart/illustration files — this repo has no varied sample-asset library.
Real user-supplied images should still be run through the actual page
before shipping; this round only validates the algorithm itself.

## Results

| # | Scenario | Background | Visible (ground truth) | Detected | Wrongly merged | Wrongly split | Missing | Background leaked in | Edge quality | Time | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 5 clipart pieces, well separated | Real alpha transparency | 5 | 5 | 0 | 0 | 0 | No | Clean, no visible fringe | mask 0.8ms + label 5.3ms ≈ 6.1ms | **Usable** |
| 2 | 4 illustration elements, well separated | Pure white (255,255,255) | 4 | 4 | 0 | 0 | 0 | No | Clean | mask 5.1ms + label 4.1ms ≈ 9.3ms | **Usable** |
| 3 | 3 elements | Cream (250,247,238) | 3 | 1 | 3→1 (everything, including background) | 0 | 0 | **Yes — total** | N/A: output is the original image with an opaque, non-transparent background | mask 0.3ms + label 4.3ms ≈ 4.6ms | **Fails** |
| 4a | 2 elements, 3px true gap | White | 2 | 2 | 0 | 0 | 0 | No | Clean | mask 3.0ms + label 0.2ms ≈ 3.2ms | **Usable** |
| 4b | 2 elements, 1px true gap | White | 2 | 1 | 1 pair | 0 | 0 | No | N/A (merged) | mask 0.8ms + label 0.3ms ≈ 1.1ms | **Fails** (expected at this extreme) |
| 5 | 2 overlapping template shapes | White | 2 | 1 | 1 pair | 0 | 0 | No | N/A (merged) | mask 0.7ms + label 0.2ms ≈ 0.9ms | **Fails** (documented limitation, confirmed) |
| 6 | 12 elements, well separated, 3-megapixel image | White | 12 | 12 | 0 | 0 | 0 | No | Clean | mask 136.5ms + label 29.3ms ≈ **165.8ms**, synchronous on the main thread | **Usable now, risky at scale** |

Every case's numbers and saved PNGs (per-element crops and a false-color
label map per scenario) are in the QA session's scratchpad and are not part
of this repo; the table above and the description below capture everything
load-bearing.

## What actually broke (visually confirmed, not just numeric)

**Cream background (#3) is a full failure, not a partial one.** The
false-color label map for this case is a single solid block — the near-white
flood fill never triggered at all, because cream's minimum channel value
(238) is just under the current "near-white" cutoff (240). The
"detected element" is the entire original image, still on its opaque cream
background — not a transparent cutout, not separated, not useful. This is
one of the five scenarios the task explicitly required to check, and it is
broken outright, not degraded.

**Touching/overlapping (#5) and a 1px gap (#4b) both merge into one
element**, confirmed visually (single-color blob spanning both shapes in the
label map) — consistent with the already-documented Fast Path limitation
(`docs/ELEMENT_DETECTION_SPIKE.md`), and now confirmed with a concrete
minimum: **~3px of true gap was enough, ~1px was not**, in this test.

**3-megapixel timing (#6) is fine in isolation but a real ceiling risk.**
166ms of blocking, synchronous main-thread work for one 2000×1500 image. The
feature accepts uploads up to 10 MB, which for a real photo can be tens of
megapixels — cost scales with pixel count, and nothing here yields to the
browser's event loop mid-computation, so a large upload would visibly freeze
the tab, not just feel a little slow.

## Judgment

1. **Can V1 ship on Fast Path alone?** Not as currently scoped. It is
   reliable for real alpha transparency and clean white backgrounds with
   elements that don't touch, which covers a real and common case (most
   flat clipart/sticker exports). But "near-white/cream background" is an
   explicit, required V1 category per `EXTRACT_ELEMENTS.md`, and it fails
   completely, not partially.
2. **Which image types should be officially supported?** Recommend
   formalizing exactly the categories that passed: real alpha transparency,
   or a background whose channels are all high and close together (i.e.
   genuinely near-white, not "off-white/cream/beige"), with elements
   separated by a few pixels or more and not touching or overlapping.
   Cream/beige backgrounds and touching/overlapping elements should be
   explicitly out of scope until addressed, not silently mishandled.
3. **Is AI extraction required for V1?** No. Neither failure found here is
   an "AI segmentation would have solved this" gap — the cream-background
   case is a Fast Path threshold bug (or an unresolved product tradeoff:
   loosening it risks misclassifying this product's own pale/pastel
   foreground artwork as background, since pastel presets are already part
   of the Image-to-SVG side of this product). Touching/overlapping is a
   structural limit of connectivity-based detection with or without AI-grade
   models unless a real segmentation model is added later. Fixing what QA
   found does not require AI.
4. **Should Phase D/E proceed as-is?** Not recommended yet. Suggest
   resolving, in order: (a) a deliberate decision + fix for near-white/cream
   support (not a blind threshold widen — see the pastel-artwork risk
   above), (b) whether to build the "not suited for automatic separation"
   fallback message now or keep deferring it, (c) whether detection needs to
   move off the main thread before the size ceiling is trusted at 10 MB.
   None of these three were implemented in this QA session by design (no
   code changes requested).

## Known Limitations of This QA Round Itself

- No real browser interaction was performed (no drag-and-drop, no real
  `<input type="file">`, no visual card-grid check) — only the algorithm
  functions were exercised directly, matching how the existing unit tests
  already do this.
- Test images are procedurally drawn proxies, not real downloaded
  clipart/illustration/template files. They faithfully test the structural
  properties the algorithm cares about (background type, gap size, overlap,
  antialiased edges) but not real-world texture, JPEG compression artifacts,
  or genuinely irregular hand-drawn shapes.
- Only one cream tone and one gap distance near the failure boundary were
  tested; the exact cream/near-white threshold boundary and the exact
  minimum safe gap were not swept across a range.
