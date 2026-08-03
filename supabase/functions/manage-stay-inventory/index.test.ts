import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleManageStayInventory } from "./index.ts";

const venueId = "00000000-1387-4000-8000-000000000004";
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");

Deno.test("requires a bearer token before creating a client", async () => {
  let created = false;
  const response = await handleManageStayInventory(
    new Request("http://local/manage-stay-inventory", {
      method: "POST",
      body: JSON.stringify({ action: "get", venueId }),
    }),
    {
      createRpcClient: () => {
        created = true;
        throw new Error("must not create");
      },
    },
  );
  assertEquals(response.status, 401);
  assertEquals(created, false);
});

Deno.test("forwards the canonical action envelope to the single RPC", async () => {
  let call: { name: string; params: Record<string, unknown> } | null = null;
  const response = await handleManageStayInventory(
    new Request("http://local/manage-stay-inventory", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "x-request-id": "00000000-1387-4000-8000-000000000099",
      },
      body: JSON.stringify({
        action: "bulk_create",
        venueId,
        payload: {
          idempotencyKey: "bulk-1",
          items: [{ kind: "room", name: "Suite" }],
        },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          call = { name, params };
          return Promise.resolve({
            data: { job: { status: "completed" } },
            error: null,
          });
        },
      }),
    },
  );
  assertEquals(response.status, 200);
  assertObjectMatch(call ?? {}, {
    name: "biz_manage_stay_inventory",
    params: {
      p_action: "bulk_create",
      p_venue_id: venueId,
      p_expected_version: null,
      p_request_id: "00000000-1387-4000-8000-000000000099",
    },
  });
  assertObjectMatch(await response.json(), { kind: "success" });
});

Deno.test("maps optimistic conflicts without leaking database details", async () => {
  const response = await handleManageStayInventory(
    new Request("http://local/manage-stay-inventory", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({
        action: "update_offering",
        venueId,
        expectedVersion: 2,
        payload: {
          offeringId: "00000000-1387-4000-8000-000000000005",
          name: "Suite",
        },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "40001",
              message: "stay_version_conflict sensitive detail",
            },
          }),
      }),
    },
  );
  const body = await response.json();
  assertEquals(response.status, 409);
  assertEquals(body.code, "stay_version_conflict");
  assertEquals(JSON.stringify(body).includes("sensitive detail"), false);
});

Deno.test("routes property settings through the v2 authoring RPC", async () => {
  let call: { name: string; params: Record<string, unknown> } | null = null;
  const response = await handleManageStayInventory(
    new Request("http://local/manage-stay-inventory", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({
        action: "save_settings",
        venueId,
        expectedVersion: 3,
        payload: {
          propertyKind: "resort",
          summary: "A complete waterfront Stay property summary.",
          timezone: "Africa/Lagos",
          defaultBookingMode: "request",
          checkInTime: "15:00",
          checkOutTime: "11:00",
          amenities: ["Pool"],
        },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          call = { name, params };
          return Promise.resolve({
            data: { inventory: { settings: { version: 4 } } },
            error: null,
          });
        },
      }),
    },
  );
  assertEquals(response.status, 200);
  assertObjectMatch(call ?? {}, {
    name: "biz_save_stay_settings_v2",
    params: {
      p_venue_id: venueId,
      p_expected_version: 3,
    },
  });
});

Deno.test("routes publish through its guarded RPC and never the generic action", async () => {
  let call: { name: string; params: Record<string, unknown> } | null = null;
  const response = await handleManageStayInventory(
    new Request("http://local/manage-stay-inventory", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "x-request-id": "00000000-1424-4000-8000-000000000099",
      },
      body: JSON.stringify({
        action: "publish_stay",
        venueId,
        expectedVersion: 7,
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          call = { name, params };
          return Promise.resolve({
            data: { inventory: { settings: { version: 8 } } },
            error: null,
          });
        },
      }),
    },
  );
  assertEquals(response.status, 200);
  assertObjectMatch(call ?? {}, {
    name: "biz_publish_stay",
    params: {
      p_venue_id: venueId,
      p_expected_version: 7,
      p_request_id: "00000000-1424-4000-8000-000000000099",
    },
  });
});

Deno.test("publish requires a positive optimistic version before any RPC", async () => {
  let created = false;
  const response = await handleManageStayInventory(
    new Request("http://local/manage-stay-inventory", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({
        action: "publish_stay",
        venueId,
        expectedVersion: 0,
      }),
    }),
    {
      createRpcClient: () => {
        created = true;
        throw new Error("must not create");
      },
    },
  );
  assertEquals(response.status, 422);
  assertEquals(created, false);
});
