// MINGLA-INVARIANT: I-PRIVACY-BAR-NEVER-OCCLUDES | issue #2331 | Edge-based: on every Host web page, at every size and rotation, from domcontentloaded through settled, scrolled-to-end, Options open and a modal open, the privacy strip is the full-width bottom band of height var(--mingla-privacy-strip), nothing inside #root reaches below its top edge (measured unclipped by #root), no painted element intersects it, nothing paints over it, and every pinned layer keeps its rect through a real wheel and a scroll of every scroller (#root included).
//
// Runs against a REAL `expo export -p web` with the post-export injector
// applied (the band and strip ship in the first HTML), served by
// playwright/issue2331/static-server.mjs (DIST_2331). Supabase is answered
// in-test by path on any origin; every other origin is aborted, so nothing
// leaves the machine. The audit is in ./stripAudit.ts.
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { eventRow } from "../issue3416-retest/mockBackend";
import { HOST_USER } from "./harness";
import { auditPinned, auditStrip, PHONE_UA, ROTATIONS, scrollEverythingToEnd, VIEWPORTS, type StripViolation } from "./stripAudit";

const APP = process.env.ISSUE_2331_STRIP_HOST_URL ?? "http://127.0.0.1:43233";
const BRAND_SLUG = "lantern";
const EVENT_SLUG = "night-a";
const EVENT_ID = "00000000-0000-4000-8000-0000000002a1";
const ORDER_ID = "00000000-0000-4000-8000-0000000002b1";
// A ticketed event: its desktop Buy bar is the premiumDesktopBarDock layer that
// lost its bottom 6px under the strip before #2331 (live, 1280x800).
const TICKETED_SLUG = "ticketed-night";
const TICKETED_ID = "00000000-0000-4000-8000-0000000002a2";
const TICKET_ID = "00000000-0000-4000-8000-0000000002c1";

// `full`: every size plus both rotations (the high-risk pages: the SPA shell,
// the page with the desktop Buy bar, and the signed-in shell with its
// sidebar, bottom nav and Modal). The rest run at the three layout
// breakpoints (phone, tablet-landscape, desktop): the audit is size-independent
// and layouts only change at those breakpoints.
const PAGES: ReadonlyArray<{ name: string; path: string; signedIn?: boolean; expectAtDesktop?: string; full?: boolean }> = [
  { name: "landing", path: "/", full: true },
  { name: "sign-in", path: "/auth" },
  { name: "event (RSVP)", path: `/e/${BRAND_SLUG}/${EVENT_SLUG}` },
  { name: "event (ticketed, Buy bar)", path: `/e/${BRAND_SLUG}/${TICKETED_SLUG}`, expectAtDesktop: "orch-1167-event-floating-bar", full: true },
  { name: "brand", path: `/b/${BRAND_SLUG}` },
  { name: "venue", path: `/b/${BRAND_SLUG}/v/main` },
  { name: "experience", path: `/exp/${BRAND_SLUG}/tasting` },
  { name: "order confirmation", path: `/o/${ORDER_ID}` },
  { name: "host home (signed in)", path: "/home", signedIn: true, full: true },
];
const BREAKPOINTS = [
  { width: 375, height: 667 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS,HEAD",
  "Access-Control-Expose-Headers": "*",
};
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function newContext(browser: Browser, width: number, height: number, signedIn: boolean): Promise<BrowserContext> {
  const phone = width < 768;
  const context = await browser.newContext({
    viewport: { width, height },
    ...(phone ? { userAgent: PHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const appOrigin = new URL(APP).origin;
  const event = { ...eventRow(EVENT_ID, EVENT_SLUG, "Neighbors Night A"), brand_slug: BRAND_SLUG };
  const ticketed = {
    ...eventRow(TICKETED_ID, TICKETED_SLUG, "Rooftop Jazz Night"),
    brand_slug: BRAND_SLUG,
    event_type: "event",
    description: "An evening of live jazz.",
    min_price_cents: 2500,
    public_theme: { business_event: { format: "in_person", whenMode: "single", location: { venueName: "The Lantern Room", address: "Brooklyn, NY" }, settings: {} } },
  };
  const ticket = {
    id: TICKET_ID, event_id: TICKETED_ID, name: "General Admission", description: "Standing room", price_cents: 2500, currency: "USD",
    quantity_total: 100, is_unlimited: false, is_free: false, sale_start_at: null, sale_end_at: null, min_purchase_qty: 1, max_purchase_qty: 10,
    is_hidden: false, is_disabled: false, requires_approval: false, allow_transfers: true, password_protected: false,
    available_online: true, available_in_person: false, waitlist_enabled: false, display_order: 0,
  };
  if (signedIn) {
    await context.addInitScript((user) => {
      const now = Math.floor(Date.now() / 1000);
      const session = { access_token: "issue2331.fixture.token", refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: now + 86400, user };
      try {
        for (const key of ["sb-127-auth-token", "sb-gqnoajqerqhnvulmnyvv-auth-token"]) window.localStorage.setItem(key, JSON.stringify(session));
      } catch {
        /* storage blocked: the run shows the sign-in wall, which is still audited */
      }
    }, HOST_USER);
  }
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appOrigin) return route.fallback();
    const p = url.pathname;
    if (!/^\/(rest|auth|functions|storage)\/v1\//.test(p)) return route.abort("blockedbyclient");
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (signedIn && p === "/auth/v1/user") return json(route, 200, HOST_USER);
    if (p.startsWith("/auth/v1/")) return json(route, 400, { error: "no_session_in_issue2331" });
    if (p === "/rest/v1/business_public_events_view") {
      const slug = url.searchParams.get("slug")?.replace(/^eq\./, "") ?? "";
      const id = url.searchParams.get("id")?.replace(/^eq\./, "") ?? "";
      const row = slug === EVENT_SLUG || id === EVENT_ID ? event : slug === TICKETED_SLUG || id === TICKETED_ID ? ticketed : null;
      const single = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      if (single) return row === null ? json(route, 406, { code: "PGRST116" }) : json(route, 200, row);
      return json(route, 200, row === null ? [] : [row]);
    }
    if (p === "/rest/v1/ticket_types") {
      const forTicketed = url.search.includes(TICKETED_ID);
      return json(route, 200, forTicketed ? [ticket] : []);
    }
    if (p === "/rest/v1/rpc/pg_direct_event_checkout_bundle") {
      const args = JSON.parse(request.postData() ?? "{}") as { p_event_slug?: string | null; p_event_id?: string | null };
      if (args.p_event_slug !== TICKETED_SLUG && args.p_event_id !== TICKETED_ID) return json(route, 200, null);
      return json(route, 200, {
        id: TICKETED_ID, brandId: "brand-3416", brandSlug: BRAND_SLUG, eventSlug: TICKETED_SLUG, name: "Rooftop Jazz Night",
        description: "An evening of live jazz.", currency: "USD", status: "scheduled", format: "in_person",
        venueName: "The Lantern Room", address: "Brooklyn, NY", timezone: "America/New_York",
        masterStartAt: ticketed.master_start_at, masterEndAt: ticketed.master_end_at,
        checkoutAccessMode: "unrestricted", brandCanCollect: true,
        occurrences: [{ id: `${TICKETED_ID}-date`, startAt: ticketed.master_start_at, endAt: ticketed.master_end_at, timezone: "America/New_York", isMaster: true, placesLeft: 50 }],
        brand: { id: "brand-3416", slug: BRAND_SLUG, name: "Lantern Room" },
        tickets: [{ id: TICKET_ID, name: "General Admission", description: "Standing room", priceCents: 2500, allInCents: 2750, currency: "USD", isFree: false, isUnlimited: false, capacity: 100, remaining: 50, minPurchaseQty: 1, maxPurchaseQty: 10, isHidden: false, isDisabled: false, availableOnline: true, availableInPerson: false, displayOrder: 0 }],
      });
    }
    if (p === "/rest/v1/rpc/pg_brand_can_charge") return json(route, 200, true);
    if (p === "/rest/v1/rpc/pg_public_ticket_types_remaining") return json(route, 200, [{ ticket_type_id: TICKET_ID, remaining: 50 }]);
    if (p === "/rest/v1/rpc/pg_public_event_tier_allin") return json(route, 200, [{ ticket_type_id: TICKET_ID, all_in_cents: 2750 }]);
    if (p.startsWith("/rest/v1/rpc/")) return json(route, 200, null);
    if (p.startsWith("/rest/v1/")) return json(route, 200, []);
    if (p.startsWith("/functions/v1/")) return json(route, 200, { ok: true });
    return json(route, 404, { error: "not_mocked" });
  });
  return context;
}

type Finding = { page: string; size: string; state: string; violations: StripViolation[] };

async function check(page: Page, findings: Finding[], where: { page: string; size: string }, state: string): Promise<void> {
  const result = await auditStrip(page, { host: true, allowStaticUnder: false });
  if (result.violations.length > 0) findings.push({ ...where, state, violations: result.violations.slice(0, 6) });
}

// Ready signal instead of a fixed wait: the load event, fonts, a quiet
// network (bounded), the app's strip mounted (the server copy removed), and
// two animation frames for the last layout pass.
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll(".mps").length === 1 && document.querySelector("[data-mingla-ssr-privacy-strip]") === null, undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function auditPage(page: Page, findings: Finding[], where: { page: string; size: string }, expectTestId?: string): Promise<void> {
  await settle(page);
  if (expectTestId !== undefined) {
    // The layer under test really rendered (the gate is not passing on an error state).
    await expect(page.locator(`[data-testid="${expectTestId}"]`).first()).toBeVisible({ timeout: 20_000 });
  }
  await check(page, findings, where, "settled");
  // Pinned stays pinned: a real wheel and every scroller (#root included).
  const moved = await auditPinned(page);
  if (moved.length > 0) findings.push({ ...where, state: "pinned stays pinned", violations: moved.slice(0, 6) });
  await scrollEverythingToEnd(page);
  await check(page, findings, where, "scrolled to end");
  // Options open: the sheet and scrim sit on the strip, the strip stays on top.
  await page.locator(".mps").click();
  await page.locator(".mpb:not([hidden])").waitFor();
  await page.waitForTimeout(250); // the sheet's 0.2s entrance
  const sheet = await page.locator(".mpb:not([hidden])").boundingBox();
  const strip = await page.locator(".mps").boundingBox();
  if (sheet === null || strip === null || Math.abs(sheet.y + sheet.height - strip.y) > 0.5) {
    findings.push({ ...where, state: "options open", violations: [{ rule: 2, detail: `the Options sheet does not end at the strip's top edge (${JSON.stringify(sheet)} vs ${JSON.stringify(strip)})` }] });
  }
  await check(page, findings, where, "options open");
  await page.keyboard.press("Escape");
}

test.describe("#2331 I-PRIVACY-BAR-NEVER-OCCLUDES on Host web (edge-based)", () => {
  for (const target of PAGES) {
    test(`${target.name}: ${target.full === true ? "every size, rotation" : "each breakpoint"} and state`, async ({ browser }) => {
      test.setTimeout(600_000);
      const findings: Finding[] = [];
      for (const size of target.full === true ? VIEWPORTS : BREAKPOINTS) {
        const where = { page: target.name, size: `${size.width}x${size.height}` };
        const context = await newContext(browser, size.width, size.height, target.signedIn === true);
        const page = await context.newPage();
        await page.goto(`${APP}${target.path}`, { waitUntil: "domcontentloaded" });
        await check(page, findings, where, "domcontentloaded");
        await auditPage(page, findings, where, size.width >= 1024 ? target.expectAtDesktop : undefined);
        await context.close();
      }
      for (const rotation of target.full === true ? ROTATIONS : []) {
        const where = { page: target.name, size: `${rotation.from.width}x${rotation.from.height} -> ${rotation.to.width}x${rotation.to.height}` };
        const context = await newContext(browser, rotation.from.width, rotation.from.height, target.signedIn === true);
        const page = await context.newPage();
        await page.goto(`${APP}${target.path}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.setViewportSize(rotation.to);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.waitForTimeout(300);
        await check(page, findings, where, "rotated");
        await scrollEverythingToEnd(page);
        await check(page, findings, where, "rotated, scrolled to end");
        await context.close();
      }
      expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
    });
  }

  // The signed-in host home opens a real react-native-web Modal on arrival
  // (the "Meet Ari" introduction): its body portal must end at the strip.
  test("a react-native-web Modal ends at the strip, and the strip stays on top", async ({ browser }) => {
    test.setTimeout(300_000);
    const findings: Finding[] = [];
    for (const size of [{ width: 375, height: 667 }, { width: 1280, height: 800 }]) {
      const where = { page: "host home modal", size: `${size.width}x${size.height}` };
      const context = await newContext(browser, size.width, size.height, true);
      const page = await context.newPage();
      await page.goto(`${APP}/home`, { waitUntil: "domcontentloaded" });
      await expect(page.locator('body > div [aria-modal="true"][role="dialog"]').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      const modal = await page.evaluate(() => {
        const portal = Array.from(document.body.children).find(
          (node) => node.id !== "root" && node.querySelector(':scope > div [aria-modal="true"]') !== null,
        );
        if (portal === undefined) return null;
        const r = portal.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, position: getComputedStyle(portal).position };
      });
      expect(modal, `${where.size}: the RN-web Modal portal`).not.toBeNull();
      expect(modal?.position).toBe("fixed");
      const strip = await page.locator(".mps").boundingBox();
      expect(Math.abs((modal?.bottom ?? 0) - (strip?.y ?? -1)), where.size).toBeLessThanOrEqual(0.5);
      await check(page, findings, where, "modal open");
      await context.close();
    }
    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
  });
});
