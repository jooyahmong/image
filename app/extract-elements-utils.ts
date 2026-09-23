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
// same ExtractionOutcome shape so the review UI and export pipeline never
// need to know which backend ran, or whether it ran on the main thread or a
// Worker.

export type ElementRegion = { id: number; x: number; y: number; width: number; height: number; area: number };
export type RasterSourceData = { width: number; height: number; data: Uint8ClampedArray };
export type ExtractedElement = ElementRegion & { previewUrl: string };
export type BackgroundMode = "alpha" | "near-uniform";
export type BackgroundEstimate = { color: [number, number, number]; confidence: number };
export type UnsupportedReason = "low-background-confidence" | "background-not-separated" | "no-elements-found";
export type ExtractionOutcome =
  | { status: "ok"; elements: ExtractedElement[] }
  | { status: "unsupported"; reason: UnsupportedReason };

const ALPHA_BACKGROUND_THRESHOLD = 24;
const MAX_DETECTED_ELEMENTS = 40;

// How close (plain RGB Euclidean distance) a pixel must be to the estimated
// background color to count as background. This is intentionally small: it
// should absorb compression noise and antialiasing blend pixels around a
// truly uniform background, not any generically "light" color -- a wider
// tolerance would start swallowing pale/pastel foreground artwork, which
// this product's own presets already use.
const BACKGROUND_COLOR_TOLERANCE_SQUARED = 28 * 28;

// Below this fraction of border pixels agreeing on one dominant color, the
// border itself doesn't look like a single flat background (a photo,
// texture, or gradient) and Fast Path should not attempt separation.
const MIN_BACKGROUND_CONFIDENCE = 0.6;

// If the single largest detected component covers more than this share of
// the whole canvas in near-uniform mode, background separation almost
// certainly failed (this is the exact shape of the cream-background
// failure found in Phase C.5 QA: one component spanning ~100% of the image).
const MAX_DOMINANT_COMPONENT_AREA_RATIO = 0.85;

// Sample the image border, bucket pixel colors coarsely (16 levels per
// channel), and take the most common bucket's average color as the
// estimated background. This is the "adaptive" part: white, off-white,
// cream, and light beige are all handled by the same estimation instead of
// a fixed near-white RGB cutoff.
function estimateBackgroundColor(width: number, height: number, data: Uint8ClampedArray): BackgroundEstimate {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let total = 0;
  const sample = (pixel: number) => {
    const offset = pixel * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
    total += 1;
  };

  for (let x = 0; x < width; x += 1) {
    sample(x);
    sample((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(y * width);
    sample(y * width + width - 1);
  }

  let winner: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!winner || bucket.count > winner.count) winner = bucket;
  }
  if (!winner || total === 0) return { color: [255, 255, 255], confidence: 0 };
  return {
    color: [Math.round(winner.r / winner.count), Math.round(winner.g / winner.count), Math.round(winner.b / winner.count)],
    confidence: winner.count / total,
  };
}

export type ForegroundMaskResult = { mask: Uint8Array; backgroundMode: BackgroundMode; background: BackgroundEstimate };

// Real alpha transparency wins when present. Otherwise estimate a single
// background color from the image border and flood-fill outward from the
// border through pixels close to that color (8-connected), so a uniform
// canvas around the artwork is dropped -- whatever shade of white, off-white,
// cream, or beige it happens to be -- while a light highlight fully enclosed
// inside a shape is not (it's never reached from the border through
// background-colored pixels alone).
export function computeForegroundMask(width: number, height: number, data: Uint8ClampedArray): ForegroundMaskResult {
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
    return { mask: foreground, backgroundMode: "alpha", background: { color: [0, 0, 0], confidence: 1 } };
  }

  const background = estimateBackgroundColor(width, height, data);
  const [br, bg, bb] = background.color;
  const isBackgroundColor = (r: number, g: number, b: number) => {
    const dr = r - br;
    const dg = g - bg;
    const db = b - bb;
    return dr * dr + dg * dg + db * db <= BACKGROUND_COLOR_TOLERANCE_SQUARED;
  };

  const visitedBackground = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let tail = 0;
  const tryEnqueue = (pixel: number) => {
    if (visitedBackground[pixel]) return;
    const offset = pixel * 4;
    if (!isBackgroundColor(data[offset], data[offset + 1], data[offset + 2])) return;
    visitedBackground[pixel] = 1;
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

  for (let pixel = 0; pixel < pixelCount; pixel += 1) foreground[pixel] = visitedBackground[pixel] ? 0 : 1;
  return { mask: foreground, backgroundMode: "near-uniform", background };
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

// Decide whether the detection result is trustworthy enough to show as
// separated elements, or whether Fast Path should say so instead of
// returning a single wrong "element" (typically the whole image, still on
// its original background) -- the exact failure shape found in Phase C.5 QA.
export function assessExtractionOutcome(
  width: number,
  height: number,
  backgroundMode: BackgroundMode,
  background: BackgroundEstimate,
  regions: ElementRegion[],
): UnsupportedReason | null {
  if (backgroundMode === "near-uniform" && background.confidence < MIN_BACKGROUND_CONFIDENCE) return "low-background-confidence";
  const dominant = regions[0];
  if (backgroundMode === "near-uniform" && dominant && dominant.area / (width * height) > MAX_DOMINANT_COMPONENT_AREA_RATIO) return "background-not-separated";
  if (regions.length === 0) return "no-elements-found";
  return null;
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

// --- Off-main-thread dispatch ------------------------------------------
//
// The pure mask/labeling pass above is the expensive part (measured ~166ms
// on a 3-megapixel image in Phase C.5 QA). It runs in a Worker when one is
// available, using a transferable ArrayBuffer round trip (the pixel buffer
// is transferred into the worker and back, not copied). If a Worker can't
// be created or errors, detection quietly falls back to running the exact
// same pure functions synchronously on the main thread -- callers never see
// the difference.

type FastPathDetection = { labels: Int32Array; regions: ElementRegion[]; backgroundMode: BackgroundMode; background: BackgroundEstimate; data: Uint8ClampedArray };

function runFastPathDetectionOnMainThread(source: RasterSourceData): FastPathDetection {
  const { mask, backgroundMode, background } = computeForegroundMask(source.width, source.height, source.data);
  const { labels, regions } = detectFastPathElements(source.width, source.height, mask);
  return { labels, regions, backgroundMode, background, data: source.data };
}

type WorkerSuccessMessage = {
  ok: true;
  data: ArrayBuffer;
  labels: ArrayBuffer;
  regions: ElementRegion[];
  backgroundMode: BackgroundMode;
  background: BackgroundEstimate;
};
type WorkerFailureMessage = { ok: false; error: string };

function runFastPathDetectionInWorker(source: RasterSourceData): Promise<FastPathDetection> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(new Error("Worker is not available in this environment."));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./extract-elements-worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    worker.onmessage = (event: MessageEvent<WorkerSuccessMessage | WorkerFailureMessage>) => {
      worker.terminate();
      const message = event.data;
      if (!message.ok) {
        reject(new Error(message.error));
        return;
      }
      resolve({
        data: new Uint8ClampedArray(message.data),
        labels: new Int32Array(message.labels),
        regions: message.regions,
        backgroundMode: message.backgroundMode,
        background: message.background,
      });
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(event.error instanceof Error ? event.error : new Error(event.message || "Worker error."));
    };

    // Transfer a clone, not `source.data` itself: if the worker fails after
    // the transfer already happened, the caller's fallback still needs a
    // valid, untouched copy of the original pixels to fall back onto.
    const outbound = source.data.slice();
    worker.postMessage({ width: source.width, height: source.height, data: outbound.buffer }, [outbound.buffer]);
  });
}

async function runFastPathDetection(source: RasterSourceData): Promise<FastPathDetection> {
  try {
    return await runFastPathDetectionInWorker(source);
  } catch {
    // The worker only ever receives a clone of the pixel buffer (see
    // below), so `source.data` is always still valid here regardless of
    // why the worker path failed.
    return runFastPathDetectionOnMainThread(source);
  }
}

export async function detectExtractElements(file: File): Promise<ExtractionOutcome> {
  const decoded = await decodeImageFileToRasterSource(file);
  const detection = await runFastPathDetection(decoded);
  const reason = assessExtractionOutcome(decoded.width, decoded.height, detection.backgroundMode, detection.background, detection.regions);
  if (reason) return { status: "unsupported", reason };

  const source: RasterSourceData = { width: decoded.width, height: decoded.height, data: detection.data };
  const elements: ExtractedElement[] = [];
  for (const region of detection.regions) {
    const previewUrl = await renderElementPreview(source, detection.labels, region);
    elements.push({ ...region, previewUrl });
  }
  return { status: "ok", elements };
}
