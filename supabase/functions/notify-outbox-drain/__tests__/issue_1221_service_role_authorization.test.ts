import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleNotifyOutboxDrain } from "../index.ts";

const SERVICE_KEY = "issue-1221-service-role-only";
const SUPABASE_URL = "http://127.0.0.1:54321";

Deno.test("notify drain requires the exact service-role bearer before every privileged call", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = Deno.env.get("SUPABASE_URL");
  const originalKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const calls: string[] = [];
  globalThis.fetch = (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

  try {
    const duplicateHeaders = new Headers();
    duplicateHeaders.append("Authorization", `Bearer ${SERVICE_KEY}`);
    duplicateHeaders.append("Authorization", `Bearer ${SERVICE_KEY}`);
    const userJwtShaped = [
      "eyJhbGciOiJIUzI1NiJ9",
      "user",
      "signature",
    ].join(".");
    const rejectedHeaders: Array<HeadersInit | undefined> = [
      undefined,
      { Authorization: "" },
      { Authorization: "Bearer " },
      { Authorization: "Bearer attacker-controlled-junk" },
      { Authorization: `Bearer ${userJwtShaped}` },
      { Authorization: "Bearer wrong-service-role-key" },
      { Authorization: `Bearer  ${SERVICE_KEY}` },
      { Authorization: `Bearer \t${SERVICE_KEY}` },
      { Authorization: `bearer ${SERVICE_KEY}` },
      { Authorization: `Basic ${SERVICE_KEY}` },
      { Authorization: SERVICE_KEY },
      duplicateHeaders,
    ];

    for (const headers of rejectedHeaders) {
      calls.length = 0;
      const response = await handleNotifyOutboxDrain(
        new Request("http://localhost/functions/v1/notify-outbox-drain", {
          method: "POST",
          headers,
        }),
      );
      assertEquals(response.status, 401);
      assertEquals(await response.json(), { error: "unauthorized" });
      assertEquals(calls, []);
    }

    calls.length = 0;
    const authorized = await handleNotifyOutboxDrain(
      new Request("http://localhost/functions/v1/notify-outbox-drain", {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      }),
    );
    assertEquals(authorized.status, 200);
    assertEquals(await authorized.json(), {
      ok: true,
      processed: 0,
      failed: 0,
    });
    assertEquals(calls.length, 4);
    assertStringIncludes(calls[0], "/rest/v1/rpc/claim_notification_outbox");
    assertStringIncludes(
      calls[1],
      "/rest/v1/rpc/claim_source_refund_notification_outbox",
    );
    assertStringIncludes(
      calls[2],
      "/rest/v1/rpc/claim_source_refund_notification_outbox",
    );
    assertStringIncludes(calls[3], "/rest/v1/rpc/claim_notification_outbox");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", originalUrl);
    if (originalKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalKey);
    }
  }
});
