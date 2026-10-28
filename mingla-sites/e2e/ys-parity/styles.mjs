// #2829 W7b — §7 check 5: computed styles of the local pilot site against the
// private baseline's _computed-styles.json, read with the baseline's own
// procedure (same selectors, first matching element, same properties, taken
// right after networkidle). Colours compare numerically (amendment A12);
// width/height within ±1 px; font family by its first name. Fonts loaded
// must match (fallback faces ignored) and no third-party script may load.
// Selectors that exist only on the baseline's trip pages, and the trip pages
// themselves, are dropped (amendment A11) and listed in the output.
//
//   node e2e/ys-parity/styles.mjs --origin http://<host>:3100 --baseline <dir> --out <dir>

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { styleDifferences } from "../parity-metrics.mjs";
import { args, assertOutsideRepo, CONSENT_STORAGE } from "./lib.mjs";

const options = args(process.argv.slice(2), ["origin", "baseline", "out"]);
const out = assertOutsideRepo(resolve(options.out));
const origin = new URL(options.origin);
const baseline = JSON.parse(readFileSync(resolve(options.baseline, "_computed-styles.json"), "utf8"));
const TRIP_ONLY_SELECTORS = [".trip-bar", ".booking-rail", ".trip-facts"];
const TRIP_PAGE = /^\/trips\/[^/]+$/;
const META = new Set(["images", "video", "fontsLoaded", "scripts"]);

const browser = await chromium.launch({ channel: "chrome" });
const result = { origin: origin.origin, dropped: { pages: [], selectors: TRIP_ONLY_SELECTORS }, entries: [], fonts: [], scripts: [], pass: true };
try {
  const byWidth = new Map();
  for (const key of Object.keys(baseline)) {
    const [path, width] = key.split("@");
    if (TRIP_PAGE.test(path)) { result.dropped.pages.push(key); continue; }
    if (!byWidth.has(width)) byWidth.set(width, []);
    byWidth.get(width).push(path);
  }
  for (const [width, paths] of byWidth) {
    const height = Number(width) > 390 ? 900 : 844;
    const context = await browser.newContext({ viewport: { width: Number(width), height } });
    await context.addInitScript(([key, value]) => { try { window.localStorage.setItem(key, value); } catch { /* see capture.mjs */ } }, [CONSENT_STORAGE.key, CONSENT_STORAGE.value]);
    const page = await context.newPage();
    for (const path of paths) {
      const key = `${path}@${width}`;
      const expected = baseline[key];
      const selectors = Object.keys(expected).filter((selector) => !META.has(selector) && !TRIP_ONLY_SELECTORS.includes(selector));
      await page.goto(`${origin.origin}${path}`, { waitUntil: "networkidle" });
      const actual = await page.evaluate((sels) => {
        const pick = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const c = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return { fontFamily: c.fontFamily, fontSize: c.fontSize, fontWeight: c.fontWeight, lineHeight: c.lineHeight, letterSpacing: c.letterSpacing, color: c.color, bg: c.backgroundColor, radius: c.borderRadius, shadow: c.boxShadow, padding: c.padding, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
        };
        const o = {};
        for (const s of sels) o[s] = pick(s);
        o.fontsLoaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family.replace(/^["']|["']$/g, "")} ${f.weight}`);
        o.scripts = [...document.scripts].map((s) => s.src).filter(Boolean);
        return o;
      }, selectors);
      for (const selector of selectors) {
        const differences = styleDifferences(expected[selector], actual[selector]);
        if (differences.length) result.pass = false;
        result.entries.push({ page: key, selector, ok: differences.length === 0, differences });
      }
      const normalise = (list) => [...new Set((list ?? []).filter((face) => !/fallback/i.test(face)).map((face) => face.replace(/^["']|["']$/g, "")))].sort();
      const wantFonts = normalise(expected.fontsLoaded);
      const haveFonts = normalise(actual.fontsLoaded);
      const fontsOk = JSON.stringify(wantFonts) === JSON.stringify(haveFonts);
      if (!fontsOk) result.pass = false;
      result.fonts.push({ page: key, ok: fontsOk, baseline: wantFonts, ours: haveFonts });
      const thirdParty = actual.scripts.filter((src) => new URL(src, origin.origin).host !== origin.host);
      if (thirdParty.length) result.pass = false;
      result.scripts.push({ page: key, ok: thirdParty.length === 0, third_party: thirdParty });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(resolve(out, "styles.json"), `${JSON.stringify(result, null, 2)}\n`);
const failing = result.entries.filter((entry) => !entry.ok);
process.stdout.write(`styles ${result.pass ? "PASS" : "FAIL"} selectors=${result.entries.length} failing=${failing.length} fonts=${result.fonts.every((f) => f.ok) ? "ok" : "MISMATCH"} third_party_scripts=${result.scripts.reduce((n, s) => n + s.third_party.length, 0)}\n`);
for (const entry of failing.slice(0, 40)) process.stdout.write(`  ${entry.page} ${entry.selector}: ${entry.differences.map((d) => `${d.property} ${JSON.stringify(d.baseline)} != ${JSON.stringify(d.ours)}`).join("; ")}\n`);
