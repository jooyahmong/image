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
  fileSize: number;
};

export type CropBox = { x: number; y: number; width: number; height: number };

const MAX_PROCESSING_DIMENSION = 1600;
const TRANSPARENT_INDEX = 255;

function canvasFromImageData(imageData: ImageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d", { willReadFrequently: true })?.putImageData(imageData, 0, 0);
  return canvas;
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

function traceImage(imageData: ImageData, palette: PaletteColor[], cleanup: CleanupLevel) {
  const pathOmit = { none: 0, light: 4, medium: 12, strong: 28 }[cleanup];
  const hasTransparency = imageData.data.some((value, index) => index % 4 === 3 && value < 10);
  const tracePalette = palette.map(({ r, g, b }) => ({ r, g, b, a: 255 }));
  if (hasTransparency) tracePalette.push({ r: 0, g: 0, b: 0, a: 0 });

  return ImageTracer.imagedataToSVG(imageData, {
    ltres: cleanup === "strong" ? 1.8 : 1,
    qtres: cleanup === "strong" ? 1.8 : 1,
    pathomit: pathOmit,
    rightangleenhance: true,
    colorsampling: 0,
    numberofcolors: tracePalette.length,
    colorquantcycles: 1,
    layering: 0,
    strokewidth: 0,
    linefilter: cleanup !== "none",
    scale: 1,
    roundcoords: 1,
    viewbox: true,
    desc: false,
    pal: tracePalette,
  });
}

function resultFromParts(
  width: number,
  height: number,
  pixelMap: Uint8Array,
  alphaMap: Uint8ClampedArray,
  palette: PaletteColor[],
  cleanup: CleanupLevel,
): VectorResult {
  const imageData = renderPalette(width, height, pixelMap, alphaMap, palette);
  const svg = traceImage(imageData, palette, cleanup);
  return {
    width,
    height,
    pixelMap,
    alphaMap,
    palette,
    imageData,
    previewUrl: imageDataToUrl(imageData),
    svg,
    pathCount: (svg.match(/<path\b/g) ?? []).length,
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
      locked: false,
    };
  });

  return resultFromParts(width, height, pixelMap, alphaMap, palette, cleanup);
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

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function downloadText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadPng(svg: string, crop: CropBox, scale: number, filename: string) {
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
  const url = URL.createObjectURL(pngBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
