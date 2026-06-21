/**
 * META-ORCH-1187 P2 — TESTER adversarial regression test (different angle).
 *
 * The implementor's happy-path test (metaOrch1187P2WebEvents.test.ts) proves the
 * fix STRINGS are present and that a GLOBAL `indexOf("opt_in_capturing")` precedes
 * a GLOBAL `indexOf('captureWeb("consent_granted"')`. That global-index proof is
 * BRITTLE and has real blind spots this test attacks on a different angle:
 *
 *   ANGLE 1 — SCOPE-BOUNDED ordering. A global indexOf passes even if the opt-in
 *     and the capture live in DIFFERENT functions, or if a SECOND opt-in were
 *     added after the capture, or if the capture were hoisted above the opt-in
 *     INSIDE grantConsent while an UNRELATED earlier opt_in_capturing reference
 *     (e.g. in a comment-stripped denyConsent or a doc string) kept the global
 *     index happy. We extract the `grantConsent` function body ONLY and assert
 *     the opt-in precedes the capture WITHIN that single scope — the property the
 *     PostHog drop-while-opted-out semantics actually require.
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
 * fails-on-revert: deleting the `checkoutStartedRef` latch, moving the
 * `captureWeb("consent_granted")` above `opt_in_capturing()` inside grantConsent,
 * or leaking a capture into denyConsent each FAILS a distinct assertion below.
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

describe("META-ORCH-1187 P2 ADVERSARIAL — consent ordering is SCOPE-BOUNDED", () => {
  const buyerAnalytics = readBiz("src/analytics/webAnalytics.web.ts");
  const marketingBanner = readRepo(
    "mingla-marketing/components/marketing/consent-banner.tsx",
  );

  // --- ANGLE 1: ordering proven INSIDE grantConsent, not globally ---
  it("buyer-web: opt_in_capturing precedes the consent_granted capture WITHIN grantConsent's own body", () => {
    const body = extractFnBody(
      buyerAnalytics,
      /export\s+function\s+grantConsent\s*\(/,
    );
    expect(body.length).toBeGreaterThan(0); // grantConsent must still exist
    const optInIdx = body.indexOf("opt_in_capturing");
    const captureIdx = body.indexOf('captureWeb("consent_granted"');
    expect(optInIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(-1);
    // The drop-while-opted-out invariant: capture AFTER opt-in, in THIS scope.
    expect(captureIdx).toBeGreaterThan(optInIdx);
  });

  it("marketing: applyConsent (opt-in) precedes the consent_granted capture WITHIN choose's own body", () => {
    const body = extractFnBody(marketingBanner, /const\s+choose\s*=\s*\(/);
    expect(body.length).toBeGreaterThan(0); // choose handler must still exist
    const applyIdx = body.indexOf("applyConsent(value)");
    const captureIdx = body.indexOf("captureMarketing('consent_granted')");
    expect(applyIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(applyIdx);
  });

  // --- ANGLE 2: deny path leaks NOTHING to PostHog ---
  it("buyer-web: denyConsent body contains NO PostHog capture of ANY name (no opted-out leak)", () => {
    const body = extractFnBody(
      buyerAnalytics,
      /export\s+function\s+denyConsent\s*\(/,
    );
    expect(body.length).toBeGreaterThan(0); // denyConsent must still exist
    expect(body).not.toMatch(/captureWeb\s*\(/);
    expect(body).not.toMatch(/posthogClient\??\.capture\s*\(/);
  });

  it("marketing: choose's deny branch fires NO PostHog capture (only the cookieless GA ping)", () => {
    const body = extractFnBody(marketingBanner, /const\s+choose\s*=\s*\(/);
    // The only captureMarketing in choose must be the GRANT one; a deny-branch
    // captureMarketing would mean a capture attempted while opted-out.
    const captureCount = (body.match(/captureMarketing\s*\(/g) ?? []).length;
    expect(captureCount).toBe(1);
    expect(body).toContain("captureMarketing('consent_granted')");
    expect(body).not.toContain("captureMarketing('consent_denied')");
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
