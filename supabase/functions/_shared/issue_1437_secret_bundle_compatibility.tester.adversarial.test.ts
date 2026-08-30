import {
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveDeliveryFlagValue,
  resolvePaymentOperationFlagValue,
  type SecretEnvGetter,
} from "./secretBundle.ts";
import {
  resolveNotificationRecipientHmacSecret,
} from "./notificationRecipientHmac.ts";
import {
  dispatchIdempotentLegacyEmail,
  recipientFingerprint,
} from "./legacyEmailIdempotency.ts";

function env(values: Record<string, string>): SecretEnvGetter {
  return (name: string): string | undefined => values[name];
}

Deno.test("issue #1437 tester: one malformed v2 field prevents mixed bundle and direct authority", () => {
  const getEnv = env({
    MINGLA_DELIVERY_FLAGS_JSON: JSON.stringify({
      schema_version: 2,
      marketing_send_live_enabled: true,
      sms_live_enabled: { ng: true, us: true },
      payment_operations: {
        payout_hold_onboard_flip: true,
        payout_release_execute: "true",
        source_refunds_post_disabled: false,
      },
    }),
    MARKETING_SEND_LIVE_ENABLED: "false",
    SMS_LIVE_ENABLED_NG: "false",
    SMS_LIVE_ENABLED_US: "false",
    PAYOUT_HOLD_ONBOARD_FLIP: "false",
    PAYOUT_RELEASE_EXECUTE: "false",
    SOURCE_REFUNDS_POST_DISABLED: "true",
  });

  assertStrictEquals(
    resolveDeliveryFlagValue(
      "marketing_send_live_enabled",
      "MARKETING_SEND_LIVE_ENABLED",
      getEnv,
    ),
    "false",
  );
  assertStrictEquals(
    resolveDeliveryFlagValue(
      "sms_live_enabled.ng",
      "SMS_LIVE_ENABLED_NG",
      getEnv,
    ),
    "false",
  );
  assertStrictEquals(
    resolveDeliveryFlagValue(
      "sms_live_enabled.us",
      "SMS_LIVE_ENABLED_US",
      getEnv,
    ),
    "false",
  );
  assertStrictEquals(
    resolvePaymentOperationFlagValue(
      "payout_hold_onboard_flip",
      "PAYOUT_HOLD_ONBOARD_FLIP",
      getEnv,
    ),
    false,
  );
  assertStrictEquals(
    resolvePaymentOperationFlagValue(
      "payout_release_execute",
      "PAYOUT_RELEASE_EXECUTE",
      getEnv,
    ),
    false,
  );
  assertStrictEquals(
    resolvePaymentOperationFlagValue(
      "source_refunds_post_disabled",
      "SOURCE_REFUNDS_POST_DISABLED",
      getEnv,
    ),
    true,
  );
});

Deno.test("issue #1437 tester: HMAC minimum length is exact and selected bytes affect the fingerprint", async () => {
  const thirtyOne = "x".repeat(31);
  const thirtyTwo = "x".repeat(32);
  const padded = ` ${thirtyTwo} `;

  assertStrictEquals(
    resolveNotificationRecipientHmacSecret(env({
      AD_CONVERSION_TOKENS: JSON.stringify({
        NOTIFICATION_RECIPIENT_HMAC_SECRET: thirtyOne,
      }),
    })),
    undefined,
  );
  assertStrictEquals(
    resolveNotificationRecipientHmacSecret(env({
      AD_CONVERSION_TOKENS: JSON.stringify({
        NOTIFICATION_RECIPIENT_HMAC_SECRET: thirtyTwo,
      }),
    })),
    thirtyTwo,
  );
  assertStrictEquals(
    resolveNotificationRecipientHmacSecret(env({
      AD_CONVERSION_TOKENS: JSON.stringify({
        NOTIFICATION_RECIPIENT_HMAC_SECRET: padded,
      }),
    })),
    padded,
  );
  assertNotEquals(
    await recipientFingerprint("person@example.com", padded),
    await recipientFingerprint("person@example.com", thirtyTwo),
  );
});

Deno.test("issue #1437 tester: malformed envelope diagnostics never reveal a valid direct fallback", () => {
  const directCanary = "SYNTHETIC_VALID_DIRECT_HMAC_CANARY_1437_NEVER_LOG_THIS";
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (message?: unknown) => errors.push(String(message));
  console.warn = (message?: unknown) => warnings.push(String(message));
  let resolved: string | undefined;
  try {
    resolved = resolveNotificationRecipientHmacSecret(env({
      AD_CONVERSION_TOKENS: "{",
      NOTIFICATION_RECIPIENT_HMAC_SECRET: directCanary,
    }));
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assertStrictEquals(resolved, directCanary);
  assertStrictEquals(errors.length, 1);
  assertStrictEquals(warnings.length, 1);
  assertStrictEquals(
    [...errors, ...warnings].some((line) => line.includes(directCanary)),
    false,
  );
});

Deno.test("issue #2874 tester: missing HMAC rejects before unresolved sibling digests start", async () => {
  // [TEST-MOD-APPROVED #2874] Keep any attempted SHA-256 siblings pending
  // until after the dispatch verdict. The old Promise.all ordering therefore
  // records two started digests deterministically instead of depending on
  // whether WebCrypto happens to finish before Deno's leak check.
  const subtle = crypto.subtle;
  const originalDigest = subtle.digest;
  const releaseDigests: Array<(value: ArrayBuffer) => void> = [];
  let digestCalls = 0;
  let claimCalls = 0;
  let providerCalls = 0;
  subtle.digest = (() => {
    digestCalls += 1;
    return new Promise<ArrayBuffer>((resolve) => releaseDigests.push(resolve));
  }) as SubtleCrypto["digest"];

  try {
    await assertRejects(
      () =>
        dispatchIdempotentLegacyEmail(
          {
            recipient: "person@example.com",
            logicalIdempotencyKey: "issue-2874-unresolved-digest-proof",
            recipientHmacSecret: "x".repeat(31),
            payload: {
              from: "Mingla <notifications@example.com>",
              to: ["person@example.com"],
              subject: "Missing HMAC ordering proof",
              text: "No digest, claim, or provider work may start.",
            },
          },
          {
            claimDelivery: () => {
              claimCalls += 1;
              throw new Error("claim_must_not_run");
            },
            completeDelivery: () => Promise.resolve(),
            sendResend: () => {
              providerCalls += 1;
              throw new Error("provider_must_not_run");
            },
          },
        ),
      Error,
      "notification_recipient_hmac_secret_missing",
    );
    assertStrictEquals(digestCalls, 0);
    assertStrictEquals(claimCalls, 0);
    assertStrictEquals(providerCalls, 0);
  } finally {
    subtle.digest = originalDigest;
    for (const release of releaseDigests) {
      release(new ArrayBuffer(32));
    }
  }
});
