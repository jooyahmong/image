export const EXTRACT_ELEMENTS_MAX_FILE_SIZE = 10 * 1024 * 1024;

const EXTRACT_ELEMENTS_ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateExtractElementsFile(file: Pick<File, "type" | "size">) {
  if (!EXTRACT_ELEMENTS_ACCEPTED_TYPES.has(file.type)) return "type" as const;
  if (file.size > EXTRACT_ELEMENTS_MAX_FILE_SIZE) return "size" as const;
  return null;
}

// --- Fast Path element detection --------------------------------------
//
// This is one interchangeable detection backend, not the architecture. Any
// future backend (a local model, a remote API) should be able to produce the
// same ElementRegion[] + per-pixel labels shape so the review UI and export
// pipeline never need to know which backend ran.

export type ElementRegion = { id: number; x: number; y: number; width: number; height: number; area: number };
export type RasterSourceData = { width: number; height: number; data: Uint8ClampedArray };
export type ExtractedElement = ElementRegion & { previewUrl: string };
export type BackgroundMode = "alpha" | "near-white";

const ALPHA_BACKGROUND_THRESHOLD = 24;
const NEAR_WHITE_MIN_CHANNEL = 240;
const NEAR_WHITE_MAX_SPREAD = 14;
const MAX_DETECTED_ELEMENTS = 40;

function isNearWhitePixel(r: number, g: number, b: number) {
  if (r < NEAR_WHITE_MIN_CHANNEL || g < NEAR_WHITE_MIN_CHANNEL || b < NEAR_WHITE_MIN_CHANNEL) return false;
  return Math.max(r, g, b) - Math.min(r, g, b) <= NEAR_WHITE_MAX_SPREAD;
}

// Real alpha transparency wins when present. Otherwise treat any near-white
// region reachable from the image border as background, so a white canvas
// around the artwork is dropped but a white highlight fully enclosed inside
// a shape is not.
export function computeForegroundMask(width: number, height: number, data: Uint8ClampedArray): { mask: Uint8Array; backgroundMode: BackgroundMode } {
  const pixelCount = width * height;

  let hasTransparency = false;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (data[pixel * 4 + 3] <= ALPHA_BACKGROUND_THRESHOLD) {
      hasTransparency = true;
      break;
    }
  }

  const foreground = new Uint8Array(pixelCount);
  if (hasTransparency) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      foreground[pixel] = data[pixel * 4 + 3] <= ALPHA_BACKGROUND_THRESHOLD ? 0 : 1;
    }
    return { mask: foreground, backgroundMode: "alpha" };
  }

  const background = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let tail = 0;
  const tryEnqueue = (pixel: number) => {
    if (background[pixel]) return;
    const offset = pixel * 4;
    if (!isNearWhitePixel(data[offset], data[offset + 1], data[offset + 2])) return;
    background[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    tryEnqueue(x);
    tryEnqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    tryEnqueue(y * width);
    tryEnqueue(y * width + width - 1);
  }

  let head = 0;
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        tryEnqueue(nextY * width + nextX);
      }
    }
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) foreground[pixel] = background[pixel] ? 0 : 1;
  return { mask: foreground, backgroundMode: "near-white" };
}

// 8-connected labeling with a dust-area cutoff, the same shape as the
// existing Image-to-SVG disconnected-object detection in vector-utils.ts
// (kept as a separate implementation since it operates on raw pixels here,
// not on a palette-reduced VectorResult).
export function detectFastPathElements(
  width: number,
  height: number,
  mask: Uint8Array,
  options: { minimumArea?: number; padding?: number } = {},
): { labels: Int32Array; regions: ElementRegion[] } {
  const pixelCount = width * height;
  const padding = options.padding ?? 2;
  const minimumArea = options.minimumArea ?? Math.max(16, Math.round(pixelCount * 0.0005));
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const regions: ElementRegion[] = [];
  let nextId = 1;

  for (let start = 0; start < pixelCount; start += 1) {
    if (!mask[start] || labels[start]) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    queue[tail] = start;
    tail += 1;
    labels[start] = nextId;

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          const nextPixel = nextY * width + nextX;
          if (!mask[nextPixel] || labels[nextPixel]) continue;
          labels[nextPixel] = nextId;
          queue[tail] = nextPixel;
          tail += 1;
        }
      }
    }

    if (tail < minimumArea) {
      for (let i = 0; i < tail; i += 1) labels[queue[i]] = 0;
      continue;
    }

    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const right = Math.min(width, maxX + 1 + padding);
    const bottom = Math.min(height, maxY + 1 + padding);
    regions.push({ id: nextId, x, y, width: right - x, height: bottom - y, area: tail });
    nextId += 1;
  }

  regions.sort((first, second) => second.area - first.area);
  return { labels, regions: regions.slice(0, MAX_DETECTED_ELEMENTS) };
}

// --- Browser-only rendering ---------------------------------------------
// Everything above is pure and unit-testable in Node. Decoding a File and
// drawing to canvas needs a real DOM, so it stays isolated here.

export async function decodeImageFileToRasterSource(file: File): Promise<RasterSourceData> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: imageData.width, height: imageData.height, data: imageData.data };
  } finally {
    bitmap.close();
  }
}

export async function renderElementPreview(source: RasterSourceData, labels: Int32Array, region: ElementRegion): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = region.width;
  canvas.height = region.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  const output = context.createImageData(region.width, region.height);

  for (let localY = 0; localY < region.height; localY += 1) {
    const sourceY = region.y + localY;
    for (let localX = 0; localX < region.width; localX += 1) {
      const sourceX = region.x + localX;
      const outputOffset = (localY * region.width + localX) * 4;
      if (sourceX >= source.width || sourceY >= source.height) {
        output.data[outputOffset + 3] = 0;
        continue;
      }
      const sourcePixel = sourceY * source.width + sourceX;
      const sourceOffset = sourcePixel * 4;
      const included = labels[sourcePixel] === region.id;
      output.data[outputOffset] = source.data[sourceOffset];
      output.data[outputOffset + 1] = source.data[sourceOffset + 1];
      output.data[outputOffset + 2] = source.data[sourceOffset + 2];
      output.data[outputOffset + 3] = included ? source.data[sourceOffset + 3] : 0;
    }
  }

  context.putImageData(output, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Element preview rendering failed.");
  return URL.createObjectURL(blob);
}

export async function detectExtractElements(file: File): Promise<ExtractedElement[]> {
  const source = await decodeImageFileToRasterSource(file);
  const { mask } = computeForegroundMask(source.width, source.height, source.data);
  const { labels, regions } = detectFastPathElements(source.width, source.height, mask);
  const elements: ExtractedElement[] = [];
  for (const region of regions) {
    const previewUrl = await renderElementPreview(source, labels, region);
    elements.push({ ...region, previewUrl });
  }
  return elements;
}
