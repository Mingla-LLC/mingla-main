import {
  assert,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  createAccountSession,
  createRecipientAccount,
} from "../stripeBlueprintClient.ts";

// ORCH-1056: with the mode helper in place, the resolver throws on the
// suffixed env var (STRIPE_RAK_ONBOARD_TEST) when MINGLA_STRIPE_MODE=test
// and that var is unset. Original ORCH-0953 invariant — "no
// STRIPE_SECRET_KEY fallback ever" — still holds.

Deno.test("ORCH-0953 §3.1 — onboarding blueprint client requires per-role RAK without STRIPE_SECRET_KEY fallback (ORCH-1056 amended)", async () => {
  const priorRak = Deno.env.get("STRIPE_RAK_ONBOARD");
  const priorRakTest = Deno.env.get("STRIPE_RAK_ONBOARD_TEST");
  const priorMode = Deno.env.get("MINGLA_STRIPE_MODE");
  const priorSecret = Deno.env.get("STRIPE_SECRET_KEY");
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "test");
    Deno.env.delete("STRIPE_RAK_ONBOARD");
    Deno.env.delete("STRIPE_RAK_ONBOARD_TEST");
    Deno.env.set("STRIPE_SECRET_KEY", "sk_test_should_not_be_used");
    const priorFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("fallback_fetch_called");
    }) as typeof fetch;

    try {
      const error = await assertRejects(
        () =>
          createRecipientAccount({
            displayName: "Fail Close Brand",
            contactEmail: "failclose@example.com",
            country: "US",
            idempotencyKey: "orch-0953-failclose",
          }),
        Error,
        "STRIPE_RAK_ONBOARD_TEST",
      );
      assert(
        !error.message.includes("STRIPE_SECRET_KEY"),
        "fail-close error must not advertise or attempt STRIPE_SECRET_KEY fallback",
      );
      assert(
        !fetchCalled,
        "request must fail before any Stripe fetch can use fallback key",
      );
    } finally {
      globalThis.fetch = priorFetch;
    }
  } finally {
    if (priorRak === undefined) Deno.env.delete("STRIPE_RAK_ONBOARD");
    else Deno.env.set("STRIPE_RAK_ONBOARD", priorRak);
    if (priorRakTest === undefined) Deno.env.delete("STRIPE_RAK_ONBOARD_TEST");
    else Deno.env.set("STRIPE_RAK_ONBOARD_TEST", priorRakTest);
    if (priorMode === undefined) Deno.env.delete("MINGLA_STRIPE_MODE");
    else Deno.env.set("MINGLA_STRIPE_MODE", priorMode);
    if (priorSecret === undefined) Deno.env.delete("STRIPE_SECRET_KEY");
    else Deno.env.set("STRIPE_SECRET_KEY", priorSecret);
  }
});

Deno.test("ORCH-0954 — account sessions require per-role RAK without STRIPE_SECRET_KEY fallback (ORCH-1056 amended)", async () => {
  const priorRak = Deno.env.get("STRIPE_RAK_ONBOARD");
  const priorRakTest = Deno.env.get("STRIPE_RAK_ONBOARD_TEST");
  const priorMode = Deno.env.get("MINGLA_STRIPE_MODE");
  const priorSecret = Deno.env.get("STRIPE_SECRET_KEY");
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "test");
    Deno.env.delete("STRIPE_RAK_ONBOARD");
    Deno.env.delete("STRIPE_RAK_ONBOARD_TEST");
    Deno.env.set("STRIPE_SECRET_KEY", "sk_test_should_not_be_used");
    const priorFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("fallback_fetch_called");
    }) as typeof fetch;

    try {
      const error = await assertRejects(
        () =>
          createAccountSession({
            accountId: "acct_failclose",
            components: {
              account_onboarding: { enabled: true },
            },
            idempotencyKey: "orch-0954-account-session-failclose",
          }),
        Error,
        "STRIPE_RAK_ONBOARD_TEST",
      );
      assert(
        !error.message.includes("STRIPE_SECRET_KEY"),
        "account-session fail-close error must not advertise or attempt STRIPE_SECRET_KEY fallback",
      );
      assert(
        !fetchCalled,
        "account-session request must fail before any Stripe fetch can use fallback key",
      );
    } finally {
      globalThis.fetch = priorFetch;
    }
  } finally {
    if (priorRak === undefined) Deno.env.delete("STRIPE_RAK_ONBOARD");
    else Deno.env.set("STRIPE_RAK_ONBOARD", priorRak);
    if (priorRakTest === undefined) Deno.env.delete("STRIPE_RAK_ONBOARD_TEST");
    else Deno.env.set("STRIPE_RAK_ONBOARD_TEST", priorRakTest);
    if (priorMode === undefined) Deno.env.delete("MINGLA_STRIPE_MODE");
    else Deno.env.set("MINGLA_STRIPE_MODE", priorMode);
    if (priorSecret === undefined) Deno.env.delete("STRIPE_SECRET_KEY");
    else Deno.env.set("STRIPE_SECRET_KEY", priorSecret);
  }
});
