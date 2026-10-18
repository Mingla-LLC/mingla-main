// MINGLA-INVARIANT: I-3720-DATA-ROOM-BROKER | issue #3720 | Owner, Admin, and Partner access private Data room bytes only through an authenticated broker that never returns provider ids or credentials and always records an access outcome.

import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createDataRoomHandler,
  type DataRoomDependencies,
  dataRoomKey,
} from "./index.ts";

const providerId = "private-google-file-id-3720";

function dependencies(options: {
  role?: string;
  upstream?: Response;
  calls?: Array<{ name: string; args?: Record<string, unknown> }>;
  onStore?: () => void;
} = {}): DataRoomDependencies {
  const calls = options.calls ?? [];
  return {
    userClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "37200000-0000-4000-8000-000000000601" } },
          error: null,
        }),
      },
      rpc: async (name) => {
        calls.push({ name });
        return {
          data: name === "admin_team_my_access"
            ? { status: "active", role: options.role ?? "partner" }
            : null,
          error: null,
        };
      },
    }),
    adminClient: () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: true, error: null };
      },
    }),
    store: () => {
      options.onStore?.();
      return {
        listDocuments: async () => [{
          id: providerId,
          name: "Investor overview.pdf",
          mimeType: "application/pdf",
          size: "2048",
          modifiedTime: "2026-10-17T00:00:00Z",
        }],
        content: async () =>
          options.upstream ?? new Response(
            new Uint8Array([37, 80, 68, 70]),
            { status: 200, headers: { "content-type": "application/pdf" } },
          ),
      };
    },
  };
}

Deno.test("#3720 Partner receives an opaque manifest and a successful audit", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const response = await createDataRoomHandler(dependencies({ calls }))(
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
  const text = await response.text();
  assertMatch(text, /Investor overview[.]pdf/);
  assertMatch(text, new RegExp(await dataRoomKey(providerId)));
  assertNotMatch(text, /private-google-file-id|client_email|private_key/);
  assertEquals(calls.at(-1)?.name, "issue_3720_log_data_room_access");
  assertEquals(calls.at(-1)?.args?.p_succeeded, true);
  assertEquals(calls.at(-1)?.args?.p_action, "room_open");
});

Deno.test("#3720 Growth is denied before private provider I/O", async () => {
  let opened = false;
  const response = await createDataRoomHandler(dependencies({
    role: "growth",
    onStore: () => opened = true,
  }))(
    new Request("https://edge.test/admin-data-room", {
      method: "POST",
      headers: {
        Authorization: "Bearer user-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "manifest" }),
    }),
  );
  assertEquals(response.status, 403);
  assertEquals(opened, false);
});

Deno.test("#3720 Document proxy bounds type and records failure without leaking provider data", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const key = await dataRoomKey(providerId);
  const response = await createDataRoomHandler(dependencies({
    calls,
    upstream: new Response("<html>provider error</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  }))(
    new Request("https://edge.test/admin-data-room", {
      method: "POST",
      headers: {
        Authorization: "Bearer user-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "document", key }),
    }),
  );
  assertEquals(response.status, 502);
  const text = await response.text();
  assertNotMatch(text, /provider error|private-google-file-id/);
  assertEquals(calls.at(-1)?.args?.p_succeeded, false);
  assertEquals(calls.at(-1)?.args?.p_document_key, key);
});

Deno.test("#3720 Google-native documents are exposed only as bounded PDFs", async () => {
  const deps = dependencies();
  deps.store = () => ({
    listDocuments: async () => [{
      id: providerId,
      name: "Board deck",
      mimeType: "application/vnd.google-apps.presentation",
    }],
    content: async () =>
      new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
  });
  const response = await createDataRoomHandler(deps)(
    new Request("https://edge.test/admin-data-room", {
      method: "POST",
      headers: {
        Authorization: "Bearer user-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "document",
        key: await dataRoomKey(providerId),
      }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "application/pdf");
});
