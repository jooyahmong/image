# Smart Extract — Planning

Status: **planning only**. No AI pipeline is implemented. Nothing here is
wired into the app. This document exists to separate a real, harder user
need from what Fast Path (now called **Quick Extract**) can actually do,
and to decide a direction before spending engineering time on it.

## 1. User Goal

The user need this document is scoped to: **take one uploaded template
image whose visual elements overlap or touch each other, and get each
element back as its own separated asset** — not just the elements that
already happen to sit apart on a clean background.

This is a materially different problem from what Quick Extract solves.
Phase C.5/C.6 QA confirmed Quick Extract is reliable for flat artwork on a
uniform background with elements that don't touch, and confirmed — not as
a bug, but as a structural limit of connectivity-based detection — that
touching or overlapping elements merge into one. Real template asset
sheets (stickers, badges, decorative layers stacked on a background) are
exactly the case that triggers this limit, and per the product's own
target audience (WOOJOO Stock-style template/asset sellers, per
`docs/PROJECT.md`), that case is common, not an edge case.

## 2. Quick Extract vs. Smart Extract

| | Quick Extract (shipped, Phase C.6) | Smart Extract (this document) |
|---|---|---|
| Method | Background-color estimation + 8-connected pixel labeling | Instance/object segmentation (a real model) |
| Cost | Free, local, instant | Unknown yet — likely real compute cost, possibly a backend |
| Works on | Transparent, white/off-white/cream/beige backgrounds; elements that don't touch | Same, plus (goal) elements that touch or overlap |
| Fails on | Touching/overlapping elements; busy/photographic backgrounds | TBD — depends on chosen model and its training data |
| Status | Shipped behind hidden `/extract-elements` | Not built. Planning only |

They are not one feature with two quality settings — they're two different
techniques with different failure modes, different costs, and (likely)
different privacy/pricing implications. Framing them as two distinct,
separately-labeled paths (see §9) keeps Quick Extract's "free, local,
private, instant" promise intact regardless of what Smart Extract turns
out to require.

## 3. Supported / Unsupported Image Types

**Quick Extract, as shipped:**
- Supported: real alpha transparency, or a uniform white/off-white/cream/
  light-beige background, with elements separated by roughly 3px or more.
- Unsupported (explicit `unsupported` outcome, not a silent bad result):
  photo-like/non-uniform backgrounds, a single dominant component covering
  most of the canvas, touching/overlapping elements (returns 1 merged
  element, not an `unsupported` outcome — this is a known, documented
  behavior, not flagged as unsupported, since it is a valid, if limited,
  result).

**Smart Extract, hoped-for scope (not yet validated):**
- Target: the same content Quick Extract already handles, plus elements
  that touch or visually overlap, on the same range of simple backgrounds.
- Almost certainly still unsupported even for Smart Extract: dense photo
  collages, deeply layered designs with many stacked semi-transparent
  effects, and anything requiring the *hidden* pixels of an occluded
  object to be invented (see §4) — that is a different, harder capability
  this document deliberately does not scope in.

## 4. The Overlapping-Template Problem, Defined

"Separate overlapping elements" can mean two different things, and mixing
them up is the single biggest risk in scoping this feature:

**Visible-only separation.** Two elements overlap; the one on top is fully
intact, the one behind has a bite missing where the other one covers it.
Extraction returns exactly what's actually visible in the source pixels —
the back element comes out with a notch, not a deleted region. This is
achievable with mature instance/panoptic segmentation techniques (see §6)
today. It never invents a pixel that wasn't in the original image.

**Full asset reconstruction.** The same scenario, but the back element
comes out *complete*, as if the front element weren't there — including
the part that was never actually visible in the source image. This
requires either the original, unflattened layers (which a raster
PNG/JPG/WEBP upload does not have — see `docs/EXTRACT_ELEMENTS.md`'s
"Implementation Boundary") or **generative inference** (image completion /
amodal segmentation) to guess what the hidden pixels probably looked like.
That guess can be wrong — it can fabricate a shape, color, or detail the
user's actual asset never had, and present it as if it were real.

**Recommendation: Smart Extract should target visible-only separation.**
It solves the concrete pain point ("give me the overlapping elements as
separate assets") without the trust risk of inventing content the user
never made. Full reconstruction is a separate, much larger, and riskier
capability that should get its own explicit decision later if ever pursued
— it is out of scope here and should stay out of scope until specifically
requested and budgeted for.

## 5. Candidate Architectures

All candidates below solve *visible-only instance segmentation*, not
reconstruction.

1. **Promptable segmentation model in "segment everything" mode** — SAM /
   SAM2 / MobileSAM class models, run with a grid of sampled point prompts
   (since there's no user click in an automatic flow), then de-duplicated
   into per-instance masks. Mature, well-documented, multiple existing
   browser and server implementations. Not designed for flat graphic-design
   content specifically — trained mostly on natural photos, so quality on
   flat vector-style template art is an open question, not a guarantee.
2. **A general instance/panoptic segmentation model** (e.g. a Mask R-CNN or
   newer transformer-based segmentation model) — could, in principle, be
   fine-tuned on flat design assets for better accuracy on this product's
   actual content, at the cost of needing a labeled dataset and a real
   training/maintenance effort this team does not currently have set up.
3. **A hybrid: Quick Extract's connectivity detector as a first pass, a
   segmentation model only invoked for the components it flags as
   ambiguous** (e.g. a component whose shape or size looks like it could be
   two merged elements). Cheaper on average than running a heavy model on
   every upload, but the "is this ambiguous" heuristic is itself new,
   unproven logic that would need its own validation.

No candidate here avoids needing a real segmentation model; the open
questions are *where it runs* (§7) and *how good it is on this product's
actual content* (§10), not *whether a model is needed at all* — Quick
Extract's pixel-connectivity approach cannot be extended into this
territory no matter how it's tuned, which is the same conclusion Phase
C.5/C.6 QA already reached and recorded in `docs/EXTRACT_ELEMENTS.md`.

## 6. Local vs. Server vs. Hybrid

| | Local (browser, WASM/WebGPU) | Server (API/backend) | Hybrid |
|---|---|---|---|
| Cost | Free (device compute) | Real, ongoing inference cost per image | Cost only for the Smart Extract path |
| Privacy | Matches existing "nothing is uploaded" promise | Requires uploading the image somewhere — a real change from today's zero-backend architecture | Quick Extract stays fully private; Smart Extract needs explicit, honest consent copy if it uploads anything |
| Quality/latency ceiling | Bounded by what fits in a browser download and runs on a user's device; "segment everything" mode is many forward passes — likely several seconds to tens of seconds, worse on lower-end/mobile hardware, worse still on non-WebGPU browsers (Safari/iOS gaps) | Can run a larger, more accurate model with predictable latency regardless of the user's device | Best-available quality only where actually needed |
| Infra | None needed — matches today's static-site architecture | New: this product currently has **no backend, API, or auth at all** (`docs/PROJECT.md`); this is a first for the product, not an incremental change | Still introduces a backend, just for one feature |
| Fits current decisions? | Yes, cleanly | No — conflicts with "no backend/API/paid API" and "V1 is free, no subscriptions/credits" (`docs/DECISIONS.md`) unless explicitly re-scoped as a separate, later, possibly-paid feature | Only if scoped as an explicit opt-in, clearly separate from V1's free Quick Extract |

**There is no local option that avoids the "automatic segment-everything is
slow" problem** — that's inherent to the technique, not to where it runs.
A server can at least make it fast and consistent; a local WASM/WebGPU
model makes it free and private but slow and hardware-dependent, and
still needs a real fallback for browsers without WebGPU.

## 7. Recommended Direction

**Hybrid, with Smart Extract explicitly separated from V1's free scope.**

- Quick Extract stays exactly as it is: free, local, private, always on,
  the default. No regression to it, ever, from this work.
- Smart Extract is planned as a distinct, later, explicitly opt-in path.
  If it needs a server, that is a deliberate, disclosed exception to
  today's "nothing is uploaded" promise — scoped to Smart Extract only,
  with its own consent copy, not silently expanded to the rest of the app.
- Do not commit yet to local-only or server-only. Validate on real template
  images first (§10) before locking in an architecture neither measured nor
  budgeted.

## 8. Conflict With Free Operation

Real, and not fully resolvable by engineering choices alone:

- `docs/DECISIONS.md` currently states V1 has no backend, no paid API, no
  subscriptions or credits, and monetization is donation-only. A
  server-hosted segmentation model has a real per-image compute cost that
  a purely voluntary coffee-donation model is unlikely to cover at any
  meaningful usage volume.
- A local model avoids that specific conflict but reintroduces the
  bundle-size and latency problems already documented in
  `docs/ELEMENT_DETECTION_SPIKE.md` (a "small" segmentation model is still
  ~40 MB+, and automatic multi-point inference is slow even then).
- Conclusion: Smart Extract, if it needs a server, should not ship as a
  free, unlimited, always-on V1 feature. It needs its own monetization or
  usage-limiting decision before broad release — this is a product
  decision, not something this planning pass can resolve unilaterally.

## 9. Future Paid Feature Candidate

Smart Extract is a reasonable candidate for a future paid tier or
usage-limited beta specifically because its cost structure (real inference
cost, possibly per-image) is fundamentally different from every other
WOOJOO Image feature today, which are all free because they cost nothing
beyond the user's own device. This document does not decide pricing — it
flags that *if* Smart Extract needs a server, the free-donation model
alone is unlikely to sustain it, and a paid or rate-limited framing should
be considered alongside the technical design, not bolted on afterward.

## 10. Technical Risks

- **Unproven accuracy on this product's actual content.** Every candidate
  model is benchmarked on natural photos. Flat, vector-style template
  graphics (the WOOJOO Image / WOOJOO Stock target content) are a
  different distribution. This needs to be measured on real template
  images before committing to a model or an architecture — Phase C.5/C.6's
  own QA process (real production code against real and synthetic test
  images, findings recorded honestly) is the model to repeat here, not
  skip.
- **"Segment everything" is inherently slow**, independent of local vs.
  server framing (see §6) — this shapes UX expectations (a progress state,
  not an instant result) regardless of where it runs.
- **Privacy/brand risk if a server path is added carelessly.** "Private by
  design" is a headline claim on the live site today (`app/landing-page.tsx`).
  Any server-uploading feature needs explicit, honest, separate consent
  copy so it doesn't quietly contradict that promise for the rest of the
  product.
- **Reconstruction creep.** The most likely way this goes wrong is scope
  drifting from "show me what's visible, separated" into "make me the
  complete hidden shape" without a deliberate decision to do so (see §4).
  That drift should be treated as a stop-and-decide moment, not something
  to slide into while chasing better demo results.
- **New infrastructure class for this product.** A server path is not an
  incremental change — it's the first backend this product has ever had.
  That carries ordinary new-infra risk (ops, uptime, cost monitoring) on
  top of the ML-specific risks above.

## 11. Recommended Development Order

1. **Validate the need with real images before building anything.** Run a
   handful of real overlapping/touching template files (the same "Real-user
   QA" step already pending from Phase C.6) through Quick Extract to see
   exactly how often and how badly the merge behavior actually hurts real
   users, not just the synthetic worst case already confirmed in QA.
2. **Feasibility-spike a segmentation model against real template images
   specifically** (not natural-photo benchmarks) to get real accuracy
   numbers on this product's actual content, before choosing local, server,
   or hybrid.
3. **Decide local vs. server vs. hybrid from that data**, not from
   assumption — §6 lays out the trade-offs, but the right call depends on
   measured accuracy and latency this planning pass doesn't have yet.
4. **Settle the monetization/cost question (§8, §9) before broad release**
   if the chosen path needs a server — not after users are already relying
   on a free unlimited feature that can't be sustained.
5. **Ship Smart Extract as an explicit, separately-labeled, opt-in beta**
   (see §12), never silently replacing or degrading Quick Extract.
6. Continue Phase D/E (rename, exclude, export) for Quick Extract in
   parallel — that work doesn't depend on any Smart Extract decision and
   shouldn't wait on it.

## 12. Proposed UI Structure (description only, not implemented)

Within the existing hidden `/extract-elements` shell, the Step 1 "Upload"
surface could offer two clearly distinct paths instead of one:

```
STEP 1 — Choose a method
┌───────────────────────────┐  ┌───────────────────────────┐
│ Quick Extract              │  │ Smart Extract (Beta)       │
│ Free · Local · Instant     │  │ Handles overlapping        │
│ Best for: separated flat   │  │ elements too (visible parts│
│ elements on a plain/       │  │ only). May take longer and │
│ transparent background     │  │ may leave your device.     │
│ [ Use Quick Extract ]      │  │ [ Try Smart Extract ]       │
└───────────────────────────┘  └───────────────────────────┘
```

Smart Extract's card should say plainly, before the user commits to it,
whatever is true once it's built: that it may take longer, and — if a
server path is chosen — that the image leaves the device, unlike every
other WOOJOO Image feature. Nothing here is implemented; this is only the
shape a future UI could take once the underlying pipeline decision is
made.
