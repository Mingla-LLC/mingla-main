// #4452 rework 1 (P0-1): platform-level (null-brand) unsubscribe tokens for form and
// free-tool follow-ups verify end to end, while brand tokens stay strict.
//
// U-1..U-3 pin the token rules in _shared/marketingTokens.ts.
// U-4 drives the REAL forms-automation-sender handler, takes the List-Unsubscribe token
// from the captured Resend request, POSTs it to the REAL self-serve-unsubscribe handler
// (the edge function behind /api/unsubscribe/one-click) and asserts a 200 with the exact
// channel_suppressions row that forms_send_gate step 5 reads (channel email, scope
// marketing, the lowercased address). The SQL half (that row skips the next scheduled
// follow-up as 'unsubscribed') is ADV-6 in
// supabase/migrations/__tests__/issue_4452_forms_leads.tester.adversarial.pg17.test.sql.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PLATFORM_UNSUB_CAMPAIGN_RE,
  signUnsubscribeToken,
  verifyBrandUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../_shared/marketingTokens.ts";
import { handler as senderHandler } from "../forms-automation-sender/index.ts";
import { handler as unsubscribeHandler } from "./index.ts";

const SECRET = "local-only-implementor-secret-0123456789abcdef0123456789";
const BRAND = "22222222-2222-4222-8222-222222222222";

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

Deno.test("U-1 a form follow-up token with no brand signs and verifies", async () => {
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: SECRET }, async () => {
    const t = await signUnsubscribeToken({ recipient_email: "ada@example.org", campaign_id: "form:tool-events", brand_id: null });
    const p = await verifyUnsubscribeToken(t);
    assertEquals(p.brand_id, null);
    assertEquals(p.recipient_email, "ada@example.org");
    assert(PLATFORM_UNSUB_CAMPAIGN_RE.test("form:creators-join"));
  });
});

Deno.test("U-2 a null brand is refused for any non-platform campaign (sign and verify)", async () => {
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: SECRET }, async () => {
    for (const c of ["11111111-1111-4111-8111-111111111111", "follow:follow", "form:", "form:Bad_Key", "tool:x", "form:a-"]) {
      await assertRejects(
        () => signUnsubscribeToken({ recipient_email: "a@b.co", campaign_id: c, brand_id: null }),
        Error,
        "unsubscribe_token_brand_required",
      );
    }
    // A forged body (validly signed with the secret) is still refused by the verifier.
    const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const body = enc({ campaign_id: "camp-1", recipient_email: "a@b.co", brand_id: null, exp: 4102444800 });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
    const forged = `${body}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    await assertRejects(() => verifyUnsubscribeToken(forged), Error, "unsubscribe_token_payload_invalid");
  });
});

Deno.test("U-3 brand consumers stay strict: the brand verifier refuses a platform token, accepts a brand one", async () => {
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: SECRET }, async () => {
    const platform = await signUnsubscribeToken({ recipient_email: "a@b.co", campaign_id: "form:creators-join", brand_id: null });
    await assertRejects(() => verifyBrandUnsubscribeToken(platform), Error, "unsubscribe_token_payload_invalid");
    const brand = await signUnsubscribeToken({ recipient_email: "a@b.co", campaign_id: "camp-1", brand_id: BRAND });
    assertEquals((await verifyBrandUnsubscribeToken(brand)).brand_id, BRAND);
  });
});

// sanitizeOps off: self-serve-unsubscribe's supabase-js client starts its token-refresh interval.
Deno.test({ name: "U-4 one-click on a real follow-up's token returns success and writes the row the gate stops on", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const SEND = "4452e000-0000-4000-8000-0000000000aa";
  const gate = {
    action: "send", send_id: SEND, run_id: "4452e000-0000-4000-8000-0000000000bb", attempts: 1, email_kind: "follow_up",
    to: "Ada@Example.org", is_test: false,
    step: { id: "s2", type: "email", from: "creators", subject: "Your first gig", action_bar: "auto",
      doc: [{ type: "paragraph", text: "Book a 20-minute call." }] },
    person: { email: "Ada@Example.org", name: "Ada Okafor", answers: {}, page: "/creators", spot: null, utm_source: null,
      utm_campaign: null, label: "creator", ads_allowed: false, click_source: null, time_zone: "Africa/Lagos" },
    form: { id: "f", key: "creators-join", name: "Creators: join", audience: "creator", fields: [] },
  };
  await withEnv({
    SUPABASE_URL: "https://local-test.supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "svc-local",
    RESEND_API_KEY: "re-local", UNSUBSCRIBE_TOKEN_SECRET: SECRET,
  }, async () => {
    const realFetch = globalThis.fetch;
    const resend: Array<Record<string, string>> = [];
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://api.resend.com/")) {
        resend.push(init?.headers as Record<string, string>);
        return Response.json({ id: "re_local" });
      }
      if (url.includes("/rpc/forms_claim_due_sends")) return Response.json([{ id: SEND, run_id: "r" }]);
      if (url.includes("/rpc/forms_send_gate")) return Response.json(gate);
      if (url.includes("/rpc/forms_finish_send")) return Response.json({ status: "sent" });
      const m = /\/rest\/v1\/(channel_suppressions|marketing_unsubscribes)/.exec(url);
      if (m) {
        const raw = JSON.parse(String(init?.body));
        inserts.push({ table: m[1], row: Array.isArray(raw) ? raw[0] : raw });
        return new Response(null, { status: 201 });
      }
      return new Response("unexpected " + url, { status: 599 });
    }) as typeof fetch;
    try {
      const sent = await senderHandler(new Request("https://fn/forms-automation-sender", { method: "POST", headers: { authorization: "Bearer svc-local" } }));
      assertEquals(sent.status, 200);
      const token = decodeURIComponent(/token=([^>]+)>/.exec(resend[0]?.["List-Unsubscribe"] ?? "")?.[1] ?? "");
      assert(token.length > 10, "the follow-up carries a token");

      // Exactly what /api/unsubscribe/one-click forwards.
      const res = await unsubscribeHandler(new Request("https://fn/self-serve-unsubscribe", {
        method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.45" },
        body: JSON.stringify({ token, scope: "marketing" }),
      }));
      const body = await res.json();
      assertEquals(res.status, 200, JSON.stringify(body));
      assertEquals(body.ok, true);
      const cs = inserts.find((i) => i.table === "channel_suppressions")?.row;
      assertEquals(cs?.channel, "email");
      assertEquals(cs?.scope, "marketing");
      assertEquals(cs?.contact, "ada@example.org");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
} });
