// issue #4420 wave 2 (D-S7) — a signed-in guest opening a Stay booking made
// for another contact gets `stay_group_other_contact` with the MASKED email
// (never the address), so the page can offer "Sign in as …".
//
// fails-on-revert: dropping the get_group branch returns the plain 403
// "forbidden" (OC-1 fails); returning the raw address fails OC-2's mask
// check; asking the lookup for a non-forbidden refusal fails OC-3.

import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const groupId = "00000000-4420-4000-8000-000000000001";

const getGroup = (
  callerError: string,
  masked: unknown,
  calls: string[],
): Promise<Response> =>
  handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ action: "get_group", payload: { groupId } }),
    }),
    {
      createRpcClient: () => ({
        rpc: () =>
          Promise.resolve({ data: null, error: { message: callerError } }),
      }),
      createServiceRpcClient: () => ({
        rpc: (name, params) => {
          calls.push(`${name}:${String(params.p_group_id)}`);
          return Promise.resolve({ data: masked, error: null });
        },
      }),
    },
  );

Deno.test("OC-1 a refused read of a real booking names its masked contact", async () => {
  const calls: string[] = [];
  const response = await getGroup("forbidden", "g•••@example.com", calls);
  assertEquals(response.status, 403);
  assertObjectMatch(await response.json(), {
    kind: "error",
    code: "stay_group_other_contact",
    maskedEmail: "g•••@example.com",
  });
  assertEquals(calls, [`issue_4420_stay_group_masked_contact:${groupId}`]);
});

Deno.test("OC-2 anything but a mask falls back to the plain refusal", async () => {
  const response = await getGroup("forbidden", "guest@example.com", []);
  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.code, "forbidden");
  assertEquals(JSON.stringify(body).includes("guest@example.com"), false);
});

Deno.test("OC-3 a missing group is still not found, with no lookup", async () => {
  const calls: string[] = [];
  const response = await getGroup("stay_group_not_found", "g•••@example.com", calls);
  assertEquals(response.status, 404);
  assertEquals((await response.json()).code, "stay_group_not_found");
  assertEquals(calls, []);
});
