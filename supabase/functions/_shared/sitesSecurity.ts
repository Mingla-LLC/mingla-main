// #2830 — the sole Core reader for MINGLA_SITES_SECURITY_JSON.
// Never export the complete envelope; callers receive one least-privilege
// projection. Validation failures intentionally disclose no field material.

const ENVELOPE_NAME = "MINGLA_SITES_SECURITY_JSON";
const MAX_SERIALIZED_BYTES = 48 * 1024;
const KID_RE = /^[A-Za-z0-9_.-]{8,64}$/;
const EXACT_FIELDS = [
  "attribution_pepper_b64",
  "cms_to_core_current_key_b64",
  "cms_to_core_current_kid",
  "cms_to_core_previous_key_b64",
  "cms_to_core_previous_kid",
  "core_to_cms_current_key_b64",
  "core_to_cms_current_kid",
  "core_to_cms_previous_key_b64",
  "core_to_cms_previous_kid",
  "runtime_to_core_current_key_b64",
  "runtime_to_core_current_kid",
  "runtime_to_core_previous_key_b64",
  "runtime_to_core_previous_kid",
  "schema_version",
] as const;

interface KeyPairProjection {
  readonly current: { readonly kid: string; readonly keyBytes: Uint8Array };
  readonly previous:
    | { readonly kid: string; readonly keyBytes: Uint8Array }
    | null;
}

type ParsedEnvelope = Record<typeof EXACT_FIELDS[number], unknown>;

function decode(value: unknown): Uint8Array {
  if (
    typeof value !== "string" || value.length === 0 || value.length % 4 !== 0
  ) {
    throw new Error("sites_security_unavailable");
  }
  try {
    const raw = atob(value);
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    if (bytes.byteLength < 32) throw new Error("sites_security_unavailable");
    return bytes;
  } catch {
    throw new Error("sites_security_unavailable");
  }
}

function keyId(value: unknown): string {
  if (typeof value !== "string" || !KID_RE.test(value)) {
    throw new Error("sites_security_unavailable");
  }
  return value;
}

function pair(
  parsed: ParsedEnvelope,
  prefix: "core_to_cms" | "cms_to_core" | "runtime_to_core",
): KeyPairProjection {
  const current = {
    kid: keyId(parsed[`${prefix}_current_kid`]),
    keyBytes: decode(parsed[`${prefix}_current_key_b64`]),
  };
  const previousKid = parsed[`${prefix}_previous_kid`];
  const previousKey = parsed[`${prefix}_previous_key_b64`];
  if ((previousKid === null) !== (previousKey === null)) {
    throw new Error("sites_security_unavailable");
  }
  const previous = previousKid === null ? null : {
    kid: keyId(previousKid),
    keyBytes: decode(previousKey),
  };
  if (
    previous !== null &&
    (previous.kid === current.kid || equal(previous.keyBytes, current.keyBytes))
  ) throw new Error("sites_security_unavailable");
  return { current, previous };
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function parsedEnvelope(): ParsedEnvelope {
  const raw = Deno.env.get(ENVELOPE_NAME);
  if (
    raw === undefined ||
    new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES
  ) {
    throw new Error("sites_security_unavailable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("sites_security_unavailable");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sites_security_unavailable");
  }
  const object = parsed as Record<string, unknown>;
  if (
    object.schema_version !== 1 ||
    JSON.stringify(Object.keys(object).sort()) !==
      JSON.stringify([...EXACT_FIELDS].sort())
  ) throw new Error("sites_security_unavailable");

  const projections = [
    pair(object as ParsedEnvelope, "core_to_cms"),
    pair(object as ParsedEnvelope, "cms_to_core"),
    pair(object as ParsedEnvelope, "runtime_to_core"),
  ];
  const materials = projections.flatMap((projection) => [
    projection.current.keyBytes,
    ...(projection.previous === null ? [] : [projection.previous.keyBytes]),
  ]);
  const pepper = decode(object.attribution_pepper_b64);
  materials.push(pepper);
  for (let left = 0; left < materials.length; left += 1) {
    for (let right = left + 1; right < materials.length; right += 1) {
      if (equal(materials[left], materials[right])) {
        throw new Error("sites_security_unavailable");
      }
    }
  }
  return object as ParsedEnvelope;
}

export function resolveCoreToCmsSigner(): KeyPairProjection["current"] {
  return pair(parsedEnvelope(), "core_to_cms").current;
}

export function resolveCmsToCoreVerifier(): ReadonlyArray<{
  readonly kid: string;
  readonly keyBytes: Uint8Array;
}> {
  const projection = pair(parsedEnvelope(), "cms_to_core");
  return [
    projection.current,
    ...(projection.previous ? [projection.previous] : []),
  ];
}

export function resolveRuntimeToCoreVerifier(): ReadonlyArray<{
  readonly kid: string;
  readonly keyBytes: Uint8Array;
}> {
  const projection = pair(parsedEnvelope(), "runtime_to_core");
  return [
    projection.current,
    ...(projection.previous ? [projection.previous] : []),
  ];
}

export function resolveSitesAttributionPepper(): Uint8Array {
  return decode(parsedEnvelope().attribution_pepper_b64);
}
