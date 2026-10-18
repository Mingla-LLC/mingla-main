import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDataRoomHandler, type DataRoomDependencies } from "./index.ts";

type RpcResult = { data: unknown; error: unknown };

function thenable(result: RpcResult): PromiseLike<RpcResult> {
  return {
    then(onfulfilled, onrejected) {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
}

Deno.test("#3720 Data room awaits the Supabase audit thenable without requiring .catch()", async () => {
  let auditCalls = 0;
  const dependencies: DataRoomDependencies = {
    userClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "37200000-0000-4000-8000-000000000602" } },
          error: null,
        }),
      },
      rpc: () =>
        thenable({
          data: { status: "active", role: "owner" },
          error: null,
        }),
    }),
    adminClient: () => ({
      rpc: () => {
        auditCalls += 1;
        return thenable({ data: true, error: null });
      },
    }),
    store: () => ({
      listDocuments: async () => [{
        id: "private-google-file-id-thenable",
        name: "Release proof.pdf",
        mimeType: "application/pdf",
        size: "2048",
        modifiedTime: "2026-10-18T00:00:00Z",
      }],
      content: async () => new Response(null, { status: 404 }),
    }),
  };

  const response = await createDataRoomHandler(dependencies)(
    new Request("https://edge.test/admin-data-room", {
      method: "POST",
      headers: {
        Authorization: "Bearer user-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "manifest" }),
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(auditCalls, 1);
});
