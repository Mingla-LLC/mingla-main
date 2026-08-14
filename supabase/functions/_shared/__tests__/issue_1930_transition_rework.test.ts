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
const paystackRouter = await Deno.readTextFile(
  new URL("../paystackWebhookRouter.ts", import.meta.url),
);
const reconcile = await Deno.readTextFile(
  new URL("../../reconcile-stuck-checkouts/index.ts", import.meta.url),
);

Deno.test("#1930 transition rework: RSVP claim precedes provider I/O and commit precedes every continuation", () => {
  for (const providerCall of [
    "paystackInitializeTransaction({",
    "stripeWeb.checkout.sessions.create(",
    "stripe.paymentIntents.create(",
  ]) {
    const callAt = rsvpCreate.indexOf(providerCall);
    const claimAt = rsvpCreate.lastIndexOf(
      "claimRsvpProviderAttempt(",
      callAt,
    );
    assert(callAt > 0 && claimAt > 0 && claimAt < callAt);
  }
  for (const continuation of [
    "authorizationUrl: init.authorization_url",
    "hostedCheckoutUrl: checkoutSession.url",
    "clientSecret,",
  ]) {
    const returnAt = rsvpCreate.indexOf(continuation);
    const commitAt = rsvpCreate.lastIndexOf(
      "commitRsvpProviderAttempt(",
      returnAt,
    );
    assert(returnAt > 0 && commitAt > 0 && commitAt < returnAt);
  }
});

Deno.test("#1930 transition rework: RSVP Stripe neutralization uses exact connected account and stable key", () => {
  assertStringIncludes(revocationWorker, 'contribution.provider === "paystack"');
  assertStringIncludes(revocationWorker, "contribution.provider_attempt_key}:expire");
  assertStringIncludes(revocationWorker, "contribution.provider_attempt_key}:cancel");
  assertStringIncludes(revocationWorker, "stripeAccount: account.stripe_account_id");
  assert(!revocationWorker.includes("client_secret"));
});

Deno.test("#1930 transition rework: RSVP enablement, delete, reassignment, and capacity are database owned", () => {
  assertStringIncludes(migration, "rsvp_contribution_enabled");
  assertStringIncludes(migration, "TG_OP='DELETE'");
  assertStringIncludes(migration, "OLD.event_id IS DISTINCT FROM NEW.event_id");
  assertStringIncludes(migration, "quantity_total");
  assertStringIncludes(migration, "is_unlimited");
  assertStringIncludes(migration, "active.id<>p_session_id");
});

Deno.test("#1930 transition rework: paid reversal remains non-final on both late-success consumers", () => {
  assertStringIncludes(paystackRouter, 'return { status: "paid_reversal_pending", paidAtIso }');
  assertStringIncludes(reconcile, 'status: "paid_reversal_pending"');
  assertStringIncludes(reconcile, 'skip: "paid_reversal_pending"');
});
