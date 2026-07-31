import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStayReservations } from "./index.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const groupId = "00000000-1392-4000-8000-000000000001";
const lineId = "00000000-1392-4000-8000-000000000002";
const previewId = "00000000-1392-4000-8000-000000000003";

function request(
  action: "cancel_preview" | "cancel",
  payload: Record<string, unknown>,
) {
  return new Request("http://local/stay-reservations", {
    method: "POST",
    headers: {
      authorization: "Bearer test-user-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, payload, expectedVersion: 1 }),
  });
}

Deno.test("#1392 preserves the permissioned cancellation preview RPC", async () => {
  let rpc = "";
  const response = await handleStayReservations(
    request("cancel_preview", { groupId, selectedLineIds: [lineId] }),
    {
      createRpcClient: () =>
        ({
          rpc: (name: string) => {
            rpc = name;
            return Promise.resolve({ data: { previewId }, error: null });
          },
        }) as never,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(rpc, "issue_1426_cancel_preview");
});

Deno.test("#1392 preserves the permissioned cancellation execution RPC", async () => {
  let rpc = "";
  const response = await handleStayReservations(
    request("cancel", {
      previewId,
      previewHash: "a".repeat(64),
      idempotencyKey: "issue-1392-cancel",
      reason: "Release rollback cancellation proof",
    }),
    {
      createRpcClient: () =>
        ({
          rpc: (name: string) => {
            rpc = name;
            return Promise.resolve({
              data: { state: "submitted" },
              error: null,
            });
          },
        }) as never,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(rpc, "issue_1426_cancel");
});
