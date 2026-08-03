import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleManageStayInventory } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

Deno.test("place-window materialization failures retain only replay-safe evidence", async () => {
  let alert: { name: string; params: Record<string, unknown> } | null = null;
  const response = await handleManageStayInventory(
    new Request("http://local/manage-stay-inventory", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "x-request-id": "private@example.test",
      },
      body: JSON.stringify({
        action: "materialize_place_windows",
        venueId: "00000000-1424-4000-8000-000000000004",
        expectedVersion: 7,
        payload: {
          scheduleRuleId: "00000000-1425-4000-8000-000000000001",
          fromDate: "2027-02-10",
          toDate: "2027-02-15",
          internalNote: "must never enter alert metadata",
        },
      }),
    }),
    {
      createRpcClient: () => ({
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "P0001",
              message: "materialization_failed: private database detail",
            },
          }),
      }),
      createServiceRpcClient: () => ({
        rpc: (name, params) => {
          alert = { name, params };
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  );
  assertEquals(response.status, 500);
  assertObjectMatch(alert ?? {}, {
    name: "issue_1427_record_stay_operation_alert",
    params: {
      p_alert_kind: "materialization_failed",
      p_severity: "warning",
      p_safe_metadata: {
        scheduleRuleId: "00000000-1425-4000-8000-000000000001",
        fromDate: "2027-02-10",
        toDate: "2027-02-15",
        expectedVersion: 7,
        errorCode: "materialization_failed",
      },
    },
  });
  assertEquals(JSON.stringify(alert).includes("internalNote"), false);
  assertEquals(
    JSON.stringify(alert).includes("private database detail"),
    false,
  );
  assertEquals(JSON.stringify(alert).includes("private@example.test"), false);
  const capturedAlert = alert as unknown as {
    params: Record<string, unknown>;
  } | null;
  const retainedRequestId = String(capturedAlert?.params.p_request_id ?? "");
  assertEquals(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      retainedRequestId,
    ),
    true,
  );
});
