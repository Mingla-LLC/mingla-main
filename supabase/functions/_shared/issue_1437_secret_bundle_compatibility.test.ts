import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
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

function deliveryBundle(
  schemaVersion: 1 | 2,
  values: {
    marketing: boolean;
    ng: boolean;
    us: boolean;
    onboard?: boolean;
    payout?: boolean;
    refundsDisabled?: boolean;
  },
): string {
  return JSON.stringify({
    schema_version: schemaVersion,
    marketing_send_live_enabled: values.marketing,
    sms_live_enabled: { ng: values.ng, us: values.us },
    ...(schemaVersion === 2
      ? {
        payment_operations: {
          payout_hold_onboard_flip: values.onboard,
          payout_release_execute: values.payout,
          source_refunds_post_disabled: values.refundsDisabled,
        },
      }
      : {}),
  });
}

Deno.test("issue #1437 HP-1: delivery schema v1 keeps all existing values unchanged", () => {
  const getEnv = env({
    MINGLA_DELIVERY_FLAGS_JSON: deliveryBundle(1, {
      marketing: true,
      ng: false,
      us: true,
    }),
  });
  assertStrictEquals(
    resolveDeliveryFlagValue(
      "marketing_send_live_enabled",
      "MARKETING_SEND_LIVE_ENABLED",
      getEnv,
    ),
    true,
  );
  assertStrictEquals(
    resolveDeliveryFlagValue(
      "sms_live_enabled.ng",
      "SMS_LIVE_ENABLED_NG",
      getEnv,
    ),
    false,
  );
  assertStrictEquals(
    resolveDeliveryFlagValue(
      "sms_live_enabled.us",
      "SMS_LIVE_ENABLED_US",
      getEnv,
    ),
    true,
  );
});

Deno.test("issue #1437 HP-2: all 64 schema-v2 switch combinations stay independent", () => {
  for (let bits = 0; bits < 64; bits += 1) {
    const values = {
      marketing: Boolean(bits & 1),
      ng: Boolean(bits & 2),
      us: Boolean(bits & 4),
      onboard: Boolean(bits & 8),
      payout: Boolean(bits & 16),
      refundsDisabled: Boolean(bits & 32),
    };
    const getEnv = env({
      MINGLA_DELIVERY_FLAGS_JSON: deliveryBundle(2, values),
      MARKETING_SEND_LIVE_ENABLED: String(!values.marketing),
      SMS_LIVE_ENABLED_NG: String(!values.ng),
      SMS_LIVE_ENABLED_US: String(!values.us),
      PAYOUT_HOLD_ONBOARD_FLIP: String(!values.onboard),
      PAYOUT_RELEASE_EXECUTE: String(!values.payout),
      SOURCE_REFUNDS_POST_DISABLED: String(!values.refundsDisabled),
    });
    assertStrictEquals(
      resolveDeliveryFlagValue(
        "marketing_send_live_enabled",
        "MARKETING_SEND_LIVE_ENABLED",
        getEnv,
      ),
      values.marketing,
    );
    assertStrictEquals(
      resolveDeliveryFlagValue(
        "sms_live_enabled.ng",
        "SMS_LIVE_ENABLED_NG",
        getEnv,
      ),
      values.ng,
    );
    assertStrictEquals(
      resolveDeliveryFlagValue(
        "sms_live_enabled.us",
        "SMS_LIVE_ENABLED_US",
        getEnv,
      ),
      values.us,
    );
    assertStrictEquals(
      resolvePaymentOperationFlagValue(
        "payout_hold_onboard_flip",
        "PAYOUT_HOLD_ONBOARD_FLIP",
        getEnv,
      ),
      values.onboard,
    );
    assertStrictEquals(
      resolvePaymentOperationFlagValue(
        "payout_release_execute",
        "PAYOUT_RELEASE_EXECUTE",
        getEnv,
      ),
      values.payout,
    );
    assertStrictEquals(
      resolvePaymentOperationFlagValue(
        "source_refunds_post_disabled",
        "SOURCE_REFUNDS_POST_DISABLED",
        getEnv,
      ),
      values.refundsDisabled,
    );
  }
});

Deno.test("issue #1437 HP-3: schema v1 and invalid v2 use only exact direct controls", () => {
  const v1 = deliveryBundle(1, {
    marketing: false,
    ng: false,
    us: false,
  });
  assertStrictEquals(
    resolvePaymentOperationFlagValue(
      "payout_hold_onboard_flip",
      "PAYOUT_HOLD_ONBOARD_FLIP",
      env({
        MINGLA_DELIVERY_FLAGS_JSON: v1,
        PAYOUT_HOLD_ONBOARD_FLIP: "TrUe",
      }),
    ),
    true,
  );
  assertStrictEquals(
    resolvePaymentOperationFlagValue(
      "payout_release_execute",
      "PAYOUT_RELEASE_EXECUTE",
      env({
        MINGLA_DELIVERY_FLAGS_JSON: '{"schema_version":7}',
        PAYOUT_RELEASE_EXECUTE: "FALSE",
      }),
    ),
    false,
  );
  assertStrictEquals(
    resolvePaymentOperationFlagValue(
      "source_refunds_post_disabled",
      "SOURCE_REFUNDS_POST_DISABLED",
      env({ SOURCE_REFUNDS_POST_DISABLED: " true " }),
    ),
    undefined,
  );
  assertThrows(
    () =>
      resolvePaymentOperationFlagValue(
        "payout_release_execute",
        "SOURCE_REFUNDS_POST_DISABLED",
        env({ SOURCE_REFUNDS_POST_DISABLED: "true" }),
      ),
    Error,
    "secret_bundle_legacy_mapping_invalid:payout_release_execute",
  );
});

Deno.test("issue #1437 HP-4: malformed, unknown, and oversized bundles fail to exact direct values", () => {
  const cases = [
    "{",
    JSON.stringify({
      schema_version: 2,
      marketing_send_live_enabled: false,
      sms_live_enabled: { ng: false, us: false },
      payment_operations: {
        payout_hold_onboard_flip: false,
        payout_release_execute: false,
        source_refunds_post_disabled: true,
      },
      smuggled: true,
    }),
    " ".repeat(48 * 1024),
  ];
  for (const raw of cases) {
    assertStrictEquals(
      resolvePaymentOperationFlagValue(
        "payout_release_execute",
        "PAYOUT_RELEASE_EXECUTE",
        env({
          MINGLA_DELIVERY_FLAGS_JSON: raw,
          PAYOUT_RELEASE_EXECUTE: "true",
        }),
      ),
      true,
    );
  }
});

Deno.test("issue #1437 HP-4b: missing, wrong-type, and nested-unknown v2 fields reject without leaking values", () => {
  const canary = "SYNTHETIC_BUNDLE_CANARY_1437";
  const invalidBundles = [
    {
      schema_version: 2,
      marketing_send_live_enabled: false,
      sms_live_enabled: { ng: false, us: false },
      payment_operations: {
        payout_hold_onboard_flip: false,
        payout_release_execute: "true",
        source_refunds_post_disabled: true,
      },
    },
    {
      schema_version: 2,
      marketing_send_live_enabled: false,
      sms_live_enabled: { ng: false, us: false },
      payment_operations: {
        payout_hold_onboard_flip: false,
        source_refunds_post_disabled: true,
      },
    },
    {
      schema_version: 2,
      marketing_send_live_enabled: false,
      sms_live_enabled: { ng: false, us: false },
      payment_operations: {
        payout_hold_onboard_flip: false,
        payout_release_execute: false,
        source_refunds_post_disabled: true,
        smuggled: canary,
      },
    },
  ];
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (message?: unknown) => errors.push(String(message));
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    for (const bundle of invalidBundles) {
      assertStrictEquals(
        resolvePaymentOperationFlagValue(
          "payout_release_execute",
          "PAYOUT_RELEASE_EXECUTE",
          env({
            MINGLA_DELIVERY_FLAGS_JSON: JSON.stringify(bundle),
            PAYOUT_RELEASE_EXECUTE: "true",
          }),
        ),
        true,
      );
    }
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  assertStrictEquals(
    [...errors, ...warnings].some((line) => line.includes(canary)),
    false,
  );
  for (const line of [...errors, ...warnings]) {
    const diagnostic = JSON.parse(line) as Record<string, unknown>;
    assertStrictEquals(
      Object.keys(diagnostic).every((field) =>
        [
          "event",
          "bundle",
          "field",
          "reason",
          "schema_version",
          "deployment_id",
          "function_name",
        ].includes(field)
      ),
      true,
    );
  }
});

Deno.test("issue #1437 HP-5: caller defaults are safe when no valid control exists", () => {
  const getEnv = env({});
  const onboard = resolvePaymentOperationFlagValue(
    "payout_hold_onboard_flip",
    "PAYOUT_HOLD_ONBOARD_FLIP",
    getEnv,
  ) ?? false;
  const payout = resolvePaymentOperationFlagValue(
    "payout_release_execute",
    "PAYOUT_RELEASE_EXECUTE",
    getEnv,
  ) ?? false;
  const refundsDisabled = resolvePaymentOperationFlagValue(
    "source_refunds_post_disabled",
    "SOURCE_REFUNDS_POST_DISABLED",
    getEnv,
  ) ?? true;
  assertStrictEquals(onboard, false);
  assertStrictEquals(payout, false);
  assertStrictEquals(refundsDisabled, true);
});

Deno.test("issue #1437 HP-6: HMAC bundle wins without transforming bytes and direct fallback remains compatible", async () => {
  const bundled = "  bundle-secret-material-that-is-long-enough  ";
  const direct = "direct-secret-material-that-is-long-enough";
  const fromBundle = resolveNotificationRecipientHmacSecret(env({
    AD_CONVERSION_TOKENS: JSON.stringify({
      SYNTHETIC_CAPI_TOKEN: "untouched",
      NOTIFICATION_RECIPIENT_HMAC_SECRET: bundled,
    }),
    NOTIFICATION_RECIPIENT_HMAC_SECRET: direct,
  }));
  const fromDirect = resolveNotificationRecipientHmacSecret(env({
    AD_CONVERSION_TOKENS: JSON.stringify({
      SYNTHETIC_CAPI_TOKEN: "untouched",
    }),
    NOTIFICATION_RECIPIENT_HMAC_SECRET: direct,
  }));
  assertStrictEquals(fromBundle, bundled);
  assertStrictEquals(fromDirect, direct);
  assertEquals(
    await recipientFingerprint("person@example.com", fromDirect!),
    await recipientFingerprint(
      "person@example.com",
      resolveNotificationRecipientHmacSecret(env({
        AD_CONVERSION_TOKENS: JSON.stringify({
          NOTIFICATION_RECIPIENT_HMAC_SECRET: direct,
        }),
      }))!,
    ),
  );
});

Deno.test("issue #1437 HP-7: invalid HMAC material fails closed and diagnostics redact values", () => {
  const canary = "SYNTHETIC_SECRET_CANARY_1437";
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (message?: unknown) => errors.push(String(message));
  console.warn = (message?: unknown) => warnings.push(String(message));
  let resolved: string | undefined;
  try {
    resolved = resolveNotificationRecipientHmacSecret(env({
      AD_CONVERSION_TOKENS: JSON.stringify({
        NOTIFICATION_RECIPIENT_HMAC_SECRET: canary,
      }),
      NOTIFICATION_RECIPIENT_HMAC_SECRET: "short",
    }));
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  assertStrictEquals(resolved, undefined);
  assertStrictEquals(errors.length, 1);
  assertStrictEquals(warnings.length, 1);
  assertStrictEquals(
    JSON.parse(errors[0]).event,
    "notification_hmac_bundle_invalid",
  );
  assertStrictEquals(
    JSON.parse(warnings[0]).event,
    "notification_hmac_legacy_fallback",
  );
  assertStrictEquals(
    [...errors, ...warnings].some((line) => line.includes(canary)),
    false,
  );
});

Deno.test("issue #1437 HP-8: missing HMAC authority fails before claim or provider I/O", async () => {
  // [TEST-MOD-APPROVED #2874] The missing-authority rejection must happen
  // before Promise.all starts either sibling SHA-256 digest. Counting the real
  // WebCrypto boundary makes the former timing-dependent Deno leak deterministic.
  const subtle = crypto.subtle;
  const originalDigest = subtle.digest;
  let digestCalls = 0;
  let claimCalls = 0;
  let providerCalls = 0;
  subtle.digest = ((algorithm: AlgorithmIdentifier, data: BufferSource) => {
    digestCalls += 1;
    return originalDigest.call(subtle, algorithm, data);
  }) as SubtleCrypto["digest"];
  try {
    await assertRejects(
      () =>
        dispatchIdempotentLegacyEmail(
          {
            recipient: "person@example.com",
            logicalIdempotencyKey: "issue-1437-no-hmac",
            recipientHmacSecret:
              resolveNotificationRecipientHmacSecret(env({})) ?? "",
            payload: {
              from: "Mingla <notifications@example.com>",
              to: ["person@example.com"],
              subject: "Compatibility proof",
              text: "No provider call is allowed.",
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
  } finally {
    subtle.digest = originalDigest;
  }
  assertStrictEquals(digestCalls, 0);
  assertStrictEquals(claimCalls, 0);
  assertStrictEquals(providerCalls, 0);
});
