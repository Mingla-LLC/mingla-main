// ORCH-1201-R2 — TESTER ADVERSARIAL test (mingla-tester, BRUTAL gatekeeper).
//
// DIFFERENT ANGLES than the implementor's class_routing.test.ts. The implementor
// proved: processor $0 ⇒ null, openai insufficient_quota vs rate_limit, cloudinary
// crit, serper single-obs. This file attacks the angles they did NOT:
//   1. PROCESSOR NO-BALANCE — both processors, with a CRIT-grade cloudinary signal
//      AND a depleted exchangerate signal forced in, at zero/negative/huge balance
//      ⇒ STILL null. The dot can never go red from balance.
//   2. CLASS-B MATCHER must require BOTH http-membership AND the exact substring —
//      a right string on a WRONG http ⇒ NOT depleted; a right http with a WRONG
//      string ⇒ NOT depleted; Serper 500 (not in the http set) ⇒ NOT depleted.
//   3. RESEND quota_exceeded vs rate_limit_exceeded; gemini generic 429 (limit not 0).
//   4. NO FABRICATED DATA — null/undefined/empty signal, empty rows, probe_only
//      service with no observations ⇒ depleted=false, NEVER a fabricated true/healthy.
//   5. HEADER boundary — exactly == warn ⇒ depleted (<=); warn+1 ⇒ NOT; non-finite
//      / undefined cached ⇒ NOT depleted (never fabricate from a missing number).
//   6. CLASS-A balance boundary + no-fabrication — exactly-at-warn, crit boundary,
//      missing detail field ⇒ null (not a fake low); unknown kind ⇒ null.
//   7. MAPBOX status_text 429 + GOOGLE_PLACES RESOURCE_EXHAUSTED on status_text.
//
// APPEND-ONLY, IMMUTABLE: do not edit to make a regression pass. This is a NEW
// file on a different angle (not a renamed copy of class_routing.test.ts).
// Fails-on-revert proven against ae3703079 (see TEST_ORCH-1201-R2.md).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLASS_B_DEPLETION,
  type DepletionObs,
  evaluateBalanceForSignal,
  matchClassBDepletion,
} from "./logic.ts";

const row = (
  http: number | null,
  code: string | null,
  text: string | null,
  agoMs = 0,
): DepletionObs => ({
  http_status: http,
  error_code: code,
  error_text: text,
  observed_at: new Date(Date.now() - agoMs).toISOString(),
});

// ════════════════════════════════════════════════════════════════════════
// 1. PROCESSOR NO-BALANCE-ALERT — the #1 thing that was wrong before.
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV-R2 P1: Stripe + Paystack NEVER alert on balance — crit-grade signal, any balance", () => {
  // Force every plausible balance value AND a non-twilio crit-grade signal in.
  const balances = [0, -1, 0.0, 999999999, 14.53];
  // Even with a cloudinary-style crit signal wired to a processor key, processors
  // short-circuit BEFORE the kind switch — must be null.
  const critSignals = [
    { kind: "twilio_balance", warn: 25, crit: 5 },
    { kind: "cloudinary_used_pct", warn: 80, crit: 100 },
    { kind: "exchangerate_quota", warn: 3000, crit: 500 },
  ];
  for (const proc of ["stripe", "paystack"]) {
    for (const b of balances) {
      for (const sig of critSignals) {
        const r = evaluateBalanceForSignal(
          proc,
          { balance: b, used_percent: 9999, requests_remaining: 0, currency: "usd" },
          sig,
        );
        assertEquals(r.balanceLow, null, `${proc} balance=${b} kind=${sig.kind} must be null`);
        assertEquals(r.severity, null, `${proc} must never carry a severity`);
        assertEquals(r.balanceText, null, `${proc} must never carry a balance alert text`);
      }
    }
  }
});

Deno.test("ADV-R2 P2: processor short-circuit ignores even a null signal", () => {
  // No signal at all ⇒ still null (not a throw, not a fabricated value).
  assertEquals(evaluateBalanceForSignal("stripe", { balance: 0 }, null).balanceLow, null);
  assertEquals(evaluateBalanceForSignal("paystack", {}, undefined).balanceLow, null);
});

// ════════════════════════════════════════════════════════════════════════
// 2. CLASS-B MATCHER — must require BOTH http-membership AND the substring.
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV-R2 B1: right depletion string on the WRONG http ⇒ NOT depleted", () => {
  const sig = CLASS_B_DEPLETION.openai; // http 429, field type, match insufficient_quota
  // insufficient_quota but arriving on a 200/500 — must NOT trip (http gate).
  assertEquals(matchClassBDepletion(sig, [row(200, "insufficient_quota", "x")]).depleted, false);
  assertEquals(matchClassBDepletion(sig, [row(500, "insufficient_quota", "x")]).depleted, false);
  // correct: 429 + insufficient_quota ⇒ depleted.
  assertEquals(matchClassBDepletion(sig, [row(429, "insufficient_quota", "x")]).depleted, true);
});

Deno.test("ADV-R2 B2: right http with the WRONG token ⇒ NOT depleted", () => {
  const sig = CLASS_B_DEPLETION.openai;
  // 429 but a 500-style / rate-limit / null code — must NOT deplete.
  for (const code of ["rate_limit_exceeded", "server_error", "", null]) {
    assertEquals(
      matchClassBDepletion(sig, [row(429, code, "Rate limit reached")]).depleted,
      false,
      `openai 429 code=${code} must not deplete`,
    );
  }
});

Deno.test("ADV-R2 B3: Serper 500 (not in [400,401,402,403,429]) ⇒ NOT depleted even with the body", () => {
  const sig = CLASS_B_DEPLETION.serper; // http [400,401,402,403,429], field body
  // A real 500 outage with the phrase echoed in an error page must NOT be misread
  // as quota depletion — depletion is a 4xx/429 credit signal, not a server crash.
  assertEquals(matchClassBDepletion(sig, [row(500, null, "Not enough credits")]).depleted, false);
  // a 402 with the body ⇒ depleted (the real fire).
  assertEquals(matchClassBDepletion(sig, [row(402, "not_enough_credits", "Not enough credits")]).depleted, true);
  // a 403 with an UNRELATED body (bad key) ⇒ NOT depleted.
  assertEquals(matchClassBDepletion(sig, [row(403, null, "Unauthorized: invalid API key")]).depleted, false);
});

// ════════════════════════════════════════════════════════════════════════
// 3. RESEND + GEMINI disambiguation.
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV-R2 B4: Resend daily/monthly quota_exceeded depletes; rate_limit_exceeded does NOT", () => {
  const sig = CLASS_B_DEPLETION.resend; // http 429, field type, match quota_exceeded
  assertEquals(matchClassBDepletion(sig, [row(429, "daily_quota_exceeded", "")]).depleted, true);
  assertEquals(matchClassBDepletion(sig, [row(429, "monthly_quota_exceeded", "")]).depleted, true);
  // transient rate-limit ⇒ NOT depletion (substring 'quota_exceeded' absent).
  assertEquals(matchClassBDepletion(sig, [row(429, "rate_limit_exceeded", "")]).depleted, false);
});

Deno.test("ADV-R2 B5: Gemini generic 429 without RESOURCE_EXHAUSTED ⇒ NOT depleted", () => {
  const sig = CLASS_B_DEPLETION.gemini; // http 429, field type, match RESOURCE_EXHAUSTED
  assertEquals(matchClassBDepletion(sig, [row(429, "UNAVAILABLE", "overloaded")]).depleted, false);
  assertEquals(matchClassBDepletion(sig, [row(429, null, null)]).depleted, false);
  // limit:0 demotion ⇒ RESOURCE_EXHAUSTED ⇒ depleted.
  assertEquals(matchClassBDepletion(sig, [row(429, "RESOURCE_EXHAUSTED", "{limit:0}")]).depleted, true);
});

// ════════════════════════════════════════════════════════════════════════
// 4. NO FABRICATED DATA — absent signal ⇒ depleted=false, never a fake.
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV-R2 N1: null/undefined/empty signal ⇒ NEVER depleted", () => {
  assertEquals(matchClassBDepletion(null, [row(429, "insufficient_quota", "x")]).depleted, false);
  assertEquals(matchClassBDepletion(undefined, [row(429, "insufficient_quota", "x")]).depleted, false);
  assertEquals(matchClassBDepletion({}, [row(429, "insufficient_quota", "x")]).depleted, false);
});

Deno.test("ADV-R2 N2: probe_only Class-B with ZERO observations ⇒ depleted=false (cold-start, no fake green/red)", () => {
  // openai is reactive_source=probe_only — until a real call site logs, there are
  // no observations. The matcher must return false (the handler then leaves the
  // service at unknown via the <5-sample floor), NEVER fabricate a status.
  const r = matchClassBDepletion(CLASS_B_DEPLETION.openai, []);
  assertEquals(r.depleted, false);
  assertEquals(r.lastErrorCode, null);
  assertEquals(r.lastErrorText, null);
});

Deno.test("ADV-R2 N3: rows with null http_status are skipped, never matched", () => {
  // A malformed observation (no http captured) must not be coerced into a match.
  assertEquals(matchClassBDepletion(CLASS_B_DEPLETION.openai, [row(null, "insufficient_quota", "x")]).depleted, false);
});

// ════════════════════════════════════════════════════════════════════════
// 5. HEADER boundary — <= warn, exact equality, missing number.
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV-R2 H1: header depletion is <= warn (inclusive); warn+1 ⇒ NOT depleted", () => {
  const sig = CLASS_B_DEPLETION.pexels; // header warn 2500
  assertEquals(matchClassBDepletion(sig, [], 2501).depleted, false); // above warn
  assertEquals(matchClassBDepletion(sig, [], 2500).depleted, true); // exactly at warn (inclusive)
  assertEquals(matchClassBDepletion(sig, [], 2499).depleted, true); // below warn
  assertEquals(matchClassBDepletion(sig, [], 0).depleted, true); // exhausted
});

Deno.test("ADV-R2 H2: ticketmaster warn 500 boundary", () => {
  const sig = CLASS_B_DEPLETION.ticketmaster; // header warn 500
  assertEquals(matchClassBDepletion(sig, [], 4994).depleted, false); // live value ⇒ ok
  assertEquals(matchClassBDepletion(sig, [], 500).depleted, true);
});

Deno.test("ADV-R2 H3: missing/NaN/undefined cached remaining ⇒ NOT depleted (no fabrication from absent number)", () => {
  const sig = CLASS_B_DEPLETION.pexels;
  assertEquals(matchClassBDepletion(sig, [], undefined).depleted, false);
  assertEquals(matchClassBDepletion(sig, [], null).depleted, false);
  assertEquals(matchClassBDepletion(sig, [], NaN).depleted, false);
  // a header-signal service must NOT fall through to a reactive scan of rows.
  assertEquals(matchClassBDepletion(sig, [row(429, "insufficient_quota", "x")], undefined).depleted, false);
});

// ════════════════════════════════════════════════════════════════════════
// 6. CLASS-A balance boundary + no-fabrication.
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV-R2 A1: twilio warn boundary — exactly 25 ⇒ low (<=); 25.01 ⇒ not; crit at <=5", () => {
  const sig = { kind: "twilio_balance", warn: 25, crit: 5 };
  assertEquals(evaluateBalanceForSignal("twilio", { balance: 25 }, sig).balanceLow, true);
  assertEquals(evaluateBalanceForSignal("twilio", { balance: 25.01 }, sig).balanceLow, false);
  // warn but above crit ⇒ severity 'warn'.
  assertEquals(evaluateBalanceForSignal("twilio", { balance: 14.53 }, sig).severity, "warn");
  // at/below crit ⇒ severity 'crit'.
  assertEquals(evaluateBalanceForSignal("twilio", { balance: 5 }, sig).severity, "crit");
  assertEquals(evaluateBalanceForSignal("twilio", { balance: 2 }, sig).severity, "crit");
});

Deno.test("ADV-R2 A2: cloudinary boundary — exactly 80 ⇒ warn-low; >=100 ⇒ crit; 79.99 ⇒ not low", () => {
  const sig = { kind: "cloudinary_used_pct", warn: 80, crit: 100 };
  const at80 = evaluateBalanceForSignal("cloudinary", { used_percent: 80 }, sig);
  assertEquals(at80.balanceLow, true);
  assertEquals(at80.severity, "warn");
  assertEquals(evaluateBalanceForSignal("cloudinary", { used_percent: 79.99 }, sig).balanceLow, false);
  assertEquals(evaluateBalanceForSignal("cloudinary", { used_percent: 100 }, sig).severity, "crit");
  assertEquals(evaluateBalanceForSignal("cloudinary", { used_percent: 747.88 }, sig).severity, "crit");
});

Deno.test("ADV-R2 A3: missing balance/used_percent field ⇒ null, NOT a fabricated low", () => {
  // A Class-A poll that failed to read the number must short-circuit to null
  // (no signal), never report balanceLow=true from an absent value.
  assertEquals(evaluateBalanceForSignal("twilio", {}, { kind: "twilio_balance", warn: 25 }).balanceLow, null);
  assertEquals(evaluateBalanceForSignal("cloudinary", {}, { kind: "cloudinary_used_pct", warn: 80, crit: 100 }).balanceLow, null);
  assertEquals(evaluateBalanceForSignal("exchangerate", {}, { kind: "exchangerate_quota", warn: 3000, crit: 500 }).balanceLow, null);
  // a non-numeric balance (string) ⇒ treated as absent ⇒ null.
  assertEquals(
    evaluateBalanceForSignal("twilio", { balance: "14.53" as unknown as number }, { kind: "twilio_balance", warn: 25 }).balanceLow,
    null,
  );
});

Deno.test("ADV-R2 A4: unknown balance kind ⇒ null (no default-low)", () => {
  assertEquals(
    evaluateBalanceForSignal("mystery", { balance: 0 }, { kind: "totally_made_up", warn: 1 }).balanceLow,
    null,
  );
  // exchangerate live-shaped success: 12000 remaining ⇒ not low.
  assertEquals(
    evaluateBalanceForSignal("exchangerate", { requests_remaining: 12000 }, { kind: "exchangerate_quota", warn: 3000, crit: 500 }).balanceLow,
    false,
  );
  // exchangerate at warn boundary ⇒ low.
  assertEquals(
    evaluateBalanceForSignal("exchangerate", { requests_remaining: 3000 }, { kind: "exchangerate_quota", warn: 3000, crit: 500 }).balanceLow,
    true,
  );
});

Deno.test("ADV-R2 A5: sentry token-gated — absent ratio ⇒ null (grey/unknown, never green, never alert)", () => {
  // When SENTRY_AUTH_TOKEN is absent the poll writes no rate_limited_ratio.
  // evaluateBalanceForSignal must return null (no signal) — never a fabricated low.
  assertEquals(evaluateBalanceForSignal("sentry", {}, { kind: "sentry_stats", warn: 0.05, crit: 0.2 }).balanceLow, null);
  // present ratio at warn ⇒ low.
  assertEquals(evaluateBalanceForSignal("sentry", { rate_limited_ratio: 0.05 }, { kind: "sentry_stats", warn: 0.05, crit: 0.2 }).balanceLow, true);
});

// ════════════════════════════════════════════════════════════════════════
// 7. MAPBOX + GOOGLE_PLACES status_text matchers.
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV-R2 G1: mapbox 429 on status_text ⇒ depleted; non-429 ⇒ not", () => {
  const sig = CLASS_B_DEPLETION.mapbox; // http 429, field status_text, match "429"
  assertEquals(matchClassBDepletion(sig, [row(429, null, "429 rate_limited")]).depleted, true);
  assertEquals(matchClassBDepletion(sig, [row(401, null, "401 unauthorized")]).depleted, false);
});

Deno.test("ADV-R2 G2: google_places RESOURCE_EXHAUSTED on status_text (429 only)", () => {
  const sig = CLASS_B_DEPLETION.google_places; // http [429], field status_text, match RESOURCE_EXHAUSTED
  assertEquals(matchClassBDepletion(sig, [row(429, null, "RESOURCE_EXHAUSTED: quota")]).depleted, true);
  // a 429 without the token ⇒ not depleted.
  assertEquals(matchClassBDepletion(sig, [row(429, null, "OVER_QUERY_LIMIT")]).depleted, false);
});

// ════════════════════════════════════════════════════════════════════════
// 8. newest-first lastError ordering (the rollup correctness).
// ════════════════════════════════════════════════════════════════════════
Deno.test("ADV-R2 O1: lastErrorCode is the MOST RECENT match across mixed rows", () => {
  const sig = CLASS_B_DEPLETION.openai;
  const rows = [
    row(429, "insufficient_quota", "old", 10_000), // older
    row(429, "rate_limit_exceeded", "transient", 5_000), // non-match
    row(429, "insufficient_quota", "newest", 1_000), // newest match
  ];
  const dep = matchClassBDepletion(sig, rows);
  assertEquals(dep.depleted, true);
  assertEquals(dep.lastErrorText, "newest");
});
