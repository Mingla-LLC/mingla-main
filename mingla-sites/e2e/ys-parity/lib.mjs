// #2829 W7b — shared pieces of the private parity harness. No brand content:
// page names and paths come from the private baseline's _meta.json.

import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const VIEWPORTS = Object.freeze([[1440, 900], [390, 844]]);

/** The runtime's stored consent choice (src/lib/consent.ts CONSENT_KEY): a returning visitor. */
export const CONSENT_STORAGE = Object.freeze({ key: "mingla_site_analytics_consent_v1", value: "necessary" });

/*
 * The ONLY regions §7 may exclude (amendment A11), located on OUR render:
 *   footerCredit — the footer bar's end cell: "Powered by Mingla" in place of
 *                  the builder credit (A1.1), with the returning visitor's
 *                  privacy-choices link that sits beside it;
 *   nameLabel    — the contact form's Name label (a name is required now).
 * Each is padded (see exclusionBoxes) so the baseline's longer words fit.
 */
export const exclusionSelectors = Object.freeze({
  footerCredit: ".site-footer .v-footer-bar__end",
  nameLabel: ".form-panel label.form-label[for$='-name']",
});

/** Pages excluded from the parity set (A1.2/A11: trip pages are Mingla trip pages, not site pages). */
const EXCLUDED_PAGE_PREFIX = "trip-";

export function parityPages(meta, only) {
  const wanted = only ? new Set(String(only).split(",")) : null;
  const pages = [];
  for (const [key, entry] of Object.entries(meta)) {
    const match = /^(.*)-1440$/.exec(key);
    if (!match) continue;
    const name = match[1];
    if (name.startsWith(EXCLUDED_PAGE_PREFIX)) continue;
    if (wanted && !wanted.has(name)) continue;
    pages.push({ name, path: new URL(entry.url).pathname });
  }
  // Home first (the first-visit capture uses it).
  return pages.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : 0));
}

/** The declared exclusion boxes for one page, from the boxes measured on our render. */
export function exclusionBoxes(measured, width) {
  const boxes = [];
  const credit = measured?.footerCredit;
  if (credit) {
    // Right-aligned on both sides: keep the right edge, reach left far enough
    // for the baseline's longer credit.
    const minWidth = width > 390 ? 300 : 260;
    const boxWidth = Math.max(credit.width, minWidth) + 8;
    boxes.push({ label: "footerCredit", x: credit.x + credit.width + 4 - boxWidth, y: credit.y - 4, width: boxWidth, height: credit.height + 8 });
  }
  const name = measured?.nameLabel;
  if (name) {
    // Left-aligned: "Name" vs "Name (optional)".
    boxes.push({ label: "nameLabel", x: name.x - 4, y: name.y - 4, width: Math.max(name.width, 180) + 8, height: name.height + 8 });
  }
  return boxes;
}

/*
 * #2829 W7c (A13.2) — the capture settle, run IN the page, identically on the
 * baseline site and ours: scroll the full page in 400 px steps with 120 ms
 * pauses (so lazy pictures and reveals fire), then jump back to the top with
 * behavior "instant" (a site's `scroll-behavior: smooth` would otherwise
 * leave the capture mid-scroll, with the header in whatever state that
 * moment gives), wait until scrollY has been 0 for 500 ms without a break,
 * and give the page at least 1,200 ms from the jump before the screenshot.
 * Self-contained (no closure): Playwright sends its source to the page.
 * Resolves with what it observed, for the run report.
 */
export async function settleInPage({ step = 400, pauseMs = 120, stableMs = 500, minSettleMs = 1200, timeoutMs = 10_000 } = {}) {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await sleep(pauseMs);
  }
  const jumpedAt = Date.now();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  let zeroSince = window.scrollY === 0 ? Date.now() : null;
  while (Date.now() - jumpedAt < timeoutMs) {
    if (zeroSince !== null && Date.now() - zeroSince >= stableMs) break;
    await sleep(25);
    if (window.scrollY !== 0) {
      zeroSince = null;
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } else if (zeroSince === null) zeroSince = Date.now();
  }
  const stable = zeroSince !== null && Date.now() - zeroSince >= stableMs;
  const remaining = minSettleMs - (Date.now() - jumpedAt);
  if (remaining > 0) await sleep(remaining);
  return { scrollY: window.scrollY, stable };
}

export function args(argv, required, optional = []) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`UNEXPECTED_ARGUMENT:${flag}`);
    const name = flag.slice(2);
    if (![...required, ...optional].includes(name)) throw new Error(`UNKNOWN_ARGUMENT:${flag}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) out[name] = true;
    else {
      out[name] = next;
      index += 1;
    }
  }
  for (const name of required) if (!out[name] || out[name] === true) throw new Error(`MISSING_ARGUMENT:--${name}`);
  return out;
}

/** Baselines and diffs are private: refuse any output path inside the repository. */
export function assertOutsideRepo(path) {
  const root = realpathSync(REPO_ROOT);
  let probe = path;
  try { probe = realpathSync(path); } catch { /* not created yet */ }
  if (probe === root || probe.startsWith(`${root}${sep}`)) throw new Error("OUTPUT_INSIDE_REPOSITORY (parity output is private)");
  return path;
}
