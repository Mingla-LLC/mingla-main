import { type SecretEnvGetter } from "./secretBundle.ts";

export type RuntimeConfigField =
  | "bunny_storage_cap_bytes"
  | "bunny_traffic_cap_bytes"
  | "content_share_v1_create_enabled"
  | "event_cover_video_provider"
  | "google_ads_api_version"
  | "meta_api_version"
  | "mingla_footer_address"
  | "mingla_logo_url"
  | "ng_payout_float_horizon_days"
  | "offering_invite_sms_price_book_v1"
  | "termii_base_url";

export type RuntimeStringField = Exclude<
  RuntimeConfigField,
  | "bunny_storage_cap_bytes"
  | "bunny_traffic_cap_bytes"
  | "content_share_v1_create_enabled"
  | "ng_payout_float_horizon_days"
  | "offering_invite_sms_price_book_v1"
>;
export type RuntimeNumberField =
  | "bunny_storage_cap_bytes"
  | "bunny_traffic_cap_bytes";
export type RuntimeBooleanField = "content_share_v1_create_enabled";

type RuntimeConfig = {
  schema_version: 1;
  bunny_storage_cap_bytes: number;
  bunny_traffic_cap_bytes: number;
  content_share_v1_create_enabled?: boolean;
  event_cover_video_provider: "cloudinary" | "bunny";
  google_ads_api_version: string;
  meta_api_version: string;
  mingla_footer_address: string;
  mingla_logo_url: string;
  /**
   * Issue #1840 — how many days ahead payout-release-sweep forecasts the
   * Nigerian payout float. Optional: an older deployed bundle without it still
   * parses, and the caller applies the 7-day default.
   *
   * Deliberately typed `unknown` and deliberately NOT validated by
   * parseRuntimeConfig. parseRuntimeConfig is all-or-nothing — the hazard this
   * file already documents for `event_cover_video_provider` — so a strict
   * validator here would let one bad payments tunable invalidate the WHOLE
   * shared bundle and silently fall `mingla_logo_url`, `termii_base_url`, the
   * Bunny caps and every other unrelated field back to legacy env vars. A
   * platform-wide degradation caused by a payout knob is a far worse outcome
   * than a wrong horizon. All narrowing and clamping happens in
   * resolveNgPayoutFloatHorizonDays instead, where the blast radius is one
   * reader.
   */
  ng_payout_float_horizon_days?: unknown;
  offering_invite_sms_price_book_v1?: unknown[];
  termii_base_url: string;
};

type ParseFailure = {
  ok: false;
  reason:
    | "invalid_json"
    | "not_object"
    | "oversized"
    | "schema_version"
    | "unknown_field"
    | "missing_field"
    | "wrong_type"
    | "invalid_value";
  field?: RuntimeConfigField | "unknown";
  schemaVersion?: number;
};

type ParseResult = { ok: true; value: RuntimeConfig } | ParseFailure;

export const RUNTIME_CONFIG_BUNDLE = "MINGLA_RUNTIME_CONFIG_JSON";
export const RUNTIME_CONFIG_FIELDS: readonly RuntimeConfigField[] = [
  "bunny_storage_cap_bytes",
  "bunny_traffic_cap_bytes",
  "content_share_v1_create_enabled",
  "event_cover_video_provider",
  "google_ads_api_version",
  "meta_api_version",
  "mingla_footer_address",
  "mingla_logo_url",
  "ng_payout_float_horizon_days",
  "offering_invite_sms_price_book_v1",
  "termii_base_url",
];
const RUNTIME_CONFIG_LEGACY_NAMES: Record<RuntimeConfigField, string> = {
  bunny_storage_cap_bytes: "BUNNY_STORAGE_CAP_BYTES",
  bunny_traffic_cap_bytes: "BUNNY_TRAFFIC_CAP_BYTES",
  content_share_v1_create_enabled: "CONTENT_SHARE_V1_CREATE_ENABLED",
  event_cover_video_provider: "EVENT_COVER_VIDEO_PROVIDER",
  google_ads_api_version: "GOOGLE_ADS_API_VERSION",
  meta_api_version: "META_API_VERSION",
  mingla_footer_address: "MINGLA_FOOTER_ADDRESS",
  mingla_logo_url: "MINGLA_LOGO_URL",
  // #1840 — bundle-only, exactly like the price book: no new Supabase secret is
  // created for the horizon (user-managed secret capacity is near its ceiling).
  ng_payout_float_horizon_days: "MINGLA_RUNTIME_CONFIG_JSON",
  offering_invite_sms_price_book_v1: "MINGLA_RUNTIME_CONFIG_JSON",
  termii_base_url: "TERMII_BASE_URL",
};

/**
 * #1840 — inclusive bounds for the Nigerian float forecast horizon, in days.
 *
 * The floor is 3, not 1. A Nigerian release matures at `event_end + 3 days`, so
 * a horizon shorter than the rail's own settlement lag warns the operator later
 * than the rail already costs them, and no bank top-up clears inside it. 1 day
 * was legal under the first version and produced under 24 hours of notice with
 * nothing anywhere flagging it. Out-of-range values are CLAMPED into this
 * window and logged, never rejected — rejecting is what let one bad value
 * invalidate the whole shared bundle.
 */
export const NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS = 3;
export const NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS = 90;
export const NG_PAYOUT_FLOAT_HORIZON_DEFAULT_DAYS = 7;

const MAX_BUNDLE_BYTES = 48 * 1024;
const MAX_DIAGNOSTIC_SCHEMA_VERSION = 1_000_000;
const TERMII_HOSTS = new Set(["v3.api.termii.com"]);
const VERSION_RE = /^v[1-9]\d?(?:\.\d{1,2})?$/;
const emittedDiagnostics = new Set<string>();

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

function boundedSchemaVersion(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= MAX_DIAGNOSTIC_SCHEMA_VERSION
    ? value
    : undefined;
}

function validHttpsUrl(
  value: unknown,
  allowedHosts?: Set<string>,
): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (!allowedHosts || allowedHosts.has(url.hostname)) &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

export function parseRuntimeConfig(raw: string): ParseResult {
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
  if (parsed.schema_version !== 1) {
    return {
      ok: false,
      reason: "schema_version",
      schemaVersion: boundedSchemaVersion(parsed.schema_version),
    };
  }
  const allowed = new Set(["schema_version", ...RUNTIME_CONFIG_FIELDS]);
  if (Object.keys(parsed).some((field) => !allowed.has(field))) {
    return { ok: false, reason: "unknown_field", field: "unknown" };
  }
  for (
    const field of RUNTIME_CONFIG_FIELDS.filter((candidate) =>
      candidate !== "content_share_v1_create_enabled" &&
      candidate !== "ng_payout_float_horizon_days" &&
      candidate !== "offering_invite_sms_price_book_v1"
    )
  ) {
    if (!Object.hasOwn(parsed, field)) {
      return { ok: false, reason: "missing_field", field };
    }
  }
  // #1840 — optional, so a bundle deployed before this field still parses and
  // every existing reader keeps working unchanged. DELIBERATELY NOT VALIDATED
  // HERE: parseRuntimeConfig is all-or-nothing, so rejecting a bad horizon
  // would invalidate the entire shared bundle and silently degrade every
  // unrelated reader to its legacy env var. The value is narrowed and clamped
  // in resolveNgPayoutFloatHorizonDays, where a bad value can only affect the
  // forecast window it belongs to.
  if (
    Object.hasOwn(parsed, "content_share_v1_create_enabled") &&
    typeof parsed.content_share_v1_create_enabled !== "boolean"
  ) {
    return {
      ok: false,
      reason: "wrong_type",
      field: "content_share_v1_create_enabled",
    };
  }
  if (
    Object.hasOwn(parsed, "offering_invite_sms_price_book_v1") &&
    !Array.isArray(parsed.offering_invite_sms_price_book_v1)
  ) {
    return {
      ok: false,
      reason: "wrong_type",
      field: "offering_invite_sms_price_book_v1",
    };
  }
  for (
    const field of [
      "bunny_storage_cap_bytes",
      "bunny_traffic_cap_bytes",
    ] as const
  ) {
    const value = parsed[field];
    if (typeof value !== "number") {
      return { ok: false, reason: "wrong_type", field };
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
      return { ok: false, reason: "invalid_value", field };
    }
  }
  // #966 — `event_cover_video_provider` is retained-but-UNREAD post-#966: Bunny is
  // hard-wired in coverVideoProvider() (eventCoverVideo.ts), so nothing routes on
  // this field anymore. The validator DELIBERATELY still accepts both "cloudinary"
  // and "bunny": narrowing it to "bunny"-only would make a stale/drifted bundle
  // still carrying "cloudinary" fail the WHOLE-bundle parse (parseRuntimeConfig is
  // all-or-nothing), silently falling every runtime-config field back to its legacy
  // env var — a worse, surprising failure mode. Tolerance here + hard-wire at the
  // routing layer is the belt-and-suspenders low-risk posture.
  if (
    parsed.event_cover_video_provider !== "cloudinary" &&
    parsed.event_cover_video_provider !== "bunny"
  ) {
    return {
      ok: false,
      reason: "invalid_value",
      field: "event_cover_video_provider",
    };
  }
  for (const field of ["google_ads_api_version", "meta_api_version"] as const) {
    if (typeof parsed[field] !== "string") {
      return { ok: false, reason: "wrong_type", field };
    }
    if (!VERSION_RE.test(parsed[field])) {
      return { ok: false, reason: "invalid_value", field };
    }
  }
  if (
    typeof parsed.mingla_footer_address !== "string" ||
    parsed.mingla_footer_address.length === 0 ||
    parsed.mingla_footer_address.length > 500
  ) {
    return {
      ok: false,
      reason: typeof parsed.mingla_footer_address === "string"
        ? "invalid_value"
        : "wrong_type",
      field: "mingla_footer_address",
    };
  }
  if (!validHttpsUrl(parsed.mingla_logo_url)) {
    return { ok: false, reason: "invalid_value", field: "mingla_logo_url" };
  }
  if (!validHttpsUrl(parsed.termii_base_url, TERMII_HOSTS)) {
    return { ok: false, reason: "invalid_value", field: "termii_base_url" };
  }
  return { ok: true, value: parsed as RuntimeConfig };
}

function emit(
  event: "secret_bundle_invalid" | "secret_bundle_legacy_fallback",
  reason: ParseFailure["reason"] | "missing",
  field: RuntimeConfigField | "unknown",
  schemaVersion?: number,
): void {
  const identity = [event, RUNTIME_CONFIG_BUNDLE, reason, field].join(":");
  if (emittedDiagnostics.has(identity)) return;
  emittedDiagnostics.add(identity);
  const diagnostic: Record<string, string | number> = {
    event,
    bundle: RUNTIME_CONFIG_BUNDLE,
    reason,
    field,
  };
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
  const message = JSON.stringify(diagnostic);
  if (event === "secret_bundle_invalid") console.error(message);
  else console.warn(message);
}

export function resolveRuntimeConfigValue(
  field: RuntimeConfigField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): RuntimeConfig[RuntimeConfigField] | string | undefined {
  if (legacyName !== RUNTIME_CONFIG_LEGACY_NAMES[field]) {
    throw new Error(`runtime_config_legacy_mapping_invalid:${field}`);
  }
  const raw = getEnv(RUNTIME_CONFIG_BUNDLE);
  if (raw) {
    const result = parseRuntimeConfig(raw);
    if (result.ok) return result.value[field];
    emit(
      "secret_bundle_invalid",
      result.reason,
      result.field ?? field,
      result.schemaVersion,
    );
    emit(
      "secret_bundle_legacy_fallback",
      result.reason,
      field,
      result.schemaVersion,
    );
  } else {
    emit("secret_bundle_legacy_fallback", "missing", field);
  }
  return getEnv(legacyName);
}

/**
 * Issue #1840 — read the Nigerian payout float forecast horizon (in days) from
 * the EXISTING runtime-config bundle. Bundle-only by design: no new Supabase
 * secret is introduced, and an absent/invalid bundle returns undefined so the
 * caller falls back to NG_PAYOUT_FLOAT_HORIZON_DEFAULT_DAYS rather than
 * silently forecasting over a wrong window.
 */
export function resolveNgPayoutFloatHorizonDays(
  getEnv: SecretEnvGetter = defaultGetEnv,
): number | undefined {
  const raw = getEnv(RUNTIME_CONFIG_BUNDLE);
  if (!raw) return undefined;
  const result = parseRuntimeConfig(raw);
  if (!result.ok) return undefined;
  const configured = result.value.ng_payout_float_horizon_days;
  if (configured === undefined) return undefined;
  // A value that is not a whole number of days carries no usable intent, so the
  // caller falls back to the default rather than guessing at a rounding.
  if (typeof configured !== "number" || !Number.isSafeInteger(configured)) {
    emitHorizonDiagnostic("wrong_type");
    return undefined;
  }
  // Out of range degrades to the nearest usable window and says so. It never
  // rejects (that would poison the shared bundle) and never disables the
  // forecast (a horizon of 0 would be a silent switch-off of the one thing
  // standing between a matured Nigerian payout and an unpaid organiser).
  if (configured < NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS) {
    emitHorizonDiagnostic("clamped_low");
    return NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS;
  }
  if (configured > NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS) {
    emitHorizonDiagnostic("clamped_high");
    return NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS;
  }
  return configured;
}

/**
 * #1840 — a clamped or unusable horizon must be visible, not silently absorbed.
 * Value-blind and once-per-reason per isolate, matching the diagnostic
 * discipline the rest of this file already uses.
 */
function emitHorizonDiagnostic(
  reason: "wrong_type" | "clamped_low" | "clamped_high",
): void {
  const identity = ["ng_payout_float_horizon", reason].join(":");
  if (emittedDiagnostics.has(identity)) return;
  emittedDiagnostics.add(identity);
  console.warn(JSON.stringify({
    event: "ng_payout_float_horizon_degraded",
    bundle: RUNTIME_CONFIG_BUNDLE,
    field: "ng_payout_float_horizon_days",
    reason,
    min_days: NG_PAYOUT_FLOAT_HORIZON_MIN_DAYS,
    max_days: NG_PAYOUT_FLOAT_HORIZON_MAX_DAYS,
  }));
}

/** Read the optional price book from the existing runtime-config bundle. */
export function resolveOfferingInviteSmsPriceBook(
  getEnv: SecretEnvGetter = defaultGetEnv,
): unknown[] | undefined {
  const raw = getEnv(RUNTIME_CONFIG_BUNDLE);
  if (!raw) return undefined;
  const result = parseRuntimeConfig(raw);
  if (!result.ok) return undefined;
  return result.value.offering_invite_sms_price_book_v1;
}

export function resolveRuntimeString(
  field: RuntimeStringField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): string | undefined {
  const value = resolveRuntimeConfigValue(field, legacyName, getEnv);
  return typeof value === "string" ? value : undefined;
}

export function resolveRuntimeNumber(
  field: RuntimeNumberField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): number | undefined {
  const value = resolveRuntimeConfigValue(field, legacyName, getEnv);
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Resolve an optional rollout boolean without truthy coercion. A valid bundled
 * boolean is authoritative; an older bundle without the field may temporarily
 * fall back to its exact direct name. Once that name is retired, every missing
 * or invalid state fails closed to false.
 */
export function resolveRuntimeBoolean(
  field: RuntimeBooleanField,
  legacyName: string,
  getEnv: SecretEnvGetter = defaultGetEnv,
): boolean {
  if (legacyName !== RUNTIME_CONFIG_LEGACY_NAMES[field]) {
    throw new Error(`runtime_config_legacy_mapping_invalid:${field}`);
  }
  const raw = getEnv(RUNTIME_CONFIG_BUNDLE);
  if (raw) {
    const result = parseRuntimeConfig(raw);
    if (result.ok) {
      const value = result.value[field];
      if (typeof value === "boolean") return value;
      emit("secret_bundle_legacy_fallback", "missing", field);
    } else {
      emit(
        "secret_bundle_invalid",
        result.reason,
        result.field ?? field,
        result.schemaVersion,
      );
      emit(
        "secret_bundle_legacy_fallback",
        result.reason,
        field,
        result.schemaVersion,
      );
    }
  } else {
    emit("secret_bundle_legacy_fallback", "missing", field);
  }
  // [TRANSITIONAL] #1808 direct-name fallback — remove only through a separately
  // reviewed cleanup after production bundle parity remains durable.
  return getEnv(legacyName) === "true";
}
