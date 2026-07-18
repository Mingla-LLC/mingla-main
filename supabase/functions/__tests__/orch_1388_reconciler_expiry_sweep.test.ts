// ORCH-1388 [checkout-session honest expiry] — source-contract tests over the
// reconcile-stuck-checkouts sweep (SPEC §9 implementor side, R-1..R-8), in the
// established `Deno.readTextFile` needle convention of
// orch_1188_reconcile_pdf_backfill.test.ts.
//
// Run locally (from repo root):
//   deno test --allow-read supabase/functions/__tests__/orch_1388_reconciler_expiry_sweep.test.ts
//
// These FAIL on a TRUE LINE-DELETION of the ORCH-1388 fix (reverting index.ts
// to its pre-1388 shape and deleting classify.ts reds R-1..R-6; reverting the
// config/migration fold-ins reds R-7).
//
// Append-only: NEW file; no existing test modified.

import { assert } from "jsr:@std/assert@1";

const reconcile = await Deno.readTextFile(
  "supabase/functions/reconcile-stuck-checkouts/index.ts",
);
const classifySrc = await Deno.readTextFile(
  "supabase/functions/reconcile-stuck-checkouts/classify.ts",
);
const configToml = await Deno.readTextFile("supabase/config.toml");
const cronMigration = await Deno.readTextFile(
  "supabase/migrations/20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql",
);
const webhookRouter = await Deno.readTextFile(
  "supabase/functions/_shared/stripeWebhookRouter.ts",
);

function has(src: string, needle: string, why: string) {
  assert(src.includes(needle), `must contain \`${needle}\` (${why})`);
}

function lacks(src: string, needle: string, why: string) {
  assert(!src.includes(needle), `must NOT contain \`${needle}\` (${why})`);
}

// ── R-1: widened sweep select ────────────────────────────────────────────────
Deno.test("R-1 — select sweeps the WHOLE in-flight strand family, capped", () => {
  has(
    reconcile,
    '.in("status"',
    "ruling 3: the sweep covers all four in-flight statuses, not one",
  );
  for (
    const status of [
      '"processing_payment"',
      '"awaiting_web_redirect"',
      '"requires_payment"',
      '"pending_free"',
    ]
  ) {
    has(
      reconcile,
      status,
      "every in-flight status can strand past-expiry and must be swept",
    );
  }
  lacks(
    reconcile,
    '.eq("status", "processing_payment")',
    "the old single-status select was the F-1 predicate gap — it must be gone",
  );
  lacks(
    reconcile,
    '.not("stripe_payment_intent_id", "is", null)',
    "no-ref rows (pending_free / pre-mint requires_payment) are in scope now",
  );
  has(
    reconcile,
    "SWEEP_BATCH_LIMIT",
    "capped batch per dispatch — bounded work per run",
  );
  has(reconcile, ".limit(", "the cap must actually be applied to the select");
  has(
    reconcile,
    '.order("created_at", { ascending: true })',
    "oldest-first so a backlog drains deterministically across runs",
  );
});

// ── R-2: the honest terminal write shape ─────────────────────────────────────
Deno.test("R-2 — the expire write stamps the full ORCH-0829-B terminal shape", () => {
  has(
    reconcile,
    'status: "expired"',
    "ruling 2: reuse the existing `expired` terminal — zero migration",
  );
  has(
    reconcile,
    "failed_at",
    "0829-B shape: terminal rows carry the failure timestamp",
  );
  has(
    reconcile,
    'failure_reason: "abandoned_past_expiry"',
    "honest machine-readable reason, snake_case per sibling convention",
  );
});

// ── R-3: CAS guards, all present on the SAME update chain ────────────────────
Deno.test("R-3 — the expiry UPDATE is a guarded compare-and-swap with rowcount verification", () => {
  const writeIdx = reconcile.indexOf('status: "expired"');
  assert(writeIdx > 0, "the expire write must exist");
  // The whole guarded chain lives within the update statement following the
  // payload — inspect that window.
  const chain = reconcile.slice(writeIdx, writeIdx + 700);
  has(
    chain,
    '.eq("status", snapshotStatus)',
    "CAS on the status read THIS run — a concurrent transition makes it 0-row",
  );
  has(
    chain,
    '.lt("expires_at", nowIso)',
    "cutoff re-checked server-side at write time; NULL never matches — fail-safe",
  );
  has(
    chain,
    '.is("order_id", null)',
    "belt-and-suspenders: a finalized row can never be expired even if status raced",
  );
  has(
    chain,
    '.select("id")',
    "I-PROPOSED-I: rowcount-verified mutation — the write must prove it wrote",
  );
});

// ── R-4: the never-expire protect set is enforced ────────────────────────────
Deno.test("R-4 — the protect set (processing/requires_action/requires_capture) exists in the classify partition", () => {
  has(
    classifySrc,
    "NEVER_EXPIRE_PI_STATUSES",
    "the protect set must be a named, testable constant",
  );
  const setIdx = classifySrc.indexOf("NEVER_EXPIRE_PI_STATUSES");
  const setBlock = classifySrc.slice(setIdx, setIdx + 400);
  for (
    const status of ['"processing"', '"requires_action"', '"requires_capture"']
  ) {
    has(
      setBlock,
      status,
      "Stripe says money may still move in this status — expiring could strand a real payment (SC-4)",
    );
  }
});

// ── R-5: raced 0-row outcome is a skip, not an error ─────────────────────────
Deno.test("R-5 — a raced (0-row) CAS outcome is counted as skip, never error", () => {
  has(
    reconcile,
    'skip: "raced"',
    "SC-11: losing the race to a concurrent finalize is a benign outcome",
  );
  // The 0-row branch must lead to the raced skip with NO error push in
  // between: slice from the rowcount test to the raced push and prove the
  // branch body is error-free.
  const zeroRowIdx = reconcile.indexOf("length === 0");
  assert(zeroRowIdx > 0, "the rowcount-0 branch must exist");
  const racedIdx = reconcile.indexOf('skip: "raced"', zeroRowIdx);
  assert(
    racedIdx > zeroRowIdx && racedIdx - zeroRowIdx < 500,
    "the raced skip must be pushed inside the rowcount-0 branch",
  );
  const branchBody = reconcile.slice(zeroRowIdx, racedIdx);
  assert(
    !branchBody.includes("error:"),
    "the raced branch must not push an error entry — raced is not a failure",
  );
});

// ── R-6 (ruling 4): ZERO Stripe mutations; every retrieve annotated ──────────
Deno.test("R-6 — the reconciler + classify contain NO mutating Stripe call", () => {
  const mutationRegex =
    /stripe\.\w+(\.\w+)*\.(cancel|update|confirm|create|capture)\(/;
  assert(
    !mutationRegex.test(reconcile),
    "ruling 4: DB-only honesty — the sweep must never cancel/update/confirm/create/capture on Stripe",
  );
  assert(
    !mutationRegex.test(classifySrc),
    "classify.ts is PURE — it must not even reference a Stripe mutation",
  );
});

Deno.test("R-6b — every Stripe retrieve call site carries the read-only allow annotation", () => {
  const lines = reconcile.split("\n");
  const tag = "orch-strict-grep-allow stripe-no-idempotency-key";
  let retrieveSites = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/\.retrieve\(/.test(lines[i])) continue;
    retrieveSites += 1;
    const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
    assert(
      context.includes(tag),
      `retrieve at line ${
        i + 1
      } must carry the \`${tag}\` annotation within 5 lines above (read-only GETs need no idempotency key, but the gate must see the explicit claim)`,
    );
  }
  assert(
    retrieveSites >= 3,
    "expected at least the PI retrieve pair, the CS retrieve, and the CS-resolved PI retrieve",
  );
});

// ── R-7: the two fold-ins ────────────────────────────────────────────────────
Deno.test("R-7 — config.toml carries the explicit reconcile stanza (D-C)", () => {
  has(
    configToml,
    "[functions.reconcile-stuck-checkouts]",
    "the fn must not run on an implicit platform default",
  );
  const stanzaIdx = configToml.indexOf("[functions.reconcile-stuck-checkouts]");
  const stanza = configToml.slice(stanzaIdx, stanzaIdx + 200);
  has(
    stanza,
    "verify_jwt = true",
    "documents the CURRENT live posture (cron's service-role bearer is a valid JWT) with zero behavior delta",
  );
});

Deno.test("R-7b — the 1187 cron migration no longer overpromises, SQL probes intact (D-D)", () => {
  assert(
    !/ANY\s+future\s+stuck\s+session/.test(cronMigration),
    "the 'ANY future stuck session auto-recovers' overpromise misled monitoring for weeks (F-6) — it must stay gone",
  );
  has(
    cronMigration,
    "cron.schedule",
    "comment-only edit: the schedule call must remain byte-identical",
  );
  has(
    cronMigration,
    "*/15 * * * *",
    "comment-only edit: the */15 cadence must remain byte-identical",
  );
  has(
    cronMigration,
    "orch_1187_reconcile_stuck_checkouts",
    "comment-only edit: the job name must remain byte-identical",
  );
});

Deno.test("R-7c — the fn header no longer claims to be a one-shot backfill", () => {
  assert(
    !/one-shot reconciliation/.test(reconcile),
    "D-D half 1: the ORCH-0849 one-shot framing is stale — this is the permanent two-branch */15 net",
  );
  has(
    reconcile,
    "ORCH-1388",
    "the header must reference the ORCH that defined the two-branch contract",
  );
});

// ── R-8: the keystone — late payment still finalizes after expiry ────────────
Deno.test("R-8 — webhook session lookup has NO status filter (an `expired` session receiving payment_intent.succeeded must still finalize to paid_completed)", () => {
  // Anchor inside handleTicketCheckoutPaymentIntent — other handlers in this
  // file also look rows up by PI id on other tables.
  const fnIdx = webhookRouter.indexOf(
    "async function handleTicketCheckoutPaymentIntent",
  );
  assert(fnIdx > 0, "the ticket-checkout PI webhook handler must exist");
  const fromIdx = webhookRouter.indexOf(
    '.from("ticket_checkout_sessions")',
    fnIdx,
  );
  assert(
    fromIdx > fnIdx,
    "the handler must read from ticket_checkout_sessions",
  );
  const eqPiIdx = webhookRouter.indexOf(
    '.eq("stripe_payment_intent_id"',
    fromIdx,
  );
  assert(
    eqPiIdx > fromIdx,
    "the webhook must look ticket-checkout sessions up by PI id",
  );
  const between = webhookRouter.slice(fromIdx, eqPiIdx);
  assert(
    !between.includes('.eq("status"'),
    "LOAD-BEARING (SPEC §1 keystone / SC-15): a status filter here would strand late payments on sweep-expired sessions — money paid, order never minted. DO NOT add one.",
  );
});

Deno.test("R-8b — the Paystack guard (pi_ prefix check) is present in the classify partition", () => {
  has(
    classifySrc,
    'startsWith("pi_")',
    "a `mingla_*` Paystack reference is NOT a Stripe id — sending it to a Stripe retrieve would error every run (T-A3)",
  );
  has(
    classifySrc,
    '"paystack_unverified"',
    "OQ-A bound default: never expire what the sweep cannot verify",
  );
});
