import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  "supabase/migrations/20270110000002_issue_1172_stripe_payout_execution.sql",
);
const sweep = await Deno.readTextFile(
  "supabase/functions/payout-release-sweep/index.ts",
);
const router = await Deno.readTextFile(
  "supabase/functions/_shared/stripeWebhookRouter.ts",
);
const stripeMode = await Deno.readTextFile(
  "supabase/functions/_shared/stripeMode.ts",
);
const stripe = await Deno.readTextFile(
  "supabase/functions/_shared/stripe.ts",
);

Deno.test("#1172 migration claims ledger rows transactionally and records exact amounts", () => {
  assertStringIncludes(migration, "FOR UPDATE OF r SKIP LOCKED");
  assertStringIncludes(
    migration,
    "stripe_execution_claim_id=gen_random_uuid()",
  );
  assertStringIncludes(
    migration,
    "v_expected:=v_release.net_release_cents+v_release.maturity_recredit_cents",
  );
  assertStringIncludes(
    migration,
    "p_amount_cents IS DISTINCT FROM v_expected",
  );
  assertStringIncludes(migration, "r.stripe_payout_id IS NULL");
  assertStringIncludes(migration, "r.attempt_count<10");
});

Deno.test("#1172 role and sweep are dark-gated with no partner execution", () => {
  assertStringIncludes(stripeMode, '| "PAYOUT_RELEASE"');
  assertStringIncludes(sweep, 'deps.env("PAYOUT_RELEASE_EXECUTE") !== "true"');
  assertStringIncludes(sweep, "createStripeReleasePayout");
  assertStringIncludes(stripe, "stripe.payouts.create");
  assertStringIncludes(stripe, "idempotencyKey: input.idempotencyKey");
  assert(!sweep.includes("transfers.create"));
  assert(!sweep.includes("source_transaction"));
});

Deno.test("#1172 webhook reconciles Mingla releases and preserves unknown auto payouts", () => {
  assertStringIncludes(router, '.from("brand_payout_releases")');
  assertStringIncludes(
    router,
    'initiated_by: releaseId ? "mingla_release" : "stripe_auto"',
  );
  assertStringIncludes(router, 'status: "released"');
  assertStringIncludes(router, 'status: "failed"');
  assertStringIncludes(router, "release_id: releaseId");
});
