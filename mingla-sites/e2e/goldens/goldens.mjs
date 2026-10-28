// #2829 W7b — CI goldens, step 2: screenshot the rendered fixture pages
// (render.test.tsx) at 1440×900 and 390×844 and compare each with its
// committed golden under the §7 thresholds (height ±4 px, pixelmatch 0.1
// with anti-aliasing ignored, ≤1.0 % / ≤1.5 % mismatched, no 64×64 tile over
// 20 %). No exclusion boxes. Run inside the pinned Playwright image so the
// browser and its fonts are the same on every machine:
//
//   docker run --rm -v "$PWD/..:/work" -w /work/mingla-sites \
//     mcr.microsoft.com/playwright:v1.64.0-noble node e2e/goldens/goldens.mjs [--update]
//
// The pages are served by a tiny local server: the design stylesheets from
// public/designs, a flat grey placeholder for every picture, and nothing
// else (fonts fall back to the image's own, deterministic within it).
// --update rewrites the goldens (review every changed image before
// committing). Diffs of a failing run go to GOLDENS_OUT (default /tmp).

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { compareScreens } from "../parity-metrics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..", "..");
const htmlDir = resolve(process.env.GOLDENS_RENDER_DIR ?? "/tmp/mingla-sites-goldens-html");
const goldenDir = resolve(here, "baseline");
const outDir = resolve(process.env.GOLDENS_OUT ?? "/tmp/mingla-sites-goldens-out");
const update = process.argv.includes("--update");
const VIEWPORTS = [[1440, 900], [390, 844]];

const placeholder = (() => {
  const png = new PNG({ width: 64, height: 48 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 158; png.data[i + 1] = 166; png.data[i + 2] = 174; png.data[i + 3] = 255; }
  return PNG.sync.write(png);
})();

const manifest = JSON.parse(readFileSync(resolve(htmlDir, "manifest.json"), "utf8"));
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://golden.local");
  const send = (status, type, body) => { response.writeHead(status, { "content-type": type, "cache-control": "no-store" }); response.end(body); };
  if (url.pathname.startsWith("/__page/")) {
    const file = normalize(join(htmlDir, url.pathname.slice("/__page/".length)));
    if (!file.startsWith(htmlDir) || !existsSync(file)) return send(404, "text/plain", "");
    return send(200, "text/html; charset=utf-8", readFileSync(file));
  }
  if (url.pathname.startsWith("/designs/")) {
    const file = normalize(join(app, "public", url.pathname));
    if (!file.startsWith(join(app, "public", "designs")) || !existsSync(file) || extname(file) !== ".css") return send(404, "text/plain", "");
    return send(200, "text/css; charset=utf-8", readFileSync(file));
  }
  if (url.pathname.startsWith("/media/") || url.pathname.startsWith("/om/") || url.pathname.startsWith("/map/")) return send(200, "image/png", placeholder);
  return send(404, "text/plain", "");
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const failures = [];
const rows = [];
try {
  for (const [width, height] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const page = await context.newPage();
    for (const entry of manifest) {
      await page.goto(`${origin}/__page/${entry.design}/${entry.name}.html`, { waitUntil: "networkidle" });
      // No hydration here: wait past the design's 2.5 s reveal failsafe so the
      // page is in its settled no-JavaScript state, then the §7 procedure.
      await page.waitForTimeout(3000);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise((done) => setTimeout(done, 120)); }
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await page.waitForTimeout(1200);
      await page.evaluate(() => document.fonts.ready);
      const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
      const key = `${entry.design}/${entry.name}-${width}`;
      const golden = resolve(goldenDir, `${key}.png`);
      if (update || !existsSync(golden)) {
        mkdirSync(dirname(golden), { recursive: true });
        writeFileSync(golden, shot);
        rows.push(`${update ? "updated" : "created"} ${key}`);
        continue;
      }
      const result = compareScreens(readFileSync(golden), shot);
      const ok = result.pass.height && result.pass.pixels && result.pass.tiles;
      rows.push(`${ok ? "PASS" : "FAIL"} ${key} Δh=${result.heightDelta} mismatch=${(result.mismatchRatio * 100).toFixed(3)}% worst=${(result.worstTile.ratio * 100).toFixed(1)}%@${result.worstTile.x},${result.worstTile.y}`);
      if (!ok) {
        failures.push(key);
        mkdirSync(dirname(resolve(outDir, key)), { recursive: true });
        writeFileSync(resolve(outDir, `${key}.actual.png`), shot);
        writeFileSync(resolve(outDir, `${key}.diff.png`), result.diffPng);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.stdout.write(`${rows.join("\n")}\n`);
if (failures.length) {
  process.stdout.write(`GOLDENS FAIL ${failures.length}: ${failures.join(", ")} (diffs in ${outDir})\n`);
  process.exit(1);
}
process.stdout.write(`GOLDENS ${update ? "UPDATED" : "PASS"} ${rows.length}\n`);
