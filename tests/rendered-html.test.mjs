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

test("exposes Bulk SVG Convert in the editor's navigation, while keeping it isolated code-wise and out of the landing page / Extract Elements", () => {
  const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
  const bulkPage = readFileSync(new URL("../app/bulk-convert-page.tsx", import.meta.url), "utf8");
  const bulkUtils = readFileSync(new URL("../app/bulk-convert-utils.ts", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const landing = readFileSync(new URL("../app/landing-page.tsx", import.meta.url), "utf8");
  const extractPage = readFileSync(new URL("../app/extract-elements-page.tsx", import.meta.url), "utf8");

  assert.match(main, /pathname === "\/bulk-convert"/);
  assert.match(main, /<BulkConvertPage \/>/);
  assert.match(bulkPage, /image\/png,image\/jpeg,image\/webp/);
  assert.match(bulkUtils, /BULK_MAX_FILES = 50/);
  // Deliberate nav exposure, approved for this release: the editor's own
  // topbar links to Bulk with the exact specified copy.
  assert.match(editor, /href=\{korean \? "\/bulk-convert\?lang=ko" : "\/bulk-convert"\}>\{korean \? "SVG 일괄 변환" : "Bulk SVG"\}/);
  // The page no longer calls itself a hidden/unlinked route, since it now
  // is linked from the live site.
  assert.doesNotMatch(bulkPage, /Hidden development route/);
  // Still never linked from the landing page or from Extract Elements --
  // only the editor's topbar gained this one link, nothing else changed.
  assert.doesNotMatch(landing, /\/bulk-convert/);
  assert.doesNotMatch(extractPage, /\/bulk-convert/);
  assert.doesNotMatch(extractPage, /Bulk SVG|SVG 일괄 변환/);
  assert.doesNotMatch(landing, /Bulk SVG|SVG 일괄 변환/);
  // No other feature (Extract Elements, Stock Tools, Planner, Journal,
  // Image Generation) was added to the editor's nav alongside it.
  assert.doesNotMatch(editor, /href="\/extract-elements"|Extract Elements|요소 추출/);
  // Bulk must not import anything from Extract Elements or re-implement
  // its own copy of the SVG engine: only vector-utils.ts and its own
  // sibling files. (Comments are free to mention extract-elements by name
  // to explain the isolation -- only an actual import statement matters.)
  assert.doesNotMatch(bulkUtils, /from\s+"\.\/extract-elements/);
  assert.doesNotMatch(bulkPage, /from\s+"\.\/extract-elements/);
});

test("Bulk Convert's intro clearly states SVG-only output, in both languages, without a loud warning treatment", () => {
  const bulkPage = readFileSync(new URL("../app/bulk-convert-page.tsx", import.meta.url), "utf8");
  const bulkStyles = readFileSync(new URL("../app/bulk-convert.css", import.meta.url), "utf8");
  assert.match(bulkPage, /Upload multiple PNG, JPG, JPEG or WebP images and convert them to SVG at once\. Bulk conversion currently supports SVG output only\./);
  assert.match(bulkPage, /여러 PNG, JPG, JPEG, WebP 이미지를 한 번에 SVG로 변환할 수 있습니다\. 현재 일괄 변환은 SVG 저장만 지원합니다\./);
  // It lives in the existing intro paragraph, not a new warning-styled
  // banner element -- no new "alert"/"warning" class was introduced for it.
  assert.doesNotMatch(bulkPage, /className="bulk-(warning|alert|svg-only)/);
  assert.doesNotMatch(bulkStyles, /\.bulk-(warning|alert|svg-only)/);
});

test("a successful SVG download shows a scoped success notice without resetting the current image/result", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  // A dedicated boolean, not the shared exportMessage used by PNG/favicon/
  // object exports too -- so a PNG or favicon save never implies the SVG
  // notice, and it can never accumulate into a list/duplicate on repeat
  // downloads (a single boolean is inherently idempotent).
  assert.match(page, /const \[svgDownloadSucceeded, setSvgDownloadSucceeded\] = useState\(false\)/);
  assert.match(page, /if \(status !== "cancelled"\) \{\s*setExportMessage\(status === "saved" \? "SVG saved successfully\." : "SVG download started\."\);\s*setSvgDownloadSucceeded\(true\);/);
  // exportSvg must never clear source/result/colorCount itself.
  const exportSvgBody = page.slice(page.indexOf("const exportSvg = useCallback"), page.indexOf("const exportPng = useCallback"));
  assert.doesNotMatch(exportSvgBody, /setSource\(null\)|setResult\(null\)|setColorCount/);
});

test("the SVG success notice uses the exact specified copy, an accessible live region, and a keyboard-operable button", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /className="svg-success-notice" role="status" aria-live="polite"/);
  assert.match(page, /SVG가 저장되었습니다\. 같은 이미지로 계속 작업하거나 다른 이미지를 올릴 수 있습니다\./);
  assert.match(page, /Your SVG has been downloaded\. Keep working with this image or upload another one\./);
  assert.match(page, /다른 이미지 올리기/);
  assert.match(page, /Upload another image/);
  // A real <button>, not a div/span with a click handler.
  assert.match(page, /<button className="text-button" type="button" onClick=\{uploadAnotherImage\}>/);
});

test("'Upload another image' resets the current image/result/crop but preserves SVG converter settings", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const body = page.slice(page.indexOf("const uploadAnotherImage = useCallback"), page.indexOf("const runConversion = useCallback"));
  assert.match(body, /setOriginalUpload\(null\)/);
  assert.match(body, /setSource\(null\)/);
  assert.match(body, /setResult\(null\)/);
  assert.match(body, /setSvgDownloadSucceeded\(false\)/);
  assert.match(body, /fileInput\.current\.value = ""/);
  // Preserved: colorCount, pngScale, language -- none of these setters
  // appear in the reset body.
  assert.doesNotMatch(body, /setColorCount/);
  assert.doesNotMatch(body, /setPngScale/);
  assert.doesNotMatch(body, /setLanguage/);
});

test("uploading a new image or starting a new conversion clears any stale SVG success notice", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const acceptFileBody = page.slice(page.indexOf("const acceptFile = useCallback"), page.indexOf("// Only runs when the person explicitly asks"));
  assert.match(acceptFileBody, /setSvgDownloadSucceeded\(false\)/);
  const runConversionBody = page.slice(page.indexOf("const runConversion = useCallback"), page.indexOf("const startSourceCropDrag = useCallback"));
  assert.match(runConversionBody, /setSvgDownloadSucceeded\(false\)/);
});

test("Bulk download actions never reference the single converter's success-notice state", () => {
  // The single converter's post-download UX (svgDownloadSucceeded /
  // "Upload another image") is specific to app/page.tsx and must never
  // leak into Bulk, which is a separate multi-file flow that shouldn't be
  // interrupted by a per-file popup.
  const bulkPage = readFileSync(new URL("../app/bulk-convert-page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(bulkPage, /svgDownloadSucceeded/);
  assert.doesNotMatch(bulkPage, /svg-success-notice/);
  assert.doesNotMatch(bulkPage, /Upload another image/);
  assert.doesNotMatch(bulkPage, /다른 이미지 올리기/);
});
