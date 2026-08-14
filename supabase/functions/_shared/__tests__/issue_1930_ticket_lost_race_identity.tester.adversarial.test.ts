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
const worker = await Deno.readTextFile(
  new URL("../../checkout-sale-revocation/index.ts", import.meta.url),
);

Deno.test("#1930 tester: ticket CAS loss durably adopts the returned provider identity before cleanup", () => {
  const commitFunction = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.issue_1930_commit_ticket_provider_attempt",
    ),
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.issue_1930_mark_ticket_provider_unknown",
    ),
  );
  const lostRace = commitFunction.slice(
    commitFunction.indexOf("IF v_attempt.claimed_epoch"),
    commitFunction.indexOf("RETURN jsonb_build_object('outcome','revoked');"),
  );

  assertStringIncludes(
    lostRace,
    "provider_object_id=COALESCE(provider_object_id,p_provider_object_id)",
  );
  assertStringIncludes(
    lostRace,
    "provider_checkout_id=COALESCE(provider_checkout_id,p_provider_checkout_id)",
  );
  assertStringIncludes(
    lostRace,
    "provider_reference=COALESCE(provider_reference,p_provider_reference)",
  );
  assert(
    lostRace.indexOf("provider_object_id=COALESCE") <
      lostRace.indexOf("INSERT INTO public.checkout_sale_revocation_outbox"),
    "the exact returned identity must be durable before cleanup is enqueued",
  );
});

Deno.test("#1930 tester: identity-less Stripe ticket cleanup remains retryable instead of falsely neutralized", () => {
  const ticketBranch = worker.slice(
    worker.indexOf("const { data: session }"),
    worker.indexOf("} catch (caught)"),
  );

  assertStringIncludes(ticketBranch, "provider_identity_missing");
  assert(
    /else\s*\{\s*throw new Error\("provider_identity_missing"\);\s*\}/s.test(
      ticketBranch,
    ),
    "a Stripe ticket attempt without an adopted provider identity must fail retryably",
  );
});
