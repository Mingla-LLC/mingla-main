import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveAlertRecipientValue,
  resolveDeliveryFlagValue,
  resolveEmailSenderValue,
  resolvePaymentModeValue,
  type SecretEnvGetter,
} from "./secretBundle.ts";
import {
  parseRuntimeConfig,
  resolveOfferingInviteSmsPriceBook,
  resolveRuntimeNumber,
  resolveRuntimeString,
} from "./runtimeConfig.ts";
import { resolveCapiToken } from "./capiTokens.ts";

function env(values: Record<string, string>): SecretEnvGetter {
  return (name: string): string | undefined => values[name];
}

const runtimeBundle = JSON.stringify({
  schema_version: 1,
  bunny_storage_cap_bytes: 1000,
  bunny_traffic_cap_bytes: 2000,
  event_cover_video_provider: "bunny",
  google_ads_api_version: "v24",
  meta_api_version: "v25.0",
  mingla_footer_address: "Mingla legal address",
  mingla_logo_url: "https://usemingla.com/brand/email/logo.png",
  termii_base_url: "https://v3.api.termii.com",
});

Deno.test("issue #1203 HP-1: valid bundles win and every semantic field stays independent", () => {
  const getEnv = env({
    MINGLA_PAYMENT_MODES_JSON: JSON.stringify({
      schema_version: 1,
      stripe_mode: "live",
      paystack_mode: "test",
    }),
    MINGLA_EMAIL_SENDERS_JSON: JSON.stringify({
      schema_version: 1,
      admin_from: "Admin <admin@example.com>",
      system_from: "System <system@example.com>",
      ticket_from: "Tickets <tickets@example.com>",
    }),
    MINGLA_DELIVERY_FLAGS_JSON: JSON.stringify({
      schema_version: 1,
      marketing_send_live_enabled: true,
      sms_live_enabled: { ng: false, us: true },
    }),
    MINGLA_ALERT_RECIPIENTS_JSON: JSON.stringify({
      schema_version: 1,
      api_health: ["health@example.com"],
      stripe_disputes: ["disputes@example.com"],
      stripe_webhook_failures: ["webhooks@example.com"],
    }),
    MINGLA_RUNTIME_CONFIG_JSON: runtimeBundle,
    MINGLA_STRIPE_MODE: "test",
    PAYSTACK_MODE: "live",
    RESEND_ADMIN_FROM: "legacy-admin@example.com",
    MARKETING_SEND_LIVE_ENABLED: "false",
    API_HEALTH_ALERT_EMAILS: "legacy-health@example.com",
    BUNNY_STORAGE_CAP_BYTES: "1",
  });

  assertEquals(
    resolvePaymentModeValue("stripe_mode", "MINGLA_STRIPE_MODE", getEnv),
    "live",
  );
  assertEquals(
    resolvePaymentModeValue("paystack_mode", "PAYSTACK_MODE", getEnv),
    "test",
  );
  assertEquals(
    resolveEmailSenderValue("admin_from", "RESEND_ADMIN_FROM", getEnv),
    "Admin <admin@example.com>",
  );
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
  assertEquals(
    resolveAlertRecipientValue("api_health", "API_HEALTH_ALERT_EMAILS", getEnv),
    ["health@example.com"],
  );
  assertEquals(
    resolveRuntimeNumber(
      "bunny_storage_cap_bytes",
      "BUNNY_STORAGE_CAP_BYTES",
      getEnv,
    ),
    1000,
  );
  assertEquals(
    resolveRuntimeString(
      "event_cover_video_provider",
      "EVENT_COVER_VIDEO_PROVIDER",
      getEnv,
    ),
    "bunny",
  );
  assertEquals(
    resolveRuntimeString("termii_base_url", "TERMII_BASE_URL", getEnv),
    "https://v3.api.termii.com",
  );
});

Deno.test("issue #1770 runtime bundle carries the optional versioned SMS price book", () => {
  const priceBook = [{
    rateId: "twilio-us-2026-08",
    provider: "twilio",
    country: "US",
    currency: "USD",
    unit: "sms_segment",
    minorNumerator: 83,
    minorDenominator: 100,
    effectiveAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    sourceReference: "official-provider-pricing",
  }];
  const getEnv = env({
    MINGLA_RUNTIME_CONFIG_JSON: JSON.stringify({
      ...JSON.parse(runtimeBundle),
      offering_invite_sms_price_book_v1: priceBook,
    }),
  });
  assertEquals(resolveOfferingInviteSmsPriceBook(getEnv), priceBook);
  assertStrictEquals(
    resolveOfferingInviteSmsPriceBook(env({
      MINGLA_RUNTIME_CONFIG_JSON: runtimeBundle,
    })),
    undefined,
  );
});

Deno.test("issue #1203 HP-2: an absent bundle uses only its exact legacy name", () => {
  const getEnv = env({
    MINGLA_STRIPE_MODE: "live",
    RESEND_TICKET_FROM: "Legacy Tickets <tickets@example.com>",
    SMS_LIVE_ENABLED_NG: "1",
    STRIPE_DISPUTE_ALERT_EMAILS: "a@example.com,b@example.com",
    META_API_VERSION: "v24.0",
    BUNNY_TRAFFIC_CAP_BYTES: "3000",
  });

  assertEquals(
    resolvePaymentModeValue("stripe_mode", "MINGLA_STRIPE_MODE", getEnv),
    "live",
  );
  assertEquals(
    resolveEmailSenderValue("ticket_from", "RESEND_TICKET_FROM", getEnv),
    "Legacy Tickets <tickets@example.com>",
  );
  assertEquals(
    resolveDeliveryFlagValue(
      "sms_live_enabled.ng",
      "SMS_LIVE_ENABLED_NG",
      getEnv,
    ),
    "1",
  );
  assertEquals(
    resolveAlertRecipientValue(
      "stripe_disputes",
      "STRIPE_DISPUTE_ALERT_EMAILS",
      getEnv,
    ),
    "a@example.com,b@example.com",
  );
  assertEquals(
    resolveRuntimeString("meta_api_version", "META_API_VERSION", getEnv),
    "v24.0",
  );
  assertEquals(
    resolveRuntimeNumber(
      "bunny_traffic_cap_bytes",
      "BUNNY_TRAFFIC_CAP_BYTES",
      getEnv,
    ),
    3000,
  );
});

Deno.test("issue #1203 HP-3: CAPI token-name lookup stays inside AD_CONVERSION_TOKENS", () => {
  const getEnv = env({
    AD_CONVERSION_TOKENS: JSON.stringify({
      SYNTHETIC_CAPI_TOKEN_NAME: "synthetic-token-value",
    }),
  });
  assertEquals(
    resolveCapiToken("SYNTHETIC_CAPI_TOKEN_NAME", getEnv),
    "synthetic-token-value",
  );
  assertEquals(resolveCapiToken("MISSING_CAPI_TOKEN_NAME", getEnv), undefined);
});

Deno.test("issue #1203: B-5 accepts exactly the eight approved non-credential fields", () => {
  const parsed = parseRuntimeConfig(runtimeBundle);
  assertStrictEquals(parsed.ok, true);
  if (parsed.ok) {
    assertEquals(Object.keys(parsed.value).sort(), [
      "bunny_storage_cap_bytes",
      "bunny_traffic_cap_bytes",
      "event_cover_video_provider",
      "google_ads_api_version",
      "meta_api_version",
      "mingla_footer_address",
      "mingla_logo_url",
      "schema_version",
      "termii_base_url",
    ]);
  }
});
