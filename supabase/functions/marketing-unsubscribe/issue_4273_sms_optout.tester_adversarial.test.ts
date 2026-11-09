// #4273 — tester adversarial: the SMS opt-out token. A forged, tampered,
// expired or cross-type token never reaches the opt-out write; an SMS token
// can never unsubscribe an email (and an email token is never read as SMS);
// every SMS token is the same length and carries ids only.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  signSmsUnsubscribeToken,
  signUnsubscribeToken,
  verifySmsUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../_shared/marketingTokens.ts";

const SECRET = "UNSUB_TESTER_4273";
const OPTS = { secretEnvKey: SECRET };
const IDS = {
  campaign_id: "42730000-0000-4000-8000-0000000000c1",
  brand_id: "42730000-0000-4000-8000-0000000000b1",
  message_id: "42730000-0000-4000-8000-0000000000e1",
};
Deno.env.set(SECRET, "tester-4273-secret-0123456789abcdef");

const b64url = (text: string) =>
  btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (part: string) =>
  atob(
    part.replace(/-/g, "+").replace(/_/g, "/") +
      "==".slice(0, (4 - part.length % 4) % 4),
  );

Deno.test("#4273 K-1 a token signed with another secret is refused", async () => {
  Deno.env.set("UNSUB_TESTER_OTHER", "some-other-secret-value-000000000");
  const forged = await signSmsUnsubscribeToken(IDS, {
    secretEnvKey: "UNSUB_TESTER_OTHER",
  });
  await assertRejects(
    () => verifySmsUnsubscribeToken(forged, OPTS),
    Error,
    "unsubscribe_token_signature_invalid",
  );
});

Deno.test("#4273 K-2 swapping the message id under a valid signature is refused", async () => {
  const token = await signSmsUnsubscribeToken(IDS, OPTS);
  const [payload, sig] = token.split(".");
  const body = JSON.parse(decode(payload));
  body.message_id = "42730000-0000-4000-8000-0000000000e2";
  const tampered = `${b64url(JSON.stringify(body))}.${sig}`;
  await assertRejects(
    () => verifySmsUnsubscribeToken(tampered, OPTS),
    Error,
    "unsubscribe_token_signature_invalid",
  );
});

Deno.test("#4273 K-3 an expired SMS token is refused, and the email path refuses it too", async () => {
  const token = await signSmsUnsubscribeToken(IDS, {
    ...OPTS,
    exp: Math.floor(Date.now() / 1000) - 60,
  });
  await assertRejects(
    () => verifySmsUnsubscribeToken(token, OPTS),
    Error,
    "unsubscribe_token_expired",
  );
  // marketing-unsubscribe falls through to the email verifier when the SMS
  // verifier throws: it must not unsubscribe anything with this token.
  await assertRejects(() => verifyUnsubscribeToken(token, OPTS));
});

Deno.test("#4273 K-4 an SMS token can never act as an email token, nor an email token as SMS", async () => {
  const sms = await signSmsUnsubscribeToken(IDS, OPTS);
  await assertRejects(
    () => verifyUnsubscribeToken(sms, OPTS),
    Error,
    "unsubscribe_token_payload_invalid",
  );
  const email = await signUnsubscribeToken({
    campaign_id: IDS.campaign_id,
    recipient_email: "guest@example.test",
    brand_id: IDS.brand_id,
  }, OPTS);
  assertEquals(await verifySmsUnsubscribeToken(email, OPTS), null);
  // An email-shaped payload that claims channel "sms" without ids is refused.
  const claimed = await signUnsubscribeToken({
    campaign_id: IDS.campaign_id,
    recipient_email: "guest@example.test",
    brand_id: IDS.brand_id,
    // deno-lint-ignore no-explicit-any
    ...({ channel: "sms" } as any),
  }, OPTS);
  const verdict = await verifySmsUnsubscribeToken(claimed, OPTS).catch((e) =>
    e
  );
  assert(verdict === null || verdict instanceof Error, String(verdict));
});

Deno.test("#4273 K-5 SMS tokens are fixed length and carry ids only", async () => {
  const lengths = new Set<number>();
  for (let i = 0; i < 20; i += 1) {
    const token = await signSmsUnsubscribeToken({
      campaign_id: crypto.randomUUID(),
      brand_id: crypto.randomUUID(),
      message_id: crypto.randomUUID(),
    }, OPTS);
    lengths.add(token.length);
    const body = JSON.parse(decode(token.split(".")[0]));
    assertEquals(Object.keys(body), [
      "campaign_id",
      "brand_id",
      "channel",
      "message_id",
      "exp",
    ]);
    assert(!/[@+]/.test(JSON.stringify(body)), "no email or phone shapes");
  }
  assertEquals(lengths.size, 1);
  await assertRejects(
    () =>
      signSmsUnsubscribeToken({ ...IDS, message_id: "+447700900123" }, OPTS),
    Error,
    "sms_unsubscribe_token_id_invalid",
  );
});
