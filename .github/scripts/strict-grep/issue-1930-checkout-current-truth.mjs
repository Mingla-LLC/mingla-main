#!/usr/bin/env node
import fs from "node:fs";

const paths = {
  migration: "supabase/migrations/20270403001930_issue_1930_checkout_current_truth.sql",
  create: "supabase/functions/ticket-checkout-create/index.ts",
  confirm: "supabase/functions/ticket-checkout-confirm/index.ts",
  stripe: "supabase/functions/_shared/stripeWebhookRouter.ts",
  paystack: "supabase/functions/_shared/paystackWebhookRouter.ts",
  reconcile: "supabase/functions/reconcile-stuck-checkouts/index.ts",
  status: "supabase/functions/ticket-checkout-status/index.ts",
  rsvp: "supabase/functions/rsvp-contribution-create/index.ts",
  worker: "supabase/functions/checkout-sale-revocation/index.ts",
  secretBundle: "supabase/functions/_shared/secretBundle.ts",
  allowlist: "supabase/security/anon_executable_definer_allowlist.txt",
  consumerNative: "app-mobile/src/payments/nativeCheckoutFlow.ts",
  businessNative: "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
  consumerRsvp: "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  businessRsvp: "mingla-business/src/components/event/PublicEventPage.tsx",
};
const fail = (message) => { throw new Error(`issue-1930-checkout-current-truth: ${message}`); };
const functionBody = (source, signature) => {
  const start = source.indexOf(signature);
  if (start < 0) fail(`shared resolver missing: ${signature}`);
  const open = source.indexOf("{", start + signature.length);
  if (open < 0) fail(`shared resolver body missing: ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  fail(`shared resolver body is unbalanced: ${signature}`);
};
const check = (s) => {
  for (const token of ["event_checkout_admission_state", "ticket_checkout_provider_attempts", "checkout_sale_revocation_outbox", "issue_1930_ticket_checkout_create_session_base", "issue_1930_ticket_checkout_finalize_base", "issue_1930_mint_ticket_late_reversal", "issue_1930_finalize_rsvp_contribution", "issue_1930_mint_rsvp_late_reversal", "FOR UPDATE SKIP LOCKED", "VALUES (true,false)"]) {
    if (!s.migration.includes(token)) fail(`migration guard missing: ${token}`);
  }
  if (!s.create.includes("claimTicketProviderAttempt") || s.create.includes("Date.now().toString(36)")) fail("create attempt identity regressed");
  for (const key of ["confirm", "stripe", "paystack", "reconcile"]) {
    if (!s[key].includes('"biz_ticket_checkout_finalize"')) fail(`${key} bypasses guarded finalize`);
  }
  if (!s.stripe.includes('"issue_1930_finalize_rsvp_contribution"') || !s.paystack.includes('"issue_1930_finalize_rsvp_contribution"')) fail("RSVP webhook bypasses guarded finalize");
  if (!s.status.includes("ticketCheckoutPreflight") || !s.rsvp.includes("contributionStillAuthorized")) fail("fresh preflight missing");
  for (const key of ["consumerNative", "businessNative"]) {
    if (!s[key].includes("preflight: true") || s[key].indexOf("preflightPaymentSheet(") > s[key].indexOf("presentPaymentSheet()")) fail(`${key} presents without preflight`);
  }
  if (!s.consumerRsvp.includes("chipInIdempotencyRef") || !s.businessRsvp.includes("chipInIdempotencyRef")) fail("RSVP caller idempotency is not interaction-stable");
  if (!/import\s*{\s*resolveCheckoutRevocationExecute\s*}\s*from\s*["']\.\.\/_shared\/secretBundle\.ts["'];/.test(s.worker)) fail("worker does not import the checkout execution resolver");
  if (!/if\s*\(\s*!\s*resolveCheckoutRevocationExecute\s*\(\s*\)\s*\)/.test(s.worker)) fail("worker is not default dark");
  const revocationResolver = functionBody(
    s.secretBundle,
    "export function resolveCheckoutRevocationExecute(",
  );
  for (const token of [
    'const field = "checkout_revocation_execute";',
    'const legacyName = "CHECKOUT_REVOCATION_EXECUTE";',
    "result.value.schema_version === 4",
    "return result.value.payment_operations.checkout_revocation_execute;",
    "fallback(bundle, field, legacyName, result, getEnv)",
  ]) {
    if (!revocationResolver.includes(token)) fail(`checkout execution resolver ownership regressed: ${token}`);
  }
  if (!revocationResolver.includes("return parseLegacyBoolean(legacy) ?? false;")) fail("checkout execution resolver is not fail closed");
  if (s.allowlist.includes("biz_ticket_checkout_create_session(") || s.allowlist.includes("biz_ticket_checkout_finalize(")) fail("checkout definer remains anon allowlisted");
  if (/client_secret\s+(text|string)/i.test(s.migration + s.worker)) fail("secret persistence introduced");
};
const sources = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, fs.readFileSync(p, "utf8")]));
if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    ["migration", "VALUES (true,false)", "VALUES (true,true)"],
    ["confirm", '"biz_ticket_checkout_finalize"', '"issue_1930_ticket_checkout_finalize_base"'],
    ["rsvp", "contributionStillAuthorized", "contributionWasAuthorized"],
    ["worker", "if (!resolveCheckoutRevocationExecute())", "if (resolveCheckoutRevocationExecute())"],
    ["secretBundle", "return parseLegacyBoolean(legacy) ?? false;", "return parseLegacyBoolean(legacy) ?? true;"],
  ];
  for (const [key, from, to] of mutations) {
    let rejected = false;
    try { check({ ...sources, [key]: sources[key].replaceAll(from, to) }); } catch { rejected = true; }
    if (!rejected) fail(`self-test mutation survived: ${from}`);
  }
  console.log("issue-1930 checkout current truth self-test: PASS");
} else {
  check(sources);
  console.log("issue-1930 checkout current truth: PASS");
}
