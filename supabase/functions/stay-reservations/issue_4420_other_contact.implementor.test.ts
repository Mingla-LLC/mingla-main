// issue #4420 wave 2 (D-S7) — a signed-in guest opening a Stay booking made
// for another contact gets `stay_group_other_contact` with the MASKED email
// (never the address), so the page can offer "Sign in as …".
//
// fails-on-revert: dropping the get_group branch returns the plain 403
// "forbidden" (OC-1 fails); returning the raw address fails OC-2's mask
// check; asking the lookup for a non-forbidden refusal fails OC-3.
// [TEST-MOD-APPROVED #4420] the lookup is now the recovery VIEW (mask, Stay,
// brand, reference), so the page can offer "Ask … to change the email".
// RS-1..3: "Email me the booking link again" is authorised like the view and
// only ever returns the mask.

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
  const response = await getGroup("forbidden", {
    masked_email: "g•••@example.com",
    venue_name: "The Glasshouse",
    brand_slug: "glass-stay-co",
    brand_name: "Glass Stay Co",
    public_reference: "ST-4420000000000000000A",
    resendable: true,
  }, calls);
  assertEquals(response.status, 403);
  const body = await response.json();
  assertObjectMatch(body, {
    kind: "error",
    code: "stay_group_other_contact",
    maskedEmail: "g•••@example.com",
    venueName: "The Glasshouse",
    brandSlug: "glass-stay-co",
    brandName: "Glass Stay Co",
    publicReference: "ST-4420000000000000000A",
    resendable: true,
  });
  assertEquals(calls, [`issue_4420_stay_group_other_contact_view:${groupId}`]);
});

Deno.test("OC-2 anything but a mask falls back to the plain refusal", async () => {
  const response = await getGroup("forbidden", { masked_email: "guest@example.com" }, []);
  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.code, "forbidden");
  assertEquals(JSON.stringify(body).includes("guest@example.com"), false);
});

Deno.test("OC-3 a missing group is still not found, with no lookup", async () => {
  const calls: string[] = [];
  const response = await getGroup("stay_group_not_found", { masked_email: "g•••@example.com" }, calls);
  assertEquals(response.status, 404);
  assertEquals((await response.json()).code, "stay_group_not_found");
  assertEquals(calls, []);
});

const resend = (
  callerError: string | null,
  masked: unknown,
  calls: string[],
): Promise<Response> =>
  handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ action: "resend_guest_link", payload: { groupId } }),
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          calls.push(`caller:${name}:${String((params.p_action as string) ?? "")}`);
          return Promise.resolve(
            callerError === null
              ? { data: { groupId }, error: null }
              : { data: null, error: { message: callerError } },
          );
        },
      }),
      createServiceRpcClient: () => ({
        rpc: (name, params) => {
          calls.push(`service:${name}:${String(params.p_group_id)}`);
          return Promise.resolve({ data: masked, error: null });
        },
      }),
    },
  );

Deno.test("RS-1 a non-owner's resend goes through the service lookup and returns only the mask", async () => {
  const calls: string[] = [];
  const response = await resend("forbidden", "g•••@example.com", calls);
  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    kind: "success",
    data: { maskedEmail: "g•••@example.com" },
  });
  assertEquals(calls, [
    "caller:biz_manage_stay_reservation:get_group",
    `service:issue_4420_stay_group_resend_link:${groupId}`,
  ]);
});

Deno.test("RS-2 the owner, or a missing booking, never reaches the resend", async () => {
  const mine: string[] = [];
  const own = await resend(null, "g•••@example.com", mine);
  assertEquals(own.status, 409);
  assertEquals((await own.json()).code, "stay_group_already_yours");
  assertEquals(mine, ["caller:biz_manage_stay_reservation:get_group"]);
  const gone: string[] = [];
  const missing = await resend("stay_group_not_found", "g•••@example.com", gone);
  assertEquals(missing.status, 404);
  assertEquals(gone, ["caller:biz_manage_stay_reservation:get_group"]);
});

Deno.test("RS-3 nothing to resend is a plain answer, never an address", async () => {
  const response = await resend("forbidden", null, []);
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.code, "stay_resend_not_available");
  assertEquals(JSON.stringify(body).includes("@"), false);
});
