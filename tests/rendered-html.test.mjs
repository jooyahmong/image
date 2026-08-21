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
  assert.doesNotMatch(bundle, /\.mp4/);
});
