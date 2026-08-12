/**
 * #1903 implementor regression: the Paystack onboarding switch is schema-v3
 * bundle-only and independent from Stripe. Sharing Stripe authority, accepting
 * a direct Paystack authority, or activating during compatibility rollout can
 * move a real merchant onto event-anchored payouts prematurely.
 */
import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveDeliveryFlagValue,
  resolvePaymentOperationFlagValue,
  resolvePaystackPayoutHoldOnboardFlip,
  type SecretEnvGetter,
} from "./secretBundle.ts";

function env(values: Record<string, string>): SecretEnvGetter {
  return (name: string): string | undefined => values[name];
}

function bundle(
  schemaVersion: 1 | 2 | 3,
  bits: number,
): string {
  return JSON.stringify({
    schema_version: schemaVersion,
    marketing_send_live_enabled: Boolean(bits & 1),
    sms_live_enabled: { ng: Boolean(bits & 2), us: Boolean(bits & 4) },
    ...(schemaVersion >= 2
      ? {
        payment_operations: {
          payout_hold_onboard_flip: Boolean(bits & 8),
          payout_release_execute: Boolean(bits & 16),
          source_refunds_post_disabled: Boolean(bits & 32),
          ...(schemaVersion === 3
            ? { paystack_payout_hold_onboard_flip: Boolean(bits & 64) }
            : {}),
        },
      }
      : {}),
  });
}

Deno.test("#1903 H-1: all 128 schema-v3 switches remain independent", () => {
  for (let bits = 0; bits < 128; bits += 1) {
    const getEnv = env({ MINGLA_DELIVERY_FLAGS_JSON: bundle(3, bits) });
    assertStrictEquals(
      resolveDeliveryFlagValue(
        "marketing_send_live_enabled",
        "MARKETING_SEND_LIVE_ENABLED",
        getEnv,
      ),
      Boolean(bits & 1),
    );
    assertStrictEquals(
      resolveDeliveryFlagValue(
        "sms_live_enabled.ng",
        "SMS_LIVE_ENABLED_NG",
        getEnv,
      ),
      Boolean(bits & 2),
    );
    assertStrictEquals(
      resolveDeliveryFlagValue(
        "sms_live_enabled.us",
        "SMS_LIVE_ENABLED_US",
        getEnv,
      ),
      Boolean(bits & 4),
    );
    assertStrictEquals(
      resolvePaymentOperationFlagValue(
        "payout_hold_onboard_flip",
        "PAYOUT_HOLD_ONBOARD_FLIP",
        getEnv,
      ),
      Boolean(bits & 8),
    );
    assertStrictEquals(
      resolvePaymentOperationFlagValue(
        "payout_release_execute",
        "PAYOUT_RELEASE_EXECUTE",
        getEnv,
      ),
      Boolean(bits & 16),
    );
    assertStrictEquals(
      resolvePaymentOperationFlagValue(
        "source_refunds_post_disabled",
        "SOURCE_REFUNDS_POST_DISABLED",
        getEnv,
      ),
      Boolean(bits & 32),
    );
    assertStrictEquals(
      resolvePaystackPayoutHoldOnboardFlip(getEnv),
      Boolean(bits & 64),
    );
  }
});

Deno.test("#1903 H-2: v1/v2 preserve established controls and keep Paystack dark", () => {
  for (const schemaVersion of [1, 2] as const) {
    const raw = bundle(schemaVersion, 63);
    const getEnv = env({
      MINGLA_DELIVERY_FLAGS_JSON: raw,
      PAYOUT_HOLD_ONBOARD_FLIP: "false",
      PAYOUT_RELEASE_EXECUTE: "false",
      SOURCE_REFUNDS_POST_DISABLED: "false",
    });
    assertStrictEquals(
      resolveDeliveryFlagValue(
        "marketing_send_live_enabled",
        "MARKETING_SEND_LIVE_ENABLED",
        getEnv,
      ),
      true,
    );
    assertStrictEquals(resolvePaystackPayoutHoldOnboardFlip(getEnv), false);
    assertStrictEquals(
      resolvePaymentOperationFlagValue(
        "payout_hold_onboard_flip",
        "PAYOUT_HOLD_ONBOARD_FLIP",
        getEnv,
      ),
      schemaVersion === 2,
    );
  }
});

Deno.test("#1903 E-1: every invalid or non-v3 Paystack authority fails false", () => {
  const base = JSON.parse(bundle(3, 127)) as Record<string, unknown>;
  const operations = base.payment_operations as Record<string, unknown>;
  const cases: Array<string | undefined> = [
    undefined,
    "{",
    "x".repeat(48 * 1024),
    "[]",
    JSON.stringify({ schema_version: 4 }),
    bundle(1, 127),
    bundle(2, 127),
    JSON.stringify({ ...base, extra: false }),
    JSON.stringify({
      ...base,
      payment_operations: { ...operations, extra: false },
    }),
    ...[undefined, "true", 1, null, {}, []].map((value) => {
      const mutated = { ...operations };
      if (value === undefined) delete mutated.paystack_payout_hold_onboard_flip;
      else mutated.paystack_payout_hold_onboard_flip = value;
      return JSON.stringify({ ...base, payment_operations: mutated });
    }),
    bundle(3, 63),
  ];
  for (const raw of cases) {
    const getEnv = env(
      raw === undefined ? {} : {
        MINGLA_DELIVERY_FLAGS_JSON: raw,
      },
    );
    assertStrictEquals(resolvePaystackPayoutHoldOnboardFlip(getEnv), false);
  }
});

Deno.test("#1903 SC-5: v3 does not couple Stripe and Paystack onboarding", () => {
  const observed: Array<[boolean, boolean]> = [];
  for (const bits of [0, 8, 64, 72]) {
    const getEnv = env({ MINGLA_DELIVERY_FLAGS_JSON: bundle(3, bits) });
    observed.push([
      resolvePaymentOperationFlagValue(
        "payout_hold_onboard_flip",
        "PAYOUT_HOLD_ONBOARD_FLIP",
        getEnv,
      ) ?? false,
      resolvePaystackPayoutHoldOnboardFlip(getEnv),
    ]);
  }
  assertEquals(observed, [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]);
});
