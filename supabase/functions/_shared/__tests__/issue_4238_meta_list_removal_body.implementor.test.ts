// Issue #4238 wave 2 rework — Meta customer-list removals carry their hashes
// in the request body, never the URL, and batch within Meta's 10,000-per-
// request cap. fetch is stubbed: no provider is ever called.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type MemberHashRow, sendMetaListUsers } from "../adListAudienceProvider.ts";
import { type MetaClient, metaGraph } from "../meta.ts";

const hex = (n: number) => n.toString(16).padStart(64, "0");
const member = (n: number): MemberHashRow => ({
  member_key: hex(n),
  email_sha256: hex(n),
  email_google_sha256: null,
  phone_sha256: n % 2 === 0 ? hex(n + 1_000_000) : null,
  phone_e164_sha256: null,
  country: "NG",
});

Deno.test("#4238 Meta removals: DELETE /users with the hashes in the body, batched at 10,000", async () => {
  const calls: { method: string; path: string; params: Record<string, unknown> | undefined; deleteBody?: boolean }[] = [];
  let session = 100;
  await sendMetaListUsers({
    graph: (method, path, params, opts) => {
      calls.push({ method, path, params, deleteBody: opts.deleteBody });
      return Promise.resolve({});
    },
    audienceId: "238400000000009",
    action: "remove",
    members: Array.from({ length: 10_001 }, (_, i) => member(i + 1)),
    sessionId: () => (session += 1),
  });
  // 10,001 members: two batches. The first sends EMAIL and PHONE; the second
  // (one odd-numbered member, no phone) sends EMAIL only.
  assertEquals(calls.map((c) => c.method), ["DELETE", "DELETE", "DELETE"]);
  assert(calls.every((c) => c.path === "238400000000009/users"));
  assert(calls.every((c) => c.deleteBody === true), "every removal asks for a body");
  for (const call of calls) {
    const data = ((call.params?.payload as { data: string[][] }).data);
    assert(data.length <= 10_000, `batch of ${data.length} is over Meta's cap`);
  }
  const emailRows = calls.filter((c) => (c.params?.payload as { schema: string[] }).schema[0] === "EMAIL")
    .reduce((n, c) => n + (c.params?.payload as { data: string[][] }).data.length, 0);
  assertEquals(emailRows, 10_001);
});

Deno.test("#4238 metaGraph deleteBody: the URL carries no hashes; the JSON body does", async () => {
  const realFetch = globalThis.fetch;
  const seen: { url: string; method: string; body: string | null }[] = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    seen.push({ url: String(url), method: String(init.method), body: typeof init.body === "string" ? init.body : null });
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }) as typeof fetch;
  try {
    const client = {
      platform: "meta",
      token: "fake-token",
      config: { graphBase: "https://graph.invalid", apiVersion: "v25.0" },
    } as unknown as MetaClient;
    const hash = hex(42);
    await metaGraph(client, "DELETE", "238400000000009/users", {
      payload: { schema: ["EMAIL"], data: [[hash]] },
    }, { deleteBody: true });
    // Default DELETE (deleting an audience by id) is unchanged.
    await metaGraph(client, "DELETE", "238400000000009", { fields: "id" });
    assertEquals(seen[0].method, "DELETE");
    assertEquals(seen[0].url, "https://graph.invalid/v25.0/238400000000009/users");
    assert(!seen[0].url.includes(hash), "no hash in the URL");
    assert(seen[0].body?.includes(hash), "the hash is in the body");
    assertEquals(seen[1].url, "https://graph.invalid/v25.0/238400000000009?fields=id");
    assertEquals(seen[1].body, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
