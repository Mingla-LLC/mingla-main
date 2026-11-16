// #4452 tester (L3) adversarial: the unsubscribe token a REAL form follow-up carries must be
// accepted by the verifier the unsubscribe endpoints use (SC-75, SC-76; RFC 8058 one-click).
//
// The implementor's sender suite stubs signUnsubscribe with "TOKEN", so the production
// signing call in index.ts was never exercised. This drives the real handler() end to end:
// the Supabase RPCs and Resend are answered by a stubbed fetch, and the List-Unsubscribe
// token from the captured Resend request is verified with verifyUnsubscribeToken, exactly
// as self-serve-unsubscribe does for /api/unsubscribe/one-click.
//
// FAILS at 9ec436d5eb: index.ts signs with brand_id null, and verifyUnsubscribeToken
// refuses a non-string brand_id ("unsubscribe_token_payload_invalid").
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyUnsubscribeToken } from "../_shared/marketingTokens.ts";
import { handler } from "./index.ts";

const SEND = "4452e000-0000-4000-8000-0000000000aa";
const SECRET = "local-only-tester-secret-0123456789abcdef0123456789abcdef";

function gateRow() {
  return {
    action: "send", send_id: SEND, run_id: "4452e000-0000-4000-8000-0000000000bb", attempts: 1, email_kind: "follow_up",
    to: "ada@example.org", is_test: false,
    step: { id: "s2", type: "email", from: "creators", subject: "Your first gig", action_bar: "auto",
      doc: [{ type: "paragraph", text: "Book a 20-minute call." }] },
    person: { email: "ada@example.org", name: "Ada Okafor", answers: {}, page: "/creators", spot: null, utm_source: null,
      utm_campaign: null, label: "creator", ads_allowed: false, click_source: null, time_zone: "Africa/Lagos" },
    form: { id: "f", key: "creators-join", name: "Creators: join", audience: "creator", fields: [] },
  };
}

Deno.test("ADV-U1 a real follow-up's List-Unsubscribe token verifies and names the person", async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://local-test.supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "svc-local",
    RESEND_API_KEY: "re-local", UNSUBSCRIBE_TOKEN_SECRET: SECRET,
  };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  const realFetch = globalThis.fetch;
  const resend: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.resend.com/")) {
      resend.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(Response.json({ id: "re_local" }));
    }
    if (url.includes("/rpc/forms_claim_due_sends")) return Promise.resolve(Response.json([{ id: SEND, run_id: "r" }]));
    if (url.includes("/rpc/forms_send_gate")) return Promise.resolve(Response.json(gateRow()));
    if (url.includes("/rpc/forms_finish_send")) return Promise.resolve(Response.json({ status: "sent" }));
    return Promise.resolve(new Response("unexpected " + url, { status: 599 }));
  }) as typeof fetch;
  try {
    const res = await handler(new Request("https://fn/forms-automation-sender", { method: "POST", headers: { authorization: "Bearer svc-local" } }));
    assertEquals(res.status, 200);
    assertEquals(resend.length, 1, "one follow-up posted to Resend");
    const header = resend[0].headers["List-Unsubscribe"] ?? "";
    const token = decodeURIComponent(/token=([^>]+)>/.exec(header)?.[1] ?? "");
    assert(token.length > 10, `a token in List-Unsubscribe: ${header}`);
    const payload = await verifyUnsubscribeToken(token);
    assertEquals(payload.recipient_email, "ada@example.org");
    assert(String(resend[0].body.html).includes(encodeURIComponent(token)), "the visible link carries the same token");
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
});
