import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

class TestImageData {
  constructor(first, second, third) {
    if (typeof first === "number") {
      this.width = first;
      this.height = second;
      this.data = new Uint8ClampedArray(first * second * 4);
    } else {
      this.data = first;
      this.width = second;
      this.height = third ?? Math.floor(first.length / 4 / second);
    }
  }
}

globalThis.ImageData = TestImageData;
globalThis.document = {
  createElement(name) {
    assert.equal(name, "canvas");
    const canvas = {
      width: 0,
      height: 0,
      image: null,
      getContext() {
        return {
          imageSmoothingEnabled: false,
          putImageData(image) { canvas.image = image; },
          drawImage(source, _x, _y, width, height) {
            const output = new TestImageData(width, height);
            const input = source.image;
            for (let y = 0; y < height; y += 1) {
              for (let x = 0; x < width; x += 1) {
                const sourceX = Math.min(input.width - 1, Math.floor(x * input.width / width));
                const sourceY = Math.min(input.height - 1, Math.floor(y * input.height / height));
                const sourceOffset = (sourceY * input.width + sourceX) * 4;
                output.data.set(input.data.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
              }
            }
            canvas.image = output;
          },
          getImageData() { return canvas.image; },
        };
      },
      toDataURL() { return "data:image/png;base64,"; },
    };
    return canvas;
  },
};

const buildDirectory = mkdtempSync(join(tmpdir(), "woojoo-vector-test-"));
const bundlePath = join(buildDirectory, "vector-utils.mjs");
execFileSync(join(process.cwd(), "node_modules/.bin/esbuild"), [
  "app/vector-utils.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${bundlePath}`,
], { stdio: "pipe" });
const { createVectorResult } = await import(`${bundlePath}?test=${Date.now()}`);

test.after(() => rmSync(buildDirectory, { recursive: true, force: true }));

function makeArtwork(width, height) {
  const imageData = new TestImageData(width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(width, height) * .38;
  const innerRadius = Math.min(width, height) * .21;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance <= outerRadius) {
        const cream = distance <= innerRadius;
        imageData.data[offset] = cream ? 253 : 229;
        imageData.data[offset + 1] = cream ? 237 : 47;
        imageData.data[offset + 2] = cream ? 213 : 34;
        imageData.data[offset + 3] = 255;
      } else if (distance <= outerRadius + 3) {
        // Deliberately impossible low-alpha blue fringe. It must never enter
        // the quantizer or SVG palette.
        imageData.data[offset] = 115;
        imageData.data[offset + 1] = 191;
        imageData.data[offset + 2] = 221;
        imageData.data[offset + 3] = 64;
      }
    }
  }

  // Opaque antialias-like salmon crumbs: all are smaller than the 0.05% path
  // threshold and must merge into their coherent neighboring color.
  for (let index = 0; index < 240; index += 1) {
    const angle = index * Math.PI * 2 / 240;
    const radius = outerRadius - 5 - (index % 3);
    const x = Math.round(centerX + Math.cos(angle) * radius);
    const y = Math.round(centerY + Math.sin(angle) * radius);
    const offset = (y * width + x) * 4;
    imageData.data[offset] = 234;
    imageData.data[offset + 1] = 93;
    imageData.data[offset + 2] = 76;
    imageData.data[offset + 3] = 255;
  }
  return imageData;
}

function sourceFor(imageData) {
  return {
    name: "regression.png",
    width: imageData.width,
    height: imageData.height,
    imageData,
    previewUrl: "",
    originalWidth: imageData.width,
    originalHeight: imageData.height,
  };
}

function commandStats(svg) {
  return {
    move: (svg.match(/\bM\s/g) ?? []).length,
    line: (svg.match(/\bL\s/g) ?? []).length,
    quadratic: (svg.match(/\bQ\s/g) ?? []).length,
    cubic: (svg.match(/\bC\s/g) ?? []).length,
  };
}

test("balanced tracing removes fringe colors and emits fitted cubic curves", () => {
  const result = createVectorResult(sourceFor(makeArtwork(800, 800)), 8, "medium");
  const stats = commandStats(result.svg);
  const drawingCommands = stats.line + stats.quadratic + stats.cubic;
  assert.match(result.svg, /data-vector-engine="imagetracer-curvefit-v2"/);
  assert.ok(stats.cubic / drawingCommands >= .3, JSON.stringify(stats));
  assert.ok(result.curveRatio >= 30, `curve ratio: ${result.curveRatio}`);
  assert.ok(stats.move < 40, `too many subpaths: ${stats.move}`);
  assert.ok(!result.palette.some((color) => color.hex === "#73BFDD"));
  assert.ok(result.palette.length <= 4, `unexpected fringe palette: ${result.palette.map((color) => color.hex).join(", ")}`);
});

test("small isolated artwork is traced on an 800px working grid", () => {
  const result = createVectorResult(sourceFor(makeArtwork(317, 324)), 8, "medium");
  const stats = commandStats(result.svg);
  assert.match(result.svg, /viewBox="0 0 317 324"/);
  assert.match(result.svg, /transform="scale\(0\.4\d* 0\.4\d*\)"/);
  assert.ok(stats.cubic > 0, JSON.stringify(stats));
  assert.ok(stats.move < 40, `too many subpaths: ${stats.move}`);
});
