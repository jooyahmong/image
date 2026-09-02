import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the production geometry helpers without adding a test-only browser
// export or importing the raster pipeline and its DOM dependencies.
const sourceText = readFileSync(new URL("../app/vector-utils.ts", import.meta.url), "utf8");
const source = ts.createSourceFile("vector-utils.ts", sourceText, ts.ScriptTarget.Latest, true);
const helperNames = ["addPoint", "subtractPoint", "scalePoint", "dotProduct", "evaluateCubic", "cubicFitError"];
const helpers = source.statements.filter((node) => ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text));
assert.equal(helpers.length, helperNames.length, "all production curve helpers must be tested");
const compiled = ts.transpileModule(helpers.map((node) => node.getText(source)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const { evaluateCubic, cubicFitError } = runInNewContext(`${compiled}\n({ evaluateCubic, cubicFitError })`);

const straight = {
  start: { x: 0, y: 0 }, control1: { x: 100 / 3, y: 0 },
  control2: { x: 200 / 3, y: 0 }, end: { x: 100, y: 0 },
};
const parameters = [0, .5, 1];
const points = parameters.map((parameter) => evaluateCubic(straight, parameter));

test("a straight cubic keeps zero inter-anchor error", () => {
  assert.ok(cubicFitError(points, straight, parameters).maximumSquaredError < 1e-20);
});

test("matching anchors cannot hide swelling between them", () => {
  const bowed = { ...straight, control1: { x: 100 / 3, y: 20 }, control2: { x: 200 / 3, y: -20 } };
  // Endpoints and the center fit perfectly; the quarter points do not.
  for (let index = 0; index < parameters.length; index += 1) {
    const sampled = evaluateCubic(bowed, parameters[index]);
    assert.ok(Math.hypot(sampled.x - points[index].x, sampled.y - points[index].y) < 1e-10);
  }
  const error = cubicFitError(points, bowed, parameters);
  assert.ok(error.maximumSquaredError > 2 ** 2, "reject a bulge beyond the normal two-pixel fit budget");
  assert.equal(error.splitIndex, 1);
});

test("thin diagonal contours receive the same overshoot protection", () => {
  const rotate = ({ x, y }) => ({ x: 450 + (x - y) / Math.SQRT2, y: 360 + (x + y) / Math.SQRT2 });
  const bowed = { ...straight, control1: { x: 100 / 3, y: 20 }, control2: { x: 200 / 3, y: -20 } };
  const diagonal = Object.fromEntries(Object.entries(bowed).map(([key, point]) => [key, rotate(point)]));
  assert.ok(cubicFitError(points.map(rotate), diagonal, parameters).maximumSquaredError > 2 ** 2);
});

test("well-sampled rounded contours retain a long cubic within budget", () => {
  const rounded = {
    start: { x: 100, y: 0 }, control1: { x: 100, y: 55.2285 },
    control2: { x: 55.2285, y: 100 }, end: { x: 0, y: 100 },
  };
  const samples = Array.from({ length: 17 }, (_, index) => index / 16);
  const error = cubicFitError(samples.map((parameter) => evaluateCubic(rounded, parameter)), rounded, samples);
  assert.ok(error.maximumSquaredError < .2 ** 2, "preserve a smooth quarter-circle, not only straight lines");
});
