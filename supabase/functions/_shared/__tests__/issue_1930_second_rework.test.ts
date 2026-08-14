import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270403001930_issue_1930_checkout_current_truth.sql",
    import.meta.url,
  ),
);
const rsvpCreate = await Deno.readTextFile(
  new URL("../../rsvp-contribution-create/index.ts", import.meta.url),
);
const revocationWorker = await Deno.readTextFile(
  new URL("../../checkout-sale-revocation/index.ts", import.meta.url),
);
const stripeRouter = await Deno.readTextFile(
  new URL("../stripeWebhookRouter.ts", import.meta.url),
);
const raceSql = await Deno.readTextFile(
  new URL(
    "../../../migrations/__tests__/issue_1930_transition_races.test.sql",
    import.meta.url,
  ),
);

Deno.test("#1930 rework 2: lost RSVP commit durably adopts exact provider identity before queuing cleanup", () => {
  const commit = migration.slice(
    migration.indexOf("issue_1930_commit_rsvp_provider_attempt"),
    migration.indexOf("issue_1930_mark_rsvp_provider_unknown"),
  );
  const lostEpoch = commit.slice(
    commit.indexOf("IF v_c.admission_epoch IS DISTINCT FROM"),
    commit.indexOf("RETURN jsonb_build_object('outcome','revoked')"),
  );
  for (
    const identity of [
      "provider_object_id=COALESCE(provider_object_id,p_provider_object_id)",
      "provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id)",
      "provider_reference=COALESCE(provider_reference,p_provider_reference)",
    ]
  ) assertStringIncludes(lostEpoch, identity);
  assert(
    lostEpoch.indexOf("provider_object_id=COALESCE") <
      lostEpoch.indexOf("checkout_sale_revocation_outbox"),
    "provider identity must be adopted in the same transaction before durable cleanup is queued",
  );
  assertStringIncludes(
    revocationWorker,
    'throw new Error("provider_identity_missing")',
  );
});

Deno.test("#1930 rework 2: provider_unknown RSVP replay keeps one contribution and exact stable provider key", () => {
  assertStringIncludes(
    rsvpCreate,
    "existingContribution?.id ?? crypto.randomUUID()",
  );
  assertStringIncludes(rsvpCreate, 'claim.outcome === "provider_unknown"');
  assertStringIncludes(
    rsvpCreate,
    "idempotencyKey: stripeWebClaim.idempotencyKey",
  );
  assertStringIncludes(
    rsvpCreate,
    "idempotencyKey: stripeNativeClaim.idempotencyKey",
  );
  assertStringIncludes(rsvpCreate, "paystackVerifyTransaction(reference)");
  assertStringIncludes(rsvpCreate, 'error: "provider_outcome_unknown"');
  assert(
    !/provider_attempt_state='provider_unknown'[\s\S]{0,180}status='failed'/
      .test(
        migration,
      ),
    "unknown provider truth must stay bounded/pending instead of becoming terminal failed",
  );
});

Deno.test("#1930 rework 2: child reassignment locks old/new event authority in canonical UUID order", () => {
  const trigger = migration.slice(
    migration.indexOf("issue_1930_child_sale_revoke_trigger"),
    migration.indexOf("-- Extend the canonical source-refund vocabulary"),
  );
  assertStringIncludes(
    trigger,
    "WHERE id IN (OLD.event_id,NEW.event_id) ORDER BY id FOR UPDATE",
  );
  assertStringIncludes(trigger, "IF OLD.event_id<NEW.event_id THEN");
  assertStringIncludes(raceSql, "reassignment A-to-B/B-to-A");
});

Deno.test("#1930 rework 2: Stripe ticket late success is explicitly non-final", () => {
  assertStringIncludes(
    stripeRouter,
    'finalizeOutcome === "paid_reversal_pending"',
  );
  assertStringIncludes(
    stripeRouter,
    "ticket payment entered paid_reversal_pending",
  );
  const pendingAt = stripeRouter.indexOf(
    'finalizeOutcome === "paid_reversal_pending"',
  );
  const confirmationAt = stripeRouter.indexOf(
    "/functions/v1/ticket-confirmation-dispatch",
    pendingAt,
  );
  assert(pendingAt > 0 && confirmationAt > pendingAt);
  assertStringIncludes(
    stripeRouter.slice(pendingAt, confirmationAt),
    "return session.brand_id",
  );
});
