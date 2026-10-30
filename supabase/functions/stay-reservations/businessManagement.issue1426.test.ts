import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("BUSINESS_WEB_ORIGIN", "https://business.example.test");

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
    name: "issue_4188_cancel_preview",
    params: {
      p_group_id: groupId,
      p_selected_line_ids: [lineId],
      p_expected_group_version: 8,
      p_request_id: requestId,
    },
  });
  assertObjectMatch(calls[1], {
    name: "issue_4188_cancel",
    params: {
      p_preview_id: previewId,
      p_preview_hash: previewHash,
      p_idempotency_key: "staff-cancel-1426",
      p_reason: "Guest requested a change",
      p_request_id: requestId,
    },
  });
});

Deno.test("Stay staff property creation forwards explicit collection truth", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const response = await handleStayReservations(
    request({
      action: "create_staff_group",
      expectedVersion: 3,
      payload: {
        quoteId: "00000000-4188-4000-8000-000000000080",
        idempotencyKey: "staff-create-group-4188",
        source: "phone",
        paymentMethod: "property",
        sendEmail: false,
        sendSms: false,
        guest: {
          name: "Nia Front Desk",
          email: "nia@example.test",
        },
      },
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          calls.push({ name, params });
          return Promise.resolve({
            data: {
              groupId,
              state: "confirmed",
              paymentCollection: "property",
            },
            error: null,
          });
        },
      }),
    },
  );

  assertEquals(response.status, 200);
  assertEquals(calls.length, 1);
  assertObjectMatch(calls[0], {
    name: "issue_4188_create_staff_stay_group",
    params: {
      p_quote_id: "00000000-4188-4000-8000-000000000080",
      p_idempotency_key: "staff-create-group-4188",
      p_source: "phone",
      p_expected_quote_version: 3,
      p_payment_method: "property",
      p_token_hash: null,
      p_send_email: false,
      p_send_sms: false,
      p_link_expires_at: null,
      p_request_id: requestId,
    },
  });
});

Deno.test("Stay staff payment link records independent channel outcomes without exposing its token to RPC storage", async () => {
  const staffCalls: Array<{ name: string; params: Record<string, unknown> }> =
    [];
  const serviceCalls: Array<{ name: string; params: Record<string, unknown> }> =
    [];
  const response = await handleStayReservations(
    request({
      action: "create_staff_group",
      expectedVersion: 4,
      payload: {
        quoteId: "00000000-4188-4000-8000-000000000081",
        idempotencyKey: "staff-payment-link-4188",
        source: "website",
        paymentMethod: "link",
        sendEmail: true,
        sendSms: true,
        guest: {
          name: "Link Guest",
          email: "link@example.test",
          phone: "+15555554188",
        },
      },
    }),
    {
      createRpcClient: () => ({
        rpc: (name, params) => {
          staffCalls.push({ name, params });
          return Promise.resolve({
            data: {
              groupId,
              guest: {
                name: "Link Guest",
                email: "link@example.test",
                phone: "+15555554188",
              },
              state: "approved_payment_required",
              paymentCollection: "mingla",
            },
            error: null,
          });
        },
      }),
      createServiceRpcClient: () => ({
        rpc: (name, params) => {
          serviceCalls.push({ name, params });
          return Promise.resolve({ data: null, error: null });
        },
      }),
      sendPaymentLinkEmail: () =>
        Promise.resolve({
          ok: true,
          status: "sent",
          providerMessageId: "email-4188",
        }),
      sendPaymentLinkSms: () => Promise.reject(new Error("sms_provider_down")),
    },
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.data.paymentLinkDelivery, {
    emailStatus: "sent",
    smsStatus: "failed",
  });
  assertEquals(typeof body.data.paymentLinkUrl, "string");
  assertEquals(
    body.data.paymentLinkUrl.startsWith(
      "https://business.example.test/stay/pay/",
    ),
    true,
  );
  assertEquals(staffCalls.length, 1);
  assertEquals(
    typeof staffCalls[0].params.p_token_hash === "string" &&
      String(staffCalls[0].params.p_token_hash).startsWith("\\x"),
    true,
  );
  assertEquals(
    Object.values(staffCalls[0].params).includes(
      body.data.paymentLinkUrl.split("/").at(-1),
    ),
    false,
  );
  assertObjectMatch(serviceCalls[0], {
    name: "issue_4188_update_staff_link_delivery",
    params: {
      p_group_id: groupId,
      p_email_status: "sent",
      p_sms_status: "failed",
      p_sms_error_code: "sms_provider_down",
    },
  });
});
