// MINGLA-INVARIANT: I-PRIVACY-BAR-NEVER-OCCLUDES | issue #2331 | Edge-based: on every listed usemingla.com page, at every size and rotation, from domcontentloaded through settled, scrolled to the bottom, Options open and each overlay open, the privacy strip is the full-width bottom band of height var(--mingla-privacy-strip), no fixed or sticky layer intersects it (nor any content at scroll-bottom), and nothing paints over it.
//
// Runs against the REAL production build of ../mingla-marketing (`next start`,
// see playwright.issue2331strip.config.ts). Every third-party origin is aborted.
// The audit is shared with the Host gate: ../issue2331/stripAudit.ts.
// Overlays: the site menu is opened for real; the form pop-ups (centre, side
// panel, phone sheet), the landing hand-off sheet and the city page layers are
// mounted with their REAL stylesheet classes (their open state comes from
// published CMS content this local build does not carry), so the shipped CSS
// rules are what is measured. scripts/issue-2331-strip-token-check.mjs is the
// static leg that covers every other fixed layer in the source.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { auditStrip, PHONE_UA, ROTATIONS, scrollEverythingToEnd, VIEWPORTS, type StripViolation } from "../issue2331/stripAudit";

const SITE = process.env.ISSUE_2331_STRIP_MARKETING_URL ?? "http://127.0.0.1:43234";
const CAREERS = SITE.replace("127.0.0.1", "career.localhost");

// The internal preview routes (/event-preview, /trip-preview, /venue-preview)
// and the design-preview banner are not public pages: they are the explicit
// exception, matching the static check's allowlist.
const PAGES: ReadonlyArray<{ name: string; url: string; overlays: Array<"forms" | "landing-sheet" | "page-system"> }> = [
  { name: "home", url: `${SITE}/`, overlays: ["forms", "landing-sheet"] },
  { name: "host", url: `${SITE}/host`, overlays: ["forms", "landing-sheet"] },
  { name: "links", url: `${SITE}/links`, overlays: [] },
  { name: "city hub", url: `${SITE}/cities/lagos`, overlays: ["page-system"] },
  { name: "help", url: `${SITE}/help`, overlays: [] },
  { name: "help article", url: `${SITE}/help/getting-the-apps`, overlays: [] },
  { name: "privacy policy", url: `${SITE}/privacy-policy`, overlays: [] },
  { name: "careers", url: `${CAREERS}/`, overlays: [] },
];

type Finding = { page: string; size: string; state: string; violations: StripViolation[] };

async function newContext(browser: Browser, width: number, height: number): Promise<BrowserContext> {
  const phone = width < 768;
  const context = await browser.newContext({
    viewport: { width, height },
    ...(phone ? { userAgent: PHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host.endsWith("localhost") ? route.fallback() : route.abort("blockedbyclient");
  });
  return context;
}

async function check(page: Page, findings: Finding[], where: { page: string; size: string }, state: string, allowStaticUnder: boolean): Promise<void> {
  const result = await auditStrip(page, { host: false, allowStaticUnder });
  if (result.violations.length > 0) findings.push({ ...where, state, violations: result.violations.slice(0, 6) });
}

/** Mount one overlay with its shipped classes; return a remover. */
async function mountOverlay(page: Page, kind: string): Promise<void> {
  await page.evaluate((which) => {
    const host = document.createElement("div");
    host.setAttribute("data-issue2331-overlay", which);
    const body = '<div style="height:2000px;background:#fff">overlay body</div>';
    const html: Record<string, string> = {
      "pu-centre": `<div class="pu-scrim"><div class="pu pu-centre"><div class="pu-pane"><div class="pu-body">${body}</div><div class="pu-foot"><button>Submit</button></div></div></div></div>`,
      "pu-side": `<div class="pu-scrim"></div><div class="pu pu-side"><div class="pu-pane"><div class="pu-body">${body}</div><div class="pu-foot"><button>Submit</button></div></div></div>`,
      "pu-sheet": `<div class="pu-scrim"></div><div class="pu pu-sheet"><div class="pu-pane"><div class="pu-body">${body}</div><div class="pu-foot"><button>Submit</button></div></div></div>`,
      "landing-sheet": `<div data-landing-sheet><div style="width:100%;height:100%;overflow:auto;background:#f5f4f0">${body}<button>Continue</button></div></div>`,
      "ps-host-sheet-layer": `<div class="ps-host-sheet-layer"><button class="ps-host-sheet-backdrop" aria-label="Close"></button><div class="ps-host-sheet"><button>Continue</button></div></div>`,
      "ps-detail-layer": `<div class="ps-detail-layer"><div class="ps-detail-backdrop"></div><div class="ps-detail-panel">${body}</div></div>`,
    };
    host.innerHTML = html[which] ?? "";
    document.body.appendChild(host);
  }, kind);
  await page.waitForTimeout(350);
}

async function unmountOverlays(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll("[data-issue2331-overlay]").forEach((node) => node.remove()));
}

async function auditOverlays(page: Page, findings: Finding[], where: { page: string; size: string }, kinds: ReadonlyArray<string>): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280;
  const list: string[] = [];
  for (const kind of kinds) {
    if (kind === "forms") list.push(...(width < 768 ? ["pu-sheet"] : ["pu-centre", "pu-side"]));
    else if (kind === "page-system") list.push("ps-host-sheet-layer", "ps-detail-layer");
    else list.push(kind);
  }
  for (const overlay of list) {
    await mountOverlay(page, overlay);
    // The overlay's own scroller at its end: its last button sits above the strip.
    await scrollEverythingToEnd(page);
    await check(page, findings, where, `overlay ${overlay}`, false);
    await unmountOverlays(page);
  }
}

test.describe("#2331 I-PRIVACY-BAR-NEVER-OCCLUDES on usemingla.com (edge-based)", () => {
  test.describe.configure({ mode: "serial" });

  for (const target of PAGES) {
    test(`${target.name}: every size, rotation and state`, async ({ browser }) => {
      test.setTimeout(600_000);
      const findings: Finding[] = [];
      for (const size of VIEWPORTS) {
        const where = { page: target.name, size: `${size.width}x${size.height}` };
        const context = await newContext(browser, size.width, size.height);
        const page = await context.newPage();
        await page.goto(target.url, { waitUntil: "domcontentloaded" });
        // Mid-page, static content may pass under the strip (document scroll).
        await check(page, findings, where, "domcontentloaded", true);
        await page.waitForLoadState("load").catch(() => undefined);
        await page.waitForTimeout(1500);
        await check(page, findings, where, "settled", true);
        await scrollEverythingToEnd(page);
        await check(page, findings, where, "scrolled to the bottom", false);
        // Options open: the sheet sits on the strip.
        await page.locator(".mps").click();
        await page.waitForTimeout(450);
        const sheet = await page.locator(".mpb:not([hidden])").boundingBox();
        const strip = await page.locator(".mps").boundingBox();
        if (sheet === null || strip === null || Math.abs(sheet.y + sheet.height - strip.y) > 0.5) {
          findings.push({ ...where, state: "options open", violations: [{ rule: 2, detail: `the Options sheet does not end at the strip's top edge (${JSON.stringify(sheet)} vs ${JSON.stringify(strip)})` }] });
        }
        await check(page, findings, where, "options open", true);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        // The site menu, opened for real where the page has one.
        const menu = page.getByRole("button", { name: "Open menu" }).first();
        if ((await menu.count()) > 0 && (await menu.isVisible())) {
          await menu.click();
          await page.waitForTimeout(600);
          await check(page, findings, where, "menu open", true);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
        }
        await auditOverlays(page, findings, where, target.overlays);
        await context.close();
      }
      for (const rotation of ROTATIONS) {
        const where = { page: target.name, size: `${rotation.from.width}x${rotation.from.height} -> ${rotation.to.width}x${rotation.to.height}` };
        const context = await newContext(browser, rotation.from.width, rotation.from.height);
        const page = await context.newPage();
        await page.goto(target.url, { waitUntil: "load" });
        await page.waitForTimeout(1200);
        await page.setViewportSize(rotation.to);
        await page.waitForTimeout(800);
        await check(page, findings, where, "rotated", true);
        await scrollEverythingToEnd(page);
        await check(page, findings, where, "rotated, scrolled to the bottom", false);
        await context.close();
      }
      expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
    });
  }
});
