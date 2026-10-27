import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createBuyerReferralLinkHandler } from "../../referral-buyer-link/index.ts";
import { createPayeeClaimHandler } from "../../payee-claim-by-email/index.ts";

const post = (body: Record<string, unknown>) =>
  new Request("https://example.test", {
    method: "POST",
    headers: {
      Authorization: "Bearer test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

Deno.test("#3872 B5 buyer link is authenticated, personal and server-slugged", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await createBuyerReferralLinkHandler({
    actor: async () => ({
      id: "00000000-0000-0000-0000-000000000001",
      email: "buyer@example.test",
      displayName: "Buyer",
    }),
    rpc: async (_name, args) => {
      calls.push(args);
      return {
        data: { url: "https://usemingla.com/r/01020304" },
        error: null,
      };
    },
    randomBytes: () => new Uint8Array([1, 2, 3, 4]),
  })(post({
    listingKind: "event",
    listingId: "00000000-0000-0000-0000-000000000009",
  }));
  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), { available: true });
  assertEquals(calls[0].p_link_slug, "01020304");
  assertEquals(calls[0].p_email, "buyer@example.test");
});

Deno.test("#3872 B5 buyer link keeps ineligible listings on the normal share rail", async () => {
  const response = await createBuyerReferralLinkHandler({
    actor: async () => ({ id: "u", email: "a@b.test", displayName: "A" }),
    rpc: async () => ({ data: null, error: null }),
    randomBytes: () => new Uint8Array([1, 2, 3, 4]),
  })(post({
    listingKind: "event",
    listingId: "00000000-0000-0000-0000-000000000009",
  }));
  assertEquals(await response.json(), { available: false });
});

Deno.test("#3872 B5 claim hashes raw token and preserves email-match failure", async () => {
  let args: Record<string, unknown> = {};
  const ok = await createPayeeClaimHandler({
    actor: async () => ({ id: "user-1", email: "guest@example.test" }),
    rpc: async (_name, input) => {
      args = input;
      return { data: { sharesClaimed: 2 }, error: null };
    },
  })(post({ token: "raw-claim-token-that-is-long-enough-1234" }));
  assertEquals(ok.status, 200);
  assertEquals(args.p_email, "guest@example.test");
  assertEquals(
    typeof args.p_token_hash === "string" &&
      /^[a-f0-9]{64}$/.test(args.p_token_hash),
    true,
  );
  assertEquals(String(args.p_token_hash).includes("raw-claim-token"), false);

  const mismatch = await createPayeeClaimHandler({
    actor: async () => ({ id: "user-1", email: "wrong@example.test" }),
    rpc: async () => ({
      data: null,
      error: { message: "claim_email_mismatch" },
    }),
  })(post({ token: "raw-claim-token-that-is-long-enough-1234" }));
  assertEquals(mismatch.status, 403);
  assertEquals((await mismatch.json()).error, "email_mismatch");
});
