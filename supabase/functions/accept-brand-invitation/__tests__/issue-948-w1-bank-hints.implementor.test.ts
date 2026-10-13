/**
 * #948 W1 implementor happy-path edge contract.
 *
 * Executes the real response builder and pins the real best-effort brand
 * projection. Removing either half breaks the client-routing contract.
 *
 * Run:
 *   deno test --allow-env --allow-net --allow-read --no-check \
 *     supabase/functions/accept-brand-invitation/__tests__/issue-948-w1-bank-hints.implementor.test.ts
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildAcceptResponse } from "../index.ts";

Deno.test("#948 W1 response includes fail-safe bank-routing hints", () => {
  const response = buildAcceptResponse(
    {
      brand_id: "2b7c2c59-b89f-4e77-a548-caa584b3466d",
      role: "brand_owner",
      transferred: true,
    },
    {
      brandSlug: "fig-and-vine",
      newOwnerFirstName: "Seth",
      countryCode: "NG",
      paymentProvider: "paystack",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: true,
      paystackSubaccountCode: "ACCT_partner_123",
    },
  );

  assertEquals(response.country_code, "NG");
  assertEquals(response.payment_provider, "paystack");
  assertEquals(response.stripe_charges_enabled, false);
  assertEquals(response.stripe_payouts_enabled, true);
  assertEquals(response.paystack_subaccount_code, "ACCT_partner_123");
});

Deno.test("#948 W1 edge reads every existing brand hint column", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );

  assertStringIncludes(
    source,
    "name, slug, partner_setup, country_code, payment_provider, stripe_charges_enabled, stripe_payouts_enabled, paystack_subaccount_code, stripe_connect_id",
  );
});

// ---------------------------------------------------------------------------
// Issue #3259 — a rightful invitee on the wrong account was shown "Invitation
// not found": the accept RPC raised invite_email_mismatch with ERRCODE P0001
// and the code was mapped before the message was read. Appended HERE because
// this is the file CI runs for supabase/functions/accept-brand-invitation/**.
// ---------------------------------------------------------------------------
import { handler, mapRpcError, mapRpcMessage } from "../index.ts";

Deno.test("#3259 P0001 carrying invite_email_mismatch maps to 403, not 404 not-found", () => {
  assertEquals(mapRpcError("P0001", "invite_email_mismatch"), {
    status: 403,
    error: "invite_email_mismatch",
  });
});

Deno.test("#3259 P0001 stays invite_not_found only when the message says so or is absent", () => {
  const notFound = { status: 404, error: "invite_not_found" };
  assertEquals(mapRpcError("P0001", "invite_not_found"), notFound);
  assertEquals(mapRpcError("P0001"), notFound);
  assertEquals(mapRpcError("P0001", ""), notFound);
});

Deno.test("#3259 an unrelated P0001 raise is not reported as invitation-not-found", () => {
  // P0001 is Postgres's default RAISE EXCEPTION code; a trigger refusal inside
  // the accept transaction must not tell the invitee their link is invalid.
  assertEquals(mapRpcError("P0001", "ACTIVE_CHECKOUTS_BLOCK_OWNER_TRANSFER"), null);
  assertEquals(mapRpcMessage("ACTIVE_CHECKOUTS_BLOCK_OWNER_TRANSFER"), null);
});

Deno.test("#3259 the proper codes are unchanged, whatever the message", () => {
  assertEquals(mapRpcError("P0004", "invite_email_mismatch"), {
    status: 403,
    error: "invite_email_mismatch",
  });
  assertEquals(mapRpcError("P0003", "invite_expired"), {
    status: 410,
    error: "invite_expired",
  });
  assertEquals(mapRpcMessage("invite_declined"), {
    status: 410,
    error: "invite_declined",
  });
});

// End to end through the real handler: only the network is stubbed. PostgREST
// answers the accept RPC exactly as production did on 2026-10-13.
async function acceptWithRpcError(
  rpcError: { code: string; message: string },
  // What the brand_invitations email lookup answers; undefined = it fails.
  invitedEmailReply?: { email: string } | null,
): Promise<Response> {
  const userId = "00000000-3259-4000-8000-000000000001";
  const realFetch = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", "https://issue-3259.example.test");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key-not-real");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-not-real");
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const reply = (body: unknown, status: number) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    if (url.includes("/auth/v1/user")) {
      return reply(
        { id: userId, aud: "authenticated", email: "signed-in@example.test" },
        200,
      );
    }
    if (url.includes("/rest/v1/creator_accounts")) {
      return reply({ id: userId }, 200);
    }
    if (
      url.includes("/rest/v1/rpc/accept_invite_and_transfer_brand_ownership")
    ) {
      return reply({ ...rpcError, details: null, hint: null }, 400);
    }
    if (url.includes("/rest/v1/brand_invitations")) {
      return invitedEmailReply === undefined
        ? reply({ message: "lookup failed in test" }, 500)
        : reply(invitedEmailReply, 200);
    }
    return reply({ message: `unexpected request in test: ${url}` }, 599);
  }) as typeof fetch;
  try {
    return await handler(
      new Request("http://local/accept-brand-invitation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer fake.jwt.token",
        },
        body: JSON.stringify({ token: "t".repeat(40) }),
      }),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test("#3259 handler: RPC mismatch raised as P0001 answers 403 invite_email_mismatch", async () => {
  const res = await acceptWithRpcError({
    code: "P0001",
    message: "invite_email_mismatch",
  });
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "invite_email_mismatch");
});

Deno.test("#3259 handler: RPC mismatch raised as P0004 answers 403 invite_email_mismatch", async () => {
  const res = await acceptWithRpcError({
    code: "P0004",
    message: "invite_email_mismatch",
  });
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "invite_email_mismatch");
});

Deno.test("#3259 handler: a real unknown token still answers 404 invite_not_found", async () => {
  const res = await acceptWithRpcError({
    code: "P0001",
    message: "invite_not_found",
  });
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "invite_not_found");
});

Deno.test("#3259 handler: an unrelated P0001 raise answers 500 server, not not-found", async () => {
  const res = await acceptWithRpcError({
    code: "P0001",
    message: "ACTIVE_CHECKOUTS_BLOCK_OWNER_TRANSFER",
  });
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "server");
});

Deno.test("#3259 handler: the mismatch 403 names the invited email for a token holder", async () => {
  const res = await acceptWithRpcError(
    { code: "P0004", message: "invite_email_mismatch" },
    { email: " Owner@Brand.test " },
  );
  assertEquals(res.status, 403);
  assertEquals(await res.json(), {
    error: "invite_email_mismatch",
    invited_email: "owner@brand.test",
  });
});

Deno.test("#3259 handler: a failed invited-email lookup still answers 403, with no address", async () => {
  const res = await acceptWithRpcError({
    code: "P0004",
    message: "invite_email_mismatch",
  });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), {
    error: "invite_email_mismatch",
    invited_email: null,
  });
});

Deno.test("#3259 handler: no other refusal discloses the invited email", async () => {
  const res = await acceptWithRpcError(
    { code: "P0003", message: "invite_expired" },
    { email: "owner@brand.test" },
  );
  assertEquals(res.status, 410);
  assertEquals(await res.json(), { error: "invite_expired" });
});
