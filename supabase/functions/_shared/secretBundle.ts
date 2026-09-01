/**
 * Strict, value-redacting readers for the four semantic secret bundles.
 *
 * Bundle values are never included in errors or telemetry. During the
 * compatibility window, a missing or invalid bundle falls back only to the
 * exact legacy name for the requested field.
 */

export type SecretEnvGetter = (name: string) => string | undefined;

export type PaymentModeField = "stripe_mode" | "paystack_mode";
export type EmailSenderField = "admin_from" | "system_from" | "ticket_from";
export type DeliveryFlagField =
  | "marketing_send_live_enabled"
  | "sms_live_enabled.ng"
  | "sms_live_enabled.us";
export type PaymentOperationFlagField =
  | "payout_hold_onboard_flip"
  | "payout_release_execute"
  | "source_refunds_post_disabled"
  | "paystack_payout_hold_onboard_flip"
  | "checkout_revocation_execute";
type LegacyPaymentOperationFlagField = Exclude<
  PaymentOperationFlagField,
  "paystack_payout_hold_onboard_flip" | "checkout_revocation_execute"
>;
type Schema3PaymentOperationFlagField = Exclude<
  PaymentOperationFlagField,
  "checkout_revocation_execute"
>;
export type AlertRecipientField =
  | "api_health"
  | "stripe_disputes"
  | "stripe_webhook_failures";

type BundleName =
  | "MINGLA_PAYMENT_MODES_JSON"
  | "MINGLA_EMAIL_SENDERS_JSON"
  | "MINGLA_DELIVERY_FLAGS_JSON"
  | "MINGLA_ALERT_RECIPIENTS_JSON";

type DiagnosticReason =
  | "invalid_json"
  | "not_object"
  | "oversized"
  | "schema_version"
  | "unknown_field"
  | "missing_field"
  | "wrong_type"
  | "invalid_value";

type ParseResult<T> =
  | { ok: true; value: T }
  | {
    ok: false;
    reason: DiagnosticReason;
    field?: string;
    schemaVersion?: number;
  };

const MAX_BUNDLE_BYTES = 48 * 1024;
const MAX_DIAGNOSTIC_SCHEMA_VERSION = 1_000_000;
const EMAIL_RE = /^(?:(.+?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/;
const emittedDiagnostics = new Set<string>();
const PAYMENT_MODE_LEGACY_NAMES: Record<PaymentModeField, string> = {
  stripe_mode: "MINGLA_STRIPE_MODE",
  paystack_mode: "PAYSTACK_MODE",
};
const EMAIL_SENDER_LEGACY_NAMES: Record<EmailSenderField, string> = {
  admin_from: "RESEND_ADMIN_FROM",
  system_from: "RESEND_SYSTEM_FROM",
  ticket_from: "RESEND_TICKET_FROM",
};
const DELIVERY_FLAG_LEGACY_NAMES: Record<DeliveryFlagField, string> = {
  marketing_send_live_enabled: "MARKETING_SEND_LIVE_ENABLED",
  "sms_live_enabled.ng": "SMS_LIVE_ENABLED_NG",
  "sms_live_enabled.us": "SMS_LIVE_ENABLED_US",
};
const PAYMENT_OPERATION_FLAG_LEGACY_NAMES: Record<
  LegacyPaymentOperationFlagField,
  string
> = {
  payout_hold_onboard_flip: "PAYOUT_HOLD_ONBOARD_FLIP",
  payout_release_execute: "PAYOUT_RELEASE_EXECUTE",
  source_refunds_post_disabled: "SOURCE_REFUNDS_POST_DISABLED",
};
const ALERT_RECIPIENT_LEGACY_NAMES: Record<AlertRecipientField, string> = {
  api_health: "API_HEALTH_ALERT_EMAILS",
  stripe_disputes: "STRIPE_DISPUTE_ALERT_EMAILS",
  stripe_webhook_failures: "STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS",
};

function defaultGetEnv(name: string): string | undefined {
  return Deno.env.get(name);
}

function diagnosticEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeField(field: string | undefined): string | undefined {
  return field && /^[a-z][a-z0-9_.]{0,63}$/.test(field) ? field : undefined;
}

function boundedSchemaVersion(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= MAX_DIAGNOSTIC_SCHEMA_VERSION
    ? value
    : undefined;
}

function emitDiagnostic(
  event: "secret_bundle_invalid" | "secret_bundle_legacy_fallback",
  bundle: BundleName,
  reason: DiagnosticReason | "missing",
  field?: string,
  schemaVersion?: number,
): void {
  const redactedField = safeField(field);
  const identity = [event, bundle, reason, redactedField ?? ""].join(":");
  if (emittedDiagnostics.has(identity)) return;
  emittedDiagnostics.add(identity);
  const diagnostic: Record<string, string | number> = {
    event,
    bundle,
    reason,
  };
  if (redactedField) diagnostic.field = redactedField;
  const redactedSchemaVersion = boundedSchemaVersion(schemaVersion);
  if (redactedSchemaVersion !== undefined) {
    diagnostic.schema_version = redactedSchemaVersion;
  }
  const deploymentId = diagnosticEnv("DENO_DEPLOYMENT_ID");
  if (deploymentId) diagnostic.deployment_id = deploymentId;
  const functionName = diagnosticEnv("DENO_FUNCTION_NAME");
  if (functionName && /^[a-z0-9-]{1,80}$/.test(functionName)) {
    diagnostic.function_name = functionName;
  }
  const serialized = JSON.stringify(diagnostic);
  if (event === "secret_bundle_invalid") console.error(serialized);
  else console.warn(serialized);
}

function parseObject(
  raw: string,
  allowedFields: readonly string[],
): ParseResult<Record<string, unknown>> {
  if (new TextEncoder().encode(raw).byteLength >= MAX_BUNDLE_BYTES) {
    return { ok: false, reason: "oversized" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "not_object" };
  const version = parsed.schema_version;
  if (version !== 1) {
    return {
      ok: false,
      reason: "schema_version",
      schemaVersion: boundedSchemaVersion(version),
    };
  }
  const allowed = new Set(["schema_version", ...allowedFields]);
  if (Object.keys(parsed).some((field) => !allowed.has(field))) {
    return { ok: false, reason: "unknown_field", field: "unknown" };
  }
  for (const field of allowedFields) {
    if (!Object.hasOwn(parsed, field)) {
      return { ok: false, reason: "missing_field", field };
    }
  }
  return { ok: true, value: parsed };
}

function parseModeBundle(
  raw: string,
): ParseResult<Record<PaymentModeField, "live" | "test">> {
  const base = parseObject(raw, ["stripe_mode", "paystack_mode"]);
  if (!base.ok) return base;
  for (const field of ["stripe_mode", "paystack_mode"] as const) {
    if (base.value[field] !== "live" && base.value[field] !== "test") {
      return { ok: false, reason: "invalid_value", field };
    }
  }
  return {
    ok: true,
    value: {
      stripe_mode: base.value.stripe_mode as "live" | "test",
      paystack_mode: base.value.paystack_mode as "live" | "test",
    },
  };
}

function validSender(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 320) return false;
  const match = value.match(EMAIL_RE);
  return match !== null && match[2].length <= 254;
}

function parseSenderBundle(
  raw: string,
): ParseResult<Record<EmailSenderField, string>> {
  const fields = ["admin_from", "system_from", "ticket_from"] as const;
  const base = parseObject(raw, fields);
  if (!base.ok) return base;
  for (const field of fields) {
    if (!validSender(base.value[field])) {
      return {
        ok: false,
        reason: typeof base.value[field] === "string"
          ? "invalid_value"
          : "wrong_type",
        field,
      };
    }
  }
  return {
    ok: true,
    value: {
      admin_from: base.value.admin_from as string,
      system_from: base.value.system_from as string,
      ticket_from: base.value.ticket_from as string,
    },
  };
}

type DeliveryFlags = {
  schema_version: 1;
  marketing_send_live_enabled: boolean;
  sms_live_enabled: { ng: boolean; us: boolean };
  payment_operations?: undefined;
} | {
  schema_version: 2;
  marketing_send_live_enabled: boolean;
  sms_live_enabled: { ng: boolean; us: boolean };
  payment_operations: Record<LegacyPaymentOperationFlagField, boolean>;
} | {
  schema_version: 3;
  marketing_send_live_enabled: boolean;
  sms_live_enabled: { ng: boolean; us: boolean };
  payment_operations: Record<Schema3PaymentOperationFlagField, boolean>;
} | {
  schema_version: 4;
  marketing_send_live_enabled: boolean;
  sms_live_enabled: { ng: boolean; us: boolean };
  payment_operations: Record<PaymentOperationFlagField, boolean>;
};

export function parseDeliveryBundle(raw: string): ParseResult<DeliveryFlags> {
  if (new TextEncoder().encode(raw).byteLength >= MAX_BUNDLE_BYTES) {
    return { ok: false, reason: "oversized" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "not_object" };
  const version = parsed.schema_version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) {
    return {
      ok: false,
      reason: "schema_version",
      schemaVersion: boundedSchemaVersion(version),
    };
  }
  const allowed = new Set([
    "schema_version",
    "marketing_send_live_enabled",
    "sms_live_enabled",
    ...(version === 2 || version === 3 || version === 4
      ? ["payment_operations"]
      : []),
  ]);
  if (Object.keys(parsed).some((field) => !allowed.has(field))) {
    return { ok: false, reason: "unknown_field", field: "unknown" };
  }
  for (
    const field of [
      "marketing_send_live_enabled",
      "sms_live_enabled",
      ...(version === 2 || version === 3 || version === 4
        ? ["payment_operations"]
        : []),
    ]
  ) {
    if (!Object.hasOwn(parsed, field)) {
      return { ok: false, reason: "missing_field", field };
    }
  }
  if (typeof parsed.marketing_send_live_enabled !== "boolean") {
    return {
      ok: false,
      reason: "wrong_type",
      field: "marketing_send_live_enabled",
    };
  }
  const sms = parsed.sms_live_enabled;
  if (!isRecord(sms)) {
    return { ok: false, reason: "wrong_type", field: "sms_live_enabled" };
  }
  if (
    Object.keys(sms).some((field) => field !== "ng" && field !== "us") ||
    !Object.hasOwn(sms, "ng") ||
    !Object.hasOwn(sms, "us")
  ) {
    return { ok: false, reason: "unknown_field", field: "sms_live_enabled" };
  }
  if (typeof sms.ng !== "boolean" || typeof sms.us !== "boolean") {
    return { ok: false, reason: "wrong_type", field: "sms_live_enabled" };
  }
  let paymentOperations:
    | Record<LegacyPaymentOperationFlagField, boolean>
    | Record<Schema3PaymentOperationFlagField, boolean>
    | Record<PaymentOperationFlagField, boolean>
    | undefined;
  if (version === 2 || version === 3 || version === 4) {
    const operations = parsed.payment_operations;
    if (!isRecord(operations)) {
      return {
        ok: false,
        reason: "wrong_type",
        field: "payment_operations",
      };
    }
    const operationFields = [
      "payout_hold_onboard_flip",
      "payout_release_execute",
      "source_refunds_post_disabled",
      ...(version === 3 || version === 4
        ? ["paystack_payout_hold_onboard_flip" as const]
        : []),
      ...(version === 4 ? ["checkout_revocation_execute" as const] : []),
    ] as const;
    if (
      Object.keys(operations).some((field) =>
        !operationFields.includes(field as PaymentOperationFlagField)
      )
    ) {
      return {
        ok: false,
        reason: "unknown_field",
        field: "payment_operations",
      };
    }
    for (const field of operationFields) {
      if (!Object.hasOwn(operations, field)) {
        return {
          ok: false,
          reason: "missing_field",
          field: `payment_operations.${field}`,
        };
      }
      if (typeof operations[field] !== "boolean") {
        return {
          ok: false,
          reason: "wrong_type",
          field: `payment_operations.${field}`,
        };
      }
    }
    paymentOperations = {
      payout_hold_onboard_flip: operations.payout_hold_onboard_flip as boolean,
      payout_release_execute: operations.payout_release_execute as boolean,
      source_refunds_post_disabled: operations
        .source_refunds_post_disabled as boolean,
      ...(version === 3 || version === 4
        ? {
          paystack_payout_hold_onboard_flip:
            operations.paystack_payout_hold_onboard_flip as boolean,
        }
        : {}),
      ...(version === 4
        ? {
          checkout_revocation_execute:
            operations.checkout_revocation_execute as boolean,
        }
        : {}),
    };
  }
  const deliveryValues = {
    marketing_send_live_enabled: parsed.marketing_send_live_enabled,
    sms_live_enabled: { ng: sms.ng, us: sms.us },
  };
  if (version === 1) {
    return { ok: true, value: { schema_version: 1, ...deliveryValues } };
  }
  if (version === 2) {
    return {
      ok: true,
      value: {
        schema_version: 2,
        ...deliveryValues,
        payment_operations:
          paymentOperations as Record<LegacyPaymentOperationFlagField, boolean>,
      },
    };
  }
  if (version === 3) {
    return {
      ok: true,
      value: {
        schema_version: 3,
        ...deliveryValues,
        payment_operations:
          paymentOperations as Record<
            Schema3PaymentOperationFlagField,
            boolean
          >,
      },
    };
  }
  return {
    ok: true,
    value: {
      schema_version: 4,
      ...deliveryValues,
      payment_operations:
        paymentOperations as Record<PaymentOperationFlagField, boolean>,
    },
  };
}

function parseRecipientList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return null;
  }
  const normalized: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      candidate.length > 254 ||
      !/^[^<>\s]+@[^<>\s]+$/.test(candidate)
    ) return null;
    normalized.push(candidate.toLowerCase());
  }
  return new Set(normalized).size === normalized.length ? normalized : null;
}

function parseAlertBundle(
  raw: string,
): ParseResult<Record<AlertRecipientField, string[]>> {
  const fields = [
    "api_health",
    "stripe_disputes",
    "stripe_webhook_failures",
  ] as const;
  const base = parseObject(raw, fields);
  if (!base.ok) return base;
  const apiHealth = parseRecipientList(base.value.api_health);
  const stripeDisputes = parseRecipientList(base.value.stripe_disputes);
  const stripeWebhookFailures = parseRecipientList(
    base.value.stripe_webhook_failures,
  );
  if (!apiHealth) {
    return { ok: false, reason: "invalid_value", field: "api_health" };
  }
  if (!stripeDisputes) {
    return { ok: false, reason: "invalid_value", field: "stripe_disputes" };
  }
  if (!stripeWebhookFailures) {
    return {
      ok: false,
      reason: "invalid_value",
      field: "stripe_webhook_failures",
    };
  }
  return {
    ok: true,
    value: {
      api_health: apiHealth,
      stripe_disputes: stripeDisputes,
      stripe_webhook_failures: stripeWebhookFailures,
    },
  };
}

function fallback<T>(
  bundle: BundleName,
  field: string,
  legacyName: string,
  result: ParseResult<T> | null,
  getEnv: SecretEnvGetter,
): string | undefined {
  if (result && !result.ok) {
    emitDiagnostic(
      "secret_bundle_invalid",
      bundle,
      result.reason,
      result.field,
      result.schemaVersion,
    );
  }
  emitDiagnostic(
    "secret_bundle_legacy_fallback",
    bundle,
    result === null ? "missing" : result.ok ? "missing" : result.reason,
    field,
    result && !result.ok ? result.schemaVersion : undefined,
  );
  return getEnv(legacyName);
}

function assertLegacyMapping(
  field: string,
  legacyName: string,
  expectedLegacyName: string,
): void {
  if (legacyName !== expectedLegacyName) {
    throw new Error(`secret_bundle_legacy_mapping_invalid:${field}`);
  }
}

export function resolvePaymentModeValue(
  field: PaymentModeField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): string | undefined {
  assertLegacyMapping(field, legacyName, PAYMENT_MODE_LEGACY_NAMES[field]);
  const bundle = "MINGLA_PAYMENT_MODES_JSON";
  const raw = getEnv(bundle);
  const result = raw ? parseModeBundle(raw) : null;
  return result?.ok
    ? result.value[field]
    : fallback(bundle, field, legacyName, result, getEnv);
}

export function resolveEmailSenderValue(
  field: EmailSenderField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): string | undefined {
  assertLegacyMapping(field, legacyName, EMAIL_SENDER_LEGACY_NAMES[field]);
  const bundle = "MINGLA_EMAIL_SENDERS_JSON";
  const raw = getEnv(bundle);
  const result = raw ? parseSenderBundle(raw) : null;
  return result?.ok
    ? result.value[field]
    : fallback(bundle, field, legacyName, result, getEnv);
}

export function resolveDeliveryFlagValue(
  field: DeliveryFlagField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): boolean | string | undefined {
  assertLegacyMapping(field, legacyName, DELIVERY_FLAG_LEGACY_NAMES[field]);
  const bundle = "MINGLA_DELIVERY_FLAGS_JSON";
  const raw = getEnv(bundle);
  const result = raw ? parseDeliveryBundle(raw) : null;
  if (result?.ok) {
    if (field === "marketing_send_live_enabled") {
      return result.value.marketing_send_live_enabled;
    }
    return field === "sms_live_enabled.ng"
      ? result.value.sms_live_enabled.ng
      : result.value.sms_live_enabled.us;
  }
  return fallback(bundle, field, legacyName, result, getEnv);
}

function parseLegacyBoolean(value: string | undefined): boolean | undefined {
  if (value?.toLowerCase() === "true") return true;
  if (value?.toLowerCase() === "false") return false;
  return undefined;
}

export function resolvePaymentOperationFlagValue(
  field: LegacyPaymentOperationFlagField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): boolean | undefined {
  assertLegacyMapping(
    field,
    legacyName,
    PAYMENT_OPERATION_FLAG_LEGACY_NAMES[field],
  );
  const bundle = "MINGLA_DELIVERY_FLAGS_JSON";
  const raw = getEnv(bundle);
  const result = raw ? parseDeliveryBundle(raw) : null;
  if (
    result?.ok &&
    (result.value.schema_version === 2 || result.value.schema_version === 3 ||
      result.value.schema_version === 4)
  ) {
    return result.value.payment_operations[field];
  }
  const legacy = fallback(bundle, field, legacyName, result, getEnv);
  return parseLegacyBoolean(legacy);
}

/**
 * Bundle-only Paystack onboarding authority. Deliberately has no legacy-name
 * parameter: a direct fallback could couple a new Nigerian brand to Stripe's
 * already-live onboarding switch and stamp the merchant prematurely.
 */
export function resolvePaystackPayoutHoldOnboardFlip(
  getEnv: SecretEnvGetter = defaultGetEnv,
): boolean {
  const bundle = "MINGLA_DELIVERY_FLAGS_JSON";
  const raw = getEnv(bundle);
  const result = raw ? parseDeliveryBundle(raw) : null;
  if (result?.ok) {
    return result.value.schema_version === 3 || result.value.schema_version === 4
      ? result.value.payment_operations.paystack_payout_hold_onboard_flip
      : false;
  }
  if (result && !result.ok) {
    emitDiagnostic(
      "secret_bundle_invalid",
      bundle,
      result.reason,
      result.field,
      result.schemaVersion,
    );
  }
  return false;
}

/**
 * Issue #2241 checkout execution authority. Schema v4 is authoritative; every
 * older or invalid bundle falls back only to the exact direct migration name.
 */
export function resolveCheckoutRevocationExecute(
  getEnv: SecretEnvGetter = defaultGetEnv,
): boolean {
  const bundle = "MINGLA_DELIVERY_FLAGS_JSON";
  const field = "checkout_revocation_execute";
  const legacyName = "CHECKOUT_REVOCATION_EXECUTE";
  const raw = getEnv(bundle);
  const result = raw ? parseDeliveryBundle(raw) : null;
  if (result?.ok && result.value.schema_version === 4) {
    return result.value.payment_operations.checkout_revocation_execute;
  }
  const legacy = fallback(bundle, field, legacyName, result, getEnv);
  return parseLegacyBoolean(legacy) ?? false;
}

export function resolveAlertRecipientValue(
  field: AlertRecipientField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): string[] | string | undefined {
  assertLegacyMapping(field, legacyName, ALERT_RECIPIENT_LEGACY_NAMES[field]);
  const bundle = "MINGLA_ALERT_RECIPIENTS_JSON";
  const raw = getEnv(bundle);
  const result = raw ? parseAlertBundle(raw) : null;
  return result?.ok
    ? result.value[field]
    : fallback(bundle, field, legacyName, result, getEnv);
}
