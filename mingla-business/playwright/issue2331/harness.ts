/**
 * #2331 — shared browser harness for the privacy-bar proofs.
 *
 * Runs against a local `expo export -p web` (see playwright.issue2331.config.ts)
 * built with EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331 and fixture
 * vendor ids. Supabase is a local stand-in; PostHog, GA4 and the four ad
 * pixels are fulfilled locally (empty 200) and RECORDED, so "what loaded" is
 * observable without any request leaving the machine. Every other origin is
 * aborted and recorded.
 */
import type { BrowserContext, Page, Route } from "@playwright/test";
import { eventRow } from "../issue3416-retest/mockBackend";

export const APP = "http://127.0.0.1:8331";
export const API = "http://127.0.0.1:54331";
export const VENUE = "http://127.0.0.1:42769";
export const BRAND_SLUG = "lantern";
export const EVENT_SLUG = "night-a";
export const EVENT_ID = "00000000-0000-4000-8000-0000000002a1";
export const ORDER_ID = "00000000-0000-4000-8000-0000000002b1";

/** The six sizes the contract names. */
export const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 412, height: 718 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
] as const;

export type Vendor = "posthog" | "ga" | "meta" | "tiktok" | "snap" | "reddit";

const VENDOR_HOSTS: Array<[Vendor, RegExp]> = [
  ["posthog", /(^|\.)posthog\.com$/],
  ["ga", /(^|\.)(googletagmanager|google-analytics|analytics\.google)\.com$/],
  ["meta", /(^|\.)(facebook\.net|facebook\.com)$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["snap", /(^|\.)(sc-static\.net|snapchat\.com)$/],
  ["reddit", /(^|\.)(redditstatic\.com|reddit\.com)$/],
];

export interface Recorder {
  vendor: Array<{ vendor: Vendor; url: string; at: number }>;
  blocked: string[];
  api: string[];
}

const cors = {
  "Access-Control-Allow-Origin": APP,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS,HEAD",
  "Access-Control-Expose-Headers": "*",
};
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Scroll every scroll owner on the page to its end (bottom-pinned UI shows). */
export async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1 && !node.closest("[data-testid='privacy-bar']")) {
        node.scrollTop = node.scrollHeight;
        node.dispatchEvent(new Event("scroll"));
      }
    }
  });
  await page.waitForTimeout(900);
}

export const HOST_USER = {
  id: "00000000-0000-4000-8000-0000000023a1",
  aud: "authenticated",
  role: "authenticated",
  email: "host-2331@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Issue 2331 Host" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/**
 * Seed a signed-in host session (supabase-js default storage key for
 * 127.0.0.1) so the authed host shell renders against the local stand-in.
 * The token is a fixture: nothing leaves the machine.
 */
export async function signInHost(context: BrowserContext): Promise<void> {
  await context.addInitScript((user) => {
    const now = Math.floor(Date.now() / 1000);
    const session = {
      access_token: "issue2331.fixture.token",
      refresh_token: "issue2331-refresh",
      token_type: "bearer",
      expires_in: 86400,
      expires_at: now + 86400,
      user,
    };
    try {
      window.localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    } catch {
      /* storage unavailable: the run reports the sign-in wall */
    }
  }, HOST_USER);
}

/** Install the local Supabase stand-in + the vendor recorder on a context. */
export async function install(context: BrowserContext, options: { signedIn?: boolean } = {}): Promise<Recorder> {
  const rec: Recorder = { vendor: [], blocked: [], api: [] };
  if (options.signedIn === true) await signInHost(context);
  const event = { ...eventRow(EVENT_ID, EVENT_SLUG, "Neighbors Night A"), brand_slug: BRAND_SLUG };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === APP || url.origin === VENUE) return route.fallback();
    const vendor = VENDOR_HOSTS.find(([, re]) => re.test(url.hostname))?.[0];
    if (vendor !== undefined) {
      rec.vendor.push({ vendor, url: url.origin + url.pathname, at: Date.now() });
      return route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*" }, contentType: "text/javascript", body: "" });
    }
    if (url.origin !== API) {
      rec.blocked.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    rec.api.push(url.pathname);
    const p = url.pathname;
    if (options.signedIn === true && p === "/auth/v1/user") return json(route, 200, HOST_USER);
    if (p.startsWith("/auth/v1/")) return json(route, 400, { error: "no_session_in_issue2331" });
    if (p === "/rest/v1/business_public_events_view") {
      const slug = url.searchParams.get("slug")?.replace(/^eq\./, "") ?? "";
      const id = url.searchParams.get("id")?.replace(/^eq\./, "") ?? "";
      const row = slug === EVENT_SLUG || id === EVENT_ID ? event : null;
      const single = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      if (single) return row === null ? json(route, 406, { code: "PGRST116" }) : json(route, 200, row);
      return json(route, 200, row === null ? [] : [row]);
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(route, 200, null);
    if (p.startsWith("/rest/v1/")) return json(route, 200, []);
    if (p.startsWith("/functions/v1/")) return json(route, 200, { ok: true });
    return json(route, 404, { error: "not_mocked" });
  });
  return rec;
}

/**
 * Pages the contract names, plus host-facing routes: the sign-in wall and the
 * signed-in host shell (tab bar, hub, account, support rail, notifications),
 * because the bar is mounted around every mingla-business web route.
 */
export const PAGES: ReadonlyArray<{ name: string; url: string; signedIn?: boolean }> = [
  { name: "event page", url: `${APP}/e/${BRAND_SLUG}/${EVENT_SLUG}` },
  { name: "checkout", url: `${APP}/checkout/${EVENT_ID}` },
  { name: "order confirmation", url: `${APP}/o/${ORDER_ID}` },
  { name: "host sign-in", url: `${APP}/auth` },
  { name: "venue reserve", url: VENUE },
  { name: "host home (signed in)", url: `${APP}/home`, signedIn: true },
  { name: "host hub events (signed in)", url: `${APP}/hub/events`, signedIn: true },
  { name: "host account (signed in)", url: `${APP}/account`, signedIn: true },
  { name: "host support (signed in)", url: `${APP}/account/support`, signedIn: true },
  { name: "host notifications (signed in)", url: `${APP}/notifications`, signedIn: true },
];

export interface OcclusionReport {
  barWidth: number;
  innerWidth: number;
  barHeight: number;
  inset: string;
  checked: number;
  covered: Array<{ label: string; hit: string; x: number; y: number }>;
}

/**
 * I-PRIVACY-BAR-NEVER-OCCLUDES: for every visible button/link outside the bar,
 * the top element at its visible centre is never the privacy bar (nor empty). "Visible" = its rect clipped by every overflow ancestor
 * and the viewport is non-empty; sheets/dialogs are excluded by construction
 * (none is open).
 */
export async function auditOcclusion(page: Page): Promise<OcclusionReport> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-testid='privacy-bar']");
    const barRect = bar?.getBoundingClientRect();
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("button, a[href], [role='button'], [role='link'], input[type='checkbox']"),
    ).filter((node) => bar === null || !bar.contains(node));
    const covered: Array<{ label: string; hit: string; x: number; y: number }> = [];
    let checked = 0;
    for (const node of controls) {
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      // Inline links that wrap have several boxes: use the first line's box.
      const boxes = node.getClientRects();
      let rect = boxes.length > 1 ? boxes[0] : node.getBoundingClientRect();
      let left = Math.max(rect.left, 0);
      let top = Math.max(rect.top, 0);
      let right = Math.min(rect.right, window.innerWidth);
      let bottom = Math.min(rect.bottom, window.innerHeight);
      for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
        const ps = getComputedStyle(parent);
        if (/(hidden|auto|scroll|clip)/.test(ps.overflowX + ps.overflowY)) {
          rect = parent.getBoundingClientRect();
          left = Math.max(left, rect.left);
          top = Math.max(top, rect.top);
          right = Math.min(right, rect.right);
          bottom = Math.min(bottom, rect.bottom);
        }
        if (ps.position === "fixed") break;
      }
      if (right - left < 2 || bottom - top < 2) continue;
      checked += 1;
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hit = document.elementsFromPoint(x, y)[0];
      // Only the privacy bar is under test: a page's own overlapping layers
      // (a sticky action over scrolled content) are that page's design.
      const underBar = bar !== null && hit !== undefined && bar.contains(hit);
      if (hit === undefined || underBar) {
        covered.push({
          label: (node.getAttribute("aria-label") ?? node.textContent ?? node.tagName).trim().slice(0, 60),
          hit: hit === undefined ? "none" : `${hit.tagName}${hit.closest("[data-testid='privacy-bar']") ? " (privacy bar)" : ""}`,
          x: Math.round(x),
          y: Math.round(y),
        });
      }
    }
    return {
      barWidth: barRect?.width ?? -1,
      innerWidth: window.innerWidth,
      barHeight: barRect?.height ?? -1,
      inset: getComputedStyle(document.documentElement).getPropertyValue("--mingla-privacy-inset").trim(),
      checked,
      covered,
    };
  });
}

export const vendorsSeen = (rec: Recorder, since = 0): Set<Vendor> =>
  new Set(rec.vendor.filter((entry) => entry.at >= since).map((entry) => entry.vendor));
