import assert from "node:assert/strict";
import test from "node:test";

class TestImageData {
  constructor(first, second, third) {
    if (typeof first === "number") {
      this.width = first;
      this.height = second;
      this.data = new Uint8ClampedArray(first * second * 4);
    } else {
      this.data = first;
      this.width = second;
      this.height = third ?? Math.floor(first.length / 4 / second);
    }
  }
}

globalThis.ImageData = TestImageData;
globalThis.document = {
  body: { appendChild() {} },
  createElement(name) {
    if (name === "a") return { href: "", download: "", target: "", rel: "", style: {}, click() {}, remove() {} };
    assert.equal(name, "canvas");
    const canvas = {
      width: 0,
      height: 0,
      image: null,
      getContext() {
        return {
          imageSmoothingEnabled: false,
          putImageData(image) { canvas.image = image; },
          drawImage(source, _x, _y, width, height) {
            const output = new TestImageData(width, height);
            const input = source.image;
            for (let y = 0; y < height; y += 1) {
              for (let x = 0; x < width; x += 1) {
                const sourceX = Math.min(input.width - 1, Math.floor(x * input.width / width));
                const sourceY = Math.min(input.height - 1, Math.floor(y * input.height / height));
                const sourceOffset = (sourceY * input.width + sourceX) * 4;
                output.data.set(input.data.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
              }
            }
            canvas.image = output;
          },
          getImageData() { return canvas.image; },
        };
      },
      toDataURL() { return "data:image/png;base64,"; },
    };
    return canvas;
  },
};

const vectorUtilsUrl = new URL("../app/vector-utils.ts", import.meta.url);
vectorUtilsUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { createVectorResult, loadRaster } = await import(vectorUtilsUrl.href);

const bulkUtilsUrl = new URL("../app/bulk-convert-utils.ts", import.meta.url);
bulkUtilsUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const {
  BULK_MAX_FILES,
  buildBulkSvgFilename,
  buildBulkZip,
  convertBulkFile,
  createBulkJobs,
  deselectAllBulkJobs,
  isBulkFileTypeAccepted,
  partitionIncomingBulkFiles,
  removeBulkJob,
  resetFailedBulkJobsToQueued,
  runBulkQueue,
  sanitizeBulkFilenameBase,
  selectAllBulkJobs,
  toggleBulkJobSelected,
  unzipSync,
} = await import(bulkUtilsUrl.href);

// A circle filled with `color`, antialiased -- enough real content for
// createVectorResult to produce a non-trivial SVG, same helper shape used
// elsewhere in this codebase's tests.
function makeCircleImageData(width, height, color) {
  const imageData = new TestImageData(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.35;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const d = Math.hypot(x - cx, y - cy) - r;
      const coverage = d > 0.5 ? 0 : d <= -0.5 ? 1 : 0.5 - d;
      imageData.data[offset] = color[0];
      imageData.data[offset + 1] = color[1];
      imageData.data[offset + 2] = color[2];
      imageData.data[offset + 3] = Math.round(coverage * 255);
    }
  }
  return imageData;
}

function makeFakeImageFile(name, { type = "image/png", size = 1024, width = 48, height = 48, color = [214, 40, 40] } = {}) {
  const image = makeCircleImageData(width, height, color);
  return { name, type, size, __bitmap: { width, height, image, close() {} } };
}

function installBitmapDecoder() {
  globalThis.createImageBitmap = async (file) => file.__bitmap;
}

// --- Upload validation -----------------------------------------------------

test("isBulkFileTypeAccepted accepts the three advertised raster types and rejects others", () => {
  assert.equal(isBulkFileTypeAccepted({ type: "image/png" }), true);
  assert.equal(isBulkFileTypeAccepted({ type: "image/jpeg" }), true);
  assert.equal(isBulkFileTypeAccepted({ type: "image/webp" }), true);
  assert.equal(isBulkFileTypeAccepted({ type: "image/svg+xml" }), false);
  assert.equal(isBulkFileTypeAccepted({ type: "application/pdf" }), false);
});

test("partitionIncomingBulkFiles accepts valid files and separately flags unsupported type, without dropping the rest of the batch", () => {
  const files = [
    makeFakeImageFile("a.png", { type: "image/png" }),
    { name: "b.txt", type: "text/plain" },
    makeFakeImageFile("c.webp", { type: "image/webp" }),
  ];
  const { accepted, rejectedType, overflow } = partitionIncomingBulkFiles(files, 0);
  assert.equal(accepted.length, 2);
  assert.deepEqual(accepted.map((f) => f.name), ["a.png", "c.webp"]);
  assert.equal(rejectedType.length, 1);
  assert.equal(rejectedType[0].name, "b.txt");
  assert.equal(overflow.length, 0);
});

test("partitionIncomingBulkFiles enforces the 50-file maximum, flagging overflow instead of throwing", () => {
  const files = Array.from({ length: 10 }, (_, i) => makeFakeImageFile(`img-${i}.png`));
  const { accepted, overflow } = partitionIncomingBulkFiles(files, BULK_MAX_FILES - 3);
  assert.equal(accepted.length, 3);
  assert.equal(overflow.length, 7);
});

test("createBulkJobs assigns ids starting from the given value and defaults every job to selected+queued", () => {
  const files = [makeFakeImageFile("a.png"), makeFakeImageFile("b.png")];
  const jobs = createBulkJobs(files, 5);
  assert.deepEqual(jobs.map((j) => j.id), [5, 6]);
  assert.ok(jobs.every((j) => j.selected && j.status === "queued"));
});

test("select all / deselect all / toggle / remove operate on the job list immutably", () => {
  const jobs = createBulkJobs([makeFakeImageFile("a.png"), makeFakeImageFile("b.png")], 1);
  const deselected = deselectAllBulkJobs(jobs);
  assert.ok(deselected.every((j) => !j.selected));
  const reselected = selectAllBulkJobs(deselected);
  assert.ok(reselected.every((j) => j.selected));
  const toggled = toggleBulkJobSelected(reselected, 1);
  assert.equal(toggled.find((j) => j.id === 1).selected, false);
  assert.equal(toggled.find((j) => j.id === 2).selected, true);
  const removed = removeBulkJob(toggled, 2);
  assert.deepEqual(removed.map((j) => j.id), [1]);
});

// --- Filenames ---------------------------------------------------------

test("sanitizeBulkFilenameBase preserves English and Korean, folds whitespace, strips extension", () => {
  assert.equal(sanitizeBulkFilenameBase("flower.png"), "flower");
  assert.equal(sanitizeBulkFilenameBase("My Flower"), "My-Flower");
  assert.equal(sanitizeBulkFilenameBase("봄꽃.png"), "봄꽃");
  assert.equal(sanitizeBulkFilenameBase("봄 꽃 카드"), "봄-꽃-카드");
});

test("sanitizeBulkFilenameBase strips forbidden/control characters without dropping Korean text", () => {
  const weird = "한복" + String.fromCharCode(58, 47) + "토끼" + String.fromCharCode(42, 63, 34, 60, 62, 124);
  assert.equal(sanitizeBulkFilenameBase(weird), "한복-토끼");
});

test("buildBulkSvgFilename numbers English and Korean duplicates the same way, case-insensitively", () => {
  const used = new Set();
  const a1 = buildBulkSvgFilename("flower", used); used.add(a1.toLowerCase());
  const a2 = buildBulkSvgFilename("flower", used); used.add(a2.toLowerCase());
  const a3 = buildBulkSvgFilename("Flower", used); used.add(a3.toLowerCase());
  // Comparison is case-insensitive (so "Flower" still collides with the
  // existing "flower.svg"/"flower-2.svg"), but the returned filename
  // preserves whatever case the caller passed in -- same contract as the
  // main editor's own buildExportFilename.
  assert.deepEqual([a1, a2, a3], ["flower.svg", "flower-2.svg", "Flower-3.svg"]);

  const usedKo = new Set();
  const k1 = buildBulkSvgFilename("봄꽃", usedKo); usedKo.add(k1.toLowerCase());
  const k2 = buildBulkSvgFilename("봄꽃", usedKo); usedKo.add(k2.toLowerCase());
  assert.deepEqual([k1, k2], ["봄꽃.svg", "봄꽃-2.svg"]);
});

// --- Queue -----------------------------------------------------------------

test("runBulkQueue converts every pending job, calling convert at most `concurrency` at a time", async () => {
  const jobs = createBulkJobs([makeFakeImageFile("a.png"), makeFakeImageFile("b.png"), makeFakeImageFile("c.png")], 1);
  let inFlight = 0;
  let maxInFlight = 0;
  const updates = [];
  await runBulkQueue(jobs, {
    concurrency: 2,
    convert: async (job) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { svg: `<svg data-job="${job.id}"/>`, width: 10, height: 10 };
    },
    onJobUpdate: (job) => updates.push({ id: job.id, status: job.status }),
  });
  assert.ok(maxInFlight <= 2, `expected concurrency bound of 2, saw ${maxInFlight} in flight`);
  const doneIds = updates.filter((u) => u.status === "done").map((u) => u.id).sort();
  assert.deepEqual(doneIds, [1, 2, 3]);
});

test("runBulkQueue isolates a single job's failure -- the rest still convert", async () => {
  const jobs = createBulkJobs([makeFakeImageFile("a.png"), makeFakeImageFile("b.png"), makeFakeImageFile("c.png")], 1);
  const finalStatus = {};
  await runBulkQueue(jobs, {
    concurrency: 2,
    convert: async (job) => {
      if (job.id === 2) throw new Error("boom");
      return { svg: "<svg/>", width: 1, height: 1 };
    },
    onJobUpdate: (job) => { finalStatus[job.id] = job.status; },
  });
  assert.equal(finalStatus[1], "done");
  assert.equal(finalStatus[2], "failed");
  assert.equal(finalStatus[3], "done");
});

test("runBulkQueue skips a job that's already done and never reconverts it", async () => {
  const jobs = createBulkJobs([makeFakeImageFile("a.png"), makeFakeImageFile("b.png")], 1);
  jobs[0].status = "done";
  jobs[0].svg = "<svg>already-done</svg>";
  const converted = [];
  await runBulkQueue(jobs, {
    concurrency: 2,
    convert: async (job) => { converted.push(job.id); return { svg: "<svg/>", width: 1, height: 1 }; },
    onJobUpdate: () => {},
  });
  assert.deepEqual(converted, [2], "the already-done job is never passed to convert");
});

test("retrying a failed job (reset to queued, run again) succeeds without touching other jobs", async () => {
  let jobs = createBulkJobs([makeFakeImageFile("a.png"), makeFakeImageFile("b.png")], 1);
  jobs[1].status = "failed";
  jobs[1].error = "boom";
  jobs = resetFailedBulkJobsToQueued(jobs);
  assert.equal(jobs[1].status, "queued");
  const latestStatusById = {};
  await runBulkQueue(jobs, {
    concurrency: 2,
    convert: async () => ({ svg: "<svg/>", width: 1, height: 1 }),
    onJobUpdate: (job) => { latestStatusById[job.id] = job.status; },
  });
  assert.equal(latestStatusById[2], "done");
});

test("runBulkQueue only processes selected jobs", async () => {
  const jobs = createBulkJobs([makeFakeImageFile("a.png"), makeFakeImageFile("b.png")], 1);
  jobs[1].selected = false;
  const converted = [];
  await runBulkQueue(jobs, {
    concurrency: 2,
    convert: async (job) => { converted.push(job.id); return { svg: "<svg/>", width: 1, height: 1 }; },
    onJobUpdate: () => {},
  });
  assert.deepEqual(converted, [1]);
});

// --- SVG: Single Image pipeline vs Bulk pipeline parity --------------------

test("convertBulkFile produces byte-identical SVG to the main editor's own loadRaster+createVectorResult sequence, same input and settings", async () => {
  installBitmapDecoder();
  const file = makeFakeImageFile("flower.png", { width: 64, height: 40, color: [23, 138, 216] });

  // "Single Image pipeline": exactly what app/page.tsx's runConversion does
  // for an upload with no interactive crop (fullCrop case).
  const singleSource = await loadRaster(file);
  const singleResult = createVectorResult(singleSource, 8, "medium", 50);

  // "Bulk pipeline": Bulk's own conversion function.
  const bulkResult = await convertBulkFile(file, 8, "medium", 50);

  assert.equal(bulkResult.svg, singleResult.svg, "same file, same settings -- Bulk must call the identical pipeline, not a second one");
  assert.equal(bulkResult.width, singleSource.width);
  assert.equal(bulkResult.height, singleSource.height);
});

test("convertBulkFile's result carries no decoded raster/canvas reference -- only the serialized SVG and dimensions", async () => {
  installBitmapDecoder();
  const file = makeFakeImageFile("icon.png", { width: 32, height: 32 });
  const result = await convertBulkFile(file, 8, "medium", 50);
  assert.deepEqual(Object.keys(result).sort(), ["height", "svg", "width"]);
});

// --- ZIP ---------------------------------------------------------------

test("buildBulkZip includes only the entries it's given, with Unicode filenames preserved and numbered correctly", () => {
  const zip = buildBulkZip([
    { name: "flower.png", svg: "<svg>flower</svg>" },
    { name: "rabbit.png", svg: "<svg>rabbit</svg>" },
    { name: "봄꽃.png", svg: "<svg>spring-flower</svg>" },
    { name: "flower.png", svg: "<svg>flower-2</svg>" }, // same original name again -> must be numbered
  ]);
  const extracted = unzipSync(zip);
  const names = Object.keys(extracted).sort();
  assert.deepEqual(names, ["flower-2.svg", "flower.svg", "rabbit.svg", "봄꽃.svg"]);
  assert.equal(Buffer.from(extracted["봄꽃.svg"]).toString("utf8"), "<svg>spring-flower</svg>", "Korean filename's content round-trips correctly");
  assert.equal(Buffer.from(extracted["flower.svg"]).toString("utf8"), "<svg>flower</svg>");
});

test("a bulk ZIP built from only the caller's selected+successful entries excludes failed and unselected files", () => {
  // The page is responsible for filtering to selected+done jobs before
  // calling buildBulkZip; this test documents and locks in that contract
  // at the data level -- buildBulkZip itself has no "status" concept.
  const jobs = [
    { id: 1, name: "a.png", selected: true, status: "done", svg: "<svg>a</svg>" },
    { id: 2, name: "b.png", selected: true, status: "failed", svg: null },
    { id: 3, name: "c.png", selected: false, status: "done", svg: "<svg>c</svg>" },
    { id: 4, name: "d.png", selected: true, status: "done", svg: "<svg>d</svg>" },
  ];
  const entries = jobs.filter((job) => job.selected && job.status === "done").map((job) => ({ name: job.name, svg: job.svg }));
  const zip = buildBulkZip(entries);
  const names = Object.keys(unzipSync(zip)).sort();
  assert.deepEqual(names, ["a.svg", "d.svg"]);
});
