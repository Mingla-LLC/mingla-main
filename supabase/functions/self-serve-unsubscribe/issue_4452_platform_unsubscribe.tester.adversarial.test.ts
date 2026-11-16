// #4452 retest 1 (tester, adversarial): the platform (null-brand) unsubscribe token
// added in rework d515015343 must not widen what a token can do.
//
// Different angle from the implementor's U-1..U-4 (happy path + sign-side refusal):
// - ADV-P1 a platform token never passes the brand-scoped verifiers that guard brand
//   writes (brand follow, web follow email), even when they share the secret.
// - ADV-P2 a validly signed BRAND token whose body is re-encoded with brand_id null
//   (signature kept) is refused: the null brand cannot be grafted onto a brand token.
// - ADV-P3 an expired platform token, a tampered one (recipient swapped, signature
//   kept) and one signed with another secret are refused by the REAL
//   self-serve-unsubscribe handler with 400 invalid_token and NO suppression write.
// - ADV-P4 near-miss campaign ids (case, whitespace, path, suffix tricks) cannot carry
//   a null brand, at sign time and at verify time (validly signed forged body).
//
// Fails on revert: deleting the `brand_id === null && PLATFORM_UNSUB_CAMPAIGN_RE`
// guard in verifyUnsubscribeToken (accepting any null brand) turns ADV-P4's
// verify-side loop red; deleting verifyBrandUnsubscribeToken's string check turns
// ADV-P1 red.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  signUnsubscribeToken,
  verifyBrandUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../_shared/marketingTokens.ts";
import { verifyBrandFollowToken } from "../_shared/brandFollowTokens.ts";
import { verifyWebFollowEmailToken } from "../_shared/webFollowEmailTokens.ts";
import { handler as unsubscribeHandler } from "./index.ts";

const SECRET = "local-only-tester-secret-4452-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_SECRET = "local-only-tester-secret-4452-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BRAND = "33333333-3333-4333-8333-333333333333";

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const keys = [...Object.keys(env), "BRAND_FOLLOW_TOKEN_SECRET", "WEB_FOLLOW_EMAIL_TOKEN_SECRET"];
  const saved = Object.fromEntries(keys.map((k) => [k, Deno.env.get(k)]));
  Deno.env.delete("BRAND_FOLLOW_TOKEN_SECRET");
  Deno.env.delete("WEB_FOLLOW_EMAIL_TOKEN_SECRET");
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

const b64u = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encBody = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
const decBody = (s: string) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(pad + "===".slice((pad.length + 3) % 4)), (c) => c.charCodeAt(0))));
};
async function signRaw(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))))}`;
}

Deno.test("ADV-P1 a platform token never passes the brand-scoped verifiers (shared secret)", async () => {
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: SECRET }, async () => {
    const platform = await signUnsubscribeToken({ recipient_email: "ada@example.org", campaign_id: "form:creators-join", brand_id: null });
    // Sanity: it IS a valid platform token.
    assertEquals((await verifyUnsubscribeToken(platform)).brand_id, null);
    await assertRejects(() => verifyBrandUnsubscribeToken(platform), Error, "unsubscribe_token_payload_invalid");
    await assertRejects(() => verifyBrandFollowToken(platform));
    await assertRejects(() => verifyWebFollowEmailToken(platform));
  });
});

Deno.test("ADV-P2 a brand token re-encoded with brand_id null (signature kept) is refused", async () => {
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: SECRET }, async () => {
    const brand = await signUnsubscribeToken({ recipient_email: "ada@example.org", campaign_id: "form:creators-join", brand_id: BRAND });
    const [body, sig] = brand.split(".");
    const p = decBody(body);
    assertEquals(p.brand_id, BRAND);
    const grafted = `${encBody({ ...p, brand_id: null })}.${sig}`;
    await assertRejects(() => verifyUnsubscribeToken(grafted));
  });
});

// sanitizeOps off: the handler's supabase-js client may start a refresh interval.
Deno.test({ name: "ADV-P3 expired, tampered and wrong-secret platform tokens: 400 invalid_token, no write", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  await withEnv({
    UNSUBSCRIBE_TOKEN_SECRET: SECRET, SUPABASE_URL: "https://local-test.supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "svc-local",
  }, async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await signUnsubscribeToken({ recipient_email: "ada@example.org", campaign_id: "form:tool-events", brand_id: null, exp: now - 60 });
    const good = await signUnsubscribeToken({ recipient_email: "ada@example.org", campaign_id: "form:tool-events", brand_id: null });
    const [gBody, gSig] = good.split(".");
    const swapped = `${encBody({ ...decBody(gBody), recipient_email: "victim@example.org" })}.${gSig}`;
    const wrongSecret = await signRaw(encBody({ campaign_id: "form:tool-events", recipient_email: "victim@example.org", brand_id: null, exp: now + 3600 }), OTHER_SECRET);

    const realFetch = globalThis.fetch;
    const writes: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      writes.push(url);
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    try {
      let ip = 10;
      for (const [label, token] of [["expired", expired], ["tampered", swapped], ["wrong-secret", wrongSecret]] as const) {
        const res = await unsubscribeHandler(new Request("https://fn/self-serve-unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ip++}` },
          body: JSON.stringify({ token, scope: "marketing" }),
        }));
        const body = await res.json();
        assertEquals(res.status, 400, `${label}: ${JSON.stringify(body)}`);
        assertEquals(body.error, "invalid_token", label);
      }
      assertEquals(writes, [], "no suppression row is written for a rejected token");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
} });

Deno.test("ADV-P4 near-miss campaign ids cannot carry a null brand (sign and verify)", async () => {
  await withEnv({ UNSUBSCRIBE_TOKEN_SECRET: SECRET }, async () => {
    const nearMisses = [
      "FORM:creators-join", " form:creators-join", "form:creators-join ", "form:creators-join\n",
      "form:creators/join", "form:../marketing", "form:creators-join:x", "xform:creators-join",
      "form:" + "a".repeat(49), "form:-a", "form:a_b", "Form:a",
    ];
    for (const c of nearMisses) {
      await assertRejects(
        () => signUnsubscribeToken({ recipient_email: "a@b.co", campaign_id: c, brand_id: null }),
        Error,
        "unsubscribe_token_brand_required",
        `sign ${JSON.stringify(c)}`,
      );
      const forged = await signRaw(encBody({ campaign_id: c, recipient_email: "a@b.co", brand_id: null, exp: 4102444800 }), SECRET);
      await assertRejects(() => verifyUnsubscribeToken(forged), Error, "unsubscribe_token_payload_invalid", `verify ${JSON.stringify(c)}`);
    }
    // Other non-string brands are never accepted either.
    for (const brand of [undefined, 0, "", false, {}]) {
      const forged = await signRaw(encBody({ campaign_id: "form:creators-join", recipient_email: "a@b.co", brand_id: brand, exp: 4102444800 }), SECRET);
      if (brand === "") {
        // An empty string is a string brand: the brand verifier still holds it (pre-existing shape rule).
        continue;
      }
      await assertRejects(() => verifyUnsubscribeToken(forged), Error, undefined, `brand ${JSON.stringify(brand)}`);
    }
  });
});
