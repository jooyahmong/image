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
  cubicCount: number;
  curveRatio: number;
  artworkCount: number;
  maxArtworkObjectCount: number;
  fileSize: number;
  anchorSimplification: number;
};

export type CropBox = { x: number; y: number; width: number; height: number };

export type ObjectRegion = CropBox & {
  seed: number;
  area: number;
};

const MAX_PROCESSING_DIMENSION = 1600;
const TRANSPARENT_INDEX = 255;
// Canvas returns un-premultiplied RGB values. On a very low-alpha edge pixel,
// that division can amplify tiny channel differences into colors that never
// existed in the artwork. Keep those pixels out of both palette sampling and
// the indexed label map; the alpha channel, not their unstable RGB, owns the
// outer boundary.
export const ALPHA_CUT = 128;
export const MAX_VECTOR_OBJECTS = 25;

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

function resizeForTracing(imageData: ImageData, minimumDimension: number, maximumDimension: number) {
  const longestSide = Math.max(imageData.width, imageData.height);
  const targetDimension = longestSide < minimumDimension
    ? Math.min(maximumDimension, minimumDimension)
    : Math.min(longestSide, maximumDimension);
  if (targetDimension === longestSide) {
    return { imageData, scaleX: 1, scaleY: 1 };
  }

  const ratio = targetDimension / longestSide;
  const width = Math.max(1, Math.round(imageData.width * ratio));
  const height = Math.max(1, Math.round(imageData.height * ratio));
  const source = canvasFromImageData(imageData);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { imageData, scaleX: 1, scaleY: 1 };
  // The input is already an exact palette label map. Nearest-neighbor
  // downsampling keeps those labels discrete instead of recreating blended
  // antialias colors along every edge.
  context.imageSmoothingEnabled = false;
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
      if (data[(y * width + x) * 4 + 3] >= ALPHA_CUT) {
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
) {
  const radii = {
    none: [] as number[],
    light: [1],
    medium: [1],
    strong: [1],
  }[cleanup];
  let current = source.slice();

  for (const radius of radii) {
    const next = current.slice();
    for (let y = radius; y < height - radius; y += 1) {
      for (let x = radius; x < width - radius; x += 1) {
        const offset = y * width + x;
        // The binary alpha cutoff owns the transparent boundary. Never let a
        // label-mode pass grow or erode that boundary by voting transparency
        // against nearby visible colors.
        if (current[offset] === TRANSPARENT_INDEX) continue;
        const counts = new Map<number, number>();
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const value = current[(y + dy) * width + x + dx];
            if (value === TRANSPARENT_INDEX) continue;
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
        // True label-mode filtering: ties keep the original label. This is
        // deliberately not an RGB blur, so no new fringe shades are created.
        if (dominant !== current[offset] && dominantCount > currentCount) next[offset] = dominant;
      }
    }
    current = next;
  }
  return current;
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
    medium: Math.max(10, Math.round(totalPixels * .00002)),
    // Ultra removes antialias crumbs without treating a deliberate bow, dot,
    // eye, line, or pattern as disposable merely because the upload is a sheet
    // containing several illustrations.
    strong: Math.max(16, Math.round(totalPixels * .00004)),
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

function findLikelyBackgroundIndex(width: number, height: number, source: Uint8Array) {
  const counts = new Uint32Array(256);
  const edgeCounts = new Uint32Array(256);
  let visible = 0;
  let edgeTotal = 0;
  for (let pixel = 0; pixel < source.length; pixel += 1) {
    const color = source[pixel];
    counts[color] += 1;
    if (color !== TRANSPARENT_INDEX) visible += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      edgeCounts[color] += 1;
      edgeTotal += 1;
    }
  }
  let candidate = TRANSPARENT_INDEX;
  for (let index = 0; index < edgeCounts.length; index += 1) {
    if (edgeCounts[index] > edgeCounts[candidate]) candidate = index;
  }
  if (candidate === TRANSPARENT_INDEX) return TRANSPARENT_INDEX;
  const edgeConfidence = edgeTotal ? edgeCounts[candidate] / edgeTotal : 0;
  const imageShare = visible ? counts[candidate] / visible : 0;
  return edgeConfidence >= .45 && imageShare >= .08 ? candidate : TRANSPARENT_INDEX;
}

function labelArtworkRegions(width: number, height: number, source: Uint8Array) {
  const backgroundIndex = findLikelyBackgroundIndex(width, height, source);
  const labels = new Int32Array(source.length).fill(-1);
  const queue = new Int32Array(source.length);
  let artworkCount = 0;

  for (let start = 0; start < source.length; start += 1) {
    if (labels[start] !== -1 || source[start] === TRANSPARENT_INDEX || source[start] === backgroundIndex) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = artworkCount;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          const nextPixel = nextY * width + nextX;
          if (
            labels[nextPixel] !== -1 ||
            source[nextPixel] === TRANSPARENT_INDEX ||
            source[nextPixel] === backgroundIndex
          ) continue;
          labels[nextPixel] = artworkCount;
          queue[tail++] = nextPixel;
        }
      }
    }
    artworkCount += 1;
  }
  return { labels, artworkCount, backgroundIndex };
}

function artworkComponentCounts(width: number, height: number, source: Uint8Array) {
  const { labels, artworkCount, backgroundIndex } = labelArtworkRegions(width, height, source);
  const counts = new Uint16Array(Math.max(1, artworkCount));
  for (const component of collectIndexedComponents(width, height, source)) {
    if (component.colorIndex === backgroundIndex || component.colorIndex === TRANSPARENT_INDEX) continue;
    const artwork = labels[component.pixels[0]];
    if (artwork >= 0) counts[artwork] += 1;
  }
  return {
    artworkCount: Math.max(1, artworkCount),
    maxArtworkObjectCount: counts.reduce((largest, count) => Math.max(largest, count), 0),
  };
}

function enforceComponentBudget(
  width: number,
  height: number,
  source: Uint8Array,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
) {
  if (cleanup !== "strong") return source.slice();
  const output = source.slice();

  for (let pass = 0; pass < 4; pass += 1) {
    const { labels, backgroundIndex } = labelArtworkRegions(width, height, output);
    const components = collectIndexedComponents(width, height, output);
    const countsByArtwork = new Map<number, number>();
    for (const component of components) {
      if (component.colorIndex === backgroundIndex || component.colorIndex === TRANSPARENT_INDEX) continue;
      const artwork = labels[component.pixels[0]];
      if (artwork >= 0) countsByArtwork.set(artwork, (countsByArtwork.get(artwork) ?? 0) + 1);
    }
    if ([...countsByArtwork.values()].every((count) => count <= MAX_VECTOR_OBJECTS)) break;
    const globalCounts = new Uint32Array(256);
    for (const color of output) globalCounts[color] += 1;
    const candidates = components.map((component) => {
      const artwork = labels[component.pixels[0]];
      const visibleBoundaries = [...component.boundaryCounts.entries()].filter(([candidate]) => (
        candidate !== TRANSPARENT_INDEX && candidate !== backgroundIndex
      ));
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
      const intentionalInteriorDetail = replacement !== TRANSPARENT_INDEX &&
        !component.touchesTransparency &&
        visibleBoundaries.length === 1 &&
        component.compactness >= .24 &&
        component.aspectRatio <= 4 &&
        isProtectedColorContrast(palette[component.colorIndex], palette[replacement]);
      const replacementDistance = replacement === TRANSPARENT_INDEX ? Number.POSITIVE_INFINITY : colorDistance(
        palette[component.colorIndex]?.r ?? 0,
        palette[component.colorIndex]?.g ?? 0,
        palette[component.colorIndex]?.b ?? 0,
        palette[replacement] ?? { r: 0, g: 0, b: 0 },
      );
      const similarBoundaryShade = replacementDistance <= 95 * 95;
      return { artwork, component, replacement, intentionalInteriorDetail, similarBoundaryShade, replacementDistance };
    }).filter(({ artwork, replacement, intentionalInteriorDetail, similarBoundaryShade }) => (
      artwork >= 0 &&
      replacement !== TRANSPARENT_INDEX &&
      !intentionalInteriorDetail &&
      similarBoundaryShade
    )).sort((first, second) => {
      if (first.replacementDistance !== second.replacementDistance) return first.replacementDistance - second.replacementDistance;
      return first.component.area - second.component.area;
    });

    let changed = false;
    for (const candidate of candidates) {
      const remaining = countsByArtwork.get(candidate.artwork) ?? 0;
      if (remaining <= MAX_VECTOR_OBJECTS) continue;
      for (const pixel of candidate.component.pixels) output[pixel] = candidate.replacement;
      countsByArtwork.set(candidate.artwork, remaining - 1);
      changed = true;
    }
    if (!changed) break;
  }
  return output;
}

function mergeFringeOnlyColors(
  width: number,
  height: number,
  source: Uint8Array,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
) {
  if (cleanup === "none" || cleanup === "light") return source.slice();
  const output = source.slice();
  const canvasArea = width * height;
  const minimumRegionArea = canvasArea * .0005;
  const components = collectIndexedComponents(width, height, output);
  const byColor = new Map<number, IndexedComponent[]>();
  for (const component of components) {
    const current = byColor.get(component.colorIndex) ?? [];
    current.push(component);
    byColor.set(component.colorIndex, current);
  }

  const intentionalInterior = (component: IndexedComponent) => {
    const visibleBoundaries = [...component.boundaryCounts.keys()].filter((candidate) => candidate !== TRANSPARENT_INDEX);
    if (component.touchesTransparency || visibleBoundaries.length !== 1 || component.compactness < .24 || component.aspectRatio > 4) return false;
    return isProtectedColorContrast(palette[component.colorIndex], palette[visibleBoundaries[0]]);
  };

  // A real palette color owns at least one coherent region. Antialias colors
  // instead appear only as narrow crescents, chains, and edge crumbs. Compact,
  // high-contrast interior details (eyes, dots, symbols) remain protected.
  const coherentColors = new Set<number>();
  for (const [colorIndex, colorComponents] of byColor) {
    if (colorComponents.some((component) => (
      intentionalInterior(component) ||
      (component.area >= minimumRegionArea && component.compactness >= .08) ||
      component.area >= minimumRegionArea * 8
    ))) coherentColors.add(colorIndex);
  }

  for (const [colorIndex, colorComponents] of byColor) {
    if (coherentColors.has(colorIndex)) continue;
    for (const component of colorComponents) {
      if (intentionalInterior(component)) continue;
      const visibleBoundaries = [...component.boundaryCounts.entries()]
        .filter(([candidate]) => candidate !== TRANSPARENT_INDEX && candidate !== colorIndex)
        .sort((first, second) => second[1] - first[1]);
      const coherentBoundaries = visibleBoundaries.filter(([candidate]) => coherentColors.has(candidate));
      const candidates = coherentBoundaries.length ? coherentBoundaries : visibleBoundaries;
      let replacement = candidates[0]?.[0] ?? TRANSPARENT_INDEX;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const [candidate, boundaryLength] of candidates) {
        const distance = colorDistance(
          palette[colorIndex]?.r ?? 0,
          palette[colorIndex]?.g ?? 0,
          palette[colorIndex]?.b ?? 0,
          palette[candidate] ?? { r: 0, g: 0, b: 0 },
        );
        const score = boundaryLength * 16 - Math.sqrt(distance);
        if (score > bestScore) {
          replacement = candidate;
          bestScore = score;
        }
      }
      if (replacement === TRANSPARENT_INDEX) continue;
      for (const pixel of component.pixels) output[pixel] = replacement;
    }
  }
  return output;
}

function cleanIndexedMap(
  width: number,
  height: number,
  source: Uint8Array,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
) {
  if (cleanup === "none") return source.slice();
  // Quantization produces a label map. Clean that map before any mask reaches
  // the tracer: a 3x3 mode pass absorbs isolated antialias assignments without
  // averaging colors or inventing intermediate shades.
  const smoothed = smoothIndexedMap(width, height, source, cleanup);
  const withoutIslands = removeTinyComponents(width, height, smoothed, cleanup, palette);
  // Smoothing can leave a final one-pixel crescent at a former island edge.
  // Run component absorption once more so only substantial color masses reach
  // the vector tracer.
  const withoutFinalFringe = removeTinyComponents(width, height, withoutIslands, cleanup, palette);
  const withoutFringeColors = mergeFringeOnlyColors(width, height, withoutFinalFringe, palette, cleanup);
  return cleanup === "strong"
    ? enforceComponentBudget(width, height, withoutFringeColors, palette, cleanup)
    : withoutFringeColors;
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

type CubicCurve = {
  start: VectorPoint;
  control1: VectorPoint;
  control2: VectorPoint;
  end: VectorPoint;
};

type FittedCommand =
  | { type: "L"; end: VectorPoint }
  | ({ type: "C" } & CubicCurve);

function roundCoordinate(value: number) {
  // Keep enough subpixel precision for fitted handles while allowing the
  // number conversion to remove trailing zeroes and integer decimals.
  return Number(value.toFixed(2));
}

function distanceBetween(first: VectorPoint, second: VectorPoint) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function addPoint(first: VectorPoint, second: VectorPoint) {
  return { x: first.x + second.x, y: first.y + second.y };
}

function subtractPoint(first: VectorPoint, second: VectorPoint) {
  return { x: first.x - second.x, y: first.y - second.y };
}

function scalePoint(point: VectorPoint, scale: number) {
  return { x: point.x * scale, y: point.y * scale };
}

function dotProduct(first: VectorPoint, second: VectorPoint) {
  return first.x * second.x + first.y * second.y;
}

function normalized(point: VectorPoint) {
  const length = Math.hypot(point.x, point.y);
  return length > 1e-8 ? { x: point.x / length, y: point.y / length } : { x: 0, y: 0 };
}

function interiorAngle(previous: VectorPoint, current: VectorPoint, next: VectorPoint) {
  const incoming = { x: previous.x - current.x, y: previous.y - current.y };
  const outgoing = { x: next.x - current.x, y: next.y - current.y };
  const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
  if (!denominator) return 180;
  const cosine = Math.max(-1, Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator));
  return Math.acos(cosine) * (180 / Math.PI);
}

function pointToLineDistance(point: VectorPoint, start: VectorPoint, end: VectorPoint) {
  const line = subtractPoint(end, start);
  const lengthSquared = dotProduct(line, line);
  if (lengthSquared <= 1e-8) return distanceBetween(point, start);
  const projection = Math.max(0, Math.min(1, dotProduct(subtractPoint(point, start), line) / lengthSquared));
  return distanceBetween(point, addPoint(start, scalePoint(line, projection)));
}

function deduplicateContour(points: VectorPoint[], minimumSpacing: number) {
  const deduplicated: VectorPoint[] = [];
  for (const point of points) {
    if (!deduplicated.length || distanceBetween(deduplicated[deduplicated.length - 1], point) > minimumSpacing) {
      deduplicated.push(point);
    }
  }
  if (deduplicated.length > 2 && distanceBetween(deduplicated[0], deduplicated[deduplicated.length - 1]) <= minimumSpacing) {
    deduplicated.pop();
  }
  return deduplicated;
}

function contourPointAtDistance(points: VectorPoint[], index: number, direction: -1 | 1, targetDistance: number) {
  let currentIndex = index;
  let travelled = 0;
  for (let step = 0; step < points.length - 1 && travelled < targetDistance; step += 1) {
    const nextIndex = (currentIndex + direction + points.length) % points.length;
    travelled += distanceBetween(points[currentIndex], points[nextIndex]);
    currentIndex = nextIndex;
  }
  return points[currentIndex];
}

function refineSubpixelContour(
  points: VectorPoint[],
  cleanup: Exclude<CleanupLevel, "none">,
  samplingScale: number,
  detailFactor: number,
) {
  // Large silhouettes can absorb more sub-pixel reconstruction than a tiny
  // eye, counter, or accent. Scale both the movement and pass count by the
  // feature itself instead of applying one global smoothing strength.
  const adaptiveStrength = .55 + detailFactor * .45;
  const weight = { light: .16, medium: .28, strong: .34 }[cleanup] * adaptiveStrength;
  const maximumShift = { light: .42, medium: .78, strong: .92 }[cleanup] * samplingScale * adaptiveStrength;
  let refined = points;
  const passes = cleanup === "strong" ? (detailFactor >= .72 ? 3 : 2) : cleanup === "medium" && detailFactor >= .72 ? 2 : 1;
  const originalArea = polygonArea(points);

  for (let pass = 0; pass < passes; pass += 1) {
    refined = refined.map((point, index, current) => {
      const previous = current[(index - 1 + current.length) % current.length];
      const next = current[(index + 1) % current.length];
      // A wide turn is raster stair-step noise more often than authored detail.
      // Move it fractionally toward the local chord, but never move sharp tips.
      const smoothingAngle = 126 + (1 - detailFactor) * 12;
      if (interiorAngle(previous, point, next) < smoothingAngle) return point;
      const midpoint = scalePoint(addPoint(previous, next), .5);
      const correction = subtractPoint(midpoint, point);
      const correctionLength = Math.hypot(correction.x, correction.y);
      if (correctionLength <= 1e-8) return point;
      const limited = Math.min(correctionLength, maximumShift) / correctionLength;
      return addPoint(point, scalePoint(correction, weight * limited));
    });
  }

  // Laplacian-style edge reconstruction can contract a closed silhouette.
  // Restore nearly the same area so smoothing removes stair steps without
  // making the artwork visibly thinner.
  const refinedArea = polygonArea(refined);
  if (originalArea > 1e-8 && refinedArea > 1e-8) {
    const areaScale = Math.max(.97, Math.min(1.03, Math.sqrt(originalArea / refinedArea)));
    if (Math.abs(areaScale - 1) > 1e-4) {
      const center = refined.reduce((sum, point) => addPoint(sum, point), { x: 0, y: 0 });
      const centroid = scalePoint(center, 1 / refined.length);
      refined = refined.map((point) => addPoint(centroid, scalePoint(subtractPoint(point, centroid), areaScale)));
    }
  }
  return refined;
}

function simplifyOpenPolyline(points: VectorPoint[], tolerance: number): VectorPoint[] {
  if (points.length <= 2) return points;
  let maximumDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointToLineDistance(points[index], points[0], points[points.length - 1]);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitIndex = index;
    }
  }
  if (maximumDistance <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplifyOpenPolyline(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyOpenPolyline(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function shouldEmitStraightLine(points: VectorPoint[], absoluteTolerance: number, relativeTolerance = 0) {
  if (points.length <= 2) return true;
  const chordLength = distanceBetween(points[0], points[points.length - 1]);
  if (chordLength <= 1e-8) return false;
  const maximumDeviation = points.slice(1, -1).reduce(
    (maximum, point) => Math.max(maximum, pointToLineDistance(point, points[0], points[points.length - 1])),
    0,
  );
  // Long logo and type strokes need a little more room for raster stair steps,
  // while recursively fitted organic curves must keep the stricter absolute
  // budget so short arcs are not flattened into a chain of line segments.
  const allowedDeviation = relativeTolerance > 0
    ? Math.max(absoluteTolerance, Math.min(absoluteTolerance * 2.75, chordLength * relativeTolerance))
    : absoluteTolerance;
  return maximumDeviation <= allowedDeviation;
}

function simplifyPolylineIndexes(points: VectorPoint[], indexes: number[], tolerance: number): number[] {
  if (indexes.length <= 2) return indexes;
  const start = points[indexes[0]];
  const end = points[indexes[indexes.length - 1]];
  let maximumDistance = 0;
  let splitPosition = 0;
  for (let position = 1; position < indexes.length - 1; position += 1) {
    const distance = pointToLineDistance(points[indexes[position]], start, end);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitPosition = position;
    }
  }
  if (maximumDistance <= tolerance) return [indexes[0], indexes[indexes.length - 1]];
  const left = simplifyPolylineIndexes(points, indexes.slice(0, splitPosition + 1), tolerance);
  const right = simplifyPolylineIndexes(points, indexes.slice(splitPosition), tolerance);
  return [...left.slice(0, -1), ...right];
}

function longStraightRuns(points: VectorPoint[], lineTolerance: number, samplingScale: number) {
  if (points.length < 4) return [] as Array<{ start: number; end: number }>;
  let opposite = 1;
  let farthestDistance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const distance = distanceBetween(points[0], points[index]);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      opposite = index;
    }
  }
  const firstChain = Array.from({ length: opposite + 1 }, (_, index) => index);
  const secondChain = [
    ...Array.from({ length: points.length - opposite }, (_, index) => opposite + index),
    0,
  ];
  const candidateIndexes = new Set([
    ...simplifyPolylineIndexes(points, firstChain, lineTolerance * 2.75),
    ...simplifyPolylineIndexes(points, secondChain, lineTolerance * 2.75),
  ]);
  const candidates = [...candidateIndexes].sort((first, second) => first - second);
  const runs: Array<{ start: number; end: number }> = [];
  const minimumRunLength = Math.max(18 * samplingScale, lineTolerance * 7);
  const cornerProbe = Math.max(3 * samplingScale, lineTolerance * 3);
  const endpointAngle = (index: number) => interiorAngle(
    contourPointAtDistance(points, index, -1, cornerProbe),
    points[index],
    contourPointAtDistance(points, index, 1, cornerProbe),
  );
  for (let position = 0; position < candidates.length; position += 1) {
    const start = candidates[position];
    const end = candidates[(position + 1) % candidates.length];
    const run = end > start
      ? points.slice(start, end + 1)
      : [...points.slice(start), ...points.slice(0, end + 1)];
    const chord = distanceBetween(run[0], run[run.length - 1]);
    if (run.length < 2 || chord < minimumRunLength) continue;
    // A real straight logo or glyph edge normally meets another edge at a
    // visible corner. Requiring both end turns prevents a smooth circle from
    // being approximated as many locally straight chords.
    if (endpointAngle(start) > 150 || endpointAngle(end) > 150) continue;
    if (!shouldEmitStraightLine(run, lineTolerance, .02)) continue;
    runs.push({ start, end });
  }
  return runs;
}

function evaluateCubic(curve: CubicCurve, parameter: number) {
  const inverse = 1 - parameter;
  const first = inverse * inverse * inverse;
  const second = 3 * inverse * inverse * parameter;
  const third = 3 * inverse * parameter * parameter;
  const fourth = parameter * parameter * parameter;
  return {
    x: curve.start.x * first + curve.control1.x * second + curve.control2.x * third + curve.end.x * fourth,
    y: curve.start.y * first + curve.control1.y * second + curve.control2.y * third + curve.end.y * fourth,
  };
}

function evaluateCubicDerivative(curve: CubicCurve, parameter: number) {
  const inverse = 1 - parameter;
  return addPoint(
    addPoint(
      scalePoint(subtractPoint(curve.control1, curve.start), 3 * inverse * inverse),
      scalePoint(subtractPoint(curve.control2, curve.control1), 6 * inverse * parameter),
    ),
    scalePoint(subtractPoint(curve.end, curve.control2), 3 * parameter * parameter),
  );
}

function evaluateCubicSecondDerivative(curve: CubicCurve, parameter: number) {
  return addPoint(
    scalePoint(addPoint(subtractPoint(curve.control2, scalePoint(curve.control1, 2)), curve.start), 6 * (1 - parameter)),
    scalePoint(addPoint(subtractPoint(curve.end, scalePoint(curve.control2, 2)), curve.control1), 6 * parameter),
  );
}

function chordLengthParameters(points: VectorPoint[]) {
  const parameters = [0];
  for (let index = 1; index < points.length; index += 1) {
    parameters.push(parameters[index - 1] + distanceBetween(points[index - 1], points[index]));
  }
  const total = parameters[parameters.length - 1];
  return total > 1e-8 ? parameters.map((value) => value / total) : parameters.map((_, index) => index / (points.length - 1));
}

function generateBezier(points: VectorPoint[], parameters: number[], leftTangent: VectorPoint, rightTangent: VectorPoint): CubicCurve {
  const start = points[0];
  const end = points[points.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let index = 0; index < points.length; index += 1) {
    const parameter = parameters[index];
    const inverse = 1 - parameter;
    const b0 = inverse * inverse * inverse;
    const b1 = 3 * inverse * inverse * parameter;
    const b2 = 3 * inverse * parameter * parameter;
    const b3 = parameter * parameter * parameter;
    const firstBasis = scalePoint(leftTangent, b1);
    const secondBasis = scalePoint(rightTangent, b2);
    const baseline = addPoint(scalePoint(start, b0 + b1), scalePoint(end, b2 + b3));
    const residual = subtractPoint(points[index], baseline);
    c00 += dotProduct(firstBasis, firstBasis);
    c01 += dotProduct(firstBasis, secondBasis);
    c11 += dotProduct(secondBasis, secondBasis);
    x0 += dotProduct(firstBasis, residual);
    x1 += dotProduct(secondBasis, residual);
  }

  const determinant = c00 * c11 - c01 * c01;
  const segmentLength = distanceBetween(start, end);
  let alphaLeft = determinant ? (x0 * c11 - x1 * c01) / determinant : segmentLength / 3;
  let alphaRight = determinant ? (c00 * x1 - c01 * x0) / determinant : segmentLength / 3;
  const epsilon = segmentLength * 1e-4;
  // Long unconstrained handles can pass every sampled contour point yet bow
  // far outside the intended letter or icon between those samples. A cubic
  // needs about 0.55× of its chord per handle to describe a quarter circle;
  // 0.75× leaves room for organic curves without allowing visible loops or
  // swollen strokes.
  const maximumHandle = segmentLength * .75;
  if (!Number.isFinite(alphaLeft) || !Number.isFinite(alphaRight) || alphaLeft < epsilon || alphaRight < epsilon) {
    alphaLeft = segmentLength / 3;
    alphaRight = segmentLength / 3;
  }
  alphaLeft = Math.min(alphaLeft, maximumHandle);
  alphaRight = Math.min(alphaRight, maximumHandle);
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  const clampToContourBounds = (point: VectorPoint) => ({
    x: Math.max(minimumX, Math.min(maximumX, point.x)),
    y: Math.max(minimumY, Math.min(maximumY, point.y)),
  });
  return {
    start,
    // A Bézier lies inside the convex hull of its controls. Keeping both
    // controls inside the sampled contour bounds prevents one color layer
    // from bulging beyond a neighboring outline between otherwise valid
    // anchors.
    control1: clampToContourBounds(addPoint(start, scalePoint(leftTangent, alphaLeft))),
    control2: clampToContourBounds(addPoint(end, scalePoint(rightTangent, alphaRight))),
    end,
  };
}

function cubicFitError(points: VectorPoint[], curve: CubicCurve, parameters: number[]) {
  let maximumSquaredError = 0;
  let splitIndex = Math.floor(points.length / 2);
  for (let index = 1; index < points.length - 1; index += 1) {
    const delta = subtractPoint(evaluateCubic(curve, parameters[index]), points[index]);
    const squaredError = dotProduct(delta, delta);
    if (squaredError > maximumSquaredError) {
      maximumSquaredError = squaredError;
      splitIndex = index;
    }
  }
  // Checking only the original anchors permits a cubic to swing far outside
  // the artwork between two matching samples. Measure every inter-anchor
  // midpoint as well; this rejects loops and swollen letter strokes while
  // still allowing long curves that remain close to the traced contour.
  for (let index = 0; index < points.length - 1; index += 1) {
    const parameter = (parameters[index] + parameters[index + 1]) / 2;
    const expected = scalePoint(addPoint(points[index], points[index + 1]), .5);
    const delta = subtractPoint(evaluateCubic(curve, parameter), expected);
    // The straight midpoint is an approximation of the traced curve between
    // anchors, so use a 10× tolerance for this supplemental overshoot check.
    const squaredError = dotProduct(delta, delta) * .01;
    if (squaredError > maximumSquaredError) {
      maximumSquaredError = squaredError;
      splitIndex = Math.max(1, Math.min(points.length - 2, index + 1));
    }
  }
  return { maximumSquaredError, splitIndex };
}

function reparameterize(points: VectorPoint[], curve: CubicCurve, parameters: number[]) {
  const adjusted = parameters.map((parameter, index) => {
    if (index === 0 || index === parameters.length - 1) return parameter;
    const position = evaluateCubic(curve, parameter);
    const firstDerivative = evaluateCubicDerivative(curve, parameter);
    const secondDerivative = evaluateCubicSecondDerivative(curve, parameter);
    const difference = subtractPoint(position, points[index]);
    const denominator = dotProduct(firstDerivative, firstDerivative) + dotProduct(difference, secondDerivative);
    if (Math.abs(denominator) <= 1e-8) return parameter;
    return Math.max(0, Math.min(1, parameter - dotProduct(difference, firstDerivative) / denominator));
  });
  for (let index = 1; index < adjusted.length; index += 1) {
    if (adjusted[index] <= adjusted[index - 1]) return parameters;
  }
  return adjusted;
}

function fitOpenCurve(
  points: VectorPoint[],
  leftTangent: VectorPoint,
  rightTangent: VectorPoint,
  errorTolerance: number,
  lineTolerance: number,
  depth = 0,
): FittedCommand[] {
  const end = points[points.length - 1];
  if (points.length <= 2) return [{ type: "L", end }];
  if (shouldEmitStraightLine(points, lineTolerance)) return [{ type: "L", end }];

  let parameters = chordLengthParameters(points);
  let curve = generateBezier(points, parameters, leftTangent, rightTangent);
  let error = cubicFitError(points, curve, parameters);
  const squaredTolerance = errorTolerance * errorTolerance;
  if (error.maximumSquaredError <= squaredTolerance) return [{ type: "C", ...curve }];

  if (error.maximumSquaredError <= squaredTolerance * 4) {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      parameters = reparameterize(points, curve, parameters);
      curve = generateBezier(points, parameters, leftTangent, rightTangent);
      error = cubicFitError(points, curve, parameters);
      if (error.maximumSquaredError <= squaredTolerance) return [{ type: "C", ...curve }];
    }
  }

  if (depth >= 20 || error.splitIndex <= 0 || error.splitIndex >= points.length - 1) {
    return [{ type: "C", ...curve }];
  }
  const split = error.splitIndex;
  // Both child curves must share one tangent line at the split. Independent
  // one-sided tangents reproduce raster kinks even when both curve fits are
  // individually accurate.
  let leftCenterTangent = normalized(subtractPoint(points[split - 1], points[split + 1]));
  if (Math.hypot(leftCenterTangent.x, leftCenterTangent.y) <= 1e-8) {
    leftCenterTangent = normalized(subtractPoint(points[split - 1], points[split]));
  }
  const rightCenterTangent = scalePoint(leftCenterTangent, -1);
  return [
    ...fitOpenCurve(points.slice(0, split + 1), leftTangent, leftCenterTangent, errorTolerance, lineTolerance, depth + 1),
    ...fitOpenCurve(points.slice(split), rightCenterTangent, rightTangent, errorTolerance, lineTolerance, depth + 1),
  ];
}

function contourCorners(
  points: VectorPoint[],
  cleanup: Exclude<CleanupLevel, "none">,
  samplingScale: number,
  detailFactor: number,
) {
  // Raster stair steps often look like shallow corners. Keep only authored
  // sharp turns here; the separate long-run detector below finds straight
  // logo and type edges without over-segmenting organic curves.
  const cornerLimit = { light: 102, medium: 103, strong: 105 }[cleanup];
  const inspectionDistance = { light: 2.2, medium: 2.8, strong: 3.4 }[cleanup] * samplingScale * Math.sqrt(detailFactor);
  const candidates = points.map((point, index) => {
    const previous = contourPointAtDistance(points, index, -1, inspectionDistance);
    const next = contourPointAtDistance(points, index, 1, inspectionDistance);
    const widePrevious = contourPointAtDistance(points, index, -1, inspectionDistance * 2.25);
    const wideNext = contourPointAtDistance(points, index, 1, inspectionDistance * 2.25);
    return {
      index,
      point,
      angle: interiorAngle(previous, point, next),
      persistentAngle: interiorAngle(widePrevious, point, wideNext),
    };
  }).filter(({ angle, persistentAngle }) => angle <= cornerLimit && (angle <= 72 || persistentAngle <= 138))
    .sort((first, second) => first.angle - second.angle);
  const minimumSeparation = inspectionDistance * 1.35;
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (selected.every(({ point }) => distanceBetween(point, candidate.point) >= minimumSeparation)) selected.push(candidate);
  }
  return selected.map(({ index }) => index).sort((first, second) => first - second);
}

function closedContourSegments(points: VectorPoint[], corners: number[]) {
  if (!corners.length) return [[...points, points[0]]];
  return corners.map((start, cornerIndex) => {
    const end = corners[(cornerIndex + 1) % corners.length];
    const segment = [points[start]];
    let index = start;
    while (index !== end) {
      index = (index + 1) % points.length;
      segment.push(points[index]);
    }
    return segment;
  }).filter((segment) => segment.length > 1);
}

function smoothClosedContour(points: VectorPoint[], cleanup: CleanupLevel, samplingScale = 1, anchorSimplification = 0) {
  if (cleanup === "none") return "";
  const activeCleanup = cleanup as Exclude<CleanupLevel, "none">;
  const scale = Math.max(1, samplingScale);
  const simplification = Math.max(0, Math.min(100, anchorSimplification)) / 100;
  const minimumSpacing = { light: .08, medium: .12, strong: .18 }[activeCleanup] * scale;
  let contour = deduplicateContour(points, minimumSpacing);
  if (contour.length < 3) return "";
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const point of contour) {
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  const minimumDimension = Math.min(maximumX - minimumX, maximumY - minimumY);
  const maximumDimension = Math.max(maximumX - minimumX, maximumY - minimumY);
  // One source-pixel of fitting error is harmless on a large silhouette but
  // can noticeably change a small eye, letter counter, or pointed accent.
  // Scale the geometry budget by feature size so small authored details keep
  // their shape while large contours still collapse into long curves.
  const detailFactor = Math.max(.38, Math.min(1, minimumDimension / (72 * scale)));
  contour = refineSubpixelContour(contour, activeCleanup, scale, detailFactor);
  const boxArea = Math.max(1e-8, (maximumX - minimumX) * (maximumY - minimumY));
  const fillRatio = polygonArea(contour) / boxArea;
  const aspectRatio = maximumDimension / Math.max(1e-8, minimumDimension);
  // Compact, rounded islands are usually eyes, dots, counters, or badges.
  // Treating their raster quadrants as authored corners produces the subtle
  // angular eyes visible at high zoom.
  const roundedCompactDetail = minimumDimension <= 28 * scale && aspectRatio <= 1.8 && fillRatio >= .62 && fillRatio <= .9;
  const errorTolerance = { light: .66, medium: 1.2, strong: 1.58 }[activeCleanup] * scale * detailFactor * (1 + simplification * 1.45);
  const lineTolerance = { light: .24, medium: .42, strong: .62 }[activeCleanup] * scale * detailFactor * (1 + simplification);
  const straightRuns = roundedCompactDetail ? [] : longStraightRuns(contour, lineTolerance, scale);
  const corners = roundedCompactDetail
    ? []
    : [...new Set([
      ...contourCorners(contour, activeCleanup, scale, detailFactor),
      ...straightRuns.flatMap(({ start, end }) => [start, end]),
    ])].sort((first, second) => first - second);
  const rdpTolerance = errorTolerance * .27;
  const segments = closedContourSegments(contour, corners);
  const start = segments[0]?.[0];
  if (!start) return "";
  const commands = [`M ${roundCoordinate(start.x)} ${roundCoordinate(start.y)}`];
  const contourIndex = new Map(contour.map((point, index) => [point, index]));
  const forwardDistance = (from: number, to: number) => (to - from + contour.length) % contour.length;

  for (const rawSegment of segments) {
    const rawStart = contourIndex.get(rawSegment[0]);
    const rawEnd = contourIndex.get(rawSegment[rawSegment.length - 1]);
    const belongsToStraightRun = rawStart !== undefined && rawEnd !== undefined && straightRuns.some((run) => {
      const runLength = forwardDistance(run.start, run.end);
      return forwardDistance(run.start, rawStart) + forwardDistance(rawStart, rawEnd) <= runLength;
    });
    if (belongsToStraightRun && rawSegment.length > 2 && distanceBetween(rawSegment[0], rawSegment[rawSegment.length - 1]) > .01 && shouldEmitStraightLine(rawSegment, lineTolerance, .02)) {
      const end = rawSegment[rawSegment.length - 1];
      commands.push(`L ${roundCoordinate(end.x)} ${roundCoordinate(end.y)}`);
      continue;
    }
    const segment = simplifyOpenPolyline(rawSegment, rdpTolerance);
    if (segment.length < 2) continue;
    const isClosedSegment = distanceBetween(segment[0], segment[segment.length - 1]) <= .01 && segment.length > 3;
    const seamTangent = isClosedSegment
      ? normalized(subtractPoint(segment[1], segment[segment.length - 2]))
      : normalized(subtractPoint(segment[1], segment[0]));
    const leftTangent = seamTangent;
    const rightTangent = isClosedSegment
      ? scalePoint(seamTangent, -1)
      : normalized(subtractPoint(segment[segment.length - 2], segment[segment.length - 1]));
    const fitted = fitOpenCurve(segment, leftTangent, rightTangent, errorTolerance, roundedCompactDetail ? 0 : lineTolerance);
    for (const command of fitted) {
      if (command.type === "L") {
        commands.push(`L ${roundCoordinate(command.end.x)} ${roundCoordinate(command.end.y)}`);
      } else {
        commands.push(`C ${roundCoordinate(command.control1.x)} ${roundCoordinate(command.control1.y)} ${roundCoordinate(command.control2.x)} ${roundCoordinate(command.control2.y)} ${roundCoordinate(command.end.x)} ${roundCoordinate(command.end.y)}`);
      }
    }
  }
  commands.push("Z");
  return commands.join(" ");
}

type TracedData = ReturnType<typeof ImageTracer.imagedataToTracedata>;
type TracedPath = TracedData["layers"][number][number];
type TracedSegment = TracedPath["segments"][number];

function segmentEnd(segment: TracedSegment): VectorPoint {
  return segment.type === "Q" && segment.x3 !== undefined && segment.y3 !== undefined
    ? { x: segment.x3, y: segment.y3 }
    : { x: segment.x2, y: segment.y2 };
}

function rawContourPath(segments: TracedSegment[]) {
  if (!segments.length) return "";
  const commands = [`M ${roundCoordinate(segments[0].x1)} ${roundCoordinate(segments[0].y1)}`];
  for (const segment of segments) {
    if (segment.type === "Q" && segment.x3 !== undefined && segment.y3 !== undefined) {
      commands.push(`Q ${roundCoordinate(segment.x2)} ${roundCoordinate(segment.y2)} ${roundCoordinate(segment.x3)} ${roundCoordinate(segment.y3)}`);
    } else {
      commands.push(`L ${roundCoordinate(segment.x2)} ${roundCoordinate(segment.y2)}`);
    }
  }
  commands.push("Z");
  return commands.join(" ");
}

function contourAnchors(segments: TracedSegment[]) {
  if (!segments.length) return [];
  const points: VectorPoint[] = [{ x: segments[0].x1, y: segments[0].y1 }];
  for (const segment of segments) {
    if (segment.type !== "Q" || segment.x3 === undefined || segment.y3 === undefined) {
      points.push(segmentEnd(segment));
      continue;
    }
    // Preserve the tracer's curve evidence for the global fitter instead of
    // keeping only each short segment endpoint.
    for (let step = 1; step <= 4; step += 1) {
      const parameter = step / 4;
      const inverse = 1 - parameter;
      points.push({
        x: inverse * inverse * segment.x1 + 2 * inverse * parameter * segment.x2 + parameter * parameter * segment.x3,
        y: inverse * inverse * segment.y1 + 2 * inverse * parameter * segment.y2 + parameter * parameter * segment.y3,
      });
    }
  }
  return points.length > 2 && distanceBetween(points[0], points[points.length - 1]) < .01 ? points.slice(0, -1) : points;
}

function fittedContourPath(segments: TracedSegment[], cleanup: CleanupLevel, samplingScale: number, anchorSimplification: number) {
  if (cleanup === "none") return rawContourPath(segments);
  const fitted = smoothClosedContour(contourAnchors(segments), cleanup, samplingScale, anchorSimplification);
  return fitted || rawContourPath(segments);
}

function sampledContour(segments: TracedSegment[]) {
  if (!segments.length) return [];
  const points: VectorPoint[] = [{ x: segments[0].x1, y: segments[0].y1 }];
  for (const segment of segments) {
    if (segment.type !== "Q" || segment.x3 === undefined || segment.y3 === undefined) {
      points.push({ x: segment.x2, y: segment.y2 });
      continue;
    }
    for (let step = 1; step <= 6; step += 1) {
      const t = step / 6;
      const inverse = 1 - t;
      points.push({
        x: inverse * inverse * segment.x1 + 2 * inverse * t * segment.x2 + t * t * segment.x3,
        y: inverse * inverse * segment.y1 + 2 * inverse * t * segment.y2 + t * t * segment.y3,
      });
    }
  }
  return points;
}

function polygonArea(points: VectorPoint[]) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea / 2);
}

function tracedPathArea(layer: TracedPath[], pathIndex: number) {
  const path = layer[pathIndex];
  if (!path || path.isholepath) return 0;
  const outer = polygonArea(sampledContour(path.segments));
  const holes = path.holechildren.reduce((total, holeIndex) => total + polygonArea(sampledContour(layer[holeIndex]?.segments ?? [])), 0);
  return Math.max(0, outer - holes);
}

function tracedPathData(
  layer: TracedPath[],
  pathIndex: number,
  cleanup: CleanupLevel,
  samplingScale: number,
  anchorSimplification: number,
) {
  const path = layer[pathIndex];
  if (!path || path.isholepath) return "";
  const contours = [fittedContourPath(path.segments, cleanup, samplingScale, anchorSimplification)];
  for (const holeIndex of path.holechildren) {
    const hole = layer[holeIndex];
    if (hole?.segments.length) contours.push(fittedContourPath(hole.segments, cleanup, samplingScale, anchorSimplification));
  }
  return contours.filter(Boolean).join(" ");
}

function keepTracedPath(
  layer: TracedPath[],
  pathIndex: number,
  canvasArea: number,
  cleanup: CleanupLevel,
  preserveForeground = false,
) {
  const path = layer[pathIndex];
  if (!path || path.isholepath) return false;
  const cleanupShare = { none: 0, light: .0001, medium: .0005, strong: .0005 }[cleanup];
  // Small nested shapes are commonly intentional facial features, counters,
  // or lettering details. Keep a stricter dust filter for exterior artwork,
  // but do not discard a foreground object just because it occupies less than
  // 0.05% of the full canvas.
  const minimumShare = preserveForeground && cleanupShare ? Math.min(cleanupShare, .0001) : cleanupShare;
  if (!minimumShare) return true;
  const area = tracedPathArea(layer, pathIndex);
  const nodeCount = path.segments.length + path.holechildren.reduce((total, holeIndex) => total + (layer[holeIndex]?.segments.length ?? 0), 0);
  const minimumArea = canvasArea * minimumShare;
  // The area threshold is the primary filter. Tiny low-node shapes get a
  // second, stricter gate because they are overwhelmingly quantization dust.
  return area >= minimumArea && (preserveForeground || nodeCount > 8 || area >= minimumArea * 2);
}

function compoundPath(pathData: string[], color: string, _strokeWidth: number) {
  if (!pathData.length) return "";
  return `<path fill="${color}" fill-rule="evenodd" clip-rule="evenodd" shape-rendering="geometricPrecision" d="${pathData.join(" ")}"/>`;
}

type TraceInternals = {
  pathscan: (layer: number[][], pathOmit: number) => unknown;
  internodes: (paths: unknown, options: unknown) => unknown;
  batchtracepaths: (paths: unknown, lineTolerance: number, curveTolerance: number) => TracedPath[];
};

function indexedTraceMap(imageData: ImageData, palette: PaletteColor[]) {
  const labels = new Uint8Array(imageData.width * imageData.height).fill(TRANSPARENT_INDEX);
  const exactColors = new Map<number, number>();
  palette.forEach((color, index) => exactColors.set((color.r << 16) | (color.g << 8) | color.b, index));
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const offset = pixel * 4;
    if (imageData.data[offset + 3] < 10) continue;
    const key = (imageData.data[offset] << 16) | (imageData.data[offset + 1] << 8) | imageData.data[offset + 2];
    const exact = exactColors.get(key);
    if (exact !== undefined) {
      labels[pixel] = exact;
      continue;
    }
    let closest = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < palette.length; index += 1) {
      const distance = colorDistance(imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2], palette[index]);
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = index;
      }
    }
    labels[pixel] = closest;
  }
  return labels;
}

type StackComponent = {
  id: number;
  colorIndex: number;
  pixels: number[];
  contacts: Map<number, number>;
  touchesExterior: boolean;
  parent: number;
  depth: number;
};

type TraceLayerPlan = {
  colorIndex: number;
  depth: number;
  mask: Uint8Array;
  order: number;
};

function exteriorTransparency(labels: Uint8Array, width: number, height: number) {
  const exterior = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  let read = 0;
  let write = 0;
  const add = (pixel: number) => {
    if (labels[pixel] !== TRANSPARENT_INDEX || exterior[pixel]) return;
    exterior[pixel] = 1;
    queue[write++] = pixel;
  };
  for (let x = 0; x < width; x += 1) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    add(y * width);
    add(y * width + width - 1);
  }
  while (read < write) {
    const pixel = queue[read++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) add(pixel - 1);
    if (x + 1 < width) add(pixel + 1);
    if (y > 0) add(pixel - width);
    if (y + 1 < height) add(pixel + width);
  }
  return exterior;
}

function stackedLayerPlans(labels: Uint8Array, width: number, height: number) {
  const componentAtPixel = new Int32Array(labels.length).fill(-1);
  const queue = new Int32Array(labels.length);
  const components: StackComponent[] = [];

  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] === TRANSPARENT_INDEX || componentAtPixel[start] >= 0) continue;
    const id = components.length;
    const colorIndex = labels[start];
    const pixels: number[] = [];
    let read = 0;
    let write = 0;
    componentAtPixel[start] = id;
    queue[write++] = start;
    while (read < write) {
      const pixel = queue[read++];
      pixels.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const visit = (next: number) => {
        if (labels[next] !== colorIndex || componentAtPixel[next] >= 0) return;
        componentAtPixel[next] = id;
        queue[write++] = next;
      };
      if (x > 0) visit(pixel - 1);
      if (x + 1 < width) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y + 1 < height) visit(pixel + width);
    }
    components.push({ id, colorIndex, pixels, contacts: new Map(), touchesExterior: false, parent: -1, depth: -1 });
  }

  const exterior = exteriorTransparency(labels, width, height);
  for (const component of components) {
    for (const pixel of component.pixels) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const inspect = (next: number) => {
        if (labels[next] === TRANSPARENT_INDEX) {
          if (exterior[next]) component.touchesExterior = true;
          return;
        }
        const neighbor = componentAtPixel[next];
        if (neighbor !== component.id) component.contacts.set(neighbor, (component.contacts.get(neighbor) ?? 0) + 1);
      };
      if (x > 0) inspect(pixel - 1); else component.touchesExterior = true;
      if (x + 1 < width) inspect(pixel + 1); else component.touchesExterior = true;
      if (y > 0) inspect(pixel - width); else component.touchesExterior = true;
      if (y + 1 < height) inspect(pixel + width); else component.touchesExterior = true;
    }
  }

  // Region depth is the shortest path from the visible exterior through the
  // color-region adjacency graph. It separates a black outer outline from a
  // disconnected black eye even though both use the same palette swatch.
  let read = 0;
  let write = 0;
  for (const component of components) {
    if (!component.touchesExterior) continue;
    component.depth = 0;
    queue[write++] = component.id;
  }
  if (!write && components.length) {
    components[0].depth = 0;
    queue[write++] = 0;
  }
  while (read < write) {
    const component = components[queue[read++]];
    for (const neighborId of component.contacts.keys()) {
      const neighbor = components[neighborId];
      if (neighbor.depth >= 0) continue;
      neighbor.depth = component.depth + 1;
      queue[write++] = neighbor.id;
    }
  }

  for (const component of components) {
    let strongestContact = -1;
    for (const [neighborId, contact] of component.contacts) {
      if (components[neighborId].depth !== component.depth - 1 || contact <= strongestContact) continue;
      strongestContact = contact;
      component.parent = neighborId;
    }
  }

  const plansByKey = new Map<string, TraceLayerPlan>();
  const planFor = (component: StackComponent) => {
    const key = `${component.depth}:${component.colorIndex}`;
    let plan = plansByKey.get(key);
    if (!plan) {
      plan = { colorIndex: component.colorIndex, depth: component.depth, mask: new Uint8Array(labels.length), order: -1 };
      plansByKey.set(key, plan);
    }
    return plan;
  };

  // Every visible component also fills each ancestor mask. The result looks
  // identical, but moving an eye, mouth, or other foreground color in a vector
  // editor reveals the solid lower artwork instead of a punched-out hole.
  for (const component of components) {
    let ancestor: StackComponent | undefined = component;
    let guard = 0;
    while (ancestor && guard++ <= components.length) {
      const mask = planFor(ancestor).mask;
      for (const pixel of component.pixels) mask[pixel] = 1;
      ancestor = ancestor.parent >= 0 ? components[ancestor.parent] : undefined;
    }
  }

  const plans = [...plansByKey.values()].sort((first, second) => first.depth - second.depth || first.colorIndex - second.colorIndex);
  plans.forEach((plan, order) => { plan.order = order; });
  const visibleOrder = new Int32Array(labels.length).fill(-1);
  for (const component of components) {
    const plan = plansByKey.get(`${component.depth}:${component.colorIndex}`);
    if (!plan) continue;
    for (const pixel of component.pixels) visibleOrder[pixel] = plan.order;
  }
  return { plans, visibleOrder };
}

function buildUnderlapLayerMask(
  seedMask: Uint8Array,
  visibleOrder: Int32Array,
  width: number,
  height: number,
  currentOrder: number,
  radius: number,
) {
  let mask = seedMask.slice();
  for (let step = 0; step < radius; step += 1) {
    const expanded = mask.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (!mask[pixel]) continue;
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          const nextY = y + yOffset;
          if (nextY < 0 || nextY >= height) continue;
          for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
            if (!xOffset && !yOffset) continue;
            const nextX = x + xOffset;
            if (nextX < 0 || nextX >= width) continue;
            const nextPixel = nextY * width + nextX;
            if (visibleOrder[nextPixel] > currentOrder) expanded[nextPixel] = 1;
          }
        }
      }
    }
    mask = expanded;
  }
  return mask;
}

function edgeNodesFromMask(mask: Uint8Array, width: number, height: number) {
  const layer = Array.from({ length: height + 2 }, () => new Array<number>(width + 2).fill(0));
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] ? 1 : 0;
  for (let nodeY = 1; nodeY < height + 2; nodeY += 1) {
    const y = nodeY - 1;
    for (let nodeX = 1; nodeX < width + 2; nodeX += 1) {
      const x = nodeX - 1;
      layer[nodeY][nodeX] = at(x - 1, y - 1) + at(x, y - 1) * 2 + at(x, y) * 4 + at(x - 1, y) * 8;
    }
  }
  return layer;
}

function traceStackedLayers(
  imageData: ImageData,
  palette: PaletteColor[],
  traceOptions: Record<string, unknown> & { pathomit: number; ltres: number; qtres: number },
  underlapRadius: number,
) {
  const labels = indexedTraceMap(imageData, palette);
  const internals = ImageTracer as unknown as TraceInternals;
  const { plans, visibleOrder } = stackedLayerPlans(labels, imageData.width, imageData.height);
  return plans.map((plan) => {
    const radius = plan.order < plans.length - 1 ? underlapRadius : 0;
    const mask = buildUnderlapLayerMask(plan.mask, visibleOrder, imageData.width, imageData.height, plan.order, radius);
    const scanned = internals.pathscan(edgeNodesFromMask(mask, imageData.width, imageData.height), traceOptions.pathomit);
    const interpolated = internals.internodes(scanned, traceOptions);
    return { ...plan, tracedLayer: internals.batchtracepaths(interpolated, traceOptions.ltres, traceOptions.qtres) };
  });
}

function traceImage(imageData: ImageData, palette: PaletteColor[], cleanup: CleanupLevel, anchorSimplification = 0) {
  const traceSettings = {
    none: { pathOmit: 1, lineTolerance: .45, curveTolerance: .8, blur: 0, blurDelta: 22, stroke: .2, minimumDimension: 800, maximumDimension: 1600 },
    light: { pathOmit: 8, lineTolerance: .3, curveTolerance: 1.35, blur: 0, blurDelta: 28, stroke: .25, minimumDimension: 800, maximumDimension: 1400 },
    medium: { pathOmit: 12, lineTolerance: .2, curveTolerance: 1.9, blur: 0, blurDelta: 34, stroke: .3, minimumDimension: 800, maximumDimension: 1200 },
    strong: { pathOmit: 20, lineTolerance: .12, curveTolerance: 2.7, blur: 0, blurDelta: 38, stroke: .35, minimumDimension: 800, maximumDimension: 1000 },
  }[cleanup];
  const simplification = Math.max(0, Math.min(100, anchorSimplification)) / 100;
  const tracing = resizeForTracing(imageData, traceSettings.minimumDimension, traceSettings.maximumDimension);
  const traceImageData = tracing.imageData;
  const hasTransparency = traceImageData.data.some((value, index) => index % 4 === 3 && value < 10);
  const tracePalette = palette.map(({ r, g, b }) => ({ r, g, b, a: 255 }));
  if (hasTransparency) tracePalette.push({ r: 0, g: 0, b: 0, a: 0 });
  const traceOptions = {
    ltres: traceSettings.lineTolerance * (1 + simplification * 1.8),
    qtres: traceSettings.curveTolerance * (1 + simplification * 2.4),
    // Anchor simplification may reduce geometry inside a path, but it must not
    // increase the threshold that removes an entire small object.
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
    roundcoords: 1,
    viewbox: true,
    desc: false,
    pal: tracePalette,
  };
  // Read ImageTracer's fitted segment data directly. Re-parsing its SVG made
  // curve fitting all-or-nothing: one short contour could force an entire
  // color path back to pixel-following L commands.
  const samplingScale = Math.max(traceImageData.width / imageData.width, traceImageData.height / imageData.height);
  const underlapRadius = cleanup === "none" ? 0 : Math.max(1, Math.round({ light: .65, medium: 1, strong: 1.25 }[cleanup] * Math.max(1, samplingScale)));
  const tracedPlans = underlapRadius
    ? traceStackedLayers(traceImageData, palette, traceOptions, underlapRadius)
    : ImageTracer.imagedataToTracedata(traceImageData, traceOptions).layers.slice(0, palette.length).map((tracedLayer, colorIndex) => ({
      colorIndex,
      depth: 0,
      order: colorIndex,
      mask: new Uint8Array(),
      tracedLayer,
    }));

  const pathsByPlan = tracedPlans.map(() => [] as string[]);
  for (let planIndex = 0; planIndex < tracedPlans.length; planIndex += 1) {
    const tracedLayer = tracedPlans[planIndex].tracedLayer ?? [];
    for (let pathIndex = 0; pathIndex < tracedLayer.length; pathIndex += 1) {
      if (!keepTracedPath(
        tracedLayer,
        pathIndex,
        traceImageData.width * traceImageData.height,
        cleanup,
        tracedPlans[planIndex].depth > 0,
      )) continue;
      const pathData = tracedPathData(tracedLayer, pathIndex, cleanup, samplingScale, anchorSimplification);
      if (pathData) pathsByPlan[planIndex].push(pathData);
    }
  }
  const layers = pathsByPlan.map((paths, planIndex) => {
    if (!paths.length) return "";
    const plan = tracedPlans[planIndex];
    const color = palette[plan.colorIndex];
    // One compound path per color and containment depth keeps related islands
    // grouped while allowing the same swatch to appear both behind and above
    // another color when the artwork requires that stacking order.
    const path = compoundPath(paths, color.hex, traceSettings.stroke);
    return `<g id="vector-layer-${planIndex + 1}" class="vector-layer" data-color-index="${plan.colorIndex}" data-stack-depth="${plan.depth}" data-color="${color.hex}" data-share="${color.share.toFixed(2)}" transform="scale(${tracing.scaleX.toFixed(6)} ${tracing.scaleY.toFixed(6)})">${path}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageData.width} ${imageData.height}" width="${imageData.width}" height="${imageData.height}" shape-rendering="geometricPrecision" data-vector-engine="imagetracer-curvefit-v7" data-color-underlap="true" data-color-stacking="containment" data-detail-preservation="foreground" data-curve-continuity="adaptive" data-geometry-classifier="line-curve" role="img" aria-label="Layered vector artwork"><g id="vector-artwork" data-vector-artwork="true">${layers}</g></svg>`;
}

function resultFromParts(
  width: number,
  height: number,
  pixelMap: Uint8Array,
  alphaMap: Uint8ClampedArray,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
  anchorSimplification = 0,
): VectorResult {
  const normalized = normalizePalette(width, height, pixelMap, palette);
  const imageData = renderPalette(width, height, normalized.pixelMap, alphaMap, normalized.palette);
  // Binary alpha keeps the original PNG's semitransparent edge pixels from
  // becoming a second noisy contour during tracing.
  const traceReady = new ImageData(width, height);
  for (let pixel = 0; pixel < normalized.pixelMap.length; pixel += 1) {
    const colorIndex = normalized.pixelMap[pixel];
    if (colorIndex === TRANSPARENT_INDEX || !normalized.palette[colorIndex]) continue;
    const offset = pixel * 4;
    const color = normalized.palette[colorIndex];
    traceReady.data[offset] = color.r;
    traceReady.data[offset + 1] = color.g;
    traceReady.data[offset + 2] = color.b;
    traceReady.data[offset + 3] = 255;
  }
  const svg = traceImage(traceReady, normalized.palette, cleanup, anchorSimplification);
  const artworkStats = artworkComponentCounts(width, height, normalized.pixelMap);
  const cubicCount = (svg.match(/\bC\s/g) ?? []).length;
  const drawingCommandCount = (svg.match(/\b[LQC]\s/g) ?? []).length;
  return {
    width,
    height,
    pixelMap: normalized.pixelMap,
    alphaMap,
    palette: normalized.palette,
    imageData,
    previewUrl: imageDataToUrl(imageData),
    svg,
    pathCount: (svg.match(/\bM\s/g) ?? []).length,
    nodeCount: (svg.match(/\b[MLQC]\s/g) ?? []).length,
    cubicCount,
    curveRatio: drawingCommandCount ? Math.round((cubicCount / drawingCommandCount) * 100) : 0,
    ...artworkStats,
    fileSize: new Blob([svg], { type: "image/svg+xml" }).size,
    anchorSimplification,
  };
}

export function createVectorResult(source: RasterSource, colorCount: number, cleanup: CleanupLevel, anchorSimplification = 0) {
  const { data, width, height } = source.imageData;
  const opaquePixels = Math.max(1, data.length / 4);
  const sampleStep = Math.max(1, Math.floor(opaquePixels / 220000));
  const sample: number[] = [];

  for (let pixel = 0; pixel < opaquePixels; pixel += sampleStep) {
    const offset = pixel * 4;
    if (data[offset + 3] >= ALPHA_CUT) sample.push(data[offset], data[offset + 1], data[offset + 2], 255);
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
  const representativeBuckets = candidates.map(() => new Map<number, { count: number; red: number; green: number; blue: number }>());

  for (let pixel = 0; pixel < opaquePixels; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3];
    const visible = alpha >= ALPHA_CUT;
    alphaMap[pixel] = visible ? 255 : 0;
    if (!visible) continue;
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
    // Snap the centroid returned by the quantizer back to a dense source-color
    // neighborhood. This keeps a flat red as that red instead of exporting an
    // averaged red/cream fringe shade.
    const bucket = ((data[offset] >> 3) << 10) | ((data[offset + 1] >> 3) << 5) | (data[offset + 2] >> 3);
    const bucketStats = representativeBuckets[closest].get(bucket) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucketStats.count += 1;
    bucketStats.red += data[offset];
    bucketStats.green += data[offset + 1];
    bucketStats.blue += data[offset + 2];
    representativeBuckets[closest].set(bucket, bucketStats);
  }

  candidates.forEach((candidate, index) => {
    const representative = [...representativeBuckets[index].values()].sort((first, second) => second.count - first.count)[0];
    if (!representative?.count) return;
    candidate.r = Math.round(representative.red / representative.count);
    candidate.g = Math.round(representative.green / representative.count);
    candidate.b = Math.round(representative.blue / representative.count);
  });

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
    cleanIndexedMap(width, height, pixelMap, palette, cleanup),
    alphaMap,
    palette,
    cleanup,
    anchorSimplification,
  );
}

export function recolorResult(result: VectorResult, palette: PaletteColor[], cleanup: CleanupLevel) {
  return resultFromParts(result.width, result.height, result.pixelMap, result.alphaMap, palette, cleanup, result.anchorSimplification);
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
  return resultFromParts(result.width, result.height, pixelMap, result.alphaMap, palette, cleanup, result.anchorSimplification);
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
    result.anchorSimplification,
  );
}

export function highlightSvg(svg: string, selected: number[]) {
  if (!selected.length) return svg;
  const chosen = new Set(selected);
  const highlighted = svg.replace(/<g\b([^>]*data-color-index="(\d+)"[^>]*)>/g, (match, attrs: string, rawIndex: string) => {
    const active = chosen.has(Number(rawIndex));
    return `<g${attrs} data-highlighted="${active ? "true" : "false"}">`;
  });
  const selectionStyle = `<style>.vector-layer[data-highlighted="false"]{opacity:.1}.vector-layer[data-highlighted="true"]{opacity:1;filter:drop-shadow(0 0 1.8px #ff604f)}</style>`;
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

export type IcoImage = { size: number; bytes: Uint8Array };

export function encodeIco(images: IcoImage[]) {
  if (!images.length) throw new Error("At least one favicon size is required.");
  const ordered = [...images].sort((first, second) => first.size - second.size);
  const directorySize = 6 + ordered.length * 16;
  const totalSize = directorySize + ordered.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);

  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, ordered.length, true);

  let imageOffset = directorySize;
  ordered.forEach((image, index) => {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256) {
      throw new Error("Favicon sizes must be whole numbers from 1 to 256 pixels.");
    }
    const entryOffset = 6 + index * 16;
    output[entryOffset] = image.size === 256 ? 0 : image.size;
    output[entryOffset + 1] = image.size === 256 ? 0 : image.size;
    output[entryOffset + 2] = 0;
    output[entryOffset + 3] = 0;
    view.setUint16(entryOffset + 4, 1, true);
    view.setUint16(entryOffset + 6, 32, true);
    view.setUint32(entryOffset + 8, image.bytes.byteLength, true);
    view.setUint32(entryOffset + 12, imageOffset, true);
    output.set(image.bytes, imageOffset);
    imageOffset += image.bytes.byteLength;
  });

  return output;
}

async function renderFaviconPng(svg: string, crop: CropBox, size: number) {
  const cropped = cropSvg(svg, crop);
  const blobUrl = URL.createObjectURL(new Blob([cropped], { type: "image/svg+xml" }));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Favicon rendering failed."));
      image.src = blobUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Favicon rendering is not supported in this browser.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.min(size / crop.width, size / crop.height);
    const width = Math.max(1, crop.width * scale);
    const height = Math.max(1, crop.height * scale);
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Favicon rendering failed.")), "image/png");
    });
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export async function downloadFavicon(svg: string, crop: CropBox, filename = "favicon.ico") {
  const mime = "image/vnd.microsoft.icon";
  const choice = await requestSaveHandle(filename, "Favicon icon", mime, ".ico");
  if (choice.cancelled) return "cancelled" as const;
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map(async (size) => ({
    size,
    bytes: await renderFaviconPng(svg, crop, size),
  })));
  const ico = encodeIco(images);
  return finishDownload(new Blob([ico], { type: mime }), filename, choice.handle);
}
