export const ERASURE_SECRET_EVENT = "brand_person_erasure_secret_unavailable";
export const ERASURE_SECRET_FIELD = "BRAND_PERSON_ERASURE_CHALLENGE_SECRET";
const ERASURE_SECRET_BUNDLE = "AD_CONVERSION_TOKENS";
const MAX_BUNDLE_BYTES = 48 * 1024;

export type ErasureSecretReason =
  | "bundle_missing"
  | "bundle_oversized"
  | "bundle_invalid_json"
  | "bundle_invalid_root"
  | "field_missing"
  | "field_wrong_type"
  | "field_invalid_base64"
  | "field_invalid_size";

export class ErasureTemporarilyUnavailable extends Error {
  readonly code = "erasure_temporarily_unavailable" as const;
  readonly safeReason: ErasureSecretReason;

  constructor(reason: ErasureSecretReason) {
    super("erasure_temporarily_unavailable");
    this.name = "ErasureTemporarilyUnavailable";
    this.safeReason = reason;
  }
}

export type EnvReader = (name: string) => string | undefined;

function fail(reason: ErasureSecretReason): never {
  throw new ErasureTemporarilyUnavailable(reason);
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    fail("field_invalid_base64");
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    fail("field_invalid_base64");
  }
  if (btoa(binary) !== value) fail("field_invalid_base64");
  const decoded = Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0),
  );
  if (decoded.byteLength < 32 || decoded.byteLength > 64) {
    fail("field_invalid_size");
  }
  return new Uint8Array(decoded);
}

/**
 * The sole production reader for the #1772 challenge key. It intentionally
 * reads only the existing credential envelope and has no direct-name fallback.
 */
export function resolveErasureChallengeKey(
  readEnv: EnvReader = (name) => Deno.env.get(name),
): Uint8Array {
  const bundle = readEnv(ERASURE_SECRET_BUNDLE);
  if (bundle === undefined || bundle === "") fail("bundle_missing");
  if (new TextEncoder().encode(bundle).byteLength >= MAX_BUNDLE_BYTES) {
    fail("bundle_oversized");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bundle);
  } catch {
    fail("bundle_invalid_json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("bundle_invalid_root");
  }
  const object = parsed as Record<string, unknown>;
  if (!(ERASURE_SECRET_FIELD in object)) fail("field_missing");
  const encoded = object[ERASURE_SECRET_FIELD];
  if (typeof encoded !== "string") fail("field_wrong_type");
  return decodeCanonicalBase64(encoded);
}

export function erasureSecretDiagnostic(
  error: ErasureTemporarilyUnavailable,
  phase: "create_challenge" | "execute",
): Readonly<Record<string, string>> {
  return Object.freeze({
    event: ERASURE_SECRET_EVENT,
    reason: error.safeReason,
    function: "support-brand-person-erasure",
    phase,
  });
}

export function createSixDigitCode(
  fill: (values: Uint32Array) => Uint32Array = (values) =>
    crypto.getRandomValues(values),
): string {
  const values = fill(new Uint32Array(1));
  return String(values[0] % 1_000_000).padStart(6, "0");
}

export async function hmacChallenge(
  keyBytes: Uint8Array,
  challengeId: string,
  code: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${challengeId}:${code}`),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
