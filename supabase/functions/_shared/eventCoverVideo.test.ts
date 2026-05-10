import {
  sha1Hex,
  verifyCloudinaryNotificationSignature,
} from "./eventCoverVideo.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

Deno.test("Cloudinary notification signature accepts body + timestamp + secret", async () => {
  const rawBody = '{"public_id":"sample"}';
  const timestamp = "1778346000";
  const apiSecret = "test-secret";
  const signature = await sha1Hex(`${rawBody}${timestamp}${apiSecret}`);

  const result = await verifyCloudinaryNotificationSignature({
    apiSecret,
    nowMs: 1778346000 * 1000,
    rawBody,
    signature,
    timestamp,
  });

  assert(result.ok, "expected documented Cloudinary notification signature to pass");
});

Deno.test("Cloudinary notification signature rejects old body-only payload", async () => {
  const rawBody = '{"public_id":"sample"}';
  const timestamp = "1778346000";
  const apiSecret = "test-secret";
  const oldStyleSignature = await sha1Hex(`${rawBody}${apiSecret}`);

  const result = await verifyCloudinaryNotificationSignature({
    apiSecret,
    nowMs: 1778346000 * 1000,
    rawBody,
    signature: oldStyleSignature,
    timestamp,
  });

  assert(!result.ok && result.code === "invalid_signature", "expected old signature to fail");
});

Deno.test("Cloudinary notification signature rejects missing timestamp", async () => {
  const result = await verifyCloudinaryNotificationSignature({
    apiSecret: "test-secret",
    nowMs: 1778346000 * 1000,
    rawBody: "{}",
    signature: "abc",
    timestamp: null,
  });

  assert(!result.ok && result.code === "missing_timestamp", "expected missing timestamp failure");
});

Deno.test("Cloudinary notification signature rejects stale timestamp", async () => {
  const result = await verifyCloudinaryNotificationSignature({
    apiSecret: "test-secret",
    nowMs: 1778346000 * 1000,
    rawBody: "{}",
    signature: "abc",
    timestamp: `${1778346000 - 7200}`,
  });

  assert(!result.ok && result.code === "stale_timestamp", "expected stale timestamp failure");
});

Deno.test("Cloudinary notification signature rejects invalid signature", async () => {
  const result = await verifyCloudinaryNotificationSignature({
    apiSecret: "test-secret",
    nowMs: 1778346000 * 1000,
    rawBody: "{}",
    signature: "not-the-signature",
    timestamp: "1778346000",
  });

  assert(!result.ok && result.code === "invalid_signature", "expected invalid signature failure");
});
