/**
 * META-ORCH-1187 P2 — TESTER adversarial regression test (different angle).
 *
 * The implementor's happy-path test (metaOrch1187P2WebEvents.test.ts) proves the
 * fix STRINGS are present and that a GLOBAL `indexOf("opt_in_capturing")` precedes
 * a GLOBAL `indexOf('captureWeb("consent_granted"')`. That global-index proof is
 * BRITTLE and has real blind spots this test attacks on a different angle:
 *
 *   ANGLE 1 — SCOPE-BOUNDED async ordering. `grantConsent` must await the
 *     one-flight granted boot before capture; that private boot must opt in
 *     before exposing the PostHog client. Marketing must persist first and put
 *     its event facade only inside the boot promise continuation.
 *
 *   ANGLE 2 — DENY PATH emits nothing to PostHog. Not just "no
 *     consent_denied capture string" (implementor) — we assert the ENTIRE
 *     denyConsent body contains NO `captureWeb(` / `posthogClient?.capture(`
 *     call at all (a `captureWeb("anything")` leak while opted-out is the bug).
 *
 *   ANGLE 3 — DOUBLE-FIRE protection on the trip/experience checkout effects.
 *     The implementor tested that web_checkout_started fires; it did NOT test
 *     that it fires AT MOST ONCE. An on-mount effect with a non-empty dep array
 *     that lacked the `checkoutStartedRef` latch would re-fire on every dep
 *     change, inflating the funnel "start" count. We assert each checkout effect
 *     latches via a ref guard that returns early once set, AND that the capture
 *     is gated on a non-null id (no fire with a null event_id).
 *
 *   ANGLE 4 — offering_type is NOT the copy-paste "event" on trip/experience,
 *     and the trip file says "trip" / experience file says "experience" — the
 *     #1 copy-paste hazard when mirroring the event checkout.
 *
 * Source-text/scope proofs (node-env, same env the sibling tests use; the real
 * module cannot be EXECUTED here because window is undefined under node and
 * posthog-js is absent from node_modules — COMMS-0052 — so a true runtime drive
 * is not possible in this worktree; CI runtime is the authoritative check). This
 * is a structural invariant proof strictly STRONGER than the global-index proof.
 *
 * fails-on-revert: deleting the `checkoutStartedRef` latch, moving the consent
 * capture before the awaited boot, exposing PostHog before opt-in, or leaking a
 * vendor call into a deny path each FAILS a distinct assertion below.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const BIZ_ROOT = join(__dirname, "..", "..", ".."); // mingla-business/
const REPO_ROOT = join(BIZ_ROOT, ".."); // monorepo root

// Strip // line comments and /* */ block comments so a doc-comment that MENTIONS
// a literal cannot satisfy (or mask) a real-code assertion — true fails-on-revert.
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const readBiz = (rel: string): string =>
  stripComments(readFileSync(join(BIZ_ROOT, rel), "utf8"));
const readRepo = (rel: string): string =>
  stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));

/**
 * Extract the body of an exported/declared function by brace-matching from the
 * first `{` after the signature. Comment-stripped input only. Returns "" if the
 * signature is not found (so a renamed/removed function FAILS the .toContain
 * assertions rather than silently passing on an empty string — we assert the
 * body is non-empty first).
 */
function extractFnBody(src: string, signatureRegex: RegExp): string {
  const m = signatureRegex.exec(src);
  if (m === null) return "";
  let i = src.indexOf("{", m.index);
  if (i === -1) return "";
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

// [TEST-MOD-APPROVED #2331] The consent_granted ordering proof is retired with
// the grant. What stays adversarial: a turn-off leaks nothing to any vendor.
describe("META-ORCH-1187 P2 ADVERSARIAL / #2331 — a turn-off is scope-bounded and silent", () => {
  const buyerAnalytics = readBiz("src/analytics/webAnalytics.web.ts");
  const marketingBanner = readRepo(
    "mingla-marketing/components/marketing/consent-banner.tsx",
  );
  const marketingProvider = readRepo(
    "mingla-marketing/components/marketing/posthog-provider.tsx",
  );

  it("buyer-web: boot re-checks the choice after the dynamic import and opts in before exposing the client", () => {
    const bootBody = extractFnBody(
      buyerAnalytics,
      /async\s+function\s+bootAnalytics\s*\(/,
    );
    expect(bootBody.length).toBeGreaterThan(0);
    const importIdx = bootBody.indexOf('await import("posthog-js")');
    const recheckIdx = bootBody.indexOf("if (!isAnalyticsOn()) return;", importIdx);
    const optInIdx = bootBody.indexOf("posthog.opt_in_capturing()");
    const exposeIdx = bootBody.lastIndexOf("posthogClient = posthog");
    expect(importIdx).toBeGreaterThan(-1);
    expect(recheckIdx).toBeGreaterThan(importIdx);
    expect(optInIdx).toBeGreaterThan(recheckIdx);
    expect(exposeIdx).toBeGreaterThan(optInIdx);
  });

  it("marketing: every capture facade fails closed while analytics is off", () => {
    const eventFacadeBody = extractFnBody(
      marketingProvider,
      /export\s+function\s+captureMarketing\s*\(/,
    );
    expect(eventFacadeBody).toContain("if (!isMarketingAnalyticsOn()) return");
    expect(eventFacadeBody).toContain("posthogOptedOut");
    const searchBody = extractFnBody(
      marketingProvider,
      /export\s+function\s+captureSearchMeasurement\s*\(/,
    );
    expect(searchBody).toContain("if (!isMarketingAnalyticsOn()) return");
  });

  it("buyer-web: stopping analytics captures NOTHING of any name", () => {
    const body = extractFnBody(buyerAnalytics, /function\s+stopAnalytics\s*\(/);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/captureWeb\s*\(/);
    expect(body).not.toMatch(/\.capture\s*\(/);
    expect(body).toContain("opt_out_capturing()");
    const saveBody = extractFnBody(
      buyerAnalytics,
      /export\s+async\s+function\s+savePrivacyChoice\s*\(/,
    );
    expect(saveBody).not.toMatch(/captureWeb\s*\(|gaEvent\s*\(/);
  });

  it("marketing: a choice makes no PostHog capture or GA event", () => {
    const body = extractFnBody(marketingBanner, /const\s+choose\s*=\s*\(/);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/\bgtag\b|consent_denied|consent_granted|captureMarketing\s*\(/);
    const stopBody = extractFnBody(
      marketingProvider,
      /function\s+stopMarketingAnalytics\s*\(/,
    );
    expect(stopBody).toContain("opt_out_capturing()");
    expect(stopBody).not.toMatch(/\.capture\s*\(/);
  });
});

describe("META-ORCH-1187 P2 ADVERSARIAL — checkout web_checkout_started fires AT MOST ONCE", () => {
  const trip = readBiz("app/checkout-trip/[tripEventId]/index.tsx");
  const exp = readBiz("app/checkout-experience/[experienceEventId]/index.tsx");

  // --- ANGLE 3: double-fire protection (ref latch + null-id gate) ---
  const assertSingleFire = (
    src: string,
    idVar: string,
    offering: string,
  ): void => {
    // The capture must sit inside an effect that (a) declares a ref latch, and
    // (b) early-returns when the latch is already set, and (c) early-returns on a
    // null id. Without (a)+(b) the on-mount effect would re-fire on each dep
    // change → inflated funnel. Without (c) it fires with a null event_id.
    expect(src).toContain("checkoutStartedRef");
    expect(src).toMatch(/checkoutStartedRef\s*=\s*(React\.)?useRef</);
    // early-return-if-already-fired latch
    expect(src).toMatch(
      /if\s*\(\s*checkoutStartedRef\.current\s*\)\s*return\s*;/,
    );
    // the latch is SET before the capture (so a second pass returns early)
    const latchSetIdx = src.indexOf("checkoutStartedRef.current = true");
    const captureIdx = src.indexOf('captureWeb("web_checkout_started"');
    expect(latchSetIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(latchSetIdx);
    // null-id gate before the capture
    expect(src).toContain(`if (${idVar} === null) return;`);
    // offering_type is the file-correct value, NOT the copy-paste "event"
    expect(src).toContain(`offering_type: "${offering}"`);
    expect(src).not.toContain('offering_type: "event"');
  };

  it("trip checkout latches the start event (single fire, null-gated, offering_type trip)", () => {
    assertSingleFire(trip, "tripEventId", "trip");
  });

  it("experience checkout latches the start event (single fire, null-gated, offering_type experience)", () => {
    assertSingleFire(exp, "experienceEventId", "experience");
  });

  it("trip/experience GA begin_checkout carries the matching id field (no copy-paste event_id mismatch)", () => {
    expect(trip).toContain(
      'gaEvent("begin_checkout", { event_id: tripEventId })',
    );
    expect(exp).toContain(
      'gaEvent("begin_checkout", { event_id: experienceEventId })',
    );
  });
});
