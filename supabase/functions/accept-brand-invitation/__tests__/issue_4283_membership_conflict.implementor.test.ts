// Issue #4283 — a unique-key clash in the accept RPC is a named 409, never a
// generic 500 `server` (which the Business app showed as "Couldn't reach
// Mingla"). Fails if the 23505 case is removed from mapRpcError.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check \
//   supabase/functions/accept-brand-invitation/__tests__/issue_4283_membership_conflict.implementor.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler, mapRpcError, mapRpcMessage } from "../index.ts";

Deno.test("#4283 mapRpcError — 23505 → 409 invite_membership_conflict", () => {
  assertEquals(
    mapRpcError(
      "23505",
      'duplicate key value violates unique constraint "idx_brand_team_members_brand_user_active"',
    ),
    { status: 409, error: "invite_membership_conflict" },
  );
  assertEquals(mapRpcError("23505"), {
    status: 409,
    error: "invite_membership_conflict",
  });
});

Deno.test("#4283 the duplicate-key message alone is not mistaken for an invite state", () => {
  assertEquals(
    mapRpcMessage(
      'duplicate key value violates unique constraint "idx_brand_team_members_brand_user_active"',
    ),
    null,
  );
});

Deno.test("#4283 never maps a serialization failure (40001) as the conflict", () => {
  assertEquals(mapRpcError("40001"), null);
});

// Through the real handler, network stubbed: PostgREST answers the accept RPC
// with the 23505 production logged on 2026-11-05. The client gets the named
// 409, and the server log still carries the code and message.
Deno.test("#4283 handler: 23505 answers 409 and still logs the rpc failure", async () => {
  const userId = "00000000-4283-4000-8000-000000000001";
  const dupMessage =
    'duplicate key value violates unique constraint "idx_brand_team_members_brand_user_active"';
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const logged: unknown[][] = [];
  Deno.env.set("SUPABASE_URL", "https://issue-4283.example.test");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key-not-real");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-not-real");
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
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
    if (url.includes("/rest/v1/rpc/accept_invite_and_transfer_brand_ownership")) {
      return reply(
        { code: "23505", message: dupMessage, details: null, hint: null },
        409,
      );
    }
    return reply({ message: `unexpected request in test: ${url}` }, 599);
  }) as typeof fetch;
  let res: Response;
  try {
    res = await handler(
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
    console.error = realError;
  }
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "invite_membership_conflict");
  const rpcLog = logged.find((args) =>
    args[0] === "[accept-brand-invitation] rpc failed"
  );
  assertEquals(rpcLog?.[1], "23505");
  assertEquals(rpcLog?.[2], dupMessage);
});
