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

function roundCoordinate(value: number) {
  return Number(value.toFixed(1));
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

function reduceCurveAnchors(points: VectorPoint[], cleanup: CleanupLevel, samplingScale = 1) {
  const minimumSpacing = { none: 0, light: .35, medium: .7, strong: 1.1 }[cleanup] * Math.max(1, samplingScale);
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

function smoothClosedContour(points: VectorPoint[], cleanup: CleanupLevel, samplingScale = 1) {
  const anchors = reduceCurveAnchors(points, cleanup, samplingScale);
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
  const points = [{ x: segments[0].x1, y: segments[0].y1 }, ...segments.map(segmentEnd)];
  return points.length > 2 && distanceBetween(points[0], points[points.length - 1]) < .01 ? points.slice(0, -1) : points;
}

function fittedContourPath(segments: TracedSegment[], cleanup: CleanupLevel, samplingScale: number) {
  if (cleanup === "none") return rawContourPath(segments);
  const fitted = smoothClosedContour(contourAnchors(segments), cleanup, samplingScale);
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

function tracedPathData(layer: TracedPath[], pathIndex: number, cleanup: CleanupLevel, samplingScale: number) {
  const path = layer[pathIndex];
  if (!path || path.isholepath) return "";
  const contours = [fittedContourPath(path.segments, cleanup, samplingScale)];
  for (const holeIndex of path.holechildren) {
    const hole = layer[holeIndex];
    if (hole?.segments.length) contours.push(fittedContourPath(hole.segments, cleanup, samplingScale));
  }
  return contours.filter(Boolean).join(" ");
}

function keepTracedPath(layer: TracedPath[], pathIndex: number, canvasArea: number, cleanup: CleanupLevel) {
  const path = layer[pathIndex];
  if (!path || path.isholepath) return false;
  const minimumShare = { none: 0, light: .0001, medium: .0005, strong: .0005 }[cleanup];
  if (!minimumShare) return true;
  const area = tracedPathArea(layer, pathIndex);
  const nodeCount = path.segments.length + path.holechildren.reduce((total, holeIndex) => total + (layer[holeIndex]?.segments.length ?? 0), 0);
  const minimumArea = canvasArea * minimumShare;
  // The area threshold is the primary filter. Tiny low-node shapes get a
  // second, stricter gate because they are overwhelmingly quantization dust.
  return area >= minimumArea && (nodeCount > 8 || area >= minimumArea * 2);
}

function compoundPath(pathData: string[], color: string, strokeWidth: number) {
  if (!pathData.length) return "";
  return `<path fill="${color}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" clip-rule="evenodd" shape-rendering="geometricPrecision" d="${pathData.join(" ")}"/>`;
}

function traceImage(imageData: ImageData, palette: PaletteColor[], cleanup: CleanupLevel) {
  const traceSettings = {
    none: { pathOmit: 1, lineTolerance: .45, curveTolerance: .8, blur: 0, blurDelta: 22, stroke: .2, minimumDimension: 800, maximumDimension: 1600 },
    light: { pathOmit: 8, lineTolerance: .3, curveTolerance: 1.35, blur: 0, blurDelta: 28, stroke: .25, minimumDimension: 800, maximumDimension: 1400 },
    medium: { pathOmit: 12, lineTolerance: .2, curveTolerance: 1.9, blur: 0, blurDelta: 34, stroke: .3, minimumDimension: 800, maximumDimension: 1200 },
    strong: { pathOmit: 20, lineTolerance: .12, curveTolerance: 2.7, blur: 0, blurDelta: 38, stroke: .35, minimumDimension: 800, maximumDimension: 1000 },
  }[cleanup];
  const tracing = resizeForTracing(imageData, traceSettings.minimumDimension, traceSettings.maximumDimension);
  const traceImageData = tracing.imageData;
  const hasTransparency = traceImageData.data.some((value, index) => index % 4 === 3 && value < 10);
  const tracePalette = palette.map(({ r, g, b }) => ({ r, g, b, a: 255 }));
  if (hasTransparency) tracePalette.push({ r: 0, g: 0, b: 0, a: 0 });
  const traceOptions = {
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
    roundcoords: 1,
    viewbox: true,
    desc: false,
    pal: tracePalette,
  };
  // Read ImageTracer's fitted segment data directly. Re-parsing its SVG made
  // curve fitting all-or-nothing: one short contour could force an entire
  // color path back to pixel-following L commands.
  const traced = ImageTracer.imagedataToTracedata(traceImageData, traceOptions);
  const samplingScale = Math.max(traceImageData.width / imageData.width, traceImageData.height / imageData.height);

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
  const silhouetteTrace = ImageTracer.imagedataToTracedata(silhouetteData, {
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
    roundcoords: 1,
    viewbox: true,
    desc: false,
    pal: [{ ...dominant, a: 255 }, { r: 0, g: 0, b: 0, a: 0 }],
  });
  const silhouettePaths: string[] = [];
  const silhouetteLayer = silhouetteTrace.layers[0] ?? [];
  for (let pathIndex = 0; pathIndex < silhouetteLayer.length; pathIndex += 1) {
    if (!keepTracedPath(silhouetteLayer, pathIndex, traceImageData.width * traceImageData.height, cleanup)) continue;
    const pathData = tracedPathData(silhouetteLayer, pathIndex, cleanup, samplingScale);
    if (pathData) silhouettePaths.push(pathData);
  }
  const basePath = compoundPath(silhouettePaths, palette[0]?.hex ?? "#000000", Math.max(.75, traceSettings.stroke));
  const baseLayer = silhouettePaths.length
    ? `<g id="vector-base-layer" class="vector-layer vector-base-layer" data-base-layer="true" data-color-index="0" data-color="${palette[0]?.hex ?? "#000000"}" transform="scale(${tracing.scaleX.toFixed(6)} ${tracing.scaleY.toFixed(6)})">${basePath}</g>`
    : "";

  const pathsByLayer = palette.map(() => [] as string[]);
  for (let layerIndex = 0; layerIndex < palette.length; layerIndex += 1) {
    const tracedLayer = traced.layers[layerIndex] ?? [];
    for (let pathIndex = 0; pathIndex < tracedLayer.length; pathIndex += 1) {
      if (!keepTracedPath(tracedLayer, pathIndex, traceImageData.width * traceImageData.height, cleanup)) continue;
      const pathData = tracedPathData(tracedLayer, pathIndex, cleanup, samplingScale);
      if (pathData) pathsByLayer[layerIndex].push(pathData);
    }
  }
  const layers = pathsByLayer.map((paths, index) => {
    if (!paths.length) return "";
    const color = palette[index];
    // One compound path per color keeps Illustrator's Layers panel clean. All
    // substantial islands of the same color remain editable as subpaths, but
    // they no longer arrive as hundreds of separate dot objects.
    const path = compoundPath(paths, color.hex, traceSettings.stroke);
    return `<g id="vector-layer-${index + 1}" class="vector-layer" data-color-index="${index}" data-color="${color.hex}" data-share="${color.share.toFixed(2)}" transform="scale(${tracing.scaleX.toFixed(6)} ${tracing.scaleY.toFixed(6)})">${path}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageData.width} ${imageData.height}" width="${imageData.width}" height="${imageData.height}" shape-rendering="geometricPrecision" data-vector-engine="imagetracer-curvefit-v2" role="img" aria-label="Layered vector artwork">${baseLayer}${layers}</svg>`;
}

function resultFromParts(
  width: number,
  height: number,
  pixelMap: Uint8Array,
  alphaMap: Uint8ClampedArray,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
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
  const svg = traceImage(traceReady, normalized.palette, cleanup);
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
  };
}

export function createVectorResult(source: RasterSource, colorCount: number, cleanup: CleanupLevel) {
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
