/**
 * #2510 happy-path regression — the event ear works, and it is guarded.
 *
 * Until now nothing listened to Resend, so there was NO open rate anywhere in
 * Mingla and both campaign screens showed a "Delivered" figure they had not
 * earned. This endpoint is the unlock — and because it WRITES engagement
 * metrics and can SUPPRESS a real recipient, its signature check is the
 * load-bearing part, not the ingest.
 *
 * FAILS ON REVERT: weaken `verifySvixSignature` and the forgery tests go red.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  eventTypeOf,
  handleResendWebhook,
  providerMessageIdOf,
  verifySvixSignature,
} from "./index.ts";

const SECRET_BYTES = new Uint8Array(32).fill(7);
const SECRET = "whsec_" + btoa(String.fromCharCode(...SECRET_BYTES));

async function sign(id: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    SECRET_BYTES,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${ts}.${body}`),
    ),
  );
  return "v1," + btoa(String.fromCharCode(...mac));
}

const NOW = 1_700_000_000;
const BODY = JSON.stringify({
  type: "email.opened",
  created_at: "2026-08-25T00:00:00.000Z",
  data: { email_id: "56761188-7520-42d8-8898-ff6fc54ce618" },
});

Deno.test("#2510 a genuine Svix signature verifies", async () => {
  const sig = await sign("msg_1", String(NOW), BODY);
  assert(
    await verifySvixSignature({
      secret: SECRET,
      svixId: "msg_1",
      svixTimestamp: String(NOW),
      svixSignature: sig,
      rawBody: BODY,
      nowSeconds: NOW,
    }),
  );
});

Deno.test("#2510 a tampered body is rejected", async () => {
  const sig = await sign("msg_1", String(NOW), BODY);
  assertEquals(
    await verifySvixSignature({
      secret: SECRET,
      svixId: "msg_1",
      svixTimestamp: String(NOW),
      svixSignature: sig,
      rawBody: BODY.replace("email.opened", "email.clicked"),
      nowSeconds: NOW,
    }),
    false,
  );
});

Deno.test("#2510 key rotation — the SECOND signature in the header still verifies", async () => {
  // Svix sends a space-separated list during rotation. Checking only the first
  // would break silently at every key roll.
  const good = await sign("msg_1", String(NOW), BODY);
  const header = `v1,${btoa("wrong-signature-bytes")} ${good}`;
  assert(
    await verifySvixSignature({
      secret: SECRET,
      svixId: "msg_1",
      svixTimestamp: String(NOW),
      svixSignature: header,
      rawBody: BODY,
      nowSeconds: NOW,
    }),
  );
});

Deno.test("#2510 a stale signature is refused (replay window)", async () => {
  const sig = await sign("msg_1", String(NOW), BODY);
  assertEquals(
    await verifySvixSignature({
      secret: SECRET,
      svixId: "msg_1",
      svixTimestamp: String(NOW),
      svixSignature: sig,
      rawBody: BODY,
      nowSeconds: NOW + 400,
    }),
    false,
  );
});

Deno.test("#2510 the envelope is read the way Resend documents it", () => {
  const payload = JSON.parse(BODY);
  assertEquals(eventTypeOf(payload), "email.opened");
  assertEquals(
    providerMessageIdOf(payload),
    "56761188-7520-42d8-8898-ff6fc54ce618",
  );
  assertEquals(providerMessageIdOf({ data: {} }), null);
  assertEquals(eventTypeOf({}), null);
});

Deno.test("#2510 an unsigned request is refused, not trusted", async () => {
  Deno.env.set("RESEND_WEBHOOK_SECRET", SECRET);
  const res = await handleResendWebhook(
    new Request("https://x.test/", { method: "POST", body: BODY }),
  );
  assertEquals(res.status, 401);
});

Deno.test("#2510 with NO secret configured the endpoint fails CLOSED", async () => {
  Deno.env.delete("RESEND_WEBHOOK_SECRET");
  const res = await handleResendWebhook(
    new Request("https://x.test/", { method: "POST", body: BODY }),
  );
  // 503, never 200: an unverified endpoint that writes metrics and suppresses
  // recipients is a vandalism surface.
  assertEquals(res.status, 503);
});

Deno.test("#2510 GET is not a way in", async () => {
  const res = await handleResendWebhook(
    new Request("https://x.test/", { method: "GET" }),
  );
  assertEquals(res.status, 405);
});
