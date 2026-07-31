import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

Deno.test("inventory conflicts retain a safe operations alert without leaking database detail", async () => {
  let alert: { name: string; params: Record<string, unknown> } | null = null;
  const response = await handleStayReservations(
    new Request("http://local/stay-reservations", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "x-request-id": "00000000-1427-4000-8000-000000000010",
      },
      body: JSON.stringify({
        action: "create_group",
        expectedVersion: 1,
        payload: {
          quoteId: "00000000-1388-4000-8000-000000000080",
          idempotencyKey: "group-key-1427",
          guest: { name: "Ada", email: "ada@example.test" },
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
              message: "stay_inventory_changed secret row detail",
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
  assertEquals(response.status, 409);
  assertObjectMatch(alert ?? {}, {
    name: "issue_1427_record_stay_operation_alert",
    params: {
      p_alert_kind: "inventory_changed",
      p_severity: "critical",
      p_safe_metadata: { action: "create_group" },
    },
  });
  assertEquals(JSON.stringify(alert).includes("Ada"), false);
  assertEquals(JSON.stringify(alert).includes("secret row detail"), false);
});
