import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");

const venueId = "00000000-1426-4000-8000-000000000011";
const groupId = "00000000-1426-4000-8000-000000000020";
const lineId = "00000000-1426-4000-8000-000000000021";
const requestId = "00000000-1426-4000-8000-000000000099";

function request(body: Record<string, unknown>): Request {
  return new Request("http://local/stay-reservations", {
    method: "POST",
    headers: {
      authorization: "Bearer staff-token",
      "x-request-id": requestId,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("Stay staff queue and inspection route only through permission-safe RPCs", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const dependencies = {
    createRpcClient: () => ({
      rpc: (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        return Promise.resolve({ data: { groups: [] }, error: null });
      },
    }),
  };

  const listResponse = await handleStayReservations(
    request({
      action: "list_staff_groups",
      payload: { venueId },
    }),
    dependencies,
  );
  const detailResponse = await handleStayReservations(
    request({
      action: "get_staff_group",
      payload: { groupId },
    }),
    dependencies,
  );

  assertEquals(listResponse.status, 200);
  assertEquals(detailResponse.status, 200);
  assertObjectMatch(calls[0], {
    name: "issue_1426_list_staff_stay_reservations",
    params: { p_venue_id: venueId },
  });
  assertObjectMatch(calls[1], {
    name: "issue_1426_staff_group_projection",
    params: { p_group_id: groupId },
  });
});

Deno.test("Stay staff approval sends one whole-group optimistic action", async () => {
  let call: { name: string; params: Record<string, unknown> } | null = null;
  let callParams: Record<string, unknown> = {};
  const response = await handleStayReservations(
    request({
      action: "approve_request",
      expectedVersion: 7,
      payload: {
        groupId,
        idempotencyKey: "staff-approve-1426",
        selectedLineIds: [lineId],
        amountMinor: "1",
      },
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          call = { name, params };
          callParams = params;
          return Promise.resolve({
            data: { groupId, state: "approved_payment_required", version: 8 },
            error: null,
          });
        },
      }),
    },
  );

  assertEquals(response.status, 200);
  assertObjectMatch(call ?? {}, {
    name: "issue_1426_manage_request",
    params: {
      p_action: "approve_request",
      p_group_id: groupId,
      p_expected_version: 7,
      p_idempotency_key: "staff-approve-1426",
      p_request_id: requestId,
    },
  });
  assertEquals(
    Object.prototype.hasOwnProperty.call(
      callParams,
      "p_selected_line_ids",
    ),
    false,
  );
});

Deno.test("Stay staff cancellation preview and commit keep exact server proof", async () => {
  const previewId = "00000000-1426-4000-8000-000000000030";
  const previewHash = "a".repeat(64);
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const dependencies = {
    createRpcClient: () => ({
      rpc: (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        return Promise.resolve({
          data: { previewId, previewHash },
          error: null,
        });
      },
    }),
  };

  const previewResponse = await handleStayReservations(
    request({
      action: "cancel_preview",
      expectedVersion: 8,
      payload: { groupId, selectedLineIds: [lineId] },
    }),
    dependencies,
  );
  const cancelResponse = await handleStayReservations(
    request({
      action: "cancel",
      payload: {
        previewId,
        previewHash,
        idempotencyKey: "staff-cancel-1426",
        reason: "Guest requested a change",
      },
    }),
    dependencies,
  );

  assertEquals(previewResponse.status, 200);
  assertEquals(cancelResponse.status, 200);
  assertObjectMatch(calls[0], {
    name: "issue_1426_cancel_preview",
    params: {
      p_group_id: groupId,
      p_selected_line_ids: [lineId],
      p_expected_group_version: 8,
      p_request_id: requestId,
    },
  });
  assertObjectMatch(calls[1], {
    name: "issue_1426_cancel",
    params: {
      p_preview_id: previewId,
      p_preview_hash: previewHash,
      p_idempotency_key: "staff-cancel-1426",
      p_reason: "Guest requested a change",
      p_request_id: requestId,
    },
  });
});
