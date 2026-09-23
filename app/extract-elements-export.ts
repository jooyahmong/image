// Kept separate from extract-elements-utils.ts on purpose: this is the only
// place Extract Elements imports vector-utils.ts (the Image-to-SVG engine).
// extract-elements-worker.ts imports extract-elements-utils.ts for the Fast
// Path detection functions and must NOT end up pulling vector-utils.ts (and
// its image-q/imagetracerjs dependencies) into the worker's bundle -- it
// did, by ~30x, when this lived in the same file as the detection code that
// worker imports. Splitting export into its own module keeps the worker
// chunk small again without changing what either side does.

import { createVectorResult, type CleanupLevel, type RasterSource } from "./vector-utils.ts";
import { extractCardPixels, toImageData, type RasterSourceData, type ReviewCard } from "./extract-elements-utils.ts";

// --- Filename safety ---------------------------------------------------
//
// Same style as the existing Image-to-SVG `cleanFilename` in app/page.tsx
// (strip a trailing extension, replace anything outside [a-zA-Z0-9-_] with
// a hyphen, fall back if empty) so a card's exported files look and behave
// like every other download this app already produces.

const FILENAME_EXTENSION = /\.[^.]+$/;
const FILENAME_UNSAFE_CHARS = /[^a-zA-Z0-9-_]+/g;

export function sanitizeFilenameBase(name: string, fallback = "element"): string {
  const cleaned = name.replace(FILENAME_EXTENSION, "").replace(FILENAME_UNSAFE_CHARS, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

// Appends `.extension` to `baseName`, renumbering (`-2`, `-3`, ...) until the
// result isn't already in `usedNames` -- callers pass every filename already
// handed out this session so repeats (including across formats sharing a
// base name) come back safely numbered instead of colliding.
export function buildExportFilename(baseName: string, extension: string, usedNames: ReadonlySet<string>): string {
  let candidate = `${baseName}.${extension}`;
  for (let suffix = 2; usedNames.has(candidate.toLowerCase()); suffix += 1) {
    candidate = `${baseName}-${suffix}.${extension}`;
  }
  return candidate;
}

// --- Export (Phase E) ---------------------------------------------------
//
// PNG/JPG always re-crop the card's real source pixels via
// `extractCardPixels` -- never a screenshot of the already-rendered
// preview -- so alpha transparency and, for a merged card, the original
// spatial relationship between its members are preserved exactly as
// detected/merged. SVG export reuses `createVectorResult` from
// `vector-utils.ts` (the same engine the Image-to-SVG editor uses) instead
// of a second SVG pipeline; this only builds the `RasterSource` wrapper it
// needs and returns the resulting SVG string.

const SVG_EXPORT_COLOR_COUNT = 8;
const SVG_EXPORT_CLEANUP: CleanupLevel = "medium";
const SVG_EXPORT_ANCHOR_SIMPLIFICATION = 50;
const JPG_EXPORT_QUALITY = 0.92;
export const JPG_EXPORT_BACKGROUND: [number, number, number] = [255, 255, 255];

function cardPixelsToCanvas(pixels: Uint8ClampedArray, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.putImageData(toImageData(pixels, width, height), 0, 0);
  return canvas;
}

export async function exportCardAsPngBlob(source: RasterSourceData, labels: Int32Array, card: ReviewCard): Promise<Blob> {
  const pixels = extractCardPixels(source, labels, card, new Set(card.sourceRegionIds));
  const canvas = cardPixelsToCanvas(pixels, card.width, card.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNG export failed.");
  return blob;
}

// JPG has no transparency, so the card is composited over a solid
// background first. `putImageData` writes raw pixels with no blending, so
// the crop is drawn to its own scratch canvas and then `drawImage`d onto
// the background-filled one -- that draw is what actually alpha-composites
// it, the same way a browser would render it normally.
export async function exportCardAsJpgBlob(
  source: RasterSourceData,
  labels: Int32Array,
  card: ReviewCard,
  background: [number, number, number] = JPG_EXPORT_BACKGROUND,
): Promise<Blob> {
  const pixels = extractCardPixels(source, labels, card, new Set(card.sourceRegionIds));
  const scratch = cardPixelsToCanvas(pixels, card.width, card.height);

  const canvas = document.createElement("canvas");
  canvas.width = card.width;
  canvas.height = card.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.fillStyle = `rgb(${background[0]}, ${background[1]}, ${background[2]})`;
  context.fillRect(0, 0, card.width, card.height);
  context.drawImage(scratch, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPG_EXPORT_QUALITY));
  if (!blob) throw new Error("JPG export failed.");
  return blob;
}

export function exportCardAsSvgString(source: RasterSourceData, labels: Int32Array, card: ReviewCard): string {
  const pixels = extractCardPixels(source, labels, card, new Set(card.sourceRegionIds));
  const rasterSource: RasterSource = {
    name: card.name,
    width: card.width,
    height: card.height,
    imageData: toImageData(pixels, card.width, card.height),
    previewUrl: "",
    originalWidth: card.width,
    originalHeight: card.height,
  };
  const result = createVectorResult(rasterSource, SVG_EXPORT_COLOR_COUNT, SVG_EXPORT_CLEANUP, SVG_EXPORT_ANCHOR_SIMPLIFICATION);
  return result.svg;
}
