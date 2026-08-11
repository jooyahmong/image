import { buildPaletteSync, utils } from "image-q";
import ImageTracer from "imagetracerjs";

export type CleanupLevel = "none" | "light" | "medium" | "strong";

export type PaletteColor = {
  id: string;
  r: number;
  g: number;
  b: number;
  a: number;
  hex: string;
  count: number;
  share: number;
  edgeShare: number;
  backgroundCandidate: boolean;
  locked: boolean;
};

export type RasterSource = {
  name: string;
  width: number;
  height: number;
  imageData: ImageData;
  previewUrl: string;
  originalWidth: number;
  originalHeight: number;
};

export type VectorResult = {
  width: number;
  height: number;
  pixelMap: Uint8Array;
  alphaMap: Uint8ClampedArray;
  palette: PaletteColor[];
  imageData: ImageData;
  previewUrl: string;
  svg: string;
  pathCount: number;
  nodeCount: number;
  fileSize: number;
};

export type CropBox = { x: number; y: number; width: number; height: number };

export type ObjectRegion = CropBox & {
  seed: number;
  area: number;
};

const MAX_PROCESSING_DIMENSION = 1600;
const TRANSPARENT_INDEX = 255;
export const MAX_VECTOR_OBJECTS = 25;
export const MAX_VECTOR_ANCHORS = 70;
// A coloured island normally produces both its own contour and a hole in the
// colour underneath it. Keeping the raster region budget to roughly half the
// final SVG budget prevents a "25 layers, hundreds of subpaths" result.
const MAX_FOREGROUND_COMPONENTS = Math.floor((MAX_VECTOR_OBJECTS - 1) / 2);

type SaveHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

function canvasFromImageData(imageData: ImageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d", { willReadFrequently: true })?.putImageData(imageData, 0, 0);
  return canvas;
}

function resizeForTracing(imageData: ImageData, maximumDimension: number) {
  const longestSide = Math.max(imageData.width, imageData.height);
  if (longestSide <= maximumDimension) {
    return { imageData, scaleX: 1, scaleY: 1 };
  }

  const ratio = maximumDimension / longestSide;
  const width = Math.max(1, Math.round(imageData.width * ratio));
  const height = Math.max(1, Math.round(imageData.height * ratio));
  const source = canvasFromImageData(imageData);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { imageData, scaleX: 1, scaleY: 1 };
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return {
    imageData: context.getImageData(0, 0, width, height),
    scaleX: imageData.width / width,
    scaleY: imageData.height / height,
  };
}

export function imageDataToUrl(imageData: ImageData) {
  return canvasFromImageData(imageData).toDataURL("image/png");
}

function trimTransparent(imageData: ImageData) {
  const { width, height, data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 2) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY || (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1)) {
    return imageData;
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const cropped = new ImageData(cropWidth, cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    const sourceStart = ((minY + y) * width + minX) * 4;
    const sourceEnd = sourceStart + cropWidth * 4;
    cropped.data.set(data.subarray(sourceStart, sourceEnd), y * cropWidth * 4);
  }
  return cropped;
}

export async function loadRaster(file: File): Promise<RasterSource> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Please choose an image under 20 MB.");
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) throw new Error("Use a PNG, JPG, or WebP image.");

  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const scale = Math.min(1, MAX_PROCESSING_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read the image.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const trimmed = trimTransparent(context.getImageData(0, 0, width, height));
  return {
    name: file.name,
    width: trimmed.width,
    height: trimmed.height,
    imageData: trimmed,
    previewUrl: imageDataToUrl(trimmed),
    originalWidth,
    originalHeight,
  };
}

export function cropRasterSource(source: RasterSource, crop: CropBox): RasterSource {
  const x = Math.max(0, Math.min(source.width - 1, Math.floor(crop.x)));
  const y = Math.max(0, Math.min(source.height - 1, Math.floor(crop.y)));
  const width = Math.max(1, Math.min(source.width - x, Math.round(crop.width)));
  const height = Math.max(1, Math.min(source.height - y, Math.round(crop.height)));
  const imageData = new ImageData(width, height);

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    const sourceEnd = sourceStart + width * 4;
    imageData.data.set(source.imageData.data.subarray(sourceStart, sourceEnd), row * width * 4);
  }

  return {
    ...source,
    width,
    height,
    imageData,
    previewUrl: imageDataToUrl(imageData),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function colorDistance(r: number, g: number, b: number, candidate: { r: number; g: number; b: number }) {
  const redMean = (r + candidate.r) / 2;
  const red = r - candidate.r;
  const green = g - candidate.g;
  const blue = b - candidate.b;
  return (2 + redMean / 256) * red * red + 4 * green * green + (2 + (255 - redMean) / 256) * blue * blue;
}

function isProtectedColorContrast(first?: { r: number; g: number; b: number }, second?: { r: number; g: number; b: number }) {
  if (!first || !second) return false;
  // Small features such as dark eyes and deliberate outline accents survive
  // Ultra cleanup. Intermediate antialiasing shades remain below this cutoff
  // and can be absorbed into the neighboring large color mass.
  const protectedDistance = 230;
  return colorDistance(first.r, first.g, first.b, second) >= protectedDistance * protectedDistance;
}

export function renderPalette(
  width: number,
  height: number,
  pixelMap: Uint8Array,
  alphaMap: Uint8ClampedArray,
  palette: PaletteColor[],
) {
  const output = new ImageData(width, height);
  for (let pixel = 0; pixel < pixelMap.length; pixel += 1) {
    const offset = pixel * 4;
    const paletteIndex = pixelMap[pixel];
    if (paletteIndex === TRANSPARENT_INDEX || !palette[paletteIndex]) {
      output.data[offset + 3] = 0;
      continue;
    }
    const color = palette[paletteIndex];
    output.data[offset] = color.r;
    output.data[offset + 1] = color.g;
    output.data[offset + 2] = color.b;
    output.data[offset + 3] = alphaMap[pixel];
  }
  return output;
}

function smoothIndexedMap(
  width: number,
  height: number,
  source: Uint8Array,
  cleanup: CleanupLevel,
  palette: PaletteColor[],
) {
  const radii = {
    none: [] as number[],
    light: [1],
    medium: [1, 1],
    strong: [1, 2, 1],
  }[cleanup];
  let current = source.slice();

  for (const radius of radii) {
    const next = current.slice();
    const minimumDominance = radius === 1 ? 5 : 14;
    const minimumLead = radius === 1 ? 2 : 4;
    for (let y = radius; y < height - radius; y += 1) {
      for (let x = radius; x < width - radius; x += 1) {
        const offset = y * width + x;
        const counts = new Map<number, number>();
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const value = current[(y + dy) * width + x + dx];
            counts.set(value, (counts.get(value) ?? 0) + 1);
          }
        }
        let dominant = current[offset];
        let dominantCount = 0;
        for (const [value, count] of counts) {
          if (count > dominantCount) {
            dominant = value;
            dominantCount = count;
          }
        }
        const currentCount = counts.get(current[offset]) ?? 0;
        const protectsDistinctDetail = cleanup === "strong" &&
          current[offset] !== TRANSPARENT_INDEX &&
          dominant !== TRANSPARENT_INDEX &&
          isProtectedColorContrast(palette[current[offset]], palette[dominant]);
        if (
          dominant !== current[offset] &&
          !protectsDistinctDetail &&
          dominantCount >= minimumDominance &&
          dominantCount >= currentCount + minimumLead
        ) next[offset] = dominant;
      }
    }
    current = next;
  }
  return current;
}

function blurAndSnapIndexedMap(
  width: number,
  height: number,
  source: Uint8Array,
  alphaMap: Uint8ClampedArray,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
) {
  if (cleanup !== "medium" && cleanup !== "strong") return source.slice();

  const longestSide = Math.max(width, height);
  const blurRadius = cleanup === "strong"
    ? Math.max(2.8, Math.min(6, longestSide / 320))
    : Math.max(.75, Math.min(2, longestSide / 850));
  const sourceImage = renderPalette(width, height, source, alphaMap, palette);
  const sourceCanvas = canvasFromImageData(sourceImage);
  const blurredCanvas = document.createElement("canvas");
  blurredCanvas.width = width;
  blurredCanvas.height = height;
  const context = blurredCanvas.getContext("2d", { willReadFrequently: true });
  if (!context || !("filter" in context)) return source.slice();

  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = `blur(${blurRadius.toFixed(2)}px)`;
  context.drawImage(sourceCanvas, 0, 0);
  context.filter = "none";
  const blurred = context.getImageData(0, 0, width, height).data;
  const output = new Uint8Array(source.length).fill(TRANSPARENT_INDEX);

  for (let pixel = 0; pixel < source.length; pixel += 1) {
    if (source[pixel] === TRANSPARENT_INDEX || alphaMap[pixel] <= 8) continue;
    const offset = pixel * 4;
    let closest = source[pixel];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < palette.length; index += 1) {
      const distance = colorDistance(blurred[offset], blurred[offset + 1], blurred[offset + 2], palette[index]);
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = index;
      }
    }
    const protectsDistinctDetail = cleanup === "strong" &&
      closest !== source[pixel] &&
      isProtectedColorContrast(palette[source[pixel]], palette[closest]);
    output[pixel] = protectsDistinctDetail ? source[pixel] : closest;
  }

  return output;
}

function removeTinyComponents(
  width: number,
  height: number,
  source: Uint8Array,
  cleanup: CleanupLevel,
  palette: PaletteColor[],
) {
  const totalPixels = width * height;
  const minimumArea = {
    none: 0,
    light: Math.max(4, Math.round(totalPixels * .000004)),
    medium: Math.max(30, Math.round(totalPixels * .00004)),
    // Ultra intentionally keeps only substantial masses. This is deliberately
    // much stronger than pathomit: raster freckles are reassigned before they
    // can become connected subpaths inside an otherwise large color layer.
    strong: Math.max(600, Math.round(totalPixels * .0009)),
  }[cleanup];
  if (!minimumArea) return source.slice();

  const output = source.slice();
  const globalCounts = new Uint32Array(256);
  for (const color of output) globalCounts[color] += 1;
  const visited = new Uint8Array(output.length);
  const component = new Int32Array(output.length);
  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],             [1, 0],
    [-1, 1],  [0, 1],   [1, 1],
  ] as const;

  for (let start = 0; start < output.length; start += 1) {
    const colorIndex = output[start];
    if (visited[start] || colorIndex === TRANSPARENT_INDEX) continue;

    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    component[tail++] = start;
    visited[start] = 1;
    const boundaryCounts = new Map<number, number>();

    while (head < tail) {
      const pixel = component[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const nextPixel = nextY * width + nextX;
        const nextColor = output[nextPixel];
        if (nextColor === colorIndex) {
          if (!visited[nextPixel]) {
            visited[nextPixel] = 1;
            component[tail++] = nextPixel;
          }
        } else if (dx === 0 || dy === 0) {
          boundaryCounts.set(nextColor, (boundaryCounts.get(nextColor) ?? 0) + 1);
        }
      }
    }

    if (tail >= minimumArea) continue;
    let replacement = TRANSPARENT_INDEX;
    let strongestScore = -1;
    const hasVisibleBoundary = [...boundaryCounts.keys()].some((candidate) => candidate !== TRANSPARENT_INDEX);
    for (const [candidate, count] of boundaryCounts) {
      if (hasVisibleBoundary && candidate === TRANSPARENT_INDEX) continue;
      // Prefer the color sharing the longest boundary, then bias toward the
      // globally larger region. Edge freckles are absorbed into the body they
      // visually belong to instead of becoming holes or separate SVG pieces.
      const score = count * (1 + Math.log2(2 + globalCounts[candidate]));
      if (score > strongestScore) {
        replacement = candidate;
        strongestScore = score;
      }
    }
    const visibleBoundaries = [...boundaryCounts.entries()].filter(([candidate]) => candidate !== TRANSPARENT_INDEX);
    const touchesTransparency = boundaryCounts.has(TRANSPARENT_INDEX);
    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const compactness = tail / Math.max(1, componentWidth * componentHeight);
    const aspectRatio = Math.max(componentWidth / Math.max(1, componentHeight), componentHeight / Math.max(1, componentWidth));
    // Preserve a high-contrast eye or intentional dot only when it is a compact
    // island completely enclosed by one visible color. Edge antialiasing dots,
    // wedges, and fringe fragments touch transparency or several colors and
    // are therefore absorbed even when their sampled shade is high contrast.
    const intentionalInteriorDetail = cleanup === "strong" &&
      replacement !== TRANSPARENT_INDEX &&
      !touchesTransparency &&
      visibleBoundaries.length === 1 &&
      compactness >= .24 &&
      aspectRatio <= 4 &&
      isProtectedColorContrast(palette[colorIndex], palette[replacement]);
    if (intentionalInteriorDetail) continue;

    for (let index = 0; index < tail; index += 1) {
      output[component[index]] = replacement;
      globalCounts[colorIndex] = Math.max(0, globalCounts[colorIndex] - 1);
      globalCounts[replacement] += 1;
    }
  }

  return output;
}

type IndexedComponent = {
  colorIndex: number;
  pixels: number[];
  boundaryCounts: Map<number, number>;
  area: number;
  compactness: number;
  aspectRatio: number;
  touchesTransparency: boolean;
};

function collectIndexedComponents(width: number, height: number, source: Uint8Array) {
  const visited = new Uint8Array(source.length);
  const queue = new Int32Array(source.length);
  const components: IndexedComponent[] = [];
  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],             [1, 0],
    [-1, 1],  [0, 1],   [1, 1],
  ] as const;

  for (let start = 0; start < source.length; start += 1) {
    const colorIndex = source[start];
    if (visited[start] || colorIndex === TRANSPARENT_INDEX) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const pixels: number[] = [];
    const boundaryCounts = new Map<number, number>();
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const pixel = queue[head++];
      pixels.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          boundaryCounts.set(TRANSPARENT_INDEX, (boundaryCounts.get(TRANSPARENT_INDEX) ?? 0) + 1);
          continue;
        }
        const nextPixel = nextY * width + nextX;
        const nextColor = source[nextPixel];
        if (nextColor === colorIndex) {
          if (!visited[nextPixel]) {
            visited[nextPixel] = 1;
            queue[tail++] = nextPixel;
          }
        } else if (dx === 0 || dy === 0) {
          boundaryCounts.set(nextColor, (boundaryCounts.get(nextColor) ?? 0) + 1);
        }
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    components.push({
      colorIndex,
      pixels,
      boundaryCounts,
      area: pixels.length,
      compactness: pixels.length / Math.max(1, componentWidth * componentHeight),
      aspectRatio: Math.max(componentWidth / Math.max(1, componentHeight), componentHeight / Math.max(1, componentWidth)),
      touchesTransparency: boundaryCounts.has(TRANSPARENT_INDEX),
    });
  }
  return components;
}

function enforceComponentBudget(
  width: number,
  height: number,
  source: Uint8Array,
  palette: PaletteColor[],
) {
  const output = source.slice();

  for (let pass = 0; pass < 4; pass += 1) {
    const components = collectIndexedComponents(width, height, output);
    if (components.length <= MAX_FOREGROUND_COMPONENTS) break;
    const globalCounts = new Uint32Array(256);
    for (const color of output) globalCounts[color] += 1;
    const candidates = components.map((component) => {
      const visibleBoundaries = [...component.boundaryCounts.entries()].filter(([candidate]) => candidate !== TRANSPARENT_INDEX);
      let replacement = TRANSPARENT_INDEX;
      let bestScore = -1;
      for (const [candidate, boundaryLength] of visibleBoundaries) {
        const distancePenalty = 1 + colorDistance(
          palette[component.colorIndex]?.r ?? 0,
          palette[component.colorIndex]?.g ?? 0,
          palette[component.colorIndex]?.b ?? 0,
          palette[candidate] ?? { r: 0, g: 0, b: 0 },
        ) / 6500;
        const score = boundaryLength * (1 + Math.log2(2 + globalCounts[candidate])) / distancePenalty;
        if (score > bestScore) {
          replacement = candidate;
          bestScore = score;
        }
      }
      // A component surrounded only by transparency is still mergeable: it is
      // an isolated fleck and should disappear before tracing. Previously
      // those pieces were filtered out here and survived every object limit.
      const canMerge = visibleBoundaries.length > 0 || component.touchesTransparency;
      const intentionalInteriorDetail = replacement !== TRANSPARENT_INDEX &&
        !component.touchesTransparency &&
        visibleBoundaries.length === 1 &&
        component.compactness >= .24 &&
        component.aspectRatio <= 4 &&
        isProtectedColorContrast(palette[component.colorIndex], palette[replacement]);
      return { component, replacement, intentionalInteriorDetail, canMerge };
    }).filter(({ canMerge }) => canMerge).sort((first, second) => {
      if (first.intentionalInteriorDetail !== second.intentionalInteriorDetail) return first.intentionalInteriorDetail ? 1 : -1;
      return first.component.area - second.component.area;
    });

    let remaining = components.length;
    let changed = false;
    for (const candidate of candidates) {
      if (remaining <= MAX_FOREGROUND_COMPONENTS) break;
      for (const pixel of candidate.component.pixels) output[pixel] = candidate.replacement;
      remaining -= 1;
      changed = true;
    }
    if (!changed) break;
  }
  return output;
}

function cleanIndexedMap(
  width: number,
  height: number,
  source: Uint8Array,
  alphaMap: Uint8ClampedArray,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
) {
  if (cleanup === "none") return source.slice();
  // Blur the indexed color map and snap it straight back to the original
  // palette. Narrow spikes, dotted antialiasing bands, and one-pixel bridges
  // lose their local color majority and are absorbed into the nearest large
  // mass. Colors stay exact because no blended color reaches the SVG.
  const massOnlyMap = blurAndSnapIndexedMap(width, height, source, alphaMap, palette, cleanup);
  const withoutIslands = removeTinyComponents(width, height, massOnlyMap, cleanup, palette);
  const smoothed = smoothIndexedMap(width, height, withoutIslands, cleanup, palette);
  // Smoothing can leave a final one-pixel crescent at a former island edge.
  // Run component absorption once more so only substantial color masses reach
  // the vector tracer.
  const withoutFinalFringe = removeTinyComponents(width, height, smoothed, cleanup, palette);
  return enforceComponentBudget(width, height, withoutFinalFringe, palette);
}

function normalizePalette(
  width: number,
  height: number,
  pixelMap: Uint8Array,
  palette: PaletteColor[],
) {
  const counts = new Array(palette.length).fill(0);
  const edgeCounts = new Array(palette.length).fill(0);
  let visible = 0;
  let visibleEdge = 0;

  for (let pixel = 0; pixel < pixelMap.length; pixel += 1) {
    const index = pixelMap[pixel];
    if (index === TRANSPARENT_INDEX || !palette[index]) continue;
    counts[index] += 1;
    visible += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      edgeCounts[index] += 1;
      visibleEdge += 1;
    }
  }

  const order = counts
    .map((count, index) => ({ count, index }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);
  const likelyBackground = edgeCounts.reduce((best, count, index) => count > edgeCounts[best] ? index : best, 0);
  const backgroundConfidence = visibleEdge ? edgeCounts[likelyBackground] / visibleEdge : 0;
  const oldToNew = new Map(order.map(({ index }, newIndex) => [index, newIndex]));
  const normalizedMap = new Uint8Array(pixelMap.length).fill(TRANSPARENT_INDEX);
  pixelMap.forEach((oldIndex, pixel) => {
    if (oldIndex !== TRANSPARENT_INDEX) normalizedMap[pixel] = oldToNew.get(oldIndex) ?? TRANSPARENT_INDEX;
  });
  const normalizedPalette = order.map(({ index, count }) => ({
    ...palette[index],
    count,
    share: visible ? (count / visible) * 100 : 0,
    edgeShare: visibleEdge ? (edgeCounts[index] / visibleEdge) * 100 : 0,
    backgroundCandidate: index === likelyBackground && backgroundConfidence >= .45 && count / Math.max(1, visible) >= .08,
  }));

  return { pixelMap: normalizedMap, palette: normalizedPalette };
}

type VectorPoint = { x: number; y: number };

function roundCoordinate(value: number) {
  return Number(value.toFixed(2));
}

function distanceBetween(first: VectorPoint, second: VectorPoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function interiorAngle(previous: VectorPoint, current: VectorPoint, next: VectorPoint) {
  const incoming = { x: previous.x - current.x, y: previous.y - current.y };
  const outgoing = { x: next.x - current.x, y: next.y - current.y };
  const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
  if (!denominator) return 180;
  const cosine = Math.max(-1, Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator));
  return Math.acos(cosine) * (180 / Math.PI);
}

function reduceCurveAnchors(points: VectorPoint[], cleanup: CleanupLevel) {
  const minimumSpacing = { none: 0, light: .35, medium: .7, strong: 1.1 }[cleanup];
  const straightAngle = { none: 180, light: 179, medium: 177.5, strong: 175.5 }[cleanup];
  let reduced = points.filter((point, index) => index === 0 || distanceBetween(points[index - 1], point) > minimumSpacing);
  if (reduced.length > 2 && distanceBetween(reduced[0], reduced[reduced.length - 1]) <= minimumSpacing) reduced = reduced.slice(0, -1);

  // Remove only anchors that add virtually no curvature. The remaining
  // anchors are control landmarks, not polygon vertices: curves are fitted
  // between them in smoothClosedContour().
  for (let pass = 0; pass < 2 && reduced.length > 4; pass += 1) {
    reduced = reduced.filter((point, index, current) => {
      const previous = current[(index - 1 + current.length) % current.length];
      const next = current[(index + 1) % current.length];
      return interiorAngle(previous, point, next) < straightAngle;
    });
  }
  return reduced;
}

function resampleClosedAnchors(points: VectorPoint[], maximumAnchors: number) {
  if (points.length <= maximumAnchors) return points;
  const segmentLengths = points.map((point, index) => distanceBetween(point, points[(index + 1) % points.length]));
  const perimeter = segmentLengths.reduce((total, length) => total + length, 0);
  if (!perimeter) return points.slice(0, maximumAnchors);
  const anchors: VectorPoint[] = [];
  let segment = 0;
  let travelled = 0;

  for (let anchor = 0; anchor < maximumAnchors; anchor += 1) {
    const target = (anchor / maximumAnchors) * perimeter;
    while (segment < segmentLengths.length - 1 && travelled + segmentLengths[segment] < target) {
      travelled += segmentLengths[segment];
      segment += 1;
    }
    const start = points[segment];
    const end = points[(segment + 1) % points.length];
    const ratio = segmentLengths[segment] ? (target - travelled) / segmentLengths[segment] : 0;
    anchors.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
  }
  return anchors;
}

function smoothClosedContour(points: VectorPoint[], cleanup: CleanupLevel, maximumAnchors = Number.POSITIVE_INFINITY) {
  const reduced = reduceCurveAnchors(points, cleanup);
  const anchors = Number.isFinite(maximumAnchors)
    ? resampleClosedAnchors(reduced, Math.max(3, Math.floor(maximumAnchors)))
    : reduced;
  if (anchors.length < 3 || cleanup === "none") return "";
  const smoothing = { light: .74, medium: .9, strong: 1 }[cleanup];
  const cornerLimit = { light: 94, medium: 102, strong: 108 }[cleanup];
  const isCorner = anchors.map((point, index) => interiorAngle(
    anchors[(index - 1 + anchors.length) % anchors.length],
    point,
    anchors[(index + 1) % anchors.length],
  ) <= cornerLimit);
  const commands = [`M ${roundCoordinate(anchors[0].x)} ${roundCoordinate(anchors[0].y)}`];

  for (let index = 0; index < anchors.length; index += 1) {
    const previous = anchors[(index - 1 + anchors.length) % anchors.length];
    const current = anchors[index];
    const next = anchors[(index + 1) % anchors.length];
    const afterNext = anchors[(index + 2) % anchors.length];
    const firstControl = isCorner[index]
      ? { x: current.x + (next.x - current.x) / 3, y: current.y + (next.y - current.y) / 3 }
      : { x: current.x + ((next.x - previous.x) * smoothing) / 6, y: current.y + ((next.y - previous.y) * smoothing) / 6 };
    const secondControl = isCorner[(index + 1) % anchors.length]
      ? { x: next.x - (next.x - current.x) / 3, y: next.y - (next.y - current.y) / 3 }
      : { x: next.x - ((afterNext.x - current.x) * smoothing) / 6, y: next.y - ((afterNext.y - current.y) * smoothing) / 6 };
    commands.push(
      `C ${roundCoordinate(firstControl.x)} ${roundCoordinate(firstControl.y)} ${roundCoordinate(secondControl.x)} ${roundCoordinate(secondControl.y)} ${roundCoordinate(next.x)} ${roundCoordinate(next.y)}`,
    );
  }
  commands.push("Z");
  return commands.join(" ");
}

type SvgContour = {
  data: string;
  area: number;
  isHole: boolean;
};

function contourArea(points: VectorPoint[]) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2);
}

function contourPoints(pathData: string) {
  const tokens = pathData.match(/[MLQCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points: VectorPoint[] = [];
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++].toUpperCase();
    if (command === "M" || command === "L") {
      points.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
    } else if (command === "Q") {
      index += 2;
      points.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
    } else if (command === "C") {
      index += 4;
      points.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
    }
  }
  return points;
}

function curvedPathContours(path: string, cleanup: CleanupLevel): SvgContour[] {
  const pathData = path.match(/\sd="([^"]*)"/)?.[1];
  if (!pathData) return [];
  const rawContours = pathData.match(/[Mm][^Mm]*/g) ?? [pathData];
  const prepared = rawContours.map((raw) => {
    const points = contourPoints(raw);
    const smoothed = cleanup === "none" ? raw.trim() : smoothClosedContour(points, cleanup);
    return { data: smoothed || raw.trim(), area: contourArea(points), isHole: false };
  }).filter((contour) => contour.data && contour.area > 0);
  if (!prepared.length) return prepared;

  // ImageTracer stores an outer contour followed by any cut-outs in the same
  // path. The largest contour is the mass; the smaller ones are holes and are
  // the first candidates to remove when enforcing the final SVG object cap.
  const outerIndex = prepared.reduce((largest, contour, index) => contour.area > prepared[largest].area ? index : largest, 0);
  return prepared.map((contour, index) => ({ ...contour, isHole: index !== outerIndex }));
}

function allocateAnchorBudgets(contours: Array<SvgContour & { score: number }>) {
  if (!contours.length) return [] as number[];
  const minimumPerContour = 3;
  const baseTotal = contours.length * minimumPerContour;
  let remaining = Math.max(0, MAX_VECTOR_ANCHORS - baseTotal);
  const weights = contours.map((contour) => Math.max(1, Math.sqrt(contour.area) * Math.log2(2 + contour.score / Math.max(1, contour.area))));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const budgets = weights.map((weight) => minimumPerContour + Math.floor(remaining * weight / totalWeight));
  remaining = MAX_VECTOR_ANCHORS - budgets.reduce((total, budget) => total + budget, 0);
  const order = weights.map((weight, index) => ({ weight, index })).sort((first, second) => second.weight - first.weight);
  for (let cursor = 0; remaining > 0; cursor = (cursor + 1) % order.length) {
    budgets[order[cursor].index] += 1;
    remaining -= 1;
  }
  return budgets;
}

function compoundPath(pathData: string[], color: string, strokeWidth: number) {
  if (!pathData.length) return "";
  return `<path fill="${color}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" clip-rule="evenodd" shape-rendering="geometricPrecision" d="${pathData.join(" ")}"/>`;
}

function traceImage(imageData: ImageData, palette: PaletteColor[], cleanup: CleanupLevel) {
  const traceSettings = {
    // Keep the straight-line threshold deliberately low. ImageTracer tries a
    // line before a spline, so raising both thresholds creates a handful of
    // obvious polygon edges. A low line threshold plus a progressively wider
    // quadratic threshold keeps fewer anchors while joining them with curves.
    none: { pathOmit: 1, lineTolerance: .45, curveTolerance: .8, blur: 0, blurDelta: 22, stroke: .25, maximumDimension: 1400 },
    light: { pathOmit: 8, lineTolerance: .14, curveTolerance: 1.7, blur: 1, blurDelta: 28, stroke: .35, maximumDimension: 1200 },
    medium: { pathOmit: 24, lineTolerance: .045, curveTolerance: 3.2, blur: 1, blurDelta: 38, stroke: .45, maximumDimension: 1000 },
    strong: { pathOmit: 96, lineTolerance: .012, curveTolerance: 5.6, blur: 2, blurDelta: 52, stroke: .55, maximumDimension: 900 },
  }[cleanup];
  const tracing = resizeForTracing(imageData, traceSettings.maximumDimension);
  const traceImageData = tracing.imageData;
  const hasTransparency = traceImageData.data.some((value, index) => index % 4 === 3 && value < 10);
  const tracePalette = palette.map(({ r, g, b }) => ({ r, g, b, a: 255 }));
  if (hasTransparency) tracePalette.push({ r: 0, g: 0, b: 0, a: 0 });

  const rawSvg = ImageTracer.imagedataToSVG(traceImageData, {
    ltres: traceSettings.lineTolerance,
    qtres: traceSettings.curveTolerance,
    pathomit: traceSettings.pathOmit,
    rightangleenhance: false,
    colorsampling: 0,
    numberofcolors: tracePalette.length,
    colorquantcycles: 1,
    layering: 0,
    blurradius: traceSettings.blur,
    blurdelta: traceSettings.blurDelta,
    strokewidth: traceSettings.stroke,
    linefilter: cleanup !== "none",
    scale: 1,
    roundcoords: 2,
    viewbox: true,
    desc: true,
    pal: tracePalette,
  });

  // A single union silhouette in the dominant color sits behind every color
  // layer. It closes antialiasing hairlines between neighboring shapes without
  // adding artificial outlines or changing the visible palette.
  const silhouetteData = new ImageData(traceImageData.width, traceImageData.height);
  const dominant = palette[0] ?? { r: 0, g: 0, b: 0 };
  for (let pixel = 0; pixel < traceImageData.width * traceImageData.height; pixel += 1) {
    const offset = pixel * 4;
    if (traceImageData.data[offset + 3] <= 8) continue;
    silhouetteData.data[offset] = dominant.r;
    silhouetteData.data[offset + 1] = dominant.g;
    silhouetteData.data[offset + 2] = dominant.b;
    silhouetteData.data[offset + 3] = 255;
  }
  const silhouetteSvg = ImageTracer.imagedataToSVG(silhouetteData, {
    ltres: traceSettings.lineTolerance,
    qtres: traceSettings.curveTolerance,
    pathomit: traceSettings.pathOmit,
    rightangleenhance: false,
    colorsampling: 0,
    numberofcolors: 2,
    colorquantcycles: 1,
    layering: 0,
    blurradius: traceSettings.blur,
    blurdelta: traceSettings.blurDelta,
    strokewidth: Math.max(.75, traceSettings.stroke),
    linefilter: cleanup !== "none",
    scale: 1,
    roundcoords: 2,
    viewbox: true,
    desc: true,
    pal: [{ ...dominant, a: 255 }, { r: 0, g: 0, b: 0, a: 0 }],
  });
  const silhouetteContours: SvgContour[] = [];
  for (const match of silhouetteSvg.matchAll(/<path\s+[^>]*desc="l\s+0\s+p\s+\d+"[^>]*\/>/g)) {
    silhouetteContours.push(...curvedPathContours(match[0], cleanup));
  }

  type LayerContour = SvgContour & { layer: number; score: number; key: string; base: boolean; distinct: boolean };
  const allContours: LayerContour[] = silhouetteContours.map((contour, index) => ({
    ...contour,
    layer: -1,
    key: `base-${index}`,
    base: true,
    distinct: false,
    // Keep each substantial outer silhouette before internal cut-outs. The
    // base closes hairline gaps, so losing a tiny base hole fills rather than
    // exposes a visible speck.
    score: contour.area * (contour.isHole ? .04 : 40),
  }));

  for (const match of rawSvg.matchAll(/<path\s+[^>]*desc="l\s+(\d+)\s+p\s+\d+"[^>]*\/>/g)) {
    const layer = Number(match[1]);
    if (!palette[layer]) continue;
    const otherColors = palette.filter((_, index) => index !== layer);
    const nearestColorDistance = otherColors.reduce((nearest, color) => Math.min(
      nearest,
      colorDistance(palette[layer].r, palette[layer].g, palette[layer].b, color),
    ), Number.POSITIVE_INFINITY);
    // Distinct small marks such as dark eyes outrank similarly-sized
    // antialias shades, while area remains the primary signal.
    const contrastBonus = nearestColorDistance > 150 * 150 ? 5 : nearestColorDistance > 80 * 80 ? 2.4 : 1;
    const distinct = nearestColorDistance > 80 * 80;
    const contours = curvedPathContours(match[0], cleanup);
    contours.forEach((contour, index) => allContours.push({
      ...contour,
      layer,
      key: `layer-${layer}-${match.index ?? 0}-${index}`,
      base: false,
      distinct,
      score: contour.area * contrastBonus * (contour.isHole ? .06 : 1),
    }));
  }

  const traceArea = traceImageData.width * traceImageData.height;
  const minimumContourArea = traceArea * ({ none: .00008, light: .00012, medium: .0002, strong: .00035 }[cleanup]);
  const largestBaseArea = allContours.filter((contour) => contour.base && !contour.isHole).reduce((largest, contour) => Math.max(largest, contour.area), 0);
  const substantialContours = allContours.filter((contour) => {
    if (contour.base && !contour.isHole) return contour.area === largestBaseArea || contour.area >= minimumContourArea;
    if (contour.isHole) return contour.area >= minimumContourArea * 2.5;
    return contour.area >= minimumContourArea * (contour.distinct ? .35 : 1);
  });
  const maximumContourCount = Math.min(MAX_VECTOR_OBJECTS, Math.floor(MAX_VECTOR_ANCHORS / 3));
  const selectedKeys = new Set(
    [...substantialContours]
      .sort((first, second) => second.score - first.score || second.area - first.area)
      .slice(0, maximumContourCount)
      .map((contour) => contour.key),
  );
  const selectedContours = allContours.filter((contour) => selectedKeys.has(contour.key));
  const anchorBudgets = allocateAnchorBudgets(selectedContours);
  const budgetedContours = selectedContours.map((contour, index) => {
    const points = contourPoints(contour.data);
    const curveCleanup = cleanup === "none" ? "light" : cleanup;
    return {
      ...contour,
      data: smoothClosedContour(points, curveCleanup, anchorBudgets[index]) || contour.data,
    };
  });
  const silhouettePaths = budgetedContours.filter((contour) => contour.base).map((contour) => contour.data);
  const basePath = compoundPath(silhouettePaths, palette[0]?.hex ?? "#000000", Math.max(.75, traceSettings.stroke));
  const baseLayer = silhouettePaths.length
    ? `<g id="vector-base-layer" class="vector-layer vector-base-layer" data-base-layer="true" data-color-index="0" data-color="${palette[0]?.hex ?? "#000000"}" transform="scale(${tracing.scaleX.toFixed(6)} ${tracing.scaleY.toFixed(6)})">${basePath}</g>`
    : "";

  const pathsByLayer = palette.map(() => [] as string[]);
  budgetedContours.forEach((contour) => {
    if (!contour.base && pathsByLayer[contour.layer]) pathsByLayer[contour.layer].push(contour.data);
  });
  const layers = pathsByLayer.map((paths, index) => {
    if (!paths.length) return "";
    const color = palette[index];
    // One compound path per color keeps Illustrator's Layers panel clean. All
    // substantial islands of the same color remain editable as subpaths, but
    // they no longer arrive as hundreds of separate dot objects.
    const path = compoundPath(paths, color.hex, traceSettings.stroke);
    return `<g id="vector-layer-${index + 1}" class="vector-layer" data-color-index="${index}" data-color="${color.hex}" data-share="${color.share.toFixed(2)}" transform="scale(${tracing.scaleX.toFixed(6)} ${tracing.scaleY.toFixed(6)})">${path}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageData.width} ${imageData.height}" width="${imageData.width}" height="${imageData.height}" shape-rendering="geometricPrecision" role="img" aria-label="Layered vector artwork">${baseLayer}${layers}</svg>`;
}

function resultFromParts(
  width: number,
  height: number,
  pixelMap: Uint8Array,
  alphaMap: Uint8ClampedArray,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
): VectorResult {
  const budgetedMap = enforceComponentBudget(width, height, pixelMap, palette);
  const normalized = normalizePalette(width, height, budgetedMap, palette);
  const imageData = renderPalette(width, height, normalized.pixelMap, alphaMap, normalized.palette);
  const svg = traceImage(imageData, normalized.palette, cleanup);
  return {
    width,
    height,
    pixelMap: normalized.pixelMap,
    alphaMap,
    palette: normalized.palette,
    imageData,
    previewUrl: imageDataToUrl(imageData),
    svg,
    // Count Illustrator-visible subpaths, not only our colour-layer wrappers.
    // Every retained object starts with an SVG moveto command.
    pathCount: (svg.match(/\bM\s+-?\d/gi) ?? []).length,
    nodeCount: (svg.match(/\b[MLQC]\s/g) ?? []).length,
    fileSize: new Blob([svg], { type: "image/svg+xml" }).size,
  };
}

export function createVectorResult(source: RasterSource, colorCount: number, cleanup: CleanupLevel) {
  const { data, width, height } = source.imageData;
  const opaquePixels = Math.max(1, data.length / 4);
  const sampleStep = Math.max(1, Math.floor(opaquePixels / 220000));
  const sample: number[] = [];

  for (let pixel = 0; pixel < opaquePixels; pixel += sampleStep) {
    const offset = pixel * 4;
    if (data[offset + 3] > 8) sample.push(data[offset], data[offset + 1], data[offset + 2], 255);
  }
  if (!sample.length) throw new Error("The image is fully transparent.");

  const sampleContainer = utils.PointContainer.fromUint8Array(new Uint8ClampedArray(sample), sample.length / 4, 1);
  const builtPalette = buildPaletteSync([sampleContainer], {
    colors: colorCount,
    paletteQuantization: "wuquant",
    colorDistanceFormula: "euclidean-bt709",
  });
  const candidates = builtPalette.getPointContainer().getPointArray().map((point) => ({ r: point.r, g: point.g, b: point.b }));
  const pixelMapUnsorted = new Uint8Array(opaquePixels).fill(TRANSPARENT_INDEX);
  const alphaMap = new Uint8ClampedArray(opaquePixels);
  const counts = new Array(candidates.length).fill(0);

  for (let pixel = 0; pixel < opaquePixels; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3];
    alphaMap[pixel] = alpha;
    if (alpha <= 8) continue;
    let closest = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < candidates.length; index += 1) {
      const distance = colorDistance(data[offset], data[offset + 1], data[offset + 2], candidates[index]);
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = index;
      }
    }
    pixelMapUnsorted[pixel] = closest;
    counts[closest] += 1;
  }

  const visibleTotal = counts.reduce((total, count) => total + count, 0);
  const order = counts.map((count, index) => ({ count, index })).filter(({ count }) => count > 0).sort((a, b) => b.count - a.count);
  const indexMap = new Map(order.map((entry, index) => [entry.index, index]));
  const pixelMap = new Uint8Array(opaquePixels).fill(TRANSPARENT_INDEX);
  for (let pixel = 0; pixel < opaquePixels; pixel += 1) {
    const originalIndex = pixelMapUnsorted[pixel];
    if (originalIndex !== TRANSPARENT_INDEX) pixelMap[pixel] = indexMap.get(originalIndex) ?? TRANSPARENT_INDEX;
  }
  const palette: PaletteColor[] = order.map(({ count, index }, sortedIndex) => {
    const color = candidates[index];
    return {
      id: `color-${Date.now()}-${sortedIndex}`,
      ...color,
      a: 255,
      hex: rgbToHex(color.r, color.g, color.b),
      count,
      share: visibleTotal ? (count / visibleTotal) * 100 : 0,
      edgeShare: 0,
      backgroundCandidate: false,
      locked: false,
    };
  });

  return resultFromParts(
    width,
    height,
    cleanIndexedMap(width, height, pixelMap, alphaMap, palette, cleanup),
    alphaMap,
    palette,
    cleanup,
  );
}

export function recolorResult(result: VectorResult, palette: PaletteColor[], cleanup: CleanupLevel) {
  return resultFromParts(result.width, result.height, result.pixelMap, result.alphaMap, palette, cleanup);
}

export function mergeResult(result: VectorResult, selected: number[], cleanup: CleanupLevel) {
  const eligible = [...new Set(selected)].filter((index) => result.palette[index] && !result.palette[index].locked).sort((a, b) => a - b);
  if (eligible.length < 2) return result;
  const keep = eligible[0];
  const removed = new Set(eligible.slice(1));
  const oldToNew = new Map<number, number>();
  const palette = result.palette.filter((_, index) => !removed.has(index)).map((color, newIndex) => {
    const oldIndex = result.palette.findIndex((item) => item.id === color.id);
    oldToNew.set(oldIndex, newIndex);
    return { ...color, count: 0, share: 0 };
  });
  const keepNewIndex = oldToNew.get(keep) ?? 0;
  for (const oldIndex of removed) oldToNew.set(oldIndex, keepNewIndex);
  const pixelMap = new Uint8Array(result.pixelMap.length).fill(TRANSPARENT_INDEX);
  let visible = 0;
  result.pixelMap.forEach((oldIndex, pixel) => {
    if (oldIndex === TRANSPARENT_INDEX) return;
    const nextIndex = oldToNew.get(oldIndex) ?? keepNewIndex;
    pixelMap[pixel] = nextIndex;
    palette[nextIndex].count += 1;
    visible += 1;
  });
  palette.forEach((color) => { color.share = visible ? (color.count / visible) * 100 : 0; });
  return resultFromParts(result.width, result.height, pixelMap, result.alphaMap, palette, cleanup);
}

export function deleteColors(
  result: VectorResult,
  selected: number[],
  cleanup: CleanupLevel,
  protectedMask?: Uint8Array,
) {
  const removed = new Set([...new Set(selected)].filter((index) => result.palette[index] && !result.palette[index].locked));
  if (!removed.size || removed.size >= result.palette.length) return result;
  const pixelMap = result.pixelMap.slice();
  let deletedPixels = 0;
  result.pixelMap.forEach((oldIndex, pixel) => {
    if (oldIndex === TRANSPARENT_INDEX || !removed.has(oldIndex) || protectedMask?.[pixel]) return;
    pixelMap[pixel] = TRANSPARENT_INDEX;
    deletedPixels += 1;
  });
  if (!deletedPixels) return result;
  return resultFromParts(
    result.width,
    result.height,
    pixelMap,
    result.alphaMap,
    result.palette.map((color) => ({ ...color })),
    cleanup,
  );
}

export function highlightSvg(svg: string, selected: number[]) {
  if (!selected.length) return svg;
  const chosen = new Set(selected);
  const highlighted = svg.replace(/<g\b([^>]*data-color-index="(\d+)"[^>]*)>/g, (match, attrs: string, rawIndex: string) => {
    const active = chosen.has(Number(rawIndex));
    return `<g${attrs} data-highlighted="${active ? "true" : "false"}">`;
  });
  const selectionStyle = `<style>.vector-base-layer{opacity:0!important;filter:none!important}.vector-layer[data-highlighted="false"]{opacity:.1}.vector-layer[data-highlighted="true"]{opacity:1;filter:drop-shadow(0 0 1.8px #ff604f)}</style>`;
  return highlighted.replace(/<svg\b([^>]*)>/, `<svg$1>${selectionStyle}`);
}

export function applyPreset(result: VectorResult, preset: string[], cleanup: CleanupLevel) {
  const editable = result.palette.map((color, index) => ({ color, index })).filter(({ color }) => !color.locked);
  const byLuminance = editable.sort((a, b) => (a.color.r * .299 + a.color.g * .587 + a.color.b * .114) - (b.color.r * .299 + b.color.g * .587 + b.color.b * .114));
  const next = result.palette.map((color) => ({ ...color }));
  byLuminance.forEach(({ index }, rank) => {
    const position = byLuminance.length === 1 ? 0 : (rank / (byLuminance.length - 1)) * (preset.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(preset.length - 1, Math.ceil(position));
    const mix = position - lower;
    const from = hexToRgb(preset[lower]);
    const to = hexToRgb(preset[upper]);
    const rgb = {
      r: Math.round(from.r + (to.r - from.r) * mix),
      g: Math.round(from.g + (to.g - from.g) * mix),
      b: Math.round(from.b + (to.b - from.b) * mix),
    };
    next[index] = { ...next[index], ...rgb, hex: rgbToHex(rgb.r, rgb.g, rgb.b) };
  });
  return recolorResult(result, next, cleanup);
}

export function cropSvg(svg: string, crop: CropBox) {
  const width = Math.max(1, Math.round(crop.width * 10) / 10);
  const height = Math.max(1, Math.round(crop.height * 10) / 10);
  let output = svg.replace(/<svg\b([^>]*)>/, (match, attrs: string) => {
    const clean = attrs
      .replace(/\swidth=("[^"]*"|'[^']*')/i, "")
      .replace(/\sheight=("[^"]*"|'[^']*')/i, "")
      .replace(/\sviewBox=("[^"]*"|'[^']*')/i, "");
    return `<svg${clean} width="${width}" height="${height}" viewBox="${crop.x} ${crop.y} ${width} ${height}">`;
  });
  if (!/xmlns=/.test(output.slice(0, 300))) output = output.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return output;
}

export function getVisibleBounds(result: VectorResult, padding = 1): CropBox {
  let minX = result.width;
  let minY = result.height;
  let maxX = -1;
  let maxY = -1;

  for (let pixel = 0; pixel < result.pixelMap.length; pixel += 1) {
    if (result.pixelMap[pixel] === TRANSPARENT_INDEX || result.alphaMap[pixel] <= 8) continue;
    const x = pixel % result.width;
    const y = Math.floor(pixel / result.width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (maxX < minX || maxY < minY) return { x: 0, y: 0, width: result.width, height: result.height };
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(result.width, maxX + 1 + padding);
  const bottom = Math.min(result.height, maxY + 1 + padding);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function getSeparateObjectBounds(result: VectorResult, padding = 2): ObjectRegion[] {
  const visited = new Uint8Array(result.pixelMap.length);
  const queue = new Int32Array(result.pixelMap.length);
  const minimumArea = Math.max(24, Math.round(result.width * result.height * .00004));
  const objects: ObjectRegion[] = [];

  for (let start = 0; start < result.pixelMap.length; start += 1) {
    if (visited[start] || result.pixelMap[start] === TRANSPARENT_INDEX || result.alphaMap[start] <= 8) continue;
    let head = 0;
    let tail = 0;
    let minX = result.width;
    let minY = result.height;
    let maxX = -1;
    let maxY = -1;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % result.width;
      const y = Math.floor(pixel / result.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= result.width || nextY >= result.height) continue;
          const nextPixel = nextY * result.width + nextX;
          if (visited[nextPixel] || result.pixelMap[nextPixel] === TRANSPARENT_INDEX || result.alphaMap[nextPixel] <= 8) continue;
          visited[nextPixel] = 1;
          queue[tail++] = nextPixel;
        }
      }
    }

    if (tail < minimumArea) continue;
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const right = Math.min(result.width, maxX + 1 + padding);
    const bottom = Math.min(result.height, maxY + 1 + padding);
    objects.push({ x, y, width: right - x, height: bottom - y, area: tail, seed: start });
  }

  return objects.sort((first, second) => second.area - first.area);
}

export function extractObjectResult(
  result: VectorResult,
  region: ObjectRegion,
  cleanup: CleanupLevel,
) {
  const included = new Uint8Array(result.pixelMap.length);
  const queue = new Int32Array(result.pixelMap.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = region.seed;
  included[region.seed] = 1;

  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % result.width;
    const y = Math.floor(pixel / result.width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= result.width || nextY >= result.height) continue;
        const nextPixel = nextY * result.width + nextX;
        if (
          included[nextPixel] ||
          result.pixelMap[nextPixel] === TRANSPARENT_INDEX ||
          result.alphaMap[nextPixel] <= 8
        ) continue;
        included[nextPixel] = 1;
        queue[tail++] = nextPixel;
      }
    }
  }

  const sourceX = Math.max(0, Math.floor(region.x));
  const sourceY = Math.max(0, Math.floor(region.y));
  const width = Math.max(1, Math.min(result.width - sourceX, Math.ceil(region.width)));
  const height = Math.max(1, Math.min(result.height - sourceY, Math.ceil(region.height)));
  const pixelMap = new Uint8Array(width * height).fill(TRANSPARENT_INDEX);
  const alphaMap = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourcePixel = (sourceY + y) * result.width + sourceX + x;
      if (!included[sourcePixel]) continue;
      const targetPixel = y * width + x;
      pixelMap[targetPixel] = result.pixelMap[sourcePixel];
      alphaMap[targetPixel] = result.alphaMap[sourcePixel];
    }
  }

  // Rebuild the SVG from the isolated raster component. This is intentionally
  // different from changing viewBox: paths for every other illustration are
  // absent from the downloaded file, including beyond the Illustrator canvas.
  return resultFromParts(
    width,
    height,
    pixelMap,
    alphaMap,
    result.palette.map((color) => ({ ...color })),
    cleanup,
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function requestSaveHandle(filename: string, description: string, mime: string, extension: string) {
  const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<SaveHandle> }).showSaveFilePicker;
  if (!picker) return { handle: null, cancelled: false };
  try {
    const handle = await picker.call(window, {
      suggestedName: filename,
      types: [{ description, accept: { [mime]: [extension] } }],
    });
    return { handle, cancelled: false };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { handle: null, cancelled: true };
    return { handle: null, cancelled: false };
  }
}

async function finishDownload(blob: Blob, filename: string, handle: SaveHandle | null) {
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved" as const;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded" as const;
}

export async function downloadText(content: string, filename: string, type: string) {
  const choice = await requestSaveHandle(filename, "SVG artwork", type, ".svg");
  if (choice.cancelled) return "cancelled" as const;
  return finishDownload(new Blob([content], { type }), filename, choice.handle);
}

export async function downloadPng(svg: string, crop: CropBox, scale: number, filename: string) {
  const choice = await requestSaveHandle(filename, "PNG image", "image/png", ".png");
  if (choice.cancelled) return "cancelled" as const;
  const cropped = cropSvg(svg, crop);
  const blobUrl = URL.createObjectURL(new Blob([cropped], { type: "image/svg+xml" }));
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("PNG export failed."));
    image.src = blobUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(blobUrl);
  const pngBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG export failed.")), "image/png"));
  return finishDownload(pngBlob, filename, choice.handle);
}
