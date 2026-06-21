/**
 * ORCH-1187 LEG 2 — buyer-web analytics happy-path regression test.
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (buyer web).
 *
 * Source-text proofs (node-env, the established pattern for the QR/budget tests
 * that read source as TEXT). Verifies the load-bearing buyer-web analytics
 * wiring so a future edit that removes the consent gate, the replay masking, the
 * web-only isolation, or any conversion capture FAILS this test.
 *
 * Implementor-owned happy-path test; fails-on-revert proven by deleting the
 * guarded line and re-running (see IMPLEMENTATION report). The tester writes a
 * separate adversarial test on a different angle.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", ".."); // mingla-business/

// Strip // line comments and block comments so a doc-comment that MENTIONS a
// literal (e.g. "opt_out_capturing_by_default: true" in prose) cannot mask a
// real-code DELETION — true fails-on-revert (matches the strict-grep gates).
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const read = (rel: string): string =>
  stripComments(readFileSync(join(ROOT, rel), "utf8"));

describe("ORCH-1187 LEG2 — webAnalytics.web.ts (PostHog + GA4, consent-gated, masked)", () => {
  const src = read("src/analytics/webAnalytics.web.ts");

  it("initializes PostHog against the US host (region lock)", () => {
    expect(src).toMatch(/posthog\.init\s*\(/);
    expect(src).toContain("https://us.i.posthog.com");
  });

  it("opts out of capturing by default (the consent gate)", () => {
    expect(src).toMatch(/opt_out_capturing_by_default\s*:\s*true/);
  });

  it("enables session replay with masking ON (never disables masking)", () => {
    expect(src).toMatch(/session_recording\s*:/);
    expect(src).toMatch(/maskAllInputs\s*:\s*true/);
    expect(src).not.toMatch(/maskAllInputs\s*:\s*false/);
  });

  it("emits GA4 Consent Mode v2 all-denied default before granting", () => {
    expect(src).toMatch(/consent['"]?\s*,\s*['"]default['"]/);
    expect(src).toMatch(/ad_storage\s*:\s*['"]denied['"]/);
    expect(src).toMatch(/analytics_storage\s*:\s*['"]denied['"]/);
    expect(src).toMatch(/ad_user_data\s*:\s*['"]denied['"]/);
    expect(src).toMatch(/ad_personalization\s*:\s*['"]denied['"]/);
  });

  it("exposes the consent + capture facade the call sites use", () => {
    for (const fn of [
      "initWebAnalytics",
      "grantConsent",
      "denyConsent",
      "captureWeb",
      "gaEvent",
      "identifyWeb",
    ]) {
      // `export function` or `export async function` (initWebAnalytics is async).
      expect(src).toMatch(new RegExp(`export (?:async )?function ${fn}\\b`));
    }
  });

  it("loads posthog-js dynamically (kept out of the eager boot chunk)", () => {
    // Dynamic import only — no top-level `import posthog from "posthog-js"`.
    expect(src).toMatch(/await import\(\s*['"]posthog-js['"]\s*\)/);
    expect(src).not.toMatch(/^import\s+\w+\s+from\s+['"]posthog-js['"]/m);
  });
});

describe("ORCH-1187 LEG2 — webAnalytics.ts native stub is a pure no-op", () => {
  const src = read("src/analytics/webAnalytics.ts");

  it("does NOT import posthog-js (native bundle must never pull the web SDK)", () => {
    expect(src).not.toMatch(/from\s+['"]posthog-js['"]/);
    expect(src).not.toMatch(/require\(\s*['"]posthog-js['"]\s*\)/);
  });

  it("exports the same facade so the call sites compile + no-op on native", () => {
    for (const fn of [
      "initWebAnalytics",
      "grantConsent",
      "denyConsent",
      "captureWeb",
      "gaEvent",
      "identifyWeb",
    ]) {
      expect(src).toContain(fn);
    }
  });
});

describe("ORCH-1187 LEG2 — _layout.tsx web-guarded init + banner mount", () => {
  const src = read("app/_layout.tsx");

  it("calls initWebAnalytics() behind a Platform.OS === 'web' guard", () => {
    expect(src).toMatch(/Platform\.OS\s*===\s*['"]web['"]/);
    expect(src).toMatch(/initWebAnalytics\s*\(/);
  });

  it("mounts <ConsentBanner />", () => {
    expect(src).toMatch(/<ConsentBanner\s*\/?\s*>/);
  });
});

describe("ORCH-1187 LEG2 — conversion captures at the buyer-web call sites", () => {
  const confirm = read("app/checkout/[eventId]/confirm.tsx");
  const tripConfirm = read("app/checkout-trip/[tripEventId]/confirm.tsx");
  const expConfirm = read("app/checkout-experience/[experienceEventId]/confirm.tsx");
  const cart = read("app/checkout/[eventId]/index.tsx");

  it("event confirm fires web_purchase_completed + GA purchase + masks PII", () => {
    expect(confirm).toContain('captureWeb("web_purchase_completed"');
    expect(confirm).toContain('offering_type: "event"');
    expect(confirm).toContain('gaEvent("purchase"');
    expect(confirm).toContain("phMaskProps()");
  });

  it("trip confirm fires web_purchase_completed (offering_type trip)", () => {
    expect(tripConfirm).toContain('captureWeb("web_purchase_completed"');
    expect(tripConfirm).toContain('offering_type: "trip"');
    expect(tripConfirm).toContain("phMaskProps()");
  });

  it("experience confirm fires web_purchase_completed (offering_type experience)", () => {
    expect(expConfirm).toContain('captureWeb("web_purchase_completed"');
    expect(expConfirm).toContain('offering_type: "experience"');
    expect(expConfirm).toContain("phMaskProps()");
  });

  it("cart screen fires web_checkout_started + GA begin_checkout", () => {
    expect(cart).toContain('captureWeb("web_checkout_started"');
    expect(cart).toContain('gaEvent("begin_checkout"');
  });
});

describe("ORCH-1187 LEG2 — public pages fire web_public_offering_viewed", () => {
  const pages: Array<[string, string]> = [
    ["app/e/[brandSlug]/[eventSlug].tsx", "event"],
    ["app/t/[brandSlug]/[tripSlug].tsx", "trip"],
    ["app/exp/[brandSlug]/[experienceSlug].tsx", "experience"],
    ["app/b/[brandSlug]/index.tsx", "brand"],
  ];
  it.each(pages)("%s captures web_public_offering_viewed (%s)", (rel, kind) => {
    const src = read(rel);
    expect(src).toContain('captureWeb("web_public_offering_viewed"');
    expect(src).toContain(`offering_type: "${kind}"`);
  });
});
