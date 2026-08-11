/**
 * Issue #1876 — REAL-Chromium reachability proof for the terminal recovery card.
 * NO jsdom, NO synthetic DOM. This is the gate the first implementation attempt
 * did not have, and its absence is the entire reason a zero-pixel card shipped
 * behind a fully green suite.
 *
 * WHY THIS FILE EXISTS. The first attempt appended `#mingla-boot-error` to
 * `document.body` as a static-flow sibling AFTER `#root`, with
 * `margin:15vh auto 0`. Every assertion in every suite asked "is the node in the
 * DOM?" and all of them passed. In a real browser, against the REAL deployed
 * shell, the answer to "can a human see it?" was NO:
 *
 *   viewport         card top   visible px   wheel   touch drag   keyboard
 *   iPhone 13 390x664   772          0        0 px      0 px        0 px
 *   Pixel 5   393x727   844          0        0 px      0 px        0 px
 *   desktop  1280x800   928          0        0 px       n/a        0 px
 *
 * The cause is the shell's own `<style id="expo-reset">`, reproduced verbatim
 * below: an EMPTY `#root` is still `height:100%`, so a static sibling after it
 * starts past the fold, and `body{overflow:hidden}` propagates to the viewport
 * so nothing can scroll to it.
 *
 * WHAT IT ASSERTS — VISIBILITY, NEVER PRESENCE:
 *   1. the card's border box is inside the viewport and has non-zero visible area;
 *   2. `document.elementFromPoint` at the card's own centre hits the card, so it
 *      is not clipped, covered, or transparent to hit-testing;
 *   3. the Reload button takes the click at its own centre (Constitution rule 1);
 *   4. and the mirror case — a healthy app that mounts LATE removes the card
 *      entirely, so a working app is never defaced.
 *
 * FIDELITY: HIGH. It executes the EXACT `<script>` bytes the build injects
 * (materialised from `scripts/inject-mobile-blur-css.mjs` the same way the jest
 * suites do, never grepped), against the real shell markup, with the missing
 * chunk answering a real 404, in real Chromium at real iPhone 13 geometry.
 *
 * Not wired into CI: it needs a Playwright browser download, and a required gate
 * that cannot install its own browser is a red gate, not a safety net. Wiring a
 * browser-layout gate for business web generally is tester discovery D-1876-j
 * and belongs to its own issue.
 *
 * Run:
 *   cd mingla-business && npx playwright test -c playwright.issue1876.config.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const INJECT_PATH = path.join(__dirname, "..", "..", "scripts", "inject-mobile-blur-css.mjs");
const injectSource = readFileSync(INJECT_PATH, "utf8");

const BOOT_ERROR_ID = "mingla-boot-error";

function stringConst(name: string): string {
  const hit = injectSource.match(new RegExp(`const ${name} = "([^"]*)";`));
  if (hit === null) throw new Error(`missing const ${name}`);
  return hit[1];
}

/** The EXACT `<script>…</script>` the build injects into `dist/index.html`. */
function injectedScriptTag(): string {
  const literal = injectSource.match(/const CHUNK_RECOVERY_SCRIPT =\s*(`[^`]*`);/);
  if (literal === null) throw new Error("CHUNK_RECOVERY_SCRIPT template literal not found");
  const cooldown = injectSource.match(/const CHUNK_RECOVERY_COOLDOWN_MS = ([0-9_]+);/);
  if (cooldown === null) throw new Error("missing const CHUNK_RECOVERY_COOLDOWN_MS");
  const build = new Function(
    "CHUNK_RECOVERY_MARKER",
    "CHUNK_RECOVERY_KEY",
    "CHUNK_RECOVERY_COOLDOWN_MS",
    `return ${literal[1]};`,
  ) as (marker: string, key: string, cooldown: number) => string;
  return build(
    stringConst("CHUNK_RECOVERY_MARKER"),
    stringConst("CHUNK_RECOVERY_KEY"),
    Number(cooldown[1].replace(/_/g, "")),
  );
}

const SCRIPT_TAG = injectedScriptTag();
const SHARED_KEY = stringConst("CHUNK_RECOVERY_KEY");

/**
 * The deployed shell's own reset, transcribed from
 * https://business.usemingla.com/ on 2026-08-11. These three rules ARE the bug:
 * they make an empty `#root` fill the viewport and stop the page scrolling.
 */
const EXPO_RESET = `<style id="expo-reset">
      html, body { height: 100%; }
      body { overflow: hidden; }
      #root { display: flex; height: 100%; flex: 1; }
    </style>`;

const ORIGIN = "https://business.usemingla.test";

function shell(lateMountMs: number | null): string {
  const mount =
    lateMountMs === null
      ? ""
      : `<script>setTimeout(function(){var d=document.createElement("div");d.id="app-shell";` +
        `d.style.cssText="flex:1;background:#0f766e;color:#fff;font:600 20px system-ui;` +
        `display:flex;align-items:center;justify-content:center";` +
        `d.textContent="Healthy app mounted";document.getElementById("root").appendChild(d)},` +
        `${lateMountMs})<\/script>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
${EXPO_RESET}
${SCRIPT_TAG}
</head><body>
<noscript>You need to enable JavaScript to run this app.</noscript>
<div id="root"></div>
<script src="/_expo/static/js/web/index-DOESNOTEXIST0000.js?v=orch1091" defer><\/script>
${mount}
</body></html>`;
}

type Measured = {
  present: boolean;
  visiblePx?: number;
  insideViewport?: boolean;
  topmostAtCentre?: boolean;
  buttonTakesClick?: boolean;
  position?: string;
  rootChildren?: number;
};

async function boot(
  page: import("@playwright/test").Page,
  lateMountMs: number | null,
  waitMs: number,
): Promise<Measured> {
  // Prime the SHARED cooldown before any shell script runs, so the chunk failure
  // is SUPPRESSED — the permanent dead end this card exists to terminate.
  await page.addInitScript((key: string) => {
    try {
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      /* blocked storage still reaches the card by its own branch */
    }
  }, SHARED_KEY);

  await page.route("**/*", (route) =>
    route.request().url() === `${ORIGIN}/`
      ? route.fulfill({ contentType: "text/html", body: shell(lateMountMs) })
      : route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" }),
  );

  await page.goto(`${ORIGIN}/`, { waitUntil: "commit" });
  await page.waitForTimeout(waitMs);

  return page.evaluate((id: string): Measured => {
    const el = document.getElementById(id);
    if (el === null) return { present: false };
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const btn = el.querySelector("button");
    const br = btn === null ? null : btn.getBoundingClientRect();
    const btnHit =
      br === null
        ? null
        : document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    return {
      present: true,
      visiblePx: Math.round(visW * visH),
      insideViewport: r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw,
      topmostAtCentre: hit !== null && (hit === el || el.contains(hit)),
      buttonTakesClick: btn !== null && btnHit !== null && (btnHit === btn || btn.contains(btnHit)),
      position: getComputedStyle(el).position,
      rootChildren: document.getElementById("root")?.childNodes.length ?? -1,
    };
  }, BOOT_ERROR_ID);
}

test.describe("#1876 — the terminal recovery card, measured in a real browser", () => {
  test("R.1 — a genuinely blank boot shows a card a human can SEE and TAP", async ({ page }) => {
    const m = await boot(page, null, 3000);

    expect(m.present).toBe(true);
    // The three properties a DOM-presence assertion cannot express.
    expect(m.visiblePx ?? 0).toBeGreaterThan(0);
    expect(m.insideViewport).toBe(true);
    expect(m.topmostAtCentre).toBe(true);
    // Constitution rule 1 — the only way out of this page must not be a dead tap.
    expect(m.buttonTakesClick).toBe(true);
    // It must be anchored to the viewport, not to a flow an empty #root owns.
    expect(m.position).toBe("fixed");
    // And it must never have touched React's mount point.
    expect(m.rootChildren).toBe(0);
  });

  test("R.2 — a healthy app that mounts LATE removes the card entirely", async ({ page }) => {
    // The mirror of R.1 and the reason P1-1 shipped in the same commit: a
    // viewport-anchored card that is never removed would deface a working app,
    // which is strictly worse than the blank page this issue is about.
    const m = await boot(page, 2500, 5000);

    expect(m.present).toBe(false);
  });

  test("R.3 — an app that mounts BEFORE the guard fires never gets a card", async ({ page }) => {
    const m = await boot(page, 200, 4000);

    expect(m.present).toBe(false);
  });
});
