import assert from "node:assert/strict";
import test from "node:test";
import { EXTRACT_ELEMENTS_MAX_FILE_SIZE, validateExtractElementsFile } from "../app/extract-elements-utils.ts";

test("Extract Elements accepts the four advertised raster extensions", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(validateExtractElementsFile({ type, size: 1024 }), null);
  }
});

test("Extract Elements rejects unsupported files and images over 10 MB", () => {
  assert.equal(validateExtractElementsFile({ type: "image/svg+xml", size: 1024 }), "type");
  assert.equal(validateExtractElementsFile({ type: "application/json", size: 1024 }), "type");
  assert.equal(validateExtractElementsFile({ type: "image/png", size: EXTRACT_ELEMENTS_MAX_FILE_SIZE }), null);
  assert.equal(validateExtractElementsFile({ type: "image/png", size: EXTRACT_ELEMENTS_MAX_FILE_SIZE + 1 }), "size");
});
