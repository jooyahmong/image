import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

test("builds a static WOOJOO Image entry point", () => {
  const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>WOOJOO Image<\/title>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<script type="module"[^>]+src="\/assets\//);
  assert.doesNotMatch(html, /cloudflareinsights|codex-preview|next\/font/i);
  assert.equal(existsSync(new URL("../dist/server", import.meta.url)), false);
});

test("deploys only Cloudflare static assets", () => {
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(config, /directory\s*=\s*"dist"/);
  assert.match(config, /not_found_handling\s*=\s*"single-page-application"/);
  assert.doesNotMatch(config, /^main\s*=/m);

  const headers = readFileSync(new URL("../dist/_headers", import.meta.url), "utf8");
  assert.match(headers, /no-transform/);
  assert.match(headers, /\/assets\/\*/);
});

test("ships a lightweight bilingual landing page", () => {
  const landingDirectory = new URL("../dist/landing/", import.meta.url);
  const media = readdirSync(landingDirectory);
  assert.equal(media.length, 5);
  assert.ok(media.every((name) => name.endsWith(".png")));
  assert.ok(media.every((name) => name.startsWith("screen-")));
  const mediaBytes = media.reduce((total, name) => total + statSync(new URL(name, landingDirectory)).size, 0);
  assert.ok(mediaBytes < 2 * 1024 * 1024, `landing media is ${(mediaBytes / 1024 / 1024).toFixed(2)} MB`);

  const scripts = readdirSync(new URL("../dist/assets/", import.meta.url)).filter((name) => name.endsWith(".js"));
  const bundle = scripts.map((name) => readFileSync(new URL(`../dist/assets/${name}`, import.meta.url), "utf8")).join("\n");
  assert.match(bundle, /Your image stays on this device/);
  assert.match(bundle, /이미지는 사용자의 기기에만 머뭅니다/);
  assert.doesNotMatch(bundle, /Anchor simplification|Label cleanup, tracing size|Balanced \(50\)|앵커 단순화|영역 정리, 추적 크기/);
  assert.match(bundle, /High-quality solid SVG/);
  assert.match(bundle, /No gradients are created/);
  assert.doesNotMatch(bundle, /\.mp4/);
});

test("uses fixed balanced vector settings without exposing redundant controls", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const FIXED_CLEANUP: CleanupLevel = "medium"/);
  assert.match(page, /const FIXED_ANCHOR_SIMPLIFICATION = 50/);
  assert.doesNotMatch(page, /id="smoothness"|id="anchor-simplification"|Balanced \(50\):/);
  assert.doesNotMatch(page, /Basic mode|Advanced mode|기본 모드|고급 모드/);
});

test("keeps the multi-mode color editor inline with a live artwork preview", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /className="color-editor-panel"/);
  assert.match(page, /type="color"/);
  assert.match(page, /aria-label="Exact HEX"/);
  assert.match(page, /"RGB values"/);
  assert.match(page, /className="rgb-input-grid"/);
  assert.match(page, /"Eyedropper"/);
  assert.match(page, /실시간 미리보기/);
  assert.doesNotMatch(page, /className="color-editor-help"/);
  assert.doesNotMatch(page, /className="color-editor-backdrop"/);
  assert.match(styles, /\.color-editor-panel\s*\{/);
  assert.match(styles, /\.color-editor-panel \.step-label\s*\{[^}]*font-size:\s*8\.4px/);
  assert.match(styles, /\.visual-color-picker > span\s*\{[^}]*white-space:\s*nowrap;[^}]*word-break:\s*keep-all/);
  assert.match(styles, /\.rgb-input-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(styles, /\.color-editor-backdrop\s*\{/);
});

test("quick color choices share the full row in three equal columns", () => {
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.quick-color-fieldset\s*\{\s*display:\s*block;/);
  assert.match(styles, /\.quick-color-buttons\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/);
});

test("original-view export uses the upload and leaves SVG export on the vector result", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setOriginalUpload\(\{ file, url: URL\.createObjectURL\(file\) \}\)/);
  assert.match(page, /viewMode === "original" && originalUpload\)\s*\{\s*openOriginalFavicon\(\);\s*return;/);
  assert.match(page, /downloadRasterFavicon\(originalUpload\.file\)/);
  assert.match(page, /originalFaviconOpen && originalUpload &&/);
  assert.match(page, /className="original-favicon-shortcut text-button"/);
  assert.match(page, /downloadFavicon\(result\.svg, crop\)/);
  assert.match(page, /downloadPng\(result\.svg, crop,/);
  assert.match(page, /URL\.revokeObjectURL\(originalUpload\.url\)/);
});

test("original preview explains favicon export and labels the export button for its source", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /const isOriginalExport = viewMode === "original" && !!originalUpload/);
  assert.match(page, /isOriginalExport && <p className="original-favicon-hint"/);
  assert.match(page, /원본 이미지를 SVG 변환 없이 파비콘으로 저장할 수 있어요\./);
  assert.match(page, /Save the original image as a favicon without converting it to SVG\./);
  assert.match(page, /aria-describedby=\{isOriginalExport \? "original-favicon-hint" : undefined\}/);
  assert.match(page, /isOriginalExport \? \(korean \? "원본 파비콘 저장 \(\.ico\)" : "Save original favicon \(\.ico\)"\) : \(korean \? "자르기 및 내보내기" : "Final crop & export"\)/);
  assert.match(styles, /\.original-favicon-hint\s*\{[^}]*margin:\s*0;[^}]*padding:\s*6px 16px;[^}]*font-size:\s*12px/);
});

test("keeps Extract Elements on an isolated unlinked development route", () => {
  const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
  const extractPage = readFileSync(new URL("../app/extract-elements-page.tsx", import.meta.url), "utf8");
  const extractUtils = readFileSync(new URL("../app/extract-elements-utils.ts", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const landing = readFileSync(new URL("../app/landing-page.tsx", import.meta.url), "utf8");

  assert.match(main, /pathname === "\/extract-elements"/);
  assert.match(main, /<ExtractElementsPage \/>/);
  assert.match(extractPage, /Separate one image into reusable assets\./);
  assert.match(extractPage, /한 장의 이미지에서 재사용할 요소를 분리하세요\./);
  assert.match(extractPage, /image\/png,image\/jpeg,image\/webp/);
  assert.match(extractUtils, /EXTRACT_ELEMENTS_MAX_FILE_SIZE = 10 \* 1024 \* 1024/);
  assert.match(extractPage, /Hidden development route · not linked from the live site/);
  assert.doesNotMatch(editor, /\/extract-elements/);
  assert.doesNotMatch(landing, /\/extract-elements/);
});
