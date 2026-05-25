#!/usr/bin/env node
// ORCH-0963 — live-fire probe of /b/{slug} against production buyer-web.
// Compares trip-planner brand vs event-brand current render to confirm
// F-1 (current behaviour for trip_planner brand) and F-3 (divergence
// inventory baseline).
//
// Requires: Playwright chromium browser already installed via
// `npx playwright install chromium` (verified present at
// ~/Library/Caches/ms-playwright/chromium-1223/).

import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";
import fs from "node:fs/promises";
import path from "node:path";

const TARGETS = [
  { slug: "travelbrand", label: "trip-planner-32-trips-2-public" },
  { slug: "leggothis", label: "popup-event-brand-11-public-events" },
  { slug: "perryssteakhousegrille", label: "physical-venue-0-public-events" },
];

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ORIGIN = "https://business.usemingla.com";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 }, // iPhone XR equivalent
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});

const consoleEvents = [];
ctx.on("console", (msg) => {
  consoleEvents.push({ type: msg.type(), text: msg.text().slice(0, 240) });
});

const results = [];
for (const t of TARGETS) {
  const page = await ctx.newPage();
  const url = `${ORIGIN}/b/${t.slug}`;
  consoleEvents.length = 0;
  const t0 = Date.now();
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
  // Give RN-Web React tree time to mount + queries to resolve
  await page.waitForTimeout(2500);

  const status = resp ? resp.status() : null;
  const title = await page.title();
  const visibleText = await page.evaluate(() => document.body?.innerText || "");
  const ogTitle = await page
    .locator('meta[property="og:title"]')
    .getAttribute("content")
    .catch(() => null);
  const ogDesc = await page
    .locator('meta[property="og:description"]')
    .getAttribute("content")
    .catch(() => null);
  const ogImage = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content")
    .catch(() => null);
  const screenshot = path.join(HERE, `f1_${t.slug}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });

  results.push({
    slug: t.slug,
    label: t.label,
    url,
    httpStatus: status,
    msToFirstPaint: Date.now() - t0,
    title,
    ogTitle,
    ogDesc,
    ogImage,
    visibleText: visibleText.slice(0, 4000),
    consoleErrors: consoleEvents.filter((e) => e.type === "error").slice(0, 10),
    consoleWarnings: consoleEvents
      .filter((e) => e.type === "warning")
      .slice(0, 5),
    screenshot,
  });
  await page.close();
}

await browser.close();

await fs.writeFile(
  path.join(HERE, "f1_probe_results.json"),
  JSON.stringify(results, null, 2),
);

console.log(JSON.stringify(results, null, 2));
