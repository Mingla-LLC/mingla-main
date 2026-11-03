// Issue #4255 (D5) — everyone on the team can write and send email.
//
// admin-send-email used to answer 403 to anyone without an active admin_users
// row. It now lets any active teammate in (owner, admin, Founding partner,
// growth), asks the database as the caller, and still refuses everyone else.
// The handler is driven end to end with fetch stubbed: no network.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("SUPABASE_URL", "https://issue4255.supabase.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key-4255");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-4255");
Deno.env.set("RESEND_API_KEY", "");

const { handler, isActiveTeammate } = await import("./index.ts");

// supabase-js starts its session timers inside the handler; they are not ours.
const test = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });

type Answer = { role: unknown; roleStatus?: number; user?: boolean };

async function callAs(answer: Answer, action = "check_provider") {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(answer.user === false
        ? new Response(JSON.stringify({ msg: "invalid" }), { status: 401 })
        : new Response(JSON.stringify({ id: "42550000-0000-4000-8000-000000000004", email: "growth@test.local", aud: "authenticated" }), { status: 200 }));
    }
    if (url.includes("/rest/v1/rpc/admin_team_role")) {
      return Promise.resolve(new Response(JSON.stringify(answer.role), {
        status: answer.roleStatus ?? 200,
        headers: { "content-type": "application/json" },
      }));
    }
    if (url.includes("/rest/v1/admin_users")) {
      // The old gate. Answering "not an admin" proves the new gate does not read it.
      return Promise.resolve(new Response("null", { status: 200, headers: { "content-type": "application/json" } }));
    }
    return realFetch(input as Request, init);
  }) as typeof fetch;
  try {
    const response = await handler(new Request("https://issue4255.supabase.test/functions/v1/admin-send-email", {
      method: "POST",
      headers: { authorization: "Bearer user-jwt", "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }));
    return { status: response.status, body: await response.json(), seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

for (const role of ["growth", "partner", "admin", "owner"]) {
  test(`#4255 a ${role} teammate reaches the email actions`, async () => {
    const result = await callAs({ role });
    assertEquals(result.status, 200, JSON.stringify(result.body));
    assertEquals(result.body.provider, "resend");
    assertEquals(result.seen.some((url) => url.includes("/rest/v1/admin_users")), false);
  });
}

test("#4255 someone with no team role is refused", async () => {
  const result = await callAs({ role: null });
  assertEquals(result.status, 403);
  assertEquals(result.body.error, "Forbidden: team access required");
});

test("#4255 an unknown role or a failed role check is refused (fails closed)", async () => {
  assertEquals((await callAs({ role: "moderator" })).status, 403);
  assertEquals((await callAs({ role: "growth", roleStatus: 500 })).status, 403);
});

test("#4255 a bad session is still 401", async () => {
  assertEquals((await callAs({ role: "growth", user: false })).status, 401);
});

test("#4255 isActiveTeammate fails closed on a thrown client", async () => {
  assertEquals(await isActiveTeammate({ rpc: () => Promise.reject(new Error("down")) }), false);
  assertEquals(await isActiveTeammate({ rpc: () => Promise.resolve({ data: "growth", error: null }) }), true);
  assertEquals(await isActiveTeammate({ rpc: () => Promise.resolve({ data: "growth", error: { message: "x" } }) }), false);
});
