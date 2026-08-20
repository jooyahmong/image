import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
