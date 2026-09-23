// Runs the Fast Path pixel math (background estimation, flood fill, and
// connected-component labeling) off the main thread. See the "Off-main-
// thread dispatch" section of extract-elements-utils.ts for how this is
// invoked and how it falls back when a Worker isn't available.
//
// Kept deliberately thin: every real decision (thresholds, the labeling
// algorithm) lives in the pure, Node-testable functions it imports, not
// duplicated here.

import { computeForegroundMask, detectFastPathElements, type BackgroundEstimate, type BackgroundMode, type ElementRegion } from "./extract-elements-utils";

// The DOM lib (not "webworker") is what this project's tsconfig loads, so
// `self` is typed as Window here. This local shape is enough for what the
// worker actually does and keeps the rest of the app's tsconfig untouched.
type WorkerScope = {
  postMessage(message: unknown, transfer: ArrayBufferLike[]): void;
  onmessage: ((event: { data: { width: number; height: number; data: ArrayBufferLike } }) => void) | null;
};
declare const self: WorkerScope;

type SuccessMessage = {
  ok: true;
  data: ArrayBufferLike;
  labels: ArrayBufferLike;
  regions: ElementRegion[];
  backgroundMode: BackgroundMode;
  background: BackgroundEstimate;
};
type FailureMessage = { ok: false; error: string };

self.onmessage = (event) => {
  const { width, height, data } = event.data;
  try {
    const pixels = new Uint8ClampedArray(data);
    const { mask, backgroundMode, background } = computeForegroundMask(width, height, pixels);
    const { labels, regions } = detectFastPathElements(width, height, mask);
    const message: SuccessMessage = { ok: true, data: pixels.buffer, labels: labels.buffer, regions, backgroundMode, background };
    self.postMessage(message, [message.data, message.labels]);
  } catch (error) {
    const message: FailureMessage = { ok: false, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(message, []);
  }
};
