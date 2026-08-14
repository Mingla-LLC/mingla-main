import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkoutUnavailableResponse,
  claimTicketProviderAttempt,
  commitTicketProviderAttempt,
  ticketCheckoutPreflight,
} from "../checkoutSaleTruth.ts";

Deno.test("#1930 claim/commit pass only bounded identities to service RPCs", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return name.includes("claim")
        ? Promise.resolve({
          data: { outcome: "fresh_claim", attemptId: "a", epoch: 3 },
          error: null,
        })
        : Promise.resolve({ data: { outcome: "ready" }, error: null });
    },
  };
  const claim = await claimTicketProviderAttempt(client, {
    checkoutSessionId: "s",
    eventId: "e",
    provider: "stripe",
    flow: "stripe_native",
    requestFingerprint: "fp",
  });
  assertEquals(claim.outcome, "fresh_claim");
  assertEquals(
    await commitTicketProviderAttempt(client, {
      attemptId: "a",
      claimedEpoch: 3,
      providerObjectId: "pi_safe",
      continuationFingerprint: "secret-hash-only",
    }),
    "ready",
  );
  assertEquals(calls[1].args.p_continuation_fingerprint, "secret-hash-only");
  assertEquals("client_secret" in calls[1].args, false);
});

Deno.test("#1930 preflight fails closed and never returns provider identity", async () => {
  const unavailable = await ticketCheckoutPreflight(
    { rpc: () => Promise.resolve({ data: null, error: new Error("down") }) },
    { checkoutSessionId: "s", buyerStatusTokenHash: "hash" },
  );
  assertEquals(unavailable, "unavailable");
  assertEquals(checkoutUnavailableResponse(), {
    error: "checkout_unavailable",
    message: "This sale is no longer available.",
  });
  await assertRejects(
    () =>
      claimTicketProviderAttempt(
        {
          rpc: () => Promise.resolve({ data: null, error: new Error("down") }),
        },
        {
          checkoutSessionId: "s",
          eventId: "e",
          provider: "paystack",
          flow: "paystack_redirect",
          requestFingerprint: "fp",
        },
      ),
    Error,
    "checkout_admission_unavailable",
  );
});
