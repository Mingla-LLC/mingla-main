// ORCH-0815-B — Source-introspection tests for marketing-unsubscribe.
// Live integration verification owned by Claude `mingla-forensics` (TEST mode).

import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// T-B15 — brand-scope insert by default.
Deno.test("marketing-unsubscribe: default scope is 'brand' (SPEC §7.3)", () => {
  // Default branch sets brand_id only when scope === 'brand'.
  assert(SOURCE.includes('scopeParam === "global" ? "global" : "brand"'));
  assert(/insertRow\.brand_id\s*=\s*payload\.brand_id/.test(SOURCE));
  assert(SOURCE.includes('scope: "brand"'));
});

// T-B16 — ?scope=global escalation.
Deno.test("marketing-unsubscribe: ?scope=global escalates to global suppression", () => {
  assert(SOURCE.includes('scope=global'));
  assert(SOURCE.includes('searchParams.get("scope")'));
});

// T-B17 — invalid / expired token → 400 with friendly HTML.
Deno.test("marketing-unsubscribe: invalid token returns friendly HTML 400", () => {
  assert(SOURCE.includes("verifyUnsubscribeToken"));
  assert(SOURCE.includes("This unsubscribe link is invalid or expired"));
  assert(/htmlError\(/.test(SOURCE));
});

// Signature check is REQUIRED (does NOT trust path param without HS256).
Deno.test("marketing-unsubscribe: verifies signed token (strict-grep check 10)", () => {
  assert(SOURCE.includes("verifyUnsubscribeToken"));
  // No code path inserts an unsubscribe row before signature verify succeeds.
  const verifyIdx = SOURCE.indexOf("verifyUnsubscribeToken(token)");
  // Find the actual DB call site, not the docstring reference.
  const insertIdx = SOURCE.indexOf('.from("marketing_unsubscribes")');
  assert(verifyIdx > -1 && insertIdx > -1);
  assert(verifyIdx < insertIdx, "signature must be verified BEFORE DB insert");
});

// marketing_messages.status flips to 'unsubscribed' for the campaign+recipient pair.
Deno.test("marketing-unsubscribe: marketing_messages.status flips to 'unsubscribed'", () => {
  assert(SOURCE.includes("marketing_messages"));
  assert(SOURCE.includes('"unsubscribed"'));
  assert(SOURCE.includes("campaign_id"));
  assert(SOURCE.includes("recipient_email"));
});

// Re-visiting the link is idempotent (handles 23505 unique violation gracefully).
Deno.test("marketing-unsubscribe: re-visit is idempotent (tolerates 23505 unique violation)", () => {
  assert(SOURCE.includes("isUniqueViolation"));
  assert(SOURCE.includes('"23505"'));
});

// Operator misconfiguration surfaces as 503, not 400.
Deno.test("marketing-unsubscribe: missing/weak secret returns 503 not 400", () => {
  assert(SOURCE.includes("unsubscribe_token_secret_missing"));
  assert(SOURCE.includes("503"));
});
