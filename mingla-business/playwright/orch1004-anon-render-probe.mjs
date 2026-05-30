// ORCH-1004 TEST — buyer-web anonymous render regression probe.
// Loads public/anon buyer-web routes with NO session attached and asserts the
// SPA mounts (#root has content) with zero page-level JS errors. The
// highest-risk regression for ORCH-1004 is that gating auth-scoped hooks on
// isAuthReady accidentally starved an anonymous buyer page (esp. the
// checkout-trip intake page, which reads the intentionally-ungated
// useIntakeSchema). This probe proves the anon path still renders.
import { chromium } from "playwright";

const BASE = process.env.ORCH1004_BASE ?? "http://127.0.0.1:8089";
const ROUTES = [
  "/", // app shell cold-open, no auth
  "/e/some-brand/some-event", // public event page (usePublicEvents)
  "/b/some-brand", // public brand shell (useBrand single)
  "/t/some-brand/some-trip", // public trip by slug (usePublicTripBySlug)
  "/checkout-trip/00000000-0000-0000-0000-000000000000/intake", // anon intake (useIntakeSchema, ungated)
];

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let hardFail = false;

  for (const route of ROUTES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    // Page-level uncaught JS errors (the thing that would break an anon render).
    page.on("pageerror", (err) => pageErrors.push(String(err && err.message ? err.message : err)));

    // Guarantee NO auth: clear storage before any app code runs.
    await context.addInitScript(() => {
      try { window.localStorage.clear(); } catch {}
      try { window.sessionStorage.clear(); } catch {}
    });

    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 30000 });
    // Give the SPA a beat to hydrate + run effects (auth bootstrap, query mounts).
    await page.waitForTimeout(2500);

    const rootLen = await page.evaluate(() => {
      const el = document.getElementById("root");
      return el ? el.innerHTML.length : -1;
    });
    // Did any localStorage get an auth token? Prove we are truly anonymous.
    const hasAuthToken = await page.evaluate(() => {
      try {
        return Object.keys(window.localStorage).some(
          (k) => /auth|sb-|supabase|session|access_token/i.test(k) &&
            /access_token|refresh_token/i.test(window.localStorage.getItem(k) || ""),
        );
      } catch { return false; }
    });

    const ok = rootLen > 0 && pageErrors.length === 0;
    if (!ok) hardFail = true;
    results.push({ route, rootLen, pageErrors: pageErrors.length, pageErrorMsgs: pageErrors, hasAuthToken, ok });
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify({ base: BASE, results, verdict: hardFail ? "FAIL" : "PASS" }, null, 2));
  process.exit(hardFail ? 1 : 0);
};

run().catch((e) => { console.error("PROBE CRASH:", e); process.exit(2); });
