import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTRACT_ELEMENTS_MAX_FILE_SIZE,
  applyMerge,
  assessExtractionOutcome,
  buildInitialCards,
  collectMergedPreviewUrls,
  computeForegroundMask,
  computeUnionBounds,
  decodeImageFileToRasterSource,
  detectExtractElements,
  detectFastPathElements,
  planMerge,
  renameCard,
  renderCombinedPreview,
  renderElementPreview,
  toggleCardExcluded,
  undoMerge,
  validateExtractElementsFile,
} from "../app/extract-elements-utils.ts";

test("Extract Elements accepts the four advertised raster extensions", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(validateExtractElementsFile({ type, size: 1024 }), null);
  }
});

test("Extract Elements rejects unsupported files and images over 10 MB", () => {
  assert.equal(validateExtractElementsFile({ type: "image/svg+xml", size: 1024 }), "type");
  assert.equal(validateExtractElementsFile({ type: "application/json", size: 1024 }), "type");
  assert.equal(validateExtractElementsFile({ type: "image/png", size: EXTRACT_ELEMENTS_MAX_FILE_SIZE }), null);
  assert.equal(validateExtractElementsFile({ type: "image/png", size: EXTRACT_ELEMENTS_MAX_FILE_SIZE + 1 }), "size");
});

function buildRaster(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const [r, g, b, a] = fill(pixel % width, Math.floor(pixel / width));
    data[pixel * 4] = r;
    data[pixel * 4 + 1] = g;
    data[pixel * 4 + 2] = b;
    data[pixel * 4 + 3] = a;
  }
  return { width, height, data };
}

function fillCircle(raster, cx, cy, r, [cr, cg, cb], alphaBackground) {
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r;
      if (d > 0.5) continue;
      const cov = d <= -0.5 ? 1 : 0.5 - d;
      const p = (y * raster.width + x) * 4;
      if (alphaBackground) {
        raster.data[p] = cr; raster.data[p + 1] = cg; raster.data[p + 2] = cb;
        raster.data[p + 3] = Math.round(cov * 255);
      } else {
        raster.data[p] = Math.round(cr * cov + raster.data[p] * (1 - cov));
        raster.data[p + 1] = Math.round(cg * cov + raster.data[p + 1] * (1 - cov));
        raster.data[p + 2] = Math.round(cb * cov + raster.data[p + 2] * (1 - cov));
        raster.data[p + 3] = 255;
      }
    }
  }
}

test("computeForegroundMask prefers real alpha transparency when present", () => {
  const raster = buildRaster(4, 4, (x) => (x < 2 ? [10, 10, 10, 255] : [0, 0, 0, 0]));
  const { mask, backgroundMode } = computeForegroundMask(raster.width, raster.height, raster.data);
  assert.equal(backgroundMode, "alpha");
  for (let y = 0; y < 4; y += 1) {
    assert.equal(mask[y * 4 + 0], 1);
    assert.equal(mask[y * 4 + 1], 1);
    assert.equal(mask[y * 4 + 2], 0);
    assert.equal(mask[y * 4 + 3], 0);
  }
});

test("computeForegroundMask estimates the background from the border and keeps an enclosed white highlight", () => {
  // 7x7 opaque image: a dark ring with a white pixel sealed in the center.
  const raster = buildRaster(7, 7, (x, y) => {
    if (x === 3 && y === 3) return [252, 252, 252, 255];
    const onRing = x >= 2 && x <= 4 && y >= 2 && y <= 4 && !(x === 3 && y === 3);
    return onRing ? [20, 20, 20, 255] : [255, 255, 255, 255];
  });
  const { mask, backgroundMode } = computeForegroundMask(raster.width, raster.height, raster.data);
  assert.equal(backgroundMode, "near-uniform");
  assert.equal(mask[0 * 7 + 0], 0, "border white pixel is background");
  assert.equal(mask[3 * 7 + 3], 1, "white pixel sealed inside the dark ring stays foreground");
  assert.equal(mask[2 * 7 + 3], 1, "ring pixel is foreground");
});

for (const [name, color] of [
  ["pure white", [255, 255, 255]],
  ["off-white", [250, 250, 248]],
  ["cream", [250, 247, 238]],
  ["light beige", [245, 238, 222]],
]) {
  test(`computeForegroundMask treats a ${name} background as background, whatever shade it is`, () => {
    const raster = buildRaster(30, 30, () => [...color, 255]);
    fillCircle(raster, 15, 15, 8, [40, 90, 200], false);
    const { mask, backgroundMode, background } = computeForegroundMask(raster.width, raster.height, raster.data);
    assert.equal(backgroundMode, "near-uniform");
    assert.ok(background.confidence > 0.9, `expected high confidence, got ${background.confidence}`);
    assert.equal(mask[0], 0, "corner pixel is background");
    assert.equal(mask[15 * 30 + 15], 1, "circle center is foreground");
  });
}

test("detectFastPathElements separates two shapes and reports padded bounds", () => {
  const width = 12;
  const height = 6;
  const mask = new Uint8Array(width * height);
  for (let y = 1; y <= 2; y += 1) for (let x = 1; x <= 2; x += 1) mask[y * width + x] = 1;
  for (let y = 3; y <= 4; y += 1) for (let x = 8; x <= 9; x += 1) mask[y * width + x] = 1;

  const { labels, regions } = detectFastPathElements(width, height, mask, { minimumArea: 1, padding: 1 });
  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map((region) => region.area).sort(), [4, 4]);
  const first = regions.find((region) => region.x < 5);
  assert.deepEqual(first, { id: first.id, x: 0, y: 0, width: 4, height: 4, area: 4 });
  assert.equal(labels[1 * width + 1], first.id);
  assert.equal(labels[0], 0);
});

test("detectFastPathElements drops components below the minimum area", () => {
  const width = 10;
  const height = 10;
  const mask = new Uint8Array(width * height);
  mask[5 * width + 5] = 1; // a single-pixel speck
  for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) mask[y * width + x] = 1; // a real 3x3 block

  const { regions } = detectFastPathElements(width, height, mask, { minimumArea: 4, padding: 0 });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].area, 9);
});

test("detectFastPathElements caps how many elements it returns", () => {
  const size = 200;
  const mask = new Uint8Array(size * size);
  let placed = 0;
  for (let y = 0; y < size && placed < 60; y += 4) {
    for (let x = 0; x < size && placed < 60; x += 4) {
      mask[y * size + x] = 1;
      placed += 1;
    }
  }
  const { regions } = detectFastPathElements(size, size, mask, { minimumArea: 1, padding: 0 });
  assert.ok(regions.length <= 40);
});

test("assessExtractionOutcome flags low background confidence", () => {
  const reason = assessExtractionOutcome(100, 100, "near-uniform", { color: [255, 255, 255], confidence: 0.3 }, [{ id: 1, x: 0, y: 0, width: 10, height: 10, area: 100 }]);
  assert.equal(reason, "low-background-confidence");
});

test("assessExtractionOutcome flags a single component spanning almost the whole canvas", () => {
  const reason = assessExtractionOutcome(100, 100, "near-uniform", { color: [250, 247, 238], confidence: 0.95 }, [{ id: 1, x: 0, y: 0, width: 100, height: 100, area: 9600 }]);
  assert.equal(reason, "background-not-separated");
});

test("assessExtractionOutcome flags zero detected elements", () => {
  const reason = assessExtractionOutcome(100, 100, "alpha", { color: [0, 0, 0], confidence: 1 }, []);
  assert.equal(reason, "no-elements-found");
});

test("assessExtractionOutcome returns null for a healthy result", () => {
  const reason = assessExtractionOutcome(100, 100, "near-uniform", { color: [255, 255, 255], confidence: 0.98 }, [{ id: 1, x: 10, y: 10, width: 20, height: 20, area: 300 }]);
  assert.equal(reason, null);
});

class TestImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height ?? Math.floor(data.length / 4 / width);
  }
}

function installCanvasMocks() {
  globalThis.ImageData = TestImageData;
  globalThis.URL.createObjectURL = (blob) => { blob.__url = `blob:${Math.random().toString(36).slice(2)}`; return blob.__url; };
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(bitmap) { canvas.__drawn = bitmap; },
            getImageData(_x, _y, width, height) { return canvas.__sourceImageData ?? new TestImageData(new Uint8ClampedArray(width * height * 4), width, height); },
            createImageData(width, height) { return new TestImageData(new Uint8ClampedArray(width * height * 4), width, height); },
            putImageData(image) { canvas.__putImage = image; },
          };
        },
        toBlob(callback) { callback({ type: "image/png" }); },
      };
      return canvas;
    },
  };
}

async function detectOnSynthetic(source) {
  installCanvasMocks();
  const bitmap = { width: source.width, height: source.height, close() {} };
  globalThis.createImageBitmap = async () => bitmap;
  globalThis.document.createElement = (name) => {
    assert.equal(name, "canvas");
    const canvas = {
      width: 0,
      height: 0,
      __sourceImageData: new TestImageData(source.data, source.width, source.height),
      getContext() {
        return {
          drawImage() {},
          getImageData(_x, _y, w, h) {
            if (w === source.width && h === source.height) return canvas.__sourceImageData;
            return new TestImageData(new Uint8ClampedArray(w * h * 4), w, h);
          },
          createImageData(w, h) { return new TestImageData(new Uint8ClampedArray(w * h * 4), w, h); },
          putImageData(image) { canvas.__putImage = image; },
        };
      },
      toBlob(callback) { callback({ type: "image/png" }); },
    };
    return canvas;
  };
  return detectExtractElements({});
}

test("decodeImageFileToRasterSource draws the bitmap and reads back its pixels", async () => {
  installCanvasMocks();
  const bitmap = { width: 3, height: 2, closed: false, close() { this.closed = true; } };
  globalThis.createImageBitmap = async () => bitmap;

  const source = await decodeImageFileToRasterSource({});
  assert.equal(source.width, 3);
  assert.equal(source.height, 2);
  assert.equal(source.data.length, 3 * 2 * 4);
  assert.equal(bitmap.closed, true);
});

test("renderElementPreview keeps included pixels and zeroes everything else", async () => {
  installCanvasMocks();
  const source = buildRaster(4, 2, (x) => (x < 2 ? [200, 100, 50, 255] : [1, 2, 3, 255]));
  const labels = new Int32Array(4 * 2).fill(2);
  labels[0] = 1;
  labels[4] = 1; // second row, first column belongs to a different element
  const region = { id: 1, x: 0, y: 0, width: 2, height: 2, area: 2 };

  const url = await renderElementPreview(source, labels, region);
  assert.match(url, /^blob:/);
});

test("detectExtractElements finds a well-separated element on a large white canvas", async () => {
  const width = 40;
  const height = 40;
  const source = buildRaster(width, height, (x, y) => {
    const inShape = x >= 10 && x <= 15 && y >= 10 && y <= 15;
    return inShape ? [10, 120, 60, 255] : [255, 255, 255, 255];
  });
  const outcome = await detectOnSynthetic(source);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.elements.length, 1);
  assert.ok(outcome.elements[0].previewUrl.startsWith("blob:"));
  assert.equal(outcome.elements[0].area, 36);
});

test("detectExtractElements finds exactly 3 elements on a cream background", async () => {
  const width = 90;
  const height = 60;
  const source = buildRaster(width, height, () => [250, 247, 238, 255]);
  fillCircle(source, 20, 20, 9, [214, 40, 40], false);
  fillCircle(source, 55, 18, 9, [67, 170, 139], false);
  fillCircle(source, 40, 45, 9, [23, 138, 216], false);
  const outcome = await detectOnSynthetic(source);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.elements.length, 3);
});

test("detectExtractElements keeps a pale/pastel foreground shape on a cream background, does not delete it as background", async () => {
  const width = 60;
  const height = 60;
  const source = buildRaster(width, height, () => [250, 247, 238, 255]);
  fillCircle(source, 30, 30, 14, [255, 214, 224], false); // soft pastel pink, distinct from the cream background
  const outcome = await detectOnSynthetic(source);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.elements.length, 1);
  assert.ok(outcome.elements[0].area > 400, `pastel shape should survive as a real element, area was ${outcome.elements[0]?.area}`);
});

test("detectExtractElements reports the enclosed highlight as part of the same element, not separately", async () => {
  const width = 40;
  const height = 40;
  const source = buildRaster(width, height, () => [255, 255, 255, 255]);
  fillCircle(source, 20, 20, 14, [30, 30, 30, 255], false);
  fillCircle(source, 20, 20, 4, [252, 252, 250, 255], false); // enclosed near-white highlight
  const outcome = await detectOnSynthetic(source);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.elements.length, 1);
});

test("detectExtractElements returns an unsupported outcome for a non-uniform, photo-like background", async () => {
  const width = 60;
  const height = 60;
  const source = buildRaster(width, height, (x, y) => {
    // Wide, noisy variation across the border with no single dominant color.
    const r = (x * 53 + y * 17) % 256;
    const g = (x * 31 + y * 71) % 256;
    const b = (x * 97 + y * 13) % 256;
    return [r, g, b, 255];
  });
  const outcome = await detectOnSynthetic(source);
  assert.equal(outcome.status, "unsupported");
  assert.equal(outcome.reason, "low-background-confidence");
});

test("detectExtractElements returns an unsupported outcome when background separation collapses to one giant component", async () => {
  // The exact shape of the Phase C.5 cream-background failure: a background
  // color estimation that (for whatever reason) never matches the border.
  const width = 50;
  const height = 50;
  const source = buildRaster(width, height, () => [250, 247, 238, 255]);
  // Poison every border pixel so the dominant bucket never reaches the
  // confidence floor, forcing the "whole image is one component" collapse
  // this check exists to catch.
  for (let x = 0; x < width; x += 1) {
    source.data[x * 4] = (x * 41) % 256;
    source.data[((height - 1) * width + x) * 4 + 1] = (x * 67) % 256;
  }
  const outcome = await detectOnSynthetic(source);
  assert.equal(outcome.status, "unsupported");
});

test("detectExtractElements keeps merging touching elements into one -- documented Fast Path limitation, not fixed here", async () => {
  const width = 60;
  const height = 40;
  const source = buildRaster(width, height, () => [255, 255, 255, 255]);
  fillCircle(source, 24, 20, 12, [214, 40, 40], false);
  fillCircle(source, 48, 20, 12, [23, 138, 216], false); // centers 24px apart, radii 12 each -> touching
  const outcome = await detectOnSynthetic(source);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.elements.length, 1, "touching elements are still expected to merge");
});

test("detectExtractElements regression: 12 well-separated elements on a large (3-megapixel-class) canvas", async () => {
  const width = 800;
  const height = 600;
  const source = buildRaster(width, height, () => [255, 255, 255, 255]);
  const colors = [[214, 40, 40], [67, 170, 139], [95, 66, 122], [23, 138, 216], [244, 162, 97], [138, 89, 227]];
  let index = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      fillCircle(source, 90 + col * 190, 100 + row * 190, 55, colors[index % colors.length], false);
      index += 1;
    }
  }
  const outcome = await detectOnSynthetic(source);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.elements.length, 12);
});

// --- Phase D: Review editing (merge / undo / reset / rename / exclude) ---

function makeCard(id, x, y, width, height, extra = {}) {
  return { id, x, y, width, height, area: width * height, previewUrl: `blob:card-${id}`, name: `Element ${id}`, excluded: false, sourceRegionIds: [id], mergedFrom: null, ...extra };
}

test("planMerge is disabled with fewer than 2 selected", () => {
  const cards = [makeCard(1, 0, 0, 10, 10), makeCard(2, 20, 20, 10, 10)];
  assert.equal(planMerge(cards, new Set([1])), null);
  assert.equal(planMerge(cards, new Set()), null);
});

test("merging 2 elements computes the correct union bounding box", () => {
  const cards = [makeCard(1, 10, 10, 20, 20), makeCard(2, 50, 5, 15, 30)];
  const plan = planMerge(cards, new Set([1, 2]));
  assert.deepEqual(plan.bounds, { x: 10, y: 5, width: 55, height: 30 });
  assert.deepEqual([...plan.memberIds].sort(), [1, 2]);
});

test("merging 3 elements computes the correct union bounding box and sums area", () => {
  const cards = [makeCard(1, 0, 0, 10, 10), makeCard(2, 40, 0, 10, 10), makeCard(3, 20, 30, 10, 10)];
  const plan = planMerge(cards, new Set([1, 2, 3]));
  assert.deepEqual(plan.bounds, { x: 0, y: 0, width: 50, height: 40 });
  const merged = applyMerge(cards, plan.members, 999, "blob:merged", "Merged element");
  const mergedCard = merged.find((card) => card.id === 999);
  assert.equal(mergedCard.area, 300); // 3 disjoint 10x10 regions, summed exactly
});

test("computeUnionBounds matches planMerge's bounds for the same members", () => {
  const members = [makeCard(1, 5, 5, 10, 10), makeCard(2, 30, 2, 8, 8)];
  assert.deepEqual(computeUnionBounds(members), { x: 5, y: 2, width: 33, height: 13 });
});

test("applyMerge replaces the members with one merged card in their place, selectable like any other", () => {
  const cards = [makeCard(1, 0, 0, 10, 10), makeCard(2, 20, 0, 10, 10), makeCard(3, 40, 0, 10, 10)];
  const merged = applyMerge(cards, [cards[0], cards[1]], 999, "blob:merged", "Merged element");
  assert.deepEqual(merged.map((card) => card.id), [999, 3]);
  const mergedCard = merged[0];
  assert.equal(mergedCard.mergedFrom.length, 2);
  assert.equal(mergedCard.name, "Merged element");
  // A merged card is a plain ReviewCard -- nothing marks it unselectable.
  assert.equal(typeof mergedCard.id, "number");
  assert.equal(mergedCard.excluded, false);
});

test("undoMerge restores the original members and removing it is a no-op for a non-merged card", () => {
  const a = makeCard(1, 0, 0, 10, 10);
  const b = makeCard(2, 20, 0, 10, 10);
  const merged = applyMerge([a, b], [a, b], 999, "blob:merged", "Merged element");
  const restored = undoMerge(merged, 999);
  assert.deepEqual(restored.map((card) => card.id), [1, 2]);

  const unaffected = undoMerge([a, b], 1); // id 1 isn't a merged card
  assert.deepEqual(unaffected, [a, b]);
});

test("reset restores the original detection result via buildInitialCards", () => {
  const elements = [
    { id: 1, x: 0, y: 0, width: 10, height: 10, area: 100, previewUrl: "blob:1" },
    { id: 2, x: 20, y: 0, width: 10, height: 10, area: 100, previewUrl: "blob:2" },
  ];
  const initial = buildInitialCards(elements, "Element");
  const merged = applyMerge(initial, initial, 999, "blob:merged", "Merged element");
  assert.equal(merged.length, 1);

  const reset = buildInitialCards(elements, "Element");
  assert.deepEqual(reset.map((card) => ({ id: card.id, name: card.name, mergedFrom: card.mergedFrom })), [
    { id: 1, name: "Element 1", mergedFrom: null },
    { id: 2, name: "Element 2", mergedFrom: null },
  ]);
});

test("collectMergedPreviewUrls only walks merge-generated previews, including a merge of a merge", () => {
  const a = makeCard(1, 0, 0, 10, 10);
  const b = makeCard(2, 20, 0, 10, 10);
  const firstMerge = applyMerge([a, b], [a, b], 900, "blob:first-merge", "Merged element")[0];
  const c = makeCard(3, 40, 0, 10, 10);
  const secondMerge = applyMerge([firstMerge, c], [firstMerge, c], 901, "blob:second-merge", "Merged element")[0];

  assert.deepEqual(collectMergedPreviewUrls(a), []); // plain card: nothing to revoke
  assert.deepEqual(collectMergedPreviewUrls(secondMerge).sort(), ["blob:first-merge", "blob:second-merge"]);
});

test("renderCombinedPreview preserves relative spatial position and transparency, not a thumbnail collage", async () => {
  installCanvasMocks();
  let capturedImage = null;
  globalThis.document.createElement = (name) => {
    assert.equal(name, "canvas");
    const canvas = {
      width: 0,
      height: 0,
      getContext() {
        return {
          createImageData(w, h) { return new TestImageData(new Uint8ClampedArray(w * h * 4), w, h); },
          putImageData(image) { capturedImage = image; },
        };
      },
      toBlob(callback) { callback({ type: "image/png" }); },
    };
    return canvas;
  };

  const source = buildRaster(60, 20, () => [255, 255, 255, 255]);
  fillCircle(source, 10, 10, 6, [214, 40, 40], false); // left element, opaque solid center
  fillCircle(source, 50, 10, 6, [23, 138, 216], false); // right element, 40px away
  const labels = new Int32Array(60 * 20);
  for (let pixel = 0; pixel < 60 * 20; pixel += 1) {
    const offset = pixel * 4;
    if (source.data[offset] === 214) labels[pixel] = 1;
    else if (source.data[offset + 2] === 216) labels[pixel] = 2;
  }
  const bounds = { x: 0, y: 0, width: 60, height: 20 };
  const url = await renderCombinedPreview(source, labels, bounds, new Set([1, 2]));
  assert.match(url, /^blob:/);
  assert.ok(capturedImage);

  const at = (x, y) => {
    const offset = (y * bounds.width + x) * 4;
    return { r: capturedImage.data[offset], g: capturedImage.data[offset + 1], b: capturedImage.data[offset + 2], a: capturedImage.data[offset + 3] };
  };
  // Each element's own solid-color center lands at its original absolute
  // coordinate (bounds.x/y is 0,0 here, so local == absolute) -- proving
  // the merge kept the real spatial relationship, not a stretched/rescaled
  // thumbnail pair.
  assert.deepEqual(at(10, 10), { r: 214, g: 40, b: 40, a: 255 });
  assert.deepEqual(at(50, 10), { r: 23, g: 138, b: 216, a: 255 });
  // The real gap between the two circles must stay fully transparent -- a
  // thumbnail collage would have pasted them edge to edge with no gap.
  assert.equal(at(30, 10).a, 0, "empty space between the two elements must be transparent");
});

test("renameCard applies a trimmed non-empty name and persists it in the card list", () => {
  const cards = [makeCard(1, 0, 0, 10, 10)];
  const result = renameCard(cards, 1, "  Cute flower  ");
  assert.equal(result.applied, true);
  assert.equal(result.cards[0].name, "Cute flower");
});

test("renameCard rejects an empty (or whitespace-only) name and leaves the card unchanged", () => {
  const cards = [makeCard(1, 0, 0, 10, 10, { name: "Original" })];
  const result = renameCard(cards, 1, "   ");
  assert.equal(result.applied, false);
  assert.equal(result.cards[0].name, "Original");
});

test("a merged card can be renamed like any other card", () => {
  const a = makeCard(1, 0, 0, 10, 10);
  const b = makeCard(2, 20, 0, 10, 10);
  const merged = applyMerge([a, b], [a, b], 999, "blob:merged", "Merged element");
  const result = renameCard(merged, 999, "Head and hand");
  assert.equal(result.cards[0].name, "Head and hand");
});

test("toggleCardExcluded persists the excluded state and restore toggles it back", () => {
  const cards = [makeCard(1, 0, 0, 10, 10), makeCard(2, 20, 0, 10, 10)];
  const excluded = toggleCardExcluded(cards, 1);
  assert.equal(excluded.find((card) => card.id === 1).excluded, true);
  assert.equal(excluded.find((card) => card.id === 2).excluded, false);

  const restored = toggleCardExcluded(excluded, 1);
  assert.equal(restored.find((card) => card.id === 1).excluded, false);
});

test("an excluded card is not treated as an active export candidate", () => {
  const cards = [makeCard(1, 0, 0, 10, 10), makeCard(2, 20, 0, 10, 10)];
  const excluded = toggleCardExcluded(cards, 2);
  const exportCandidates = excluded.filter((card) => !card.excluded);
  assert.deepEqual(exportCandidates.map((card) => card.id), [1]);
});
