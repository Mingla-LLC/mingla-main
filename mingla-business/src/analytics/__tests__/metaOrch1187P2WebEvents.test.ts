/**
 * META-ORCH-1187 P2 — web analytics gap-fix regression test.
 *   Phase 2 (WEB-only) instrumentation gaps found by the Phase-2A dashboard build.
 *
 * Source-text proofs (node-env, the established pattern for the LEG-2 buyer-web
 * test it sits beside). Verifies the two gap-fixes stay wired so a future edit
 * that drops them FAILS this test:
 *
 *   FIX 1 — checkout-funnel parity: the TRIP and EXPERIENCE checkout cart screens
 *     fire `web_checkout_started` (+ GA4 `begin_checkout`) on mount, just like the
 *     event checkout. Without these the web funnel undercounts started checkouts.
 *   FIX 2 — consent measurement: both roots fire `consent_granted` only after
 *     their asynchronous grant-only boot completes. No `consent_denied` capture
 *     is fired and Reject has no analytics-side effect.
 *
 * Implementor-owned happy-path test; fails-on-revert proven by deleting the
 * guarded lines and re-running (see IMPLEMENTATION report). The tester writes a
 * separate adversarial test on a different angle.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const BIZ_ROOT = join(__dirname, "..", "..", ".."); // mingla-business/
const REPO_ROOT = join(BIZ_ROOT, ".."); // monorepo root

// Strip // line comments and block comments so a doc-comment that MENTIONS a
// literal cannot mask a real-code DELETION — true fails-on-revert.
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const readBiz = (rel: string): string =>
  stripComments(readFileSync(join(BIZ_ROOT, rel), "utf8"));
const readRepo = (rel: string): string =>
  stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));

describe("META-ORCH-1187 P2 FIX 1 — trip/experience checkout fire web_checkout_started", () => {
  const trip = readBiz("app/checkout-trip/[tripEventId]/index.tsx");
  const exp = readBiz("app/checkout-experience/[experienceEventId]/index.tsx");

  it("trip checkout cart fires web_checkout_started (offering_type trip) + GA begin_checkout", () => {
    expect(trip).toContain('captureWeb("web_checkout_started"');
    expect(trip).toContain('offering_type: "trip"');
    expect(trip).toContain('gaEvent("begin_checkout"');
    // Imports the analytics facade (platform-resolved .web on web, no-op native).
    expect(trip).toMatch(
      /import\s*\{[^}]*captureWeb[^}]*\}\s*from\s*['"][^'"]*analytics\/webAnalytics['"]/,
    );
  });

  it("experience checkout cart fires web_checkout_started (offering_type experience) + GA begin_checkout", () => {
    expect(exp).toContain('captureWeb("web_checkout_started"');
    expect(exp).toContain('offering_type: "experience"');
    expect(exp).toContain('gaEvent("begin_checkout"');
    expect(exp).toMatch(
      /import\s*\{[^}]*captureWeb[^}]*\}\s*from\s*['"][^'"]*analytics\/webAnalytics['"]/,
    );
  });
});

describe("META-ORCH-1187 P2 FIX 2 — consent banners fire consent_granted (not consent_denied) in PostHog", () => {
  // Buyer-web grant lives in the analytics module (grantConsent fires after opt-in).
  const buyerAnalytics = readBiz("src/analytics/webAnalytics.web.ts");
  const marketingBanner = readRepo(
    "mingla-marketing/components/marketing/consent-banner.tsx",
  );
  const marketingProvider = readRepo(
    "mingla-marketing/components/marketing/posthog-provider.tsx",
  );

  it("buyer-web awaits the one-flight grant boot before consent_granted, and boot opts in before exposing PostHog", () => {
    const grantStart = buyerAnalytics.indexOf("export async function grantConsent");
    const grantEnd = buyerAnalytics.indexOf("export function denyConsent", grantStart);
    const grantBody = buyerAnalytics.slice(grantStart, grantEnd);
    const awaitIdx = grantBody.indexOf("await ensureGrantedAnalyticsBoot()");
    const captureIdx = grantBody.indexOf('captureWeb("consent_granted"');
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(awaitIdx);

    const bootStart = buyerAnalytics.indexOf("async function bootGrantedAnalytics");
    const bootEnd = buyerAnalytics.indexOf("function ensureGrantedAnalyticsBoot", bootStart);
    const bootBody = buyerAnalytics.slice(bootStart, bootEnd);
    const optInIdx = bootBody.indexOf("posthog.opt_in_capturing()");
    const exposeIdx = bootBody.indexOf("posthogClient = posthog");
    expect(optInIdx).toBeGreaterThan(-1);
    expect(exposeIdx).toBeGreaterThan(optInIdx);
  });

  it("buyer-web does NOT fire a consent_denied PostHog capture", () => {
    expect(buyerAnalytics).not.toContain('captureWeb("consent_denied"');
  });

  it("marketing persists first and captures consent_granted only from the grant boot continuation", () => {
    const chooseStart = marketingBanner.indexOf("const choose =");
    const chooseEnd = marketingBanner.indexOf("const visible =", chooseStart);
    const chooseBody = marketingBanner.slice(chooseStart, chooseEnd);
    const persistIdx = chooseBody.indexOf("persistMarketingConsent(value)");
    const optInIdx = chooseBody.indexOf("posthogOptIn().then");
    const captureIdx = chooseBody.indexOf("captureMarketingConsentGrantOnce()");
    expect(persistIdx).toBeGreaterThan(-1);
    expect(optInIdx).toBeGreaterThan(persistIdx);
    expect(captureIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(optInIdx);

    const facadeStart = marketingProvider.indexOf(
      "export function captureMarketingConsentGrantOnce",
    );
    const facadeEnd = marketingProvider.indexOf("interface PostHogProviderProps", facadeStart);
    const facadeBody = marketingProvider.slice(facadeStart, facadeEnd);
    expect(facadeBody).toContain("readMarketingConsent() !== 'granted'");
    expect(facadeBody).toContain("captureMarketing('consent_granted')");
  });

  it("marketing banner does NOT fire a consent_denied PostHog capture", () => {
    expect(marketingBanner).not.toContain(
      "captureMarketing('consent_denied')",
    );
  });
});
