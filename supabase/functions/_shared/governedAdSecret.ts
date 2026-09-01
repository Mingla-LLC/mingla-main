/**
 * Bundle-first compatibility reader for the independently governed credential
 * fields consolidated by issue #2241.
 *
 * The envelope is intentionally open-schema because existing CAPI providers
 * own dynamic fields. This reader validates only the exact requested field,
 * never substitutes another field, and emits value-free diagnostics at most
 * once per deployment before using the exact migration fallback.
 */

export type GovernedAdField =
  | "ATTENDANCE_CLAIM_PEPPER"
  | "META_COMPETITOR_ACCESS_TOKEN"
  | "META_COMPETITOR_IG_USER_ID"
  | "RESEND_WEBHOOK_SECRET";

export type GovernedAdEnvGetter = (name: string) => string | undefined;

export type AttendanceClaimPepperGeneration = "legacy_v1" | "governed_v2";
export type AttendanceClaimPepperRing = {
  current: { generation: AttendanceClaimPepperGeneration; secret: string };
  previous: {
    generation: AttendanceClaimPepperGeneration;
    secret: string;
  } | null;
};

const BUNDLE_NAME = "AD_CONVERSION_TOKENS";
const MAX_BUNDLE_BYTES = 48 * 1024;
const LEGACY_NAMES: Record<GovernedAdField, string> = {
  ATTENDANCE_CLAIM_PEPPER: "ATTENDANCE_CLAIM_PEPPER",
  META_COMPETITOR_ACCESS_TOKEN: "META_COMPETITOR_ACCESS_TOKEN",
  META_COMPETITOR_IG_USER_ID: "META_COMPETITOR_IG_USER_ID",
  RESEND_WEBHOOK_SECRET: "RESEND_WEBHOOK_SECRET",
};
const emittedDiagnostics = new Set<string>();

function defaultGetEnv(name: string): string | undefined {
  return Deno.env.get(name);
}

function safeRuntimeEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function emitOnce(
  event: "governed_ad_bundle_invalid" | "governed_ad_legacy_fallback",
  field: GovernedAdField,
  reason:
    | "missing"
    | "invalid_json"
    | "not_object"
    | "oversized"
    | "missing_field"
    | "wrong_type",
): void {
  const key = `${event}:${field}:${reason}`;
  if (emittedDiagnostics.has(key)) return;
  emittedDiagnostics.add(key);
  const diagnostic: Record<string, string> = {
    event,
    bundle: BUNDLE_NAME,
    field,
    reason,
  };
  const deploymentId = safeRuntimeEnv("DENO_DEPLOYMENT_ID");
  if (deploymentId) diagnostic.deployment_id = deploymentId;
  const functionName = safeRuntimeEnv("DENO_FUNCTION_NAME");
  if (functionName && /^[a-z0-9-]{1,80}$/.test(functionName)) {
    diagnostic.function_name = functionName;
  }
  const serialized = JSON.stringify(diagnostic);
  if (event === "governed_ad_bundle_invalid") console.error(serialized);
  else console.warn(serialized);
}

type FieldResult =
  | { ok: true; value: string }
  | {
    ok: false;
    reason:
      | "missing"
      | "invalid_json"
      | "not_object"
      | "oversized"
      | "missing_field"
      | "wrong_type";
  };

function readBundleField(
  raw: string | undefined,
  field: GovernedAdField,
): FieldResult {
  if (raw === undefined || raw === "") return { ok: false, reason: "missing" };
  if (new TextEncoder().encode(raw).byteLength >= MAX_BUNDLE_BYTES) {
    return { ok: false, reason: "oversized" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "not_object" };
  }
  if (!Object.hasOwn(parsed, field)) {
    return { ok: false, reason: "missing_field" };
  }
  const value = (parsed as Record<string, unknown>)[field];
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, reason: "wrong_type" };
  }
  return { ok: true, value };
}

export function resolveGovernedAdField(
  field: GovernedAdField,
  legacyName: string,
  getEnv: GovernedAdEnvGetter = defaultGetEnv,
): string | undefined {
  if (legacyName !== LEGACY_NAMES[field]) {
    throw new Error(`governed_ad_legacy_mapping_invalid:${field}`);
  }
  const result = readBundleField(getEnv(BUNDLE_NAME), field);
  if (result.ok) return result.value;
  if (result.reason !== "missing") {
    emitOnce("governed_ad_bundle_invalid", field, result.reason);
  }
  emitOnce("governed_ad_legacy_fallback", field, result.reason);
  return getEnv(legacyName);
}

/**
 * The attendance pepper is the only governed field that needs a two-reader
 * cutover. The direct secret is never compared with the bundle value and no
 * diagnostic includes secret-derived metadata.
 */
export function resolveAttendanceClaimPepperRing(
  getEnv: GovernedAdEnvGetter = defaultGetEnv,
): AttendanceClaimPepperRing | undefined {
  const bundle = readBundleField(
    getEnv(BUNDLE_NAME),
    "ATTENDANCE_CLAIM_PEPPER",
  );
  const direct = getEnv("ATTENDANCE_CLAIM_PEPPER");
  if (bundle.ok) {
    return {
      current: { generation: "governed_v2", secret: bundle.value },
      previous: direct ? { generation: "legacy_v1", secret: direct } : null,
    };
  }
  if (bundle.reason !== "missing") {
    emitOnce(
      "governed_ad_bundle_invalid",
      "ATTENDANCE_CLAIM_PEPPER",
      bundle.reason,
    );
  }
  emitOnce(
    "governed_ad_legacy_fallback",
    "ATTENDANCE_CLAIM_PEPPER",
    bundle.reason,
  );
  return direct
    ? {
      current: { generation: "legacy_v1", secret: direct },
      previous: null,
    }
    : undefined;
}
