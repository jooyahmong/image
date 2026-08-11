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

const MAX_PROCESSING_DIMENSION = 1600;
const TRANSPARENT_INDEX = 255;

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

function smoothIndexedMap(width: number, height: number, source: Uint8Array, cleanup: CleanupLevel) {
  const passes = { none: 0, light: 1, medium: 1, strong: 2 }[cleanup];
  const minimum = { none: 9, light: 6, medium: 5, strong: 5 }[cleanup];
  let current = source.slice();

  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const offset = y * width + x;
        const counts = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
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
        if (dominant !== current[offset] && dominantCount >= minimum) next[offset] = dominant;
      }
    }
    current = next;
  }
  return current;
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

function smoothClosedContour(points: VectorPoint[], cleanup: CleanupLevel) {
  const anchors = reduceCurveAnchors(points, cleanup);
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

function curvePathData(pathData: string, cleanup: CleanupLevel) {
  if (cleanup === "none") return pathData;
  const tokens = pathData.match(/[MLQCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const contours: VectorPoint[][] = [];
  let contour: VectorPoint[] = [];
  let index = 0;

  const finishContour = () => {
    if (contour.length) contours.push(contour);
    contour = [];
  };

  while (index < tokens.length) {
    const command = tokens[index++].toUpperCase();
    if (command === "M" || command === "L") {
      if (command === "M") finishContour();
      contour.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
    } else if (command === "Q") {
      index += 2;
      contour.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
    } else if (command === "C") {
      index += 4;
      contour.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
    } else if (command === "Z") {
      finishContour();
    }
  }
  finishContour();

  const curved = contours.map((points) => smoothClosedContour(points, cleanup)).filter(Boolean);
  return curved.length === contours.length && curved.length ? curved.join(" ") : pathData;
}

function curvePathMarkup(path: string, cleanup: CleanupLevel) {
  return path.replace(/\sd="([^"]*)"/, (match, pathData: string) => ` d="${curvePathData(pathData, cleanup)}"`);
}

function traceImage(imageData: ImageData, palette: PaletteColor[], cleanup: CleanupLevel) {
  const traceSettings = {
    // Keep the straight-line threshold deliberately low. ImageTracer tries a
    // line before a spline, so raising both thresholds creates a handful of
    // obvious polygon edges. A low line threshold plus a progressively wider
    // quadratic threshold keeps fewer anchors while joining them with curves.
    none: { pathOmit: 1, lineTolerance: .45, curveTolerance: .8, blur: 0, blurDelta: 22, stroke: .25, maximumDimension: 1400 },
    light: { pathOmit: 5, lineTolerance: .14, curveTolerance: 1.7, blur: 1, blurDelta: 28, stroke: .35, maximumDimension: 1200 },
    medium: { pathOmit: 11, lineTolerance: .045, curveTolerance: 3.2, blur: 1, blurDelta: 38, stroke: .45, maximumDimension: 1000 },
    strong: { pathOmit: 22, lineTolerance: .012, curveTolerance: 5.6, blur: 2, blurDelta: 52, stroke: .55, maximumDimension: 900 },
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

  const pathsByLayer = palette.map(() => [] as string[]);
  for (const match of rawSvg.matchAll(/<path\s+[^>]*desc="l\s+(\d+)\s+p\s+\d+"[^>]*\/>/g)) {
    const layer = Number(match[1]);
    if (pathsByLayer[layer]) {
      const cleanPath = match[0]
        .replace(/\sdesc="[^"]*"/, "")
        .replace("<path ", '<path stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision" ');
      pathsByLayer[layer].push(curvePathMarkup(cleanPath, cleanup));
    }
  }
  const layers = pathsByLayer.map((paths, index) => {
    if (!paths.length) return "";
    const color = palette[index];
    return `<g id="vector-layer-${index + 1}" class="vector-layer" data-color-index="${index}" data-color="${color.hex}" data-share="${color.share.toFixed(2)}" transform="scale(${tracing.scaleX.toFixed(6)} ${tracing.scaleY.toFixed(6)})">${paths.join("")}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageData.width} ${imageData.height}" width="${imageData.width}" height="${imageData.height}" shape-rendering="geometricPrecision" role="img" aria-label="Layered vector artwork">${layers}</svg>`;
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
    pathCount: (svg.match(/<path\b/g) ?? []).length,
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

  return resultFromParts(width, height, smoothIndexedMap(width, height, pixelMap, cleanup), alphaMap, palette, cleanup);
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

export function deleteColors(result: VectorResult, selected: number[], cleanup: CleanupLevel) {
  const removed = new Set([...new Set(selected)].filter((index) => result.palette[index] && !result.palette[index].locked));
  if (!removed.size || removed.size >= result.palette.length) return result;
  const oldToNew = new Map<number, number>();
  const palette = result.palette.filter((_, index) => !removed.has(index)).map((color, newIndex) => {
    const oldIndex = result.palette.findIndex((item) => item.id === color.id);
    oldToNew.set(oldIndex, newIndex);
    return { ...color };
  });
  const pixelMap = new Uint8Array(result.pixelMap.length).fill(TRANSPARENT_INDEX);
  result.pixelMap.forEach((oldIndex, pixel) => {
    if (oldIndex === TRANSPARENT_INDEX || removed.has(oldIndex)) return;
    pixelMap[pixel] = oldToNew.get(oldIndex) ?? TRANSPARENT_INDEX;
  });
  return resultFromParts(
    result.width,
    result.height,
    smoothIndexedMap(result.width, result.height, pixelMap, cleanup),
    result.alphaMap,
    palette,
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
