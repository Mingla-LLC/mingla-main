import {
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type GovernedAdEnvGetter,
  type GovernedAdField,
  resolveGovernedAdField,
} from "./governedAdSecret.ts";
import {
  parseDeliveryBundle,
  resolveCheckoutRevocationExecute,
  resolvePaystackPayoutHoldOnboardFlip,
  type SecretEnvGetter,
} from "./secretBundle.ts";

function env(values: Record<string, string>): SecretEnvGetter {
  return (name: string): string | undefined => values[name];
}

const governed: GovernedAdField[] = [
  "ATTENDANCE_CLAIM_PEPPER",
  "META_COMPETITOR_ACCESS_TOKEN",
  "META_COMPETITOR_IG_USER_ID",
  "RESEND_WEBHOOK_SECRET",
];

function delivery(version: 3 | 4, checkout = false): string {
  return JSON.stringify({
    schema_version: version,
    marketing_send_live_enabled: true,
    sms_live_enabled: { ng: false, us: true },
    payment_operations: {
      payout_hold_onboard_flip: false,
      payout_release_execute: true,
      source_refunds_post_disabled: false,
      paystack_payout_hold_onboard_flip: true,
      ...(version === 4 ? { checkout_revocation_execute: checkout } : {}),
    },
  });
}

Deno.test("issue #2241 happy: every governed AD reader is bundle-first", () => {
  const bundle = Object.fromEntries(
    governed.map((field) => [field, `bundle-${field}`]),
  );
  for (const field of governed) {
    const getEnv: GovernedAdEnvGetter = env({
      AD_CONVERSION_TOKENS: JSON.stringify(bundle),
      [field]: `direct-${field}`,
    });
    assertStrictEquals(
      resolveGovernedAdField(field, field, getEnv),
      `bundle-${field}`,
    );
  }
});

Deno.test("issue #2241 happy: missing and invalid AD bundles use only the exact legacy name", () => {
  for (const field of governed) {
    assertStrictEquals(
      resolveGovernedAdField(field, field, env({ [field]: `legacy-${field}` })),
      `legacy-${field}`,
    );
    assertStrictEquals(
      resolveGovernedAdField(
        field,
        field,
        env({ AD_CONVERSION_TOKENS: "{", [field]: `legacy-${field}` }),
      ),
      `legacy-${field}`,
    );
  }
  assertThrows(
    () =>
      resolveGovernedAdField(
        "ATTENDANCE_CLAIM_PEPPER",
        "RESEND_WEBHOOK_SECRET",
        env({ RESEND_WEBHOOK_SECRET: "synthetic" }),
      ),
    Error,
    "governed_ad_legacy_mapping_invalid:ATTENDANCE_CLAIM_PEPPER",
  );
});

Deno.test("issue #2241 happy: AD diagnostics never contain credential material", () => {
  const canary = "SYNTHETIC_VALUE_CANARY_2241";
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (message?: unknown) => errors.push(String(message));
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    resolveGovernedAdField(
      "META_COMPETITOR_ACCESS_TOKEN",
      "META_COMPETITOR_ACCESS_TOKEN",
      env({
        AD_CONVERSION_TOKENS: JSON.stringify({
          META_COMPETITOR_ACCESS_TOKEN: { canary },
        }),
        META_COMPETITOR_ACCESS_TOKEN: canary,
      }),
    );
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  assertStrictEquals(
    [...errors, ...warnings].some((line) => line.includes(canary)),
    false,
  );
  for (const line of [...errors, ...warnings]) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assertEquals(
      Object.keys(parsed).sort(),
      ["bundle", "event", "field", "reason"],
    );
  }
});

Deno.test("issue #2241 happy: delivery schema v3 stays compatible and v4 owns checkout", () => {
  const parsedV3 = parseDeliveryBundle(delivery(3));
  assertStrictEquals(parsedV3.ok, true);
  assertStrictEquals(
    resolvePaystackPayoutHoldOnboardFlip(
      env({
        MINGLA_DELIVERY_FLAGS_JSON: delivery(3),
        PAYSTACK_PAYOUT_HOLD_ONBOARD_FLIP: "false",
      }),
    ),
    true,
  );
  assertStrictEquals(
    resolveCheckoutRevocationExecute(
      env({
        MINGLA_DELIVERY_FLAGS_JSON: delivery(3),
        CHECKOUT_REVOCATION_EXECUTE: "true",
      }),
    ),
    true,
  );
  assertStrictEquals(
    resolveCheckoutRevocationExecute(
      env({
        MINGLA_DELIVERY_FLAGS_JSON: delivery(4, false),
        CHECKOUT_REVOCATION_EXECUTE: "true",
      }),
    ),
    false,
  );
  assertStrictEquals(
    resolveCheckoutRevocationExecute(
      env({
        MINGLA_DELIVERY_FLAGS_JSON: delivery(4, true),
        CHECKOUT_REVOCATION_EXECUTE: "false",
      }),
    ),
    true,
  );
});

Deno.test("issue #2241 adversarial: malformed/partial/unknown/oversized v4 falls back fail-closed", () => {
  const cases = [
    "{",
    JSON.stringify({
      ...JSON.parse(delivery(4, true)),
      payment_operations: {
        payout_hold_onboard_flip: false,
        payout_release_execute: true,
        source_refunds_post_disabled: false,
        paystack_payout_hold_onboard_flip: true,
      },
    }),
    JSON.stringify({ ...JSON.parse(delivery(4, true)), smuggled: true }),
    " ".repeat(48 * 1024),
  ];
  for (const raw of cases) {
    assertStrictEquals(
      resolveCheckoutRevocationExecute(
        env({
          MINGLA_DELIVERY_FLAGS_JSON: raw,
          CHECKOUT_REVOCATION_EXECUTE: "false",
        }),
      ),
      false,
    );
  }
});
