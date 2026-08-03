/**
 * Bundle-first resolver for the recipient-fingerprinting HMAC material.
 *
 * The raw value is returned byte-for-byte. Diagnostics never contain secret
 * material, its length, a prefix, or a digest.
 */

import type { SecretEnvGetter } from "./secretBundle.ts";

const BUNDLE_NAME = "AD_CONVERSION_TOKENS";
const FIELD_NAME = "NOTIFICATION_RECIPIENT_HMAC_SECRET";
const MIN_SECRET_LENGTH = 32;
const MAX_BUNDLE_BYTES = 48 * 1024;
const emittedDiagnostics = new Set<string>();

type Reason =
  | "missing"
  | "invalid_json"
  | "not_object"
  | "oversized"
  | "missing_field"
  | "wrong_type"
  | "invalid_value";

function defaultGetEnv(name: string): string | undefined {
  return Deno.env.get(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnosticEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function emitDiagnostic(
  event:
    | "notification_hmac_bundle_invalid"
    | "notification_hmac_legacy_fallback",
  reason: Reason,
): void {
  const identity = `${event}:${reason}`;
  if (emittedDiagnostics.has(identity)) return;
  emittedDiagnostics.add(identity);
  const diagnostic: Record<string, string> = {
    event,
    bundle: BUNDLE_NAME,
    field: "notification_recipient_hmac_secret",
    reason,
  };
  const deploymentId = diagnosticEnv("DENO_DEPLOYMENT_ID");
  if (deploymentId) diagnostic.deployment_id = deploymentId;
  const functionName = diagnosticEnv("DENO_FUNCTION_NAME");
  if (functionName && /^[a-z0-9-]{1,80}$/.test(functionName)) {
    diagnostic.function_name = functionName;
  }
  const serialized = JSON.stringify(diagnostic);
  if (event === "notification_hmac_bundle_invalid") {
    console.error(serialized);
  } else {
    console.warn(serialized);
  }
}

function validSecret(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length >= MIN_SECRET_LENGTH;
}

export function resolveNotificationRecipientHmacSecret(
  getEnv: SecretEnvGetter = defaultGetEnv,
): string | undefined {
  const raw = getEnv(BUNDLE_NAME);
  let reason: Reason = "missing";
  if (raw) {
    if (new TextEncoder().encode(raw).byteLength >= MAX_BUNDLE_BYTES) {
      reason = "oversized";
    } else {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) {
          reason = "not_object";
        } else if (!Object.hasOwn(parsed, FIELD_NAME)) {
          reason = "missing_field";
        } else if (typeof parsed[FIELD_NAME] !== "string") {
          reason = "wrong_type";
        } else if (!validSecret(parsed[FIELD_NAME])) {
          reason = "invalid_value";
        } else {
          return parsed[FIELD_NAME];
        }
      } catch {
        reason = "invalid_json";
      }
    }
    emitDiagnostic("notification_hmac_bundle_invalid", reason);
  }
  emitDiagnostic("notification_hmac_legacy_fallback", reason);
  const direct = getEnv(FIELD_NAME);
  return validSecret(direct) ? direct : undefined;
}
