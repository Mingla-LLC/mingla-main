import { type SecretEnvGetter } from "./secretBundle.ts";

export type RuntimeConfigField =
  | "bunny_storage_cap_bytes"
  | "bunny_traffic_cap_bytes"
  | "event_cover_video_provider"
  | "google_ads_api_version"
  | "meta_api_version"
  | "mingla_footer_address"
  | "mingla_logo_url"
  | "termii_base_url";

export type RuntimeStringField = Exclude<
  RuntimeConfigField,
  "bunny_storage_cap_bytes" | "bunny_traffic_cap_bytes"
>;
export type RuntimeNumberField =
  | "bunny_storage_cap_bytes"
  | "bunny_traffic_cap_bytes";

type RuntimeConfig = {
  schema_version: 1;
  bunny_storage_cap_bytes: number;
  bunny_traffic_cap_bytes: number;
  event_cover_video_provider: "cloudinary" | "bunny";
  google_ads_api_version: string;
  meta_api_version: string;
  mingla_footer_address: string;
  mingla_logo_url: string;
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
};

type ParseResult = { ok: true; value: RuntimeConfig } | ParseFailure;

export const RUNTIME_CONFIG_BUNDLE = "MINGLA_RUNTIME_CONFIG_JSON";
export const RUNTIME_CONFIG_FIELDS: readonly RuntimeConfigField[] = [
  "bunny_storage_cap_bytes",
  "bunny_traffic_cap_bytes",
  "event_cover_video_provider",
  "google_ads_api_version",
  "meta_api_version",
  "mingla_footer_address",
  "mingla_logo_url",
  "termii_base_url",
];
const RUNTIME_CONFIG_LEGACY_NAMES: Record<RuntimeConfigField, string> = {
  bunny_storage_cap_bytes: "BUNNY_STORAGE_CAP_BYTES",
  bunny_traffic_cap_bytes: "BUNNY_TRAFFIC_CAP_BYTES",
  event_cover_video_provider: "EVENT_COVER_VIDEO_PROVIDER",
  google_ads_api_version: "GOOGLE_ADS_API_VERSION",
  meta_api_version: "META_API_VERSION",
  mingla_footer_address: "MINGLA_FOOTER_ADDRESS",
  mingla_logo_url: "MINGLA_LOGO_URL",
  termii_base_url: "TERMII_BASE_URL",
};

const MAX_BUNDLE_BYTES = 48 * 1024;
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
    return { ok: false, reason: "schema_version" };
  }
  const allowed = new Set(["schema_version", ...RUNTIME_CONFIG_FIELDS]);
  if (Object.keys(parsed).some((field) => !allowed.has(field))) {
    return { ok: false, reason: "unknown_field", field: "unknown" };
  }
  for (const field of RUNTIME_CONFIG_FIELDS) {
    if (!Object.hasOwn(parsed, field)) {
      return { ok: false, reason: "missing_field", field };
    }
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
    emit("secret_bundle_invalid", result.reason, result.field ?? field);
    emit("secret_bundle_legacy_fallback", result.reason, field);
  } else {
    emit("secret_bundle_legacy_fallback", "missing", field);
  }
  return getEnv(legacyName);
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
