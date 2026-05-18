// ORCH-0869 [Tr3 Installment Payments] Stage 1b — ADVERSARIAL regression test.
//
// Tester-authored (Claude `mingla-tester`). Attacks a DIFFERENT angle from
// the implementor's 12 dispatcher-routing tests at
// `supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts`.
//
// Implementor's tests cover: ticket-confirmation-dispatch routing on body.kind.
// This test covers: stripeWebhookRouter → finalize handoff + migration's
// finalize signature invariants. If a future refactor accidentally:
//   (a) widens the metadata check to non-strict equality (e.g., `==` or
//       `Boolean(...)` instead of `=== "true"`), allowing the boolean `true`
//       or `"True"` to also trigger the installment-plan-root code path —
//   (b) extracts customer/PM unconditionally (not gated on the flag),
//       leaking them into non-installment orders.stripe_customer_id_on_
//       connected_account columns —
//   (c) removes the `DROP FUNCTION IF EXISTS biz_ticket_checkout_finalize(
//       uuid, text, text, text, text)` from the Stage 1b migration, causing
//       a future migration to leave two finalize overloads coexisting and
//       supabase.rpc() resolution to be non-deterministic —
//   (d) removes the defensive `installment_plan_finalize_missing_customer_or_pm`
//       guard, allowing the finalize RPC to silently insert order_installments
//       rows the cron can never charge (because no saved PM exists) —
// — this test FAILS and CLOSE is blocked.
//
// Source-assertion shape: regex-against-source-text, no DB/network required.
// Mirror of the implementor's pattern but on different files.
//
// Fails-on-revert verification documented in
// `Mingla_Artifacts/reports/QA_ORCH-0869_TR3_INSTALLMENT_PAYMENTS_STAGE_1B_REPORT.md`.

import {
  assertEquals,
  assertExists,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const ROUTER_PATH = new URL("../stripeWebhookRouter.ts", import.meta.url);
const MIGRATION_PATH = new URL(
  "../../../migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql",
  import.meta.url,
);
const FINALIZE_RPC_REF = "biz_ticket_checkout_finalize";

const ROUTER_SOURCE = await Deno.readTextFile(ROUTER_PATH);
const MIGRATION_SOURCE = await Deno.readTextFile(MIGRATION_PATH);

// ---------- A. stripeWebhookRouter → finalize handoff ----------

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: webhook router uses STRICT string equality on installment-plan-root metadata", () => {
  // If a refactor switches to == or Boolean(...) coercion, Stripe boolean
  // `true` (some test contexts) or `"True"` would also trigger the
  // installment-plan-root path. Strict `=== "true"` keeps the surface tight.
  assertMatch(
    ROUTER_SOURCE,
    /piMetadata\["mingla_installment_plan_root"\]\s*===\s*"true"/,
    "metadata extraction must use STRICT EQUALITY === \"true\" (not == or Boolean coercion)",
  );
});

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: customer + saved PM extraction is GATED on installment-plan-root flag", () => {
  // Both extractions MUST be ternary-gated on isInstallmentPlanRoot. If a
  // future refactor unconditionally extracts them, the values would leak
  // into the orders columns for every non-installment order too.
  assertMatch(
    ROUTER_SOURCE,
    /const\s+stripeCustomerId\s*=\s*isInstallmentPlanRoot\s*\?\s*objectString\(paymentIntent,\s*"customer"\)\s*:\s*null/,
    "stripeCustomerId extraction MUST be ternary-gated on isInstallmentPlanRoot, returning null otherwise",
  );
  assertMatch(
    ROUTER_SOURCE,
    /const\s+savedPaymentMethodId\s*=\s*isInstallmentPlanRoot\s*\?\s*objectString\(paymentIntent,\s*"payment_method"\)\s*:\s*null/,
    "savedPaymentMethodId extraction MUST be ternary-gated on isInstallmentPlanRoot, returning null otherwise",
  );
});

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: all 3 new finalize params passed in single rpc() call", () => {
  // Pre-Stage-1b call had 5 params. The Stage 1b rpc() call must pass
  // p_stripe_customer_id_on_connected_account, p_saved_payment_method_id,
  // AND p_installment_plan_root in the SAME rpc() invocation. A refactor
  // that drops any one of them would break installment auto-charging
  // silently (cron would have null customer/PM and reject loudly per
  // migration §603, but the failure surfaces only at the buyer-facing
  // moment, not in dev).
  const finalizeCallMatch = ROUTER_SOURCE.match(
    /supabase\.rpc\(\s*"biz_ticket_checkout_finalize"\s*,\s*\{([\s\S]*?)\}\s*,?\s*\)/,
  );
  assertExists(finalizeCallMatch, "expected exactly one supabase.rpc(\"biz_ticket_checkout_finalize\", {...}) in stripeWebhookRouter.ts");
  const body = finalizeCallMatch![1];
  assertStringIncludes(body, "p_stripe_customer_id_on_connected_account: stripeCustomerId");
  assertStringIncludes(body, "p_saved_payment_method_id: savedPaymentMethodId");
  assertStringIncludes(body, "p_installment_plan_root: isInstallmentPlanRoot");
  assertStringIncludes(body, "p_qr_token_pepper: qrTokenPepper()");
});

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: webhook router has ONLY ONE finalize rpc call site (no drift via copy-paste)", () => {
  // A future "let me also call finalize from here too" would create a
  // parallel call site that almost certainly forgets one of the 3 new
  // params. Single owner = enforceable contract.
  const callSites = (ROUTER_SOURCE.match(/supabase\.rpc\(\s*"biz_ticket_checkout_finalize"/g) ?? []).length;
  assertEquals(
    callSites,
    1,
    `expected exactly 1 finalize rpc call site in stripeWebhookRouter.ts, found ${callSites}`,
  );
});

// ---------- B. Migration finalize signature + invariants ----------

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: migration DROPs the 5-arg finalize overload before CREATE OR REPLACE", () => {
  // Without DROP, the 5-arg overload (added by 20260515000016_orch_0777_qr_pepper)
  // would persist alongside the new 8-arg form. supabase.rpc() with 5 named
  // params would then resolve ambiguously (PostgreSQL picks based on
  // default-arg analysis, non-deterministic across server versions). The
  // DROP forces every caller through the new 8-arg form.
  assertMatch(
    MIGRATION_SOURCE,
    /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.biz_ticket_checkout_finalize\s*\(\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)\s*;/i,
    "migration MUST drop the 5-arg finalize overload before CREATE OR REPLACE on the 8-arg form",
  );
});

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: new finalize signature has 8 params with last 3 defaulting", () => {
  // Param names + DEFAULTs must match what stripeWebhookRouter passes.
  // A drift between TS-side keys and SQL param names would silently no-op
  // (PostgREST returns 404 for unknown named params).
  const sigMatch = MIGRATION_SOURCE.match(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.biz_ticket_checkout_finalize\s*\(([\s\S]*?)\)\s*RETURNS\s+jsonb/,
  );
  assertExists(sigMatch, "expected CREATE OR REPLACE FUNCTION biz_ticket_checkout_finalize signature");
  const sig = sigMatch![1];
  assertStringIncludes(sig, "p_checkout_session_id uuid");
  assertStringIncludes(sig, "p_stripe_payment_intent_id text");
  assertStringIncludes(sig, "p_stripe_charge_id text");
  assertStringIncludes(sig, "p_stripe_payment_method_type text");
  assertStringIncludes(sig, "p_qr_token_pepper text");
  assertStringIncludes(sig, "p_stripe_customer_id_on_connected_account text DEFAULT NULL");
  assertStringIncludes(sig, "p_saved_payment_method_id text DEFAULT NULL");
  assertStringIncludes(sig, "p_installment_plan_root boolean DEFAULT false");
});

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: finalize installment branch defensively guards against null customer or PM", () => {
  // The guard prevents silent insert of order_installments rows that the
  // cron can never charge (no saved Customer/PM means off_session PI
  // creation always fails). Removing this guard would let an
  // installment-plan-root finalize succeed with null columns, the cron
  // would then crash on every attempt with no recovery path.
  assertMatch(
    MIGRATION_SOURCE,
    /IF\s+p_stripe_customer_id_on_connected_account\s+IS\s+NULL\s+OR\s+p_saved_payment_method_id\s+IS\s+NULL\s+THEN\s*[\s\S]*?RAISE\s+EXCEPTION\s+'installment_plan_finalize_missing_customer_or_pm'/i,
    "finalize installment branch MUST raise installment_plan_finalize_missing_customer_or_pm when customer or PM is null",
  );
});

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: finalize installment branch gated on BOTH plan_root flag AND non-null schedule", () => {
  // A refactor that drops the v_schedule null-check would let an
  // installment-plan-root finalize on a session WITHOUT an installment
  // schedule succeed silently (no rows inserted, but installment_plan_root
  // would be set to true). State drift. The current AND gate prevents this.
  assertMatch(
    MIGRATION_SOURCE,
    /IF\s+p_installment_plan_root\s+AND\s+v_schedule\s+IS\s+NOT\s+NULL\s+THEN/i,
    "finalize installment-row INSERT loop MUST be gated on BOTH p_installment_plan_root AND v_schedule IS NOT NULL",
  );
});

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: orders columns populated only on installment-plan-root finalize", () => {
  // The 3 new columns must be CASE-gated on p_installment_plan_root. If a
  // future refactor passes the raw params unconditionally, non-installment
  // orders would carry the Stripe Customer + saved PM IDs, polluting the
  // schema contract (these columns are for installment-plan orders only).
  // The COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false)
  // expression guards installment_plan_root; the two CASE WHENs guard the
  // other two columns.
  assertMatch(
    MIGRATION_SOURCE,
    /COALESCE\(p_installment_plan_root\s+AND\s+v_schedule\s+IS\s+NOT\s+NULL\s*,\s*false\)/i,
    "orders.installment_plan_root must be COALESCE-gated on (p_installment_plan_root AND v_schedule IS NOT NULL)",
  );
  assertMatch(
    MIGRATION_SOURCE,
    /CASE\s+WHEN\s+p_installment_plan_root\s+THEN\s+p_stripe_customer_id_on_connected_account\s+ELSE\s+NULL\s+END/i,
    "orders.stripe_customer_id_on_connected_account must be CASE-gated on p_installment_plan_root",
  );
  assertMatch(
    MIGRATION_SOURCE,
    /CASE\s+WHEN\s+p_installment_plan_root\s+THEN\s+p_saved_payment_method_id\s+ELSE\s+NULL\s+END/i,
    "orders.saved_payment_method_id must be CASE-gated on p_installment_plan_root",
  );
});

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: self-verification probe asserts 8 params + 1 overload", () => {
  // The probe is the migration's safety net. If a future migration drops
  // the probe (or weakens it), Stage 1b's overload-uniqueness contract
  // becomes silently un-enforced. This test pins the probe.
  assertMatch(
    MIGRATION_SOURCE,
    /v_finalize_param_count\s*<>\s*8/,
    "probe MUST assert v_finalize_param_count = 8",
  );
  assertMatch(
    MIGRATION_SOURCE,
    /count\(\*\)\s+FROM\s+pg_proc\s+WHERE\s+proname\s*=\s*'biz_ticket_checkout_finalize'\)\s*<>\s*1/i,
    "probe MUST assert exactly 1 biz_ticket_checkout_finalize overload",
  );
});

// ---------- C. Cross-domain: dispatcher does NOT also call finalize ----------

Deno.test("ORCH-0869 Stage 1b ADVERSARIAL: ticket-confirmation-dispatch (Stage 1b dispatcher) does NOT touch finalize RPC", () => {
  // The dispatcher's new installment_dunning + installment_plan_paid_in_full
  // branches must NOT call finalize. Finalize is webhook-only territory.
  // If a future refactor migrates finalize logic into the dispatcher, the
  // 3-new-param contract would split across files and drift.
  const DISPATCHER_PATH = new URL(
    "../../ticket-confirmation-dispatch/index.ts",
    import.meta.url,
  );
  const dispatcherSource = Deno.readTextFileSync(DISPATCHER_PATH);
  const callCount = (dispatcherSource.match(/biz_ticket_checkout_finalize/g) ?? []).length;
  // The existing comment at line 6 mentions the legacy ORCH-0785 name —
  // that's the only allowed reference. Any actual rpc("biz_ticket_checkout_finalize")
  // would be a new violation.
  const rpcCalls = (dispatcherSource.match(/\.rpc\(\s*"biz_ticket_checkout_finalize"/g) ?? []).length;
  assertEquals(
    rpcCalls,
    0,
    `dispatcher must NOT call biz_ticket_checkout_finalize via rpc(); found ${rpcCalls} call sites`,
  );
});
