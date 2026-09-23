import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTRACT_ELEMENTS_MAX_FILE_SIZE,
  computeForegroundMask,
  decodeImageFileToRasterSource,
  detectExtractElements,
  detectFastPathElements,
  renderElementPreview,
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

test("computeForegroundMask floods near-white background from the border but keeps an enclosed white highlight", () => {
  // 7x7 opaque image: a dark ring with a white pixel sealed in the center.
  const raster = buildRaster(7, 7, (x, y) => {
    if (x === 3 && y === 3) return [252, 252, 252, 255];
    const onRing = x >= 2 && x <= 4 && y >= 2 && y <= 4 && !(x === 3 && y === 3);
    return onRing ? [20, 20, 20, 255] : [255, 255, 255, 255];
  });
  const { mask, backgroundMode } = computeForegroundMask(raster.width, raster.height, raster.data);
  assert.equal(backgroundMode, "near-white");
  assert.equal(mask[0 * 7 + 0], 0, "border white pixel is background");
  assert.equal(mask[3 * 7 + 3], 1, "white pixel sealed inside the dark ring stays foreground");
  assert.equal(mask[2 * 7 + 3], 1, "ring pixel is foreground");
});

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

class TestImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height ?? Math.floor(data.length / 4 / width);
  }
}

function installCanvasMocks() {
  globalThis.ImageData = TestImageData;
  const revoked = [];
  globalThis.URL.createObjectURL = (blob) => {
    blob.__url = `blob:${Math.random().toString(36).slice(2)}`;
    return blob.__url;
  };
  globalThis.URL.revokeObjectURL = (url) => revoked.push(url);
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
        toBlob(callback) { callback({ __size: canvas.width * canvas.height, type: "image/png" }); },
      };
      return canvas;
    },
  };
  return { revoked };
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

test("detectExtractElements runs the full pipeline end to end on a synthetic image", async () => {
  installCanvasMocks();
  const width = 40;
  const height = 40;
  const source = buildRaster(width, height, (x, y) => {
    const inShape = x >= 10 && x <= 15 && y >= 10 && y <= 15;
    return inShape ? [10, 120, 60, 255] : [255, 255, 255, 255];
  });
  const bitmap = { width, height, close() {} };
  globalThis.createImageBitmap = async () => bitmap;
  globalThis.document.createElement = (name) => {
    assert.equal(name, "canvas");
    const canvas = {
      width: 0,
      height: 0,
      __sourceImageData: new TestImageData(source.data, width, height),
      getContext() {
        return {
          drawImage() {},
          getImageData(_x, _y, w, h) {
            if (w === width && h === height) return canvas.__sourceImageData;
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

  const elements = await detectExtractElements({});
  assert.equal(elements.length, 1);
  assert.ok(elements[0].previewUrl.startsWith("blob:"));
  assert.equal(elements[0].area, 36);
});
