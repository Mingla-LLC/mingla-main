import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const venueId = "00000000-1473-4000-8000-000000000004";

const quoteRequest = (bearer: string): Request =>
  new Request("http://local/stay-reservations", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      action: "quote",
      payload: {
        venueId,
        idempotencyKey: `quote-key-1473-${bearer}`,
        lines: [{ kind: "room" }],
      },
    }),
  });

Deno.test("#1473 rejects the project anon key before auth or reservation RPC", async () => {
  let authenticated = false;
  let created = false;
  const response = await handleStayReservations(
    quoteRequest("test-anon-key"),
    {
      authenticateUser: () => {
        authenticated = true;
        return Promise.resolve(null);
      },
      createRpcClient: () => {
        created = true;
        throw new Error("must not create");
      },
    },
  );

  assertEquals(response.status, 401);
  assertObjectMatch(await response.json(), {
    code: "unauthorized",
    message: "Sign in to reserve this Stay.",
  });
  assertEquals(authenticated, false);
  assertEquals(created, false);
});

Deno.test("#1473 rejects a bearer that is not a verified user before reservation RPC", async () => {
  let created = false;
  const response = await handleStayReservations(
    quoteRequest("malformed-or-expired-token"),
    {
      authenticateUser: () => Promise.resolve(null),
      createRpcClient: () => {
        created = true;
        throw new Error("must not create");
      },
    },
  );

  assertEquals(response.status, 401);
  assertObjectMatch(await response.json(), {
    code: "unauthorized",
    message: "Sign in to reserve this Stay.",
  });
  assertEquals(created, false);
});

Deno.test("#1473 verified user bearer reaches the canonical reservation RPC", async () => {
  let called = false;
  const response = await handleStayReservations(
    quoteRequest("verified-user-token"),
    {
      authenticateUser: () =>
        Promise.resolve("00000000-1473-4000-8000-000000000001"),
      createRpcClient: () => ({
        rpc: () => {
          called = true;
          return Promise.resolve({
            data: {
              quoteId: "00000000-1473-4000-8000-000000000080",
              totalMinor: "12000",
            },
            error: null,
          });
        },
      }),
    },
  );

  assertEquals(response.status, 200);
  assertEquals(called, true);
});
