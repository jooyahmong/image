# Smart Extract — Feasibility Spike

Status: **isolated technical spike, nothing shipped, nothing committed
alongside this document yet.** No production code was touched. No AI model
is integrated into `app/extract-elements-*`. Quick Extract and
Image-to-SVG are unmodified.

## 0. What actually happened in this spike (read this first)

The plan was to install `onnxruntime-node` in an isolated scratchpad
project (outside this repo) and run 1–2 candidate models against synthetic
overlapping-artwork images. The runtime install worked. **Getting an
actual model file did not**, for a reason worth recording precisely:

- `huggingface.co` (and its `hf.co` short domain, which redirects to it) was
  **unreachable from this environment on every attempt** — `curl` and
  PowerShell's `Invoke-WebRequest` (two different HTTP stacks) both got a
  TLS connection reset on every retry, including through an `hf-mirror.com`
  proxy that itself redirected back into a reset. This is where essentially
  every practical SAM/SAM2/MobileSAM/FastSAM ONNX export is hosted.
- `github.com`, `raw.githubusercontent.com`, `registry.npmjs.org`, and
  `cdn.jsdelivr.net` were all reachable normally.
- A GitHub-hosted mirror of MobileSAM's ONNX files
  (`akbartus/MobileSAM-in-the-Browser`) only contains the **decoder**
  (8.8 MB quantized) — the much larger ViT encoder isn't in that repo, so
  it isn't a complete, runnable substitute on its own.
- No complete SAM-family ONNX file could be obtained through any reachable
  host in the time available.

**This is treated as a spike-environment limitation, not a finding about
real users.** A real user's browser has no special reason to be blocked
from `huggingface.co` the way this sandboxed tool environment apparently
is — multiple existing third-party projects (cited throughout §2) already
run these exact models in ordinary browsers today. It is, however, a real
and reportable *operational* risk worth keeping in mind: if this product's
own infrastructure, CI, or a user's corporate/network environment ever
can't reach Hugging Face's CDN, a Smart Extract feature that lazy-loads a
model from there would fail for that user too. That risk is folded into
§5 and §8.

Given this, §2 below is a rigorous **desk comparison** grounded in each
project's own documentation, license file, and (where available) existing
third-party browser implementations — cited, not guessed. §3 reports
exactly what could and couldn't be verified hands-on. The judgment calls in
§4 are explicitly marked as informed-but-not-personally-confirmed where
that's the honest state of things.

## 1. Problem Definition

Target failure case: images where Quick Extract's connected-components
approach cannot separate anything meaningful because the elements touch,
overlap, or otherwise share connectivity with the background or each
other. Concretely, per the brief: people standing close together or
overlapping, food/props/decoration overlapping in a flat-lay template,
multiple objects in contact within one template, or any case where
background separation alone collapses the whole canvas into one component
(the exact failure mode `assessExtractionOutcome` in Quick Extract now
detects and reports as `unsupported` rather than guessing).

Goal, restated precisely: recover a mask **per visually distinct element,
using only pixels that are actually visible in the source image.** Not
regenerating occluded content — see `docs/SMART_EXTRACT.md` §4 for why that
(full reconstruction) is explicitly out of scope.

## 2. Candidate Comparison

| | **SAM** (ViT-B/H, Meta) | **SAM2** (hiera-tiny) | **MobileSAM** | **FastSAM-S** | EfficientSAM (flagged, not fully vetted) |
|---|---|---|---|---|---|
| ONNX size | ViT-B encoder alone is generally cited around 375 MB unquantized; ViT-H is larger still | encoder ~134 MB + decoder ~15 MB ≈ ~150 MB (SharpAI/sam2-hiera-tiny-onnx) | ViT-tiny encoder + small decoder, ≈40–50 MB combined quantized (per Phase C.5's earlier research and MobileSAM-ONNX-Sample) | **47.3 MB, one file** (qualcomm/FastSam-S.onnx) | Claimed smaller than SAM in its paper; no verified browser-ready ONNX size found this session |
| License | Apache 2.0 | Apache 2.0 | Apache 2.0 (MobileSAM-ONNX-Sample repo, Apache-2.0) | Apache 2.0 | Varies by checkpoint/backbone -- needs an explicit check before use, not assumed |
| Runs in-browser today? | Yes -- ONNX Runtime Web demos exist | Yes -- `webgpu-sam2`, Labelbox's `sam2-web` are public, working demos | Yes -- `akbartus/MobileSAM-in-the-Browser` is a public, working demo | Should run on the same `onnxruntime-web` stack as any YOLOv8-seg web demo; no public FastSAM-specific browser demo confirmed this session | Not confirmed |
| WebGPU | Yes, in the cited demos | Yes, cited demos target WebGPU specifically | Yes, with WASM fallback per its demo | Expected to work (standard onnxruntime-web execution providers); not demo-confirmed for FastSAM specifically | Not confirmed |
| WASM fallback | Yes, but slow for a ViT-scale encoder | Yes, same caveat | Yes -- this is MobileSAM's whole reason to exist (mobile-realistic even without WebGPU) | Should be fine -- YOLO-scale backbones are far cheaper on WASM than a ViT encoder | Not confirmed |
| **Automatic "everything" mode** | Not native -- needs an external grid-of-points sampler calling the decoder many times per image | Not native -- same promptable design as SAM | Not native -- same promptable design | **Native.** One forward pass returns all instance masks directly (YOLOv8-seg architecture) -- this is the one candidate that doesn't require building automatic mask generation myself | Not native (promptable, SAM-derived) |
| Prompt required? | Yes (point/box) | Yes | Yes | **No** | Yes |
| Fit for flower/ribbon/ornament/character/badge/abstract decorative art | Unproven -- trained on SA-1B natural photos | Unproven -- trained on SA-V (video/photos) | Unproven, same lineage as SAM | Unproven -- trained on natural-photo instance data (COCO-like); architecturally it looks for "an object," which flat vector-style decoration may or may not read as | Unproven |
| Init download | Hundreds of MB | ~150 MB | ~40-50 MB | 47.3 MB | Unverified |
| Memory footprint | High (large ViT activations) | High | Moderate | Moderate (single YOLO-scale backbone, no separate huge encoder) | Unverified |
| Desktop realism | Workable with WebGPU per demos | Workable with WebGPU per demos | Workable | Should be workable (lighter than the SAM family) | Unverified |
| iPad realism | Unlikely (size + compute) | Unlikely | Most plausible of the SAM-family for a tablet, still promptable-only | More plausible than any SAM-family option given its size and single-pass design | Unverified |
| Mobile-phone realism | Unrealistic | Unrealistic | Uncertain, likely marginal | Uncertain but the best-positioned of these candidates; needs a real benchmark, not assumed | Unverified |

Sources for the figures and claims above: `qualcomm/FastSam-S` (Hugging
Face model card, sizes seen before the network block), `SharpAI/sam2-hiera-tiny-onnx`,
`Acly/MobileSAM` and `Kazuhito00/MobileSAM-ONNX-Sample` (Hugging
Face/GitHub), and the public demo repositories `akbartus/MobileSAM-in-the-Browser`,
`lucasgelfond/webgpu-sam2`, and the `browser-visual-search` npm package
(FastSAM + CLIP + onnxruntime-web) found on the npm registry during this
spike. None of these were re-verified by running them myself this
session -- they are cited as third-party evidence that the underlying
browser-execution claims are realistic, not as something this spike
reproduced firsthand.

**Do not conclude from a general-purpose semantic segmenter or a
COCO-class detector alone** -- none of the above are COCO-fixed-class
detectors; all five are class-agnostic (SAM family) or single-class
"is this an object" detectors (FastSAM), which is the right category for
"flower / ribbon / ornament / character / badge / abstract decorative
object" since none of those are COCO classes.

## 3. What Was Actually Tested

- `npm install onnxruntime-node` in an isolated scratchpad project
  (outside this repository, own `package.json`): **succeeded**, prebuilt
  binaries, no compilation step, fast install. This confirms the Node-side
  ONNX runtime tooling itself is usable in this kind of environment --
  it says nothing about in-browser `onnxruntime-web`, which is what the
  real product would actually ship, or about any model's accuracy.
- Downloading `FastSam-S.onnx` (qualcomm/FastSam-S, 47.3 MB) from
  Hugging Face: **failed** -- connection reset on every attempt, from two
  different HTTP clients, including via a mirror domain. See §0.
- Downloading MobileSAM's encoder+decoder pair from a GitHub-hosted demo
  repo: **partially available** (decoder only, 8.8 MB quantized); the
  encoder was not present in that repo and no other reachable host had it.
- No inference was run. No mask images, timing numbers, or accuracy
  observations exist from this spike -- there is nothing to attach as
  before/after screenshots or artifacts, and none were fabricated.

## 4. Core Judgment

**A. Is Smart Extract accurate enough on real overlapping templates?**
Not established either way. No candidate model's accuracy on this
product's actual content (flat, vector-style decorative art) was measured
here or found measured anywhere in the sources reviewed -- every
benchmark found is on natural photos. This is the single largest open
question and should be the first thing resolved with real template images
before any further investment, per `docs/SMART_EXTRACT.md` §11 step 1-2.

**B. Automatic mask generation alone, or does it need interactive
(click/box) refinement?**
Leaning toward **needing refinement**, for two independent reasons: (1)
accuracy on this product's content is unproven, so a human check-and-fix
step is the responsible default until proven otherwise; (2) of the
candidates surveyed, only FastSAM has a native automatic "everything"
mode -- the entire rest of the SAM family is prompt-native by design,
which is itself a signal that "click to specify what you want" is the
mode these models are actually built and tuned for, not a workaround.

**C. Is semi-automatic (auto-suggest, then user clicks to confirm/select)
more realistic?**
Yes, and it maps cleanly onto the two model families rather than treating
them as competitors: **FastSAM's native "everything" pass generates the
initial candidate masks automatically**, and **SAM2/MobileSAM's native
point-prompt design is exactly the right tool for "the user clicks a
specific object to isolate or fix it."** A two-stage pipeline (fast
automatic candidates, then prompt-based refinement on demand) uses each
model family for what it's actually designed to do, instead of forcing
one model to do both jobs.

**D. If fully automatic is too slow or over-segments, what's the
realistic V1 UX?**
The exact flow sketched in the task brief, and consistent with
`docs/SMART_EXTRACT.md` §12's UI sketch:

```
Quick Extract (default, free, instant)
   -> fails / flagged unsupported / user wants more
Smart Extract (Beta, explicit opt-in)
   -> automatic candidate masks generated (progress shown, not instant)
   -> user reviews, keeps/discards/click-refines candidates
   -> confirmed selections become the final assets
```

Never present raw automatic output as a finished result without a review
step -- given the unresolved accuracy question in (A), showing unreviewed
masks as final assets is the one thing this spike would actively
recommend against.

## 5. Cost / Privacy Judgment

- **Fully local Smart Extract:** Plausible for FastSAM-S specifically
  (single 47.3 MB file, no separate huge ViT encoder) and for MobileSAM
  (the one SAM-family model explicitly designed for this). Full SAM or
  SAM2 at any real quality tier is not realistic purely client-side today
  -- the download and compute cost are too high for a "fast, simple"
  product per `docs/PROJECT.md`.
- **Lazy-load + browser cache:** Realistic pattern (same one recommended
  in `docs/ELEMENT_DETECTION_SPIKE.md`) -- fetch on first Smart Extract
  use, cache via the browser's Cache Storage/IndexedDB so repeat use is
  free. This does not remove the first-use cost, and this spike's own §0
  is a reminder that the fetch has a real dependency on the model host
  being reachable from the user's network.
- **Is a 40-50 MB download acceptable UX?** Only with clear, upfront
  disclosure ("this downloads about 45 MB and may take a moment") and only
  as an explicit opt-in for Smart Extract specifically -- never silently,
  and never for Quick Extract, which must stay instant.
- **iPad/mobile realism:** FastSAM-S and MobileSAM are the only candidates
  worth taking seriously here, and neither has a real on-device benchmark
  from this spike or from the sources reviewed. Treat mobile support as
  unproven, not assumed, until measured.
- **Does this need a server?** Not proven necessary by this spike, but not
  ruled out either -- if real-template accuracy testing (§4A) shows the
  smaller local-friendly models (FastSAM-S, MobileSAM) perform poorly on
  this product's actual decorative art, a server running a larger model
  (full SAM2, or a model fine-tuned on flat design assets) becomes the
  fallback reason, purely on accuracy grounds, not on device-capability
  grounds. Per the task's instruction, no server was built or even
  prototyped this session; this is recorded as a conditional, not a plan.

## 6. Recommended V1 Smart Extract UX

The two-stage flow in §4D: Quick Extract stays the default; Smart Extract
is a separate, explicitly-opt-in beta that runs FastSAM-class automatic
candidate generation first, then lets the user confirm or click-refine
with a SAM2/MobileSAM-class prompt model before anything is treated as a
final asset. Both model downloads should be disclosed and cached, and
Quick Extract must never regress or wait on any of this.

## 7. Recommended Next Implementation Step

1. **Resolve model access, not model choice, first.** Whoever continues
   this (in an environment that can actually reach Hugging Face, or by
   sourcing weights through a mirror that's confirmed reachable) needs to
   get one real model file and run it before anything else here can move
   from "desk research" to "measured."
2. **Test FastSAM-S's automatic mode against 3-5 real overlapping
   templates** (not synthetic proxies this time -- real decorative
   art/stickers/badges) and honestly score it against the failure modes
   the task named: over-segmentation, wrongly-merged instances, and
   whether "an element" in this product's sense is even something the
   model recognizes as "an object" at all.
3. **Only if that clears a real accuracy bar**, prototype the click-refine
   step with MobileSAM (smallest, most mobile-realistic SAM-family
   option) against the same test images.
4. Decide local vs. server from that data, not from this document's
   size/license table alone.
5. Feed the result back into `docs/SMART_EXTRACT.md` §7/§11 as measured
   evidence, replacing this spike's "unproven" caveats with real numbers.

## 8. Rejected / Deferred Approaches, and Why

- **Full SAM or SAM2 (non-tiny) as the primary model:** rejected for V1 on
  size/cost alone (hundreds of MB to ~150 MB); not ruled out forever as a
  server-side option if smaller models fail the accuracy bar.
- **Building automatic grid-prompt mask generation for SAM2/MobileSAM
  myself:** deferred, not rejected -- FastSAM's native "everything" mode
  covers the same need with far less new code to write and maintain, so it
  should be tried first; a hand-built grid-prompt sampler is real
  engineering effort that isn't justified until FastSAM is shown to be
  insufficient.
- **Full asset reconstruction (generative completion of occluded
  content):** out of scope per `docs/SMART_EXTRACT.md` §4 -- not
  re-litigated here.
- **Treating this as solvable with COCO-class object detectors:** rejected
  per the task's own instruction -- this product's content (flower/ribbon/
  ornament/badge/abstract decoration) doesn't fit fixed COCO classes, so a
  class-agnostic or single-class "is this an object" approach (SAM family,
  FastSAM) is the right category, not a closed-vocabulary detector.
- **Actually integrating any model into the app this session:** correctly
  out of scope per the task's own instructions -- not attempted.

## Known Limitations of This Spike Document

- No hands-on accuracy result exists yet for any candidate on this
  product's actual content -- every accuracy judgment above is "unproven"
  by design, not a soft-pedaled "probably fine."
- The network constraint in §0 means this spike is desk research plus
  license/size/architecture facts, not a benchmark. Treat §2's comparison
  as a starting point for the next attempt, not a final scorecard.
- EfficientSAM was flagged but not thoroughly vetted (license terms can
  vary by checkpoint) -- do not treat it as pre-cleared for use without a
  fresh check.
