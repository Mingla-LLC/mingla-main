/**
 * ORCH-1114 [public trip + experience Share button dead-tap on web] — TESTER
 * adversarial RUNTIME gate (Playwright, real Chromium, navigator.share UNDEFINED).
 *
 * Constitution #1 (no dead taps) demands runtime FIRING proof, not source wiring.
 * The implementor's tests are source-grep guards (readFileSync + toMatch) which
 * cap at "suspected". This spec proves, in a real desktop-Chrome RNW bundle where
 * the Web Share API does not exist, that tapping the public-page Share control
 * ACTUALLY opens the web-aware ShareModal and that the share paths surface toasts
 * (no silent swallow) instead of dead-tapping.
 *
 * Different angle than the implementor's source guards: this is a behavioral,
 * runtime, render-and-tap assertion on the live exported bundle, driving the
 * REAL route component (Supabase REST chain route-mocked so the cover render body
 * — and therefore the Share IconChrome — mounts), then tapping through the modal.
 *
 * Fidelity: HIGH. Real Chromium (Playwright Desktop Chrome has NO navigator.share),
 * real exported RNW JS bundle, real ShareModal + sharePublicUrl + copyPublicUrl,
 * real toasts. Supabase payloads are route-mocked because the test Supabase project
 * is a stub; the share UI under test is fully real.
 *
 * Serves web-build-orch1114 (exported with EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL=
 * http://127.0.0.1:43114) on its own static server. Self-contained — does NOT use
 * the repo playwright.config.ts webServer (which targets meta_orch_0952).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { chromium, expect, test, type Browser, type Page, type Route } from "@playwright/test";

const PORT = 43114;
const BASE = `http://127.0.0.1:${PORT}`;
// The exported bundle bakes MINGLA_BUSINESS_WEB_URL from app.config.ts's `extra`
// default (the production canonical origin), NOT the export-time env override —
// so the ShareModal renders the REAL production URL. We assert exactly that, which
// also proves SC-7's production-origin output at runtime (not just in the unit test).
const ORIGIN = "https://business.usemingla.com";

const WEB_BUILD = resolve(__dirname, "..", "web-build-orch1114");
const STATIC_SERVER = resolve(__dirname, "meta-orch-0952-static-server.mjs");

const BRAND_SLUG = "acme-co";
const TRIP_SLUG = "bali-escape";
const EXP_SLUG = "sunset-sail";

const BRAND_ID = "11111111-1111-1111-1111-111111111111";
const TRIP_EVENT_ID = "22222222-2222-2222-2222-222222222222";
const EXP_EVENT_ID = "33333333-3333-3333-3333-333333333333";

const jsonHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

let server: ChildProcess;
let browser: Browser;

test.beforeAll(async () => {
  server = spawn("node", [STATIC_SERVER, WEB_BUILD, String(PORT)], {
    stdio: "ignore",
  });
  // give the static server a moment to bind
  await new Promise((r) => setTimeout(r, 1200));
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
});

/**
 * Route-mock the public-trip / public-experience Supabase REST chain so the
 * route reaches its render body (the cover hero with the Share IconChrome).
 * Keyed by PostgREST table path. Anything else under /rest/v1 returns [].
 */
async function installPublicDataMocks(
  page: Page,
  kind: "trip" | "experience",
): Promise<void> {
  const eventId = kind === "trip" ? TRIP_EVENT_ID : EXP_EVENT_ID;
  const slug = kind === "trip" ? TRIP_SLUG : EXP_SLUG;
  const eventType = kind === "trip" ? "trip" : "experience";
  const title = kind === "trip" ? "Bali Escape" : "Sunset Sail";

  const brandRow = {
    id: BRAND_ID,
    slug: BRAND_SLUG,
    name: "Acme Co",
    description: "Acme adventures",
    cover_media_url: null,
  };
  const eventRow = {
    id: eventId,
    brand_id: BRAND_ID,
    slug,
    title,
    description: "An unforgettable day on the water.",
    status: "scheduled",
    visibility: "public",
    published_at: "2026-01-01T00:00:00Z",
    timezone: "UTC",
    event_type: eventType,
    cover_media_url: null,
    cover_media_type: null,
    currency: "usd",
    departure_text: null,
    theme: {},
  };

  await page.route("**/rest/v1/**", (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const table = path.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    let body: unknown = [];
    if (table === "brands") {
      body = brandRow; // maybeSingle → object
    } else if (table === "events") {
      body = eventRow; // maybeSingle → object
    } else if (table === "experiences" || table === "experience_intents") {
      body = kind === "experience" ? [] : [];
    } else {
      // trip_days, trip_pricing_tiers, trip_inclusions, ticket_types,
      // experience_stops, etc. → empty arrays (page renders with no sidecar data)
      body = [];
    }
    route.fulfill({ status: 200, headers: jsonHeaders, body: JSON.stringify(body) });
  });
}

/** Assert navigator.share is genuinely undefined in this Chromium context. */
async function assertNoWebShare(page: Page): Promise<void> {
  const hasShare = await page.evaluate(
    () => typeof (navigator as { share?: unknown }).share !== "undefined",
  );
  expect(hasShare, "navigator.share must be UNDEFINED for this dead-tap repro").toBe(false);
}

/**
 * Seed a non-expired Supabase web session into localStorage BEFORE the app
 * bundle runs, so the route-agnostic ORCH-1102 auth gate (logged-out web users
 * are redirected to `/`) does not bounce us off the public route. The bundle was
 * exported with EXPO_PUBLIC_SUPABASE_URL=https://orch1114.supabase.co → project
 * ref "orch1114" → storageKey "sb-orch1114-auth-token". The AsyncStorage web shim
 * persists under the raw key; seed both raw + "@RNAsyncStorage:"-prefixed forms
 * for resilience. /auth/v1/user is also route-mocked so getUser() resolves.
 *
 * NOTE: the Share fix under test is auth-INDEPENDENT (the IconChrome + ShareModal
 * are identical for authed and anon viewers). Seeding a session only gets the
 * route to mount its render body; it does not alter the share behavior proven.
 */
async function seedSession(page: Page): Promise<void> {
  const FUTURE = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // +24h
  const session = {
    access_token: "orch1114-fake-access-token",
    token_type: "bearer",
    expires_in: 86_400,
    expires_at: FUTURE,
    refresh_token: "orch1114-fake-refresh-token",
    user: {
      id: "99999999-9999-9999-9999-999999999999",
      aud: "authenticated",
      role: "authenticated",
      email: "qa-orch1114@usemingla.test",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "2026-01-01T00:00:00Z",
    },
  };
  const value = JSON.stringify(session);
  // Two keys are required: supabase-js reads under the RUNTIME project ref
  // ("sb-orch1114-auth-token", from the export's EXPO_PUBLIC_SUPABASE_URL), while
  // AuthContext.readStoredWebSession() (the 3s-bootstrap-timeout fallback) reads a
  // HARDCODED production ref "sb-gqnoajqerqhnvulmnyvv-auth-token". Seed both so the
  // route mounts (user resolves) instead of hitting the ORCH-1102 7s-ceiling
  // redirect-to-sign-in. The /auth/v1/user mock keeps the ORCH-1106 getUser()
  // staleness probe from signing the seeded session out.
  await page.addInitScript(
    ([v]) => {
      try {
        window.localStorage.setItem("sb-orch1114-auth-token", v);
        window.localStorage.setItem("sb-gqnoajqerqhnvulmnyvv-auth-token", v);
      } catch {
        /* storage unavailable — ignore */
      }
    },
    [value],
  );
  // getUser() / token refresh fallbacks → resolve to the seeded user.
  await page.route("**/auth/v1/**", (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/user")) {
      route.fulfill({ status: 200, headers: jsonHeaders, body: JSON.stringify(session.user) });
    } else {
      route.fulfill({ status: 200, headers: jsonHeaders, body: JSON.stringify(session) });
    }
  });
}

/**
 * Headless Chromium blocks navigator.clipboard.writeText even with the
 * clipboard-write permission (no real OS clipboard). Install a deterministic
 * writeText that records the copied value into window.__orch1114Copied so the
 * REAL ShareModal copy path (copyPublicUrl → writeText → "Link copied" toast)
 * resolves and we can assert the EXACT value the modal copied. navigator.share
 * is deliberately left UNDEFINED (the dead-tap condition under test).
 */
async function installClipboardCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __orch1114Copied?: string };
    const nav = navigator as unknown as {
      clipboard?: { writeText?: (v: string) => Promise<void> };
    };
    const stub = {
      writeText: (v: string): Promise<void> => {
        w.__orch1114Copied = v;
        return Promise.resolve();
      },
      readText: (): Promise<string> => Promise.resolve(w.__orch1114Copied ?? ""),
    };
    try {
      Object.defineProperty(navigator, "clipboard", { value: stub, configurable: true });
    } catch {
      if (nav.clipboard) nav.clipboard.writeText = stub.writeText;
    }
  });
}

async function openPage(page: Page, kind: "trip" | "experience"): Promise<void> {
  await seedSession(page);
  await installClipboardCapture(page);
  await installPublicDataMocks(page, kind);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const route =
    kind === "trip"
      ? `${BASE}/t/${BRAND_SLUG}/${TRIP_SLUG}`
      : `${BASE}/exp/${BRAND_SLUG}/${EXP_SLUG}`;
  await page.goto(route, { waitUntil: "networkidle" });
  await assertNoWebShare(page);
  // The Share IconChrome renders aria-label="Share" in the cover overlay.
  await expect(page.getByLabel("Share").first()).toBeVisible({ timeout: 25_000 });
}

for (const kind of ["trip", "experience"] as const) {
  const pathLabel = kind === "trip" ? "/t/" : "/exp/";
  const expectedUrl =
    kind === "trip"
      ? `${ORIGIN}/t/${BRAND_SLUG}/${TRIP_SLUG}`
      : `${ORIGIN}/exp/${BRAND_SLUG}/${EXP_SLUG}`;

  test.describe(`ORCH-1114 ${pathLabel} runtime share gate`, () => {
    test(`${pathLabel} Share tap OPENS ShareModal (not a dead tap)`, async () => {
      const page = await browser.newPage();
      try {
        await openPage(page, kind);

        // Before tap: the ShareModal title bar "Share" sheet must NOT be present.
        // (The IconChrome aria-label is also "Share"; the modal exposes the
        // "Copy link" + "Share via…" buttons, which are the unambiguous markers.)
        await expect(page.getByText("Copy link", { exact: true })).toHaveCount(0);

        await page.getByLabel("Share").first().click();

        // RUNTIME FIRING PROOF: the modal mounted on tap.
        await expect(page.getByText("Copy link", { exact: true })).toBeVisible({
          timeout: 10_000,
        });
        await expect(page.getByText("Share via…", { exact: true })).toBeVisible();
        // The URL row shows the canonical public URL for this surface.
        await expect(page.getByText(expectedUrl, { exact: false })).toBeVisible();
      } finally {
        await page.close();
      }
    });

    test(`${pathLabel} Copy link → "Link copied" toast + clipboard has the URL`, async () => {
      const page = await browser.newPage();
      try {
        await openPage(page, kind);
        await page.getByLabel("Share").first().click();
        await expect(page.getByText("Copy link", { exact: true })).toBeVisible({
          timeout: 10_000,
        });

        await page.getByText("Copy link", { exact: true }).click();

        await expect(page.getByText("Link copied", { exact: true })).toBeVisible({
          timeout: 10_000,
        });
        const clip = await page.evaluate(
          () => (window as unknown as { __orch1114Copied?: string }).__orch1114Copied,
        );
        expect(clip).toBe(expectedUrl);
      } finally {
        await page.close();
      }
    });

    test(`${pathLabel} Share via… → graceful "not supported" toast (no silent swallow)`, async () => {
      const page = await browser.newPage();
      try {
        await openPage(page, kind);
        await page.getByLabel("Share").first().click();
        await expect(page.getByText("Share via…", { exact: true })).toBeVisible({
          timeout: 10_000,
        });

        await page.getByText("Share via…", { exact: true }).click();

        // navigator.share is undefined → sharePublicUrl throws → ShareModal toasts.
        await expect(
          page.getByText("Native share not supported on this browser.", { exact: true }),
        ).toBeVisible({ timeout: 10_000 });
      } finally {
        await page.close();
      }
    });
  });
}
