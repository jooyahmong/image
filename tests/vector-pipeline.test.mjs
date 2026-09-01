import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { deflateSync } from "node:zlib";

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

const vectorUtilsUrl = new URL("../app/vector-utils.ts", import.meta.url);
vectorUtilsUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { createVectorResult, deleteColors, encodeIco } = await import(vectorUtilsUrl.href);

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

function makeUnderlapArtwork() {
  const width = 240;
  const height = 160;
  const imageData = new TestImageData(width, height);
  for (let y = 20; y < 140; y += 1) {
    for (let x = 20; x < 220; x += 1) {
      const offset = (y * width + x) * 4;
      const inner = x >= 80 && x < 160 && y >= 50 && y < 110;
      imageData.data[offset] = inner ? 22 : 226;
      imageData.data[offset + 1] = inner ? 112 : 54;
      imageData.data[offset + 2] = inner ? 190 : 42;
      imageData.data[offset + 3] = 255;
    }
  }
  return imageData;
}

function makeNestedArtwork() {
  const width = 240;
  const height = 160;
  const imageData = new TestImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isOrange = x >= 20 && x < 220 && y >= 20 && y < 140;
      const isBlack = x >= 80 && x < 160 && y >= 50 && y < 110;
      const isWhiteEye = x >= 100 && x < 140 && y >= 65 && y < 95;
      const color = isWhiteEye ? [250, 250, 250] : isBlack ? [20, 20, 20] : isOrange ? [226, 112, 42] : [250, 250, 250];
      imageData.data[offset] = color[0];
      imageData.data[offset + 1] = color[1];
      imageData.data[offset + 2] = color[2];
      imageData.data[offset + 3] = 255;
    }
  }
  return imageData;
}

function makeSmallEyesArtwork() {
  const width = 240;
  const height = 160;
  const imageData = new TestImageData(width, height);
  const eyes = [[100, 78], [140, 78]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isBody = x >= 20 && x < 220 && y >= 20 && y < 140;
      const isEye = eyes.some(([eyeX, eyeY]) => Math.hypot(x - eyeX, y - eyeY) <= 3);
      const color = isEye ? [20, 20, 20] : isBody ? [226, 112, 42] : [250, 250, 250];
      imageData.data[offset] = color[0];
      imageData.data[offset + 1] = color[1];
      imageData.data[offset + 2] = color[2];
      imageData.data[offset + 3] = 255;
    }
  }
  return imageData;
}

function makeMixedLogoArtwork() {
  const width = 200;
  const height = 120;
  const imageData = new TestImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const leftEdge = 18 + Math.floor(y * .16);
      const rightEdge = 78 + Math.floor(y * .16);
      const slantedBlock = y >= 18 && y < 102 && x >= leftEdge && x < rightEdge;
      const roundMark = Math.hypot(x - 148, y - 60) <= 34;
      const navy = slantedBlock || roundMark;
      imageData.data[offset] = navy ? 16 : 250;
      imageData.data[offset + 1] = navy ? 42 : 250;
      imageData.data[offset + 2] = navy ? 86 : 250;
      imageData.data[offset + 3] = 255;
    }
  }
  return imageData;
}

function makeLayeredCharacterArtwork() {
  const width = 320;
  const height = 320;
  const imageData = new TestImageData(width, height);
  const ellipse = (x, y, centerX, centerY, radiusX, radiusY) => (
    ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2 <= 1
  );
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      let color = [250, 250, 250];
      const outerBody = ellipse(x, y, 158, 171, 108, 135);
      const innerBody = ellipse(x, y, 164, 174, 89, 116);
      const overalls = innerBody && y >= 211;
      const leftStrap = innerBody && x >= 112 && x <= 129 && y >= 169 && y <= 236;
      const rightStrap = innerBody && x >= 196 && x <= 213 && y >= 169 && y <= 236;
      const ear = ellipse(x, y, 119, 104, 26, 31);
      const beak = ellipse(x, y, 247, 146, 61, 27);
      const leftEye = ellipse(x, y, 164, 137, 8, 10);
      const rightEye = ellipse(x, y, 197, 134, 8, 10);
      const leftButton = ellipse(x, y, 124, 216, 7, 7);
      const rightButton = ellipse(x, y, 204, 216, 7, 7);
      const mouthRadius = Math.hypot(x - 181, y - 171);
      const mouth = mouthRadius >= 27 && mouthRadius <= 34 && y >= 173 && x >= 178;

      if (outerBody) color = [30, 25, 24];
      if (innerBody) color = [201, 132, 54];
      if (ear) color = [103, 69, 43];
      if (overalls || leftStrap || rightStrap) color = [31, 86, 139];
      if (leftButton || rightButton) color = [238, 184, 48];
      if (leftEye || rightEye || mouth) color = [30, 25, 24];
      if (beak) color = [103, 69, 43];

      imageData.data[offset] = color[0];
      imageData.data[offset + 1] = color[1];
      imageData.data[offset + 2] = color[2];
      imageData.data[offset + 3] = 255;
    }
  }
  return imageData;
}

function structureMetrics(result) {
  const paths = [...result.svg.matchAll(/<path\b([^>]*)\bd="([^"]+)"[^>]*>/g)];
  const groups = [...result.svg.matchAll(/<g\b[^>]*data-stack-depth="(\d+)"[^>]*>/g)];
  return {
    fileSize: result.fileSize,
    colors: result.palette.length,
    paths: paths.length,
    subpaths: (result.svg.match(/\bM\s/g) ?? []).length,
    estimatedAnchors: result.nodeCount,
    bezierCommands: result.cubicCount,
    unwantedHoles: paths.reduce((total, path) => total + Math.max(0, (path[2].match(/\bM\s/g) ?? []).length - 1), 0),
    backgroundRectangle: /\bM\s+0(?:\.0+)?\s+0(?:\.0+)?[^Z]*\bZ/.test(result.svg),
    layerStructure: `${groups.length} layers / max depth ${Math.max(0, ...groups.map((group) => Number(group[1])))}`,
    embeddedRaster: /(?:<image\b|data:image|base64)/i.test(result.svg),
    strokePaths: paths.filter((path) => /\bstroke=/.test(path[1])).length,
    closedFillPaths: paths.filter((path) => /\bfill=/.test(path[1]) && /Z\s*$/.test(path[2])).length,
  };
}

function writePocArtifact(phase, result, metrics) {
  if (!phase || process.env.POC_PHASE !== phase) return;
  const artifactDirectory = new URL("./artifacts/", import.meta.url);
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(new URL(`region-fill-${phase}.svg`, artifactDirectory), result.svg);
  writeFileSync(new URL(`region-fill-${phase}.json`, artifactDirectory), `${JSON.stringify(metrics, null, 2)}\n`);
}

function pngCrc(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function writePocSourcePng(imageData) {
  if (!process.env.POC_PHASE) return;
  const artifactDirectory = new URL("./artifacts/", import.meta.url);
  mkdirSync(artifactDirectory, { recursive: true });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(imageData.width, 0);
  header.writeUInt32BE(imageData.height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((imageData.width * 4 + 1) * imageData.height);
  for (let y = 0; y < imageData.height; y += 1) {
    const target = y * (imageData.width * 4 + 1);
    scanlines[target] = 0;
    Buffer.from(imageData.data.buffer, imageData.data.byteOffset + y * imageData.width * 4, imageData.width * 4).copy(scanlines, target + 1);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(new URL("region-fill-source.png", artifactDirectory), png);
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
  assert.match(result.svg, /data-vector-engine="imagetracer-regionfill-v8"/);
  assert.match(result.svg, /data-rendering-model="region-layered-fill"/);
  assert.match(result.svg, /data-color-underlap="true"/);
  assert.match(result.svg, /data-color-stacking="containment"/);
  assert.match(result.svg, /data-curve-continuity="adaptive"/);
  assert.match(result.svg, /data-geometry-classifier="line-curve"/);
  assert.ok(stats.cubic / drawingCommands >= .3, JSON.stringify(stats));
  assert.ok(result.curveRatio >= 30, `curve ratio: ${result.curveRatio}`);
  assert.ok(stats.move < 40, `too many subpaths: ${stats.move}`);
  assert.ok(result.nodeCount <= Math.ceil(81 * .7), `expected roughly 30% fewer nodes than v2 baseline: ${result.nodeCount}`);
  assert.ok(result.cubicCount <= Math.floor(78 * .7), `expected at least 30% fewer cubics than v2 baseline: ${result.cubicCount}`);
  assert.ok(result.fileSize <= Math.floor(3511 * .85), `expected a smaller SVG than v2 baseline: ${result.fileSize}`);
  assert.ok(!result.palette.some((color) => color.hex === "#73BFDD"));
  assert.ok(result.palette.length <= 4, `unexpected fringe palette: ${result.palette.map((color) => color.hex).join(", ")}`);
  assert.doesNotMatch(result.svg, /(?:<image\b|data:image|base64|NaN|Infinity)/i);
});

test("small isolated artwork is traced on an 800px working grid", () => {
  const result = createVectorResult(sourceFor(makeArtwork(317, 324)), 8, "medium");
  const stats = commandStats(result.svg);
  assert.match(result.svg, /viewBox="0 0 317 324"/);
  assert.match(result.svg, /transform="scale\(0\.4\d* 0\.4\d*\)"/);
  assert.ok(stats.cubic > 0, JSON.stringify(stats));
  assert.ok(stats.move < 40, `too many subpaths: ${stats.move}`);
  assert.ok(result.nodeCount <= Math.floor(742 * .7), `expected at least 30% fewer nodes than v2 baseline: ${result.nodeCount}`);
  assert.ok(result.cubicCount <= Math.floor(739 * .7), `expected at least 30% fewer cubics than v2 baseline: ${result.cubicCount}`);
  assert.ok(result.fileSize <= Math.floor(27241 * .7), `expected at least 30% smaller SVG than v2 baseline: ${result.fileSize}`);
});

test("anchor simplification changes geometry without changing the indexed artwork", () => {
  const source = sourceFor(makeArtwork(317, 324));
  const balanced = createVectorResult(source, 8, "medium", 0);
  const smoother = createVectorResult(source, 8, "medium", 70);
  assert.deepEqual(smoother.pixelMap, balanced.pixelMap);
  assert.deepEqual(smoother.palette.map(({ hex }) => hex), balanced.palette.map(({ hex }) => hex));
  assert.ok(smoother.nodeCount <= balanced.nodeCount, `${smoother.nodeCount} should not exceed ${balanced.nodeCount}`);
  assert.ok(smoother.fileSize <= balanced.fileSize, `${smoother.fileSize} should not exceed ${balanced.fileSize}`);
  assert.doesNotMatch(smoother.svg, /(?:<image\b|data:image|base64|NaN|Infinity)/i);
});

test("midpoint simplification preserves small foreground eyes before and after background deletion", () => {
  const initial = createVectorResult(sourceFor(makeSmallEyesArtwork()), 3, "medium", 50);
  const blackIndex = initial.palette.findIndex(({ hex }) => hex === "#141414");
  const backgroundIndex = initial.palette.findIndex(({ backgroundCandidate }) => backgroundCandidate);
  const blackLayer = initial.svg.match(new RegExp(`<g id="vector-layer-\\d+"[^>]*data-color-index="${blackIndex}"[^>]*data-stack-depth="[1-9]"[^>]*>([\\s\\S]*?)<\\/g>`));

  assert.ok(blackIndex >= 0 && backgroundIndex >= 0);
  assert.equal(initial.anchorSimplification, 50);
  assert.match(initial.svg, /data-detail-preservation="foreground"/);
  assert.ok((blackLayer?.[1].match(/M\s/g) ?? []).length >= 2, "both small eyes must remain visible");
  assert.doesNotMatch(blackLayer?.[1] ?? "", /\bL\s/, "compact round eyes should use fitted curves instead of angular line segments");
  const eyePaths = [...(blackLayer?.[1] ?? "").matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(eyePaths.filter((path) => (path.match(/\bC\s/g) ?? []).length === 4).length >= 2, "small round eyes should use four continuous cubic arcs");

  const withoutBackground = deleteColors(initial, [backgroundIndex], "medium");
  assert.equal(withoutBackground.anchorSimplification, 50, "palette edits must retain the same tracing quality");
  assert.match(withoutBackground.svg, /data-detail-preservation="foreground"/);
});

test("logo geometry emits straight strokes as lines and rounded marks as curves", () => {
  const result = createVectorResult(sourceFor(makeMixedLogoArtwork()), 2, "medium", 50);
  const foregroundIndex = result.palette.findIndex(({ backgroundCandidate }) => !backgroundCandidate);
  const foregroundLayer = result.svg.match(new RegExp(`<g id="vector-layer-\\d+"[^>]*data-color-index="${foregroundIndex}"[^>]*>([\\s\\S]*?)<\\/g>`))?.[1] ?? "";
  const lineCount = (foregroundLayer.match(/\bL\s/g) ?? []).length;
  const curveCount = (foregroundLayer.match(/\bC\s/g) ?? []).length;

  assert.match(result.svg, /data-geometry-classifier="line-curve"/);
  assert.ok(lineCount >= 4, `the slanted logo block should retain four straight sides: ${lineCount} lines, ${curveCount} curves`);
  assert.ok(curveCount >= 2, `the round logo mark should remain a fitted curve: ${lineCount} lines, ${curveCount} curves`);
});

test("layered character stays a pure closed-fill vector after background deletion", () => {
  const artwork = makeLayeredCharacterArtwork();
  writePocSourcePng(artwork);
  const initial = createVectorResult(sourceFor(artwork), 6, "medium", 50);
  const backgroundIndex = initial.palette.findIndex(({ backgroundCandidate }) => backgroundCandidate);
  assert.ok(backgroundIndex >= 0, "the white canvas must be recognized as removable background");
  const result = deleteColors(initial, [backgroundIndex], "medium");
  const metrics = structureMetrics(result);
  writePocArtifact(process.env.POC_PHASE, result, metrics);

  assert.equal(metrics.embeddedRaster, false);
  assert.equal(metrics.strokePaths, 0);
  assert.equal(metrics.backgroundRectangle, false);
  assert.equal(metrics.closedFillPaths, metrics.paths);
  assert.equal(metrics.unwantedHoles, 0, "nested colors should be stacked objects instead of punched holes");
  assert.match(result.svg, /<path id="vector-object-\d+-\d+" class="vector-object"/);
  assert.equal((result.svg.match(/<path\b/g) ?? []).length, (result.svg.match(/id="vector-object-/g) ?? []).length);
  assert.ok(metrics.paths >= 10, `major character regions should remain separately selectable: ${metrics.paths}`);
});

test("contained foreground colors are stacked over a solid lower path", () => {
  const result = createVectorResult(sourceFor(makeUnderlapArtwork()), 2, "medium");
  const lowerMatch = result.svg.match(/id="vector-layer-1"[^>]*data-stack-depth="0"[\s\S]*?<path[^>]* d="([^"]+)"/);
  const upperMatch = result.svg.match(/id="vector-layer-2"[^>]*data-stack-depth="1"[\s\S]*?<path[^>]* d="([^"]+)"/);
  assert.ok(lowerMatch?.[1] && upperMatch?.[1]);
  const lowerSubpaths = lowerMatch[1].match(/M\s[\s\S]*?Z/g) ?? [];
  const upperSubpaths = upperMatch[1].match(/M\s[\s\S]*?Z/g) ?? [];
  assert.equal(lowerSubpaths.length, 1, "the lower color must stay solid beneath the foreground object");
  assert.ok(upperSubpaths.length >= 1);
});

test("the same color can be emitted at separate background and foreground depths", () => {
  const result = createVectorResult(sourceFor(makeNestedArtwork()), 3, "medium");
  const groups = [...result.svg.matchAll(/<g id="vector-layer-\d+"[^>]*data-color-index="(\d+)"[^>]*data-stack-depth="(\d+)"[^>]*>[\s\S]*?<\/g>/g)]
    .map((match) => ({ colorIndex: Number(match[1]), depth: Number(match[2]), svg: match[0] }));
  const whiteIndex = result.palette.findIndex(({ hex }) => hex === "#FAFAFA");
  const whiteGroups = groups.filter(({ colorIndex }) => colorIndex === whiteIndex);
  assert.deepEqual(whiteGroups.map(({ depth }) => depth), [0, 3]);
  const orangeGroup = groups.find(({ depth }) => depth === 1);
  assert.ok(orangeGroup, "the middle fill should be its own stacked layer");
  const orangePath = orangeGroup.svg.match(/<path[^>]* d="([^"]+)"/)?.[1] ?? "";
  assert.equal((orangePath.match(/M\s/g) ?? []).length, 1, "the middle fill must not contain an eye-shaped hole");
});

test("favicon encoder creates a valid multi-size ICO directory", () => {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  const images = [16, 32, 48].map((size, index) => ({
    size,
    bytes: Uint8Array.from([...pngSignature, index, size]),
  }));
  const ico = encodeIco(images);
  const view = new DataView(ico.buffer);

  assert.equal(view.getUint16(0, true), 0);
  assert.equal(view.getUint16(2, true), 1);
  assert.equal(view.getUint16(4, true), 3);
  let expectedOffset = 6 + images.length * 16;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], image.size);
    assert.equal(ico[entry + 1], image.size);
    assert.equal(view.getUint16(entry + 4, true), 1);
    assert.equal(view.getUint16(entry + 6, true), 32);
    assert.equal(view.getUint32(entry + 8, true), image.bytes.byteLength);
    assert.equal(view.getUint32(entry + 12, true), expectedOffset);
    assert.deepEqual([...ico.slice(expectedOffset, expectedOffset + 8)], pngSignature);
    expectedOffset += image.bytes.byteLength;
  });
  assert.equal(ico.byteLength, expectedOffset);
});
