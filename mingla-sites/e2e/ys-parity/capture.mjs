// #2829 W7b — capture the local pilot site with the IDENTICAL procedure used
// for the private baselines (spec §6 W7 "Parity harness"): installed Google
// Chrome (channel "chrome"), deviceScaleFactor 1, 1440×900 and 390×844, one
// page per width visiting every path in turn, waitUntil "networkidle", then
// the shared settle (lib.mjs settleInPage — W7c/A13.2: full-page scroll pass,
// an INSTANT jump to the top, scrollY held at 0 for 500 ms, at least 1,200 ms
// from the jump), document.fonts.ready, full-page screenshot.
//
// --baseline-capture (W7c/A13.2): the same procedure pointed at the brand's
// public live site to make a baseline folder: also writes `_meta.json`
// (status, url, title, height, canonical per page and width) so the folder is
// a complete baseline. Read-only: it only loads public pages, gently: at
// least 5 s between page loads (--pace-ms, default 5000 in this mode) and it
// stops at the first 5xx instead of carrying on against a struggling site.
//
// Captures are taken in the RETURNING-visitor state (amendment A12): a
// consent choice is stored before the first page loads, so the first-visit
// consent panel (which the baseline site does not have) is not in frame.
// With --first-visit the home page is ALSO captured once without a stored
// choice, for review only.
//
// The page list (names and paths) is read from the PRIVATE baseline's
// _meta.json, so no brand path lives in this repository. Nothing is written
// inside the repository: --out must be outside it.
//
//   node e2e/ys-parity/capture.mjs --origin http://<host>:3100 \
//     --baseline <dir> --out <dir> [--pages a,b] [--first-visit]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { args, assertOutsideRepo, CONSENT_STORAGE, exclusionSelectors, parityPages, settleInPage, VIEWPORTS } from "./lib.mjs";

const options = args(process.argv.slice(2), ["origin", "baseline", "out"], ["pages", "first-visit", "baseline-capture", "pace-ms"]);
const paceMs = Number(options["pace-ms"] ?? (options["baseline-capture"] ? 5000 : 0));
let lastLoadAt = 0;
const out = assertOutsideRepo(resolve(options.out));
mkdirSync(out, { recursive: true });
const origin = new URL(options.origin);
const pages = parityPages(JSON.parse(readFileSync(resolve(options.baseline, "_meta.json"), "utf8")), options.pages);

async function settle(page) {
  // The shared procedure (lib.mjs settleInPage), identical on both sides.
  const observed = await page.evaluate(settleInPage);
  await page.evaluate(() => document.fonts.ready);
  if (!observed.stable || observed.scrollY !== 0) throw new Error(`CAPTURE_NOT_AT_TOP:${JSON.stringify(observed)}`);
  return observed;
}

const browser = await chromium.launch({ channel: "chrome" });
const report = { origin: origin.origin, captured_at: new Date().toISOString(), consent_state: "returning visitor (choice stored before capture)", pages: [], offsite_requests: [] };
const offsite = new Set();
try {
  for (const [width, height] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.addInitScript(([key, value]) => {
      try { window.localStorage.setItem(key, value); } catch { /* storage blocked: the panel would show, and the diff will say so */ }
    }, [CONSENT_STORAGE.key, CONSENT_STORAGE.value]);
    const page = await context.newPage();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.host !== origin.host) offsite.add(url.origin);
    });
    for (const { name, path } of pages) {
      const wait = lastLoadAt + paceMs - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      lastLoadAt = Date.now();
      const response = await page.goto(`${origin.origin}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
      if (options["baseline-capture"] && (response?.status() ?? 0) >= 500) {
        throw new Error(`BASELINE_SITE_5XX:${name}-${width}:${response?.status()} (stopped; nothing more is loaded)`);
      }
      await settle(page);
      const file = resolve(out, `${name}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const info = await page.evaluate((selectors) => {
        const boxes = {};
        for (const [label, selector] of Object.entries(selectors)) {
          const element = document.querySelector(selector);
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          boxes[label] = { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
        }
        const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
        return { title: document.title, height: document.documentElement.scrollHeight, boxes, canonical };
      }, exclusionSelectors);
      report.pages.push({ name, path, width, status: response?.status() ?? null, ...info });
      process.stdout.write(`captured ${name}-${width} ${response?.status()} h=${info.height}\n`);
    }
    await context.close();
  }
  if (options["first-visit"]) {
    mkdirSync(resolve(out, "first-visit"), { recursive: true });
    for (const [width, height] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto(`${origin.origin}${pages[0].path}`, { waitUntil: "networkidle", timeout: 60_000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: resolve(out, "first-visit", `${pages[0].name}-${width}.png`) });
      await context.close();
    }
  }
} finally {
  await browser.close();
}
report.offsite_requests = [...offsite];
writeFileSync(resolve(out, "capture.json"), `${JSON.stringify(report, null, 2)}\n`);
if (options["baseline-capture"]) {
  const meta = {};
  for (const row of report.pages) {
    meta[`${row.name}-${row.width}`] = { status: row.status, url: `${origin.origin}${row.path}`, title: row.title, h: row.height, canonical: row.canonical };
  }
  writeFileSync(resolve(out, "_meta.json"), `${JSON.stringify(meta, null, 1)}\n`);
}
