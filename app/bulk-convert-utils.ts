// Bulk SVG Convert -- pure logic only (validation, filenames, job/queue
// state, ZIP packaging). Deliberately independent of Extract Elements and
// of the quarantined `experiment/extract-export-quality` branch: nothing
// here is imported from `extract-elements-*`, and the Unicode-safe
// filename helper below is a fresh, small, Bulk-only implementation, not a
// copy of that experiment's fix.
//
// The actual conversion step (`convertBulkFile`) calls the real, unmodified
// single-image pipeline (`loadRaster` + `createVectorResult` from
// `vector-utils.ts`) -- Bulk is not a second SVG engine.

import { strToU8, unzipSync, zipSync } from "fflate";
import { createVectorResult, loadRaster, type CleanupLevel } from "./vector-utils.ts";

// --- Upload validation ---------------------------------------------------

export const BULK_MAX_FILES = 50;
export const BULK_ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isBulkFileTypeAccepted(file: Pick<File, "type">): boolean {
  return BULK_ACCEPTED_TYPES.has(file.type);
}

// Splits an incoming file list into what can actually be added -- accepted
// files, files rejected for type, and files that would exceed the
// remaining quota -- so one bad or excess file in a drag-drop never throws
// away the rest of a valid batch.
export function partitionIncomingBulkFiles(
  files: File[],
  existingCount: number,
): { accepted: File[]; rejectedType: File[]; overflow: File[] } {
  const accepted: File[] = [];
  const rejectedType: File[] = [];
  const overflow: File[] = [];
  let count = existingCount;
  for (const file of files) {
    if (!isBulkFileTypeAccepted(file)) {
      rejectedType.push(file);
      continue;
    }
    if (count >= BULK_MAX_FILES) {
      overflow.push(file);
      continue;
    }
    accepted.push(file);
    count += 1;
  }
  return { accepted, rejectedType, overflow };
}

// --- Unicode-safe filenames (Bulk-only utility) --------------------------
//
// Denylist, not allowlist: removes only characters that actually break a
// filename (Windows/filesystem-forbidden characters, control characters,
// whitespace folded to a hyphen) so Korean, English, and any other
// Unicode text a file was actually named survives untouched. No
// transliteration.

const BULK_FILENAME_EXTENSION = /\.[^.]+$/;
const BULK_FILENAME_FORBIDDEN_CHARS = /[<>:"/\\|?*]+/gu;
const BULK_FILENAME_WHITESPACE = /\s+/gu;

function stripBulkControlCharacters(value: string): string {
  return Array.from(value).filter((character) => (character.codePointAt(0) ?? 0) >= 0x20).join("");
}

export function sanitizeBulkFilenameBase(name: string, fallback = "image"): string {
  const withoutExtension = stripBulkControlCharacters(name.replace(BULK_FILENAME_EXTENSION, ""));
  const cleaned = withoutExtension
    .replace(BULK_FILENAME_FORBIDDEN_CHARS, "-")
    .replace(BULK_FILENAME_WHITESPACE, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-.]+|[-.\s]+$/gu, "");
  return cleaned || fallback;
}

// Numbers collisions (`flower.svg`, `flower-2.svg`, ...) case-insensitively
// against every filename already handed out, the same shape as the main
// editor's own download-collision handling.
export function buildBulkSvgFilename(baseName: string, usedNames: ReadonlySet<string>): string {
  let candidate = `${baseName}.svg`;
  for (let suffix = 2; usedNames.has(candidate.toLowerCase()); suffix += 1) {
    candidate = `${baseName}-${suffix}.svg`;
  }
  return candidate;
}

// --- Jobs ------------------------------------------------------------------

export type BulkJobStatus = "queued" | "converting" | "done" | "failed";

export type BulkJob = {
  id: number;
  file: File;
  name: string;
  selected: boolean;
  status: BulkJobStatus;
  svg: string | null;
  width: number | null;
  height: number | null;
  error: string | null;
};

export function createBulkJob(id: number, file: File): BulkJob {
  return { id, file, name: file.name, selected: true, status: "queued", svg: null, width: null, height: null, error: null };
}

export function createBulkJobs(files: File[], startId: number): BulkJob[] {
  return files.map((file, index) => createBulkJob(startId + index, file));
}

export function selectAllBulkJobs(jobs: BulkJob[]): BulkJob[] {
  return jobs.map((job) => ({ ...job, selected: true }));
}

export function deselectAllBulkJobs(jobs: BulkJob[]): BulkJob[] {
  return jobs.map((job) => ({ ...job, selected: false }));
}

export function toggleBulkJobSelected(jobs: BulkJob[], id: number): BulkJob[] {
  return jobs.map((job) => (job.id === id ? { ...job, selected: !job.selected } : job));
}

export function removeBulkJob(jobs: BulkJob[], id: number): BulkJob[] {
  return jobs.filter((job) => job.id !== id);
}

// A job is eligible for Convert All / retry if it's selected and not
// already successfully done -- a done job is never silently reconverted.
export function isBulkJobPending(job: BulkJob): boolean {
  return job.selected && job.status !== "done";
}

export function resetBulkJobToQueued(jobs: BulkJob[], id: number): BulkJob[] {
  return jobs.map((job) => (job.id === id ? { ...job, status: "queued", error: null } : job));
}

export function resetFailedBulkJobsToQueued(jobs: BulkJob[]): BulkJob[] {
  return jobs.map((job) => (job.status === "failed" ? { ...job, status: "queued", error: null } : job));
}

export function bulkProgress(jobs: BulkJob[]): { done: number; failed: number; total: number } {
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    if (job.status === "done") done += 1;
    else if (job.status === "failed") failed += 1;
  }
  return { done, failed, total: jobs.length };
}

// --- Conversion: the real, shared single-image pipeline ------------------
//
// Exactly the two calls `app/page.tsx`'s own upload+conversion flow makes
// (`loadRaster` then `createVectorResult`), with no wrapper engine and no
// extra preprocessing of its own. Only `{ svg, width, height }` is kept --
// the decoded `RasterSource`/ImageData/canvas is never stored anywhere
// past this function's own stack, so nothing holds 50 rasters in memory
// at once regardless of how many jobs exist.
export async function convertBulkFile(
  file: File,
  colorCount: number,
  cleanup: CleanupLevel,
  anchorSimplification: number,
): Promise<{ svg: string; width: number; height: number }> {
  const source = await loadRaster(file);
  const result = createVectorResult(source, colorCount, cleanup, anchorSimplification);
  return { svg: result.svg, width: source.width, height: source.height };
}

// --- Bounded concurrency queue --------------------------------------------
//
// `createVectorResult` is synchronous and CPU-bound (same as the main
// editor; there is no Worker for vectorization, and adding one is out of
// scope -- it would start to look like a second pipeline). `concurrency`
// workers each pull the next pending job from a shared cursor: `loadRaster`
// actually overlaps (it's a real async decode), while each job's
// synchronous trace step still runs to completion before the next one on
// the JS main thread -- concurrency mainly bounds how many files are
// in flight / decoded at once, not CPU parallelism that doesn't exist here.
// A failure in one job is caught per-job and never stops the others.
export type BulkConvertFn = (job: BulkJob) => Promise<{ svg: string; width: number; height: number }>;

export async function runBulkQueue(
  jobs: BulkJob[],
  options: { concurrency: number; convert: BulkConvertFn; onJobUpdate: (job: BulkJob) => void; isCancelled?: () => boolean },
): Promise<void> {
  const pending = jobs.filter(isBulkJobPending);
  let cursor = 0;
  const concurrency = Math.max(1, Math.floor(options.concurrency));

  const worker = async () => {
    while (cursor < pending.length) {
      if (options.isCancelled?.()) return;
      const job = pending[cursor];
      cursor += 1;
      const converting: BulkJob = { ...job, status: "converting", error: null };
      options.onJobUpdate(converting);
      try {
        const result = await options.convert(converting);
        options.onJobUpdate({ ...converting, status: "done", svg: result.svg, width: result.width, height: result.height });
      } catch (error) {
        options.onJobUpdate({ ...converting, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
}

// --- ZIP -------------------------------------------------------------------

export const BULK_ZIP_FILENAME = "woojoo-svg-export.zip";

// Only successful, selected jobs ever reach this -- the caller filters;
// this function just packages whatever filename/SVG pairs it's handed,
// numbering any remaining collisions.
export function buildBulkZip(entries: { name: string; svg: string }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const entry of entries) {
    const baseName = sanitizeBulkFilenameBase(entry.name.replace(/\.[^.]+$/, ""));
    const filename = buildBulkSvgFilename(baseName, used);
    used.add(filename.toLowerCase());
    files[filename] = strToU8(entry.svg);
  }
  return zipSync(files);
}

// Re-exported only so tests can round-trip a built ZIP (confirms Unicode
// filenames and content survive) without a second, hand-rolled ZIP reader.
export { unzipSync };
