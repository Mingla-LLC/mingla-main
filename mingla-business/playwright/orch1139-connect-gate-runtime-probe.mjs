// ORCH-1139 SC-5 RUNTIME PROBE — sessionless connect-route gate.
//
// Drives a headless Chromium against the branch web export served SPA-fallback,
// with NO auth token in storage, and observes whether each route is BOUNCED to
// the sign-in welcome screen (the bug) or RENDERS its own route.
//
// Signal model:
//   - A REDIRECTED (gated) route → the SPA navigates to `/` and mounts
//     BusinessWelcomeScreen → the document body carries the welcome/sign-in
//     copy AND the URL path collapses toward `/`.
//   - An EXEMPT connect route (the fix) → the SPA stays on the connect path;
//     the connect page mounts. With no valid Stripe `session=` it shows its OWN
//     loading/error state — but crucially NOT the sign-in welcome screen, and
//     the path is NOT bounced to `/`.
//
// The decisive, copy-independent assertion is the URL: a sessionless visit to
// `/connect-onboarding` must NOT end up at `/` (redirected). We also capture the
// rendered welcome-marker text as corroboration.
import { chromium } from "playwright";

const BASE = process.env.ORCH1139_BASE ?? "http://127.0.0.1:43139";

// Welcome/sign-in screen markers (BusinessWelcomeScreen canonical copy).
const SIGNIN_MARKERS = [
  "Your Place Deserves to Be Found",
  "Sign in",
  "Sign In",
  "Continue with",
  "Log in",
];

const CASES = [
  // EXEMPT (fix): must NOT bounce to `/`.
  { route: "/connect-onboarding", expect: "exempt" },
  { route: "/connect-account-management", expect: "exempt" },
  { route: "/accept-brand-invitation", expect: "exempt" },
  // CONTROL gated private route: MUST bounce to `/` (sign-in).
  { route: "/account", expect: "redirected" },
  { route: "/notifications", expect: "redirected" },
  // CONTROL buyer route (ORCH-1115): must NOT bounce (regression guard).
  { route: "/b/some-brand", expect: "exempt" },
  // CONTROL near-miss lookalike: MUST bounce (segment-safety at runtime).
  { route: "/connect-onboarding-evil", expect: "redirected" },
];

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let hardFail = false;

  for (const c of CASES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));

    // Guarantee NO auth: clear storage before any app code runs.
    await context.addInitScript(() => {
      try { window.localStorage.clear(); } catch {}
      try { window.sessionStorage.clear(); } catch {}
    });

    await page.goto(`${BASE}${c.route}`, { waitUntil: "networkidle", timeout: 30000 });
    // Let the SPA hydrate + run the auth bootstrap + the redirect gate.
    await page.waitForTimeout(3500);

    const finalPath = await page.evaluate(() => window.location.pathname);
    const bodyText = await page.evaluate(() => (document.body?.innerText ?? ""));
    const showsSignIn = SIGNIN_MARKERS.some((m) => bodyText.includes(m));
    const rootLen = await page.evaluate(() => {
      const el = document.getElementById("root");
      return el ? el.innerHTML.length : -1;
    });
    const hasAuthToken = await page.evaluate(() => {
      try {
        return Object.keys(window.localStorage).some(
          (k) => /auth|sb-|supabase|session|access_token/i.test(k) &&
            /access_token|refresh_token/i.test(window.localStorage.getItem(k) || ""),
        );
      } catch { return false; }
    });

    // "redirected" iff the final path collapsed to `/` (the welcome route).
    const bouncedToRoot = finalPath === "/" || finalPath === "";
    let ok;
    if (c.expect === "redirected") {
      ok = bouncedToRoot;
    } else {
      // exempt: must NOT bounce to `/`, AND must have rendered something.
      ok = !bouncedToRoot && rootLen > 0;
    }
    if (!ok) hardFail = true;

    results.push({
      route: c.route,
      expect: c.expect,
      finalPath,
      bouncedToRoot,
      showsSignIn,
      rootLen,
      hasAuthToken,
      pageErrors: pageErrors.length,
      ok,
    });
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  console.log(hardFail ? "ORCH-1139 SC-5 PROBE: HARD FAIL" : "ORCH-1139 SC-5 PROBE: PASS");
  process.exit(hardFail ? 1 : 0);
};

run().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(2);
});
