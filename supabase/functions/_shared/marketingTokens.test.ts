// ORCH-0815-B — Unit tests for marketing token primitives.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  generateTrackingId,
  signUnsubscribeToken,
  TRACKING_ID_RE,
  verifyUnsubscribeToken,
} from "./marketingTokens.ts";

const TEST_SECRET = "a".repeat(32);

async function withSecret<T>(
  secret: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const original = Deno.env.get("UNSUBSCRIBE_TOKEN_SECRET");
  Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", secret);
  try {
    return await fn();
  } finally {
    if (original === undefined) Deno.env.delete("UNSUBSCRIBE_TOKEN_SECRET");
    else Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", original);
  }
}

Deno.test("signUnsubscribeToken + verifyUnsubscribeToken — happy path roundtrip", async () => {
  await withSecret(TEST_SECRET, async () => {
    const token = await signUnsubscribeToken({
      campaign_id: "11111111-1111-1111-1111-111111111111",
      recipient_email: "alice@example.com",
      brand_id: "22222222-2222-2222-2222-222222222222",
    });
    assert(token.includes("."));
    const payload = await verifyUnsubscribeToken(token);
    assertEquals(payload.campaign_id, "11111111-1111-1111-1111-111111111111");
    assertEquals(payload.recipient_email, "alice@example.com");
    assertEquals(payload.brand_id, "22222222-2222-2222-2222-222222222222");
    assert(payload.exp > Math.floor(Date.now() / 1000));
  });
});

Deno.test("verifyUnsubscribeToken — tampered signature rejected", async () => {
  await withSecret(TEST_SECRET, async () => {
    const token = await signUnsubscribeToken({
      campaign_id: "11111111-1111-1111-1111-111111111111",
      recipient_email: "alice@example.com",
      brand_id: "22222222-2222-2222-2222-222222222222",
    });
    const [payload, _sig] = token.split(".");
    // Re-sign with one bit flipped in the signature.
    const corrupted = `${payload}.AAAA${_sig.slice(4)}`;
    await assertRejects(
      () => verifyUnsubscribeToken(corrupted),
      Error,
      "unsubscribe_token_signature_invalid",
    );
  });
});

Deno.test("verifyUnsubscribeToken — expired token rejected", async () => {
  await withSecret(TEST_SECRET, async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await signUnsubscribeToken({
      campaign_id: "11111111-1111-1111-1111-111111111111",
      recipient_email: "alice@example.com",
      brand_id: "22222222-2222-2222-2222-222222222222",
      exp: past,
    });
    await assertRejects(
      () => verifyUnsubscribeToken(token),
      Error,
      "unsubscribe_token_expired",
    );
  });
});

Deno.test("verifyUnsubscribeToken — malformed token rejected", async () => {
  await withSecret(TEST_SECRET, async () => {
    await assertRejects(
      () => verifyUnsubscribeToken("not-a-token"),
      Error,
      "unsubscribe_token_malformed",
    );
  });
});

Deno.test("signUnsubscribeToken — missing/weak secret throws", async () => {
  await withSecret("short", async () => {
    await assertRejects(
      () =>
        signUnsubscribeToken({
          campaign_id: "11111111-1111-1111-1111-111111111111",
          recipient_email: "alice@example.com",
          brand_id: "22222222-2222-2222-2222-222222222222",
        }),
      Error,
      "marketing_token_secret_missing_or_weak",
    );
  });
});

Deno.test("generateTrackingId — UUID v4 shape", () => {
  for (let i = 0; i < 10; i += 1) {
    const id = generateTrackingId();
    assert(TRACKING_ID_RE.test(id), `not UUID: ${id}`);
  }
});
