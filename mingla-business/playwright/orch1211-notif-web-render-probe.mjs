// ORCH-1211 TEST — LIVE real-Chromium load of the running expo --web
// /notifications route. The adversarial angle DISTINCT from the jest path
// (which mis-resolves react-native-worklets): a real browser evaluates the
// actual web bundle, so it reproduces the prod crash (LinearTransition
// undefined at module-eval → "Cannot read properties of undefined (reading
// 'duration')" → global ErrorBoundary "Something broke.").
//
// PASS condition: NO uncaught TypeError mentioning "duration", AND the page
// does NOT show the global ErrorBoundary fallback ("Something broke." /
// "Try again" / "Get help"). The inbox chrome ("Notifications" title) or the
// screen body renders.
//
// ENV ISOLATION: the local dev env's Supabase backend is in *live* Stripe mode
// while the bundle ships a pk_test key, so the boot stripe-mode handshake
// throws StripeModeMismatchError in <RootLayoutInner> — a config artifact of
// THIS machine, unrelated to ORCH-1211. We abort the `/functions/v1/stripe-mode`
// request so the handshake hits its documented unreachable→soft-warn→null path
// (no throw), letting the actual notifications screen mount. This isolates the
// ORCH-1211 module-eval crash from the unrelated env blocker.
//
// Modeled on playwright/orch1004-anon-render-probe.mjs.
import { chromium } from "playwright";

const BASE = process.env.ORCH1211_BASE ?? "http://127.0.0.1:8099";
const ROUTE = "/notifications";

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Isolate the unrelated live-mode Stripe handshake blocker (see header).
  await page.route("**/functions/v1/stripe-mode**", (r) => r.abort());

  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) =>
    pageErrors.push(String(err && err.stack ? err.stack : err && err.message ? err.message : err)),
  );
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(7000);

  const rootLen = await page.evaluate(() => {
    const el = document.getElementById("root");
    return el ? el.innerHTML.length : -1;
  });
  const bodyText = await page.evaluate(() => document.body.innerText || "");

  const durationTypeError = pageErrors.find(
    (m) => /duration/i.test(m) && /undefined|TypeError|cannot read/i.test(m),
  );
  const durationConsoleError = consoleErrors.find(
    (m) => /duration/i.test(m) && /undefined|TypeError|cannot read/i.test(m),
  );
  const showsErrorBoundary =
    /Something broke\.?/i.test(bodyText) &&
    (/Try again/i.test(bodyText) || /Get help/i.test(bodyText));
  const showsNotifChrome = /Notifications/i.test(bodyText);
  const showsEmptyOrRows =
    /caught up|all caught up/i.test(bodyText) || rootLen > 2000;

  await page.screenshot({ path: "/tmp/orch1211_notif_web.png", fullPage: true });

  const ok =
    !durationTypeError && !durationConsoleError && !showsErrorBoundary && rootLen > 0;

  const result = {
    base: BASE,
    route: ROUTE,
    rootLen,
    bodyTextSample: bodyText.slice(0, 500),
    pageErrorCount: pageErrors.length,
    pageErrors,
    consoleErrorCount: consoleErrors.length,
    durationTypeError: durationTypeError ?? null,
    durationConsoleError: durationConsoleError ?? null,
    showsErrorBoundary,
    showsNotifChrome,
    showsEmptyOrRows,
    screenshot: "/tmp/orch1211_notif_web.png",
    verdict: ok ? "PASS" : "FAIL",
  };

  await context.close();
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
};

run().catch((e) => {
  console.error("PROBE CRASH:", e);
  process.exit(2);
});
