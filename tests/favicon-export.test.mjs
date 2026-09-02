import assert from "node:assert/strict";
import test from "node:test";
import { downloadRasterFavicon } from "../app/vector-utils.ts";

function mockFaviconBrowser(t, { width = 4000, height = 2000, cancel = false, failRendering = false } = {}) {
  const previous = Object.fromEntries(["window", "document", "createImageBitmap"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const upload = new Blob(["original uploaded raster"], { type: "image/png" });
  const state = { decoded: false, closed: false, written: null, draws: [], events: [] };
  const bitmap = { width, height, close() { state.closed = true; } };
  globalThis.createImageBitmap = async (file) => {
    assert.equal(file, upload, "decode the actual upload, not a processed preview or SVG");
    state.decoded = true;
    state.events.push("decode");
    return bitmap;
  };
  globalThis.window = {
    async showSaveFilePicker(options) {
      state.events.push("save-picker");
      assert.equal(options.suggestedName, "favicon.ico");
      if (cancel) throw new DOMException("Cancelled", "AbortError");
      return {
        async createWritable() {
          return { async write(blob) { state.written = blob; }, async close() {} };
        },
      };
    },
  };
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      const canvas = {
        width: 0,
        height: 0,
        getContext(type) {
          assert.equal(type, "2d");
          return {
            drawImage(image, x, y, drawWidth, drawHeight) {
              assert.equal(image, bitmap);
              assert.equal(this.imageSmoothingEnabled, true);
              assert.equal(this.imageSmoothingQuality, "high");
              state.draws.push({ size: canvas.width, canvasHeight: canvas.height, x, y, width: drawWidth, height: drawHeight });
            },
          };
        },
        toBlob(callback, type) {
          assert.equal(type, "image/png");
          // A sentinel payload tests ICO packaging; the drawing assertions test geometry.
          callback(failRendering ? null : new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, canvas.width])]));
        },
      };
      return canvas;
    },
  };
  return { upload, state };
}

for (const [width, height] of [[4000, 2000], [2000, 4000]]) {
  test(`original favicon fits the complete ${width}x${height} upload without tracing or cropping`, async (t) => {
    const { upload, state } = mockFaviconBrowser(t, { width, height });
    assert.equal(await downloadRasterFavicon(upload), "saved");
    assert.deepEqual(state.events, ["save-picker", "decode"], "request a save handle before asynchronous decoding consumes user activation");
    assert.equal(state.closed, true);
    assert.equal(state.written.type, "image/vnd.microsoft.icon");
    assert.deepEqual(state.draws.map(({ size }) => size), [16, 32, 48]);
    for (const draw of state.draws) {
      assert.equal(draw.canvasHeight, draw.size);
      assert.equal(draw.width / draw.height, width / height);
      assert.equal(draw.x, (draw.size - draw.width) / 2);
      assert.equal(draw.y, (draw.size - draw.height) / 2);
      assert.equal(Math.max(draw.width, draw.height), draw.size);
    }
    const bytes = new Uint8Array(await state.written.arrayBuffer());
    const directory = new DataView(bytes.buffer);
    assert.equal(directory.getUint16(2, true), 1);
    assert.equal(directory.getUint16(4, true), 3);
    for (const [index, size] of [16, 32, 48].entries()) {
      const entry = 6 + index * 16;
      assert.equal(bytes[entry], size);
      assert.equal(bytes[entry + 1], size);
      assert.equal(directory.getUint16(entry + 6, true), 32);
      const offset = directory.getUint32(entry + 12, true);
      assert.deepEqual([...bytes.slice(offset, offset + 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });
}

test("cancelling original favicon export does not decode or download anything", async (t) => {
  const { upload, state } = mockFaviconBrowser(t, { cancel: true });
  assert.equal(await downloadRasterFavicon(upload), "cancelled");
  assert.equal(state.decoded, false);
  assert.equal(state.written, null);
});

test("original favicon releases its bitmap when rendering fails", async (t) => {
  const { upload, state } = mockFaviconBrowser(t, { failRendering: true });
  await assert.rejects(downloadRasterFavicon(upload), /Favicon rendering failed/);
  assert.equal(state.closed, true);
  assert.equal(state.written, null);
});
