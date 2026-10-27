// #2830 — provider-neutral contracts shared by the four Sites Edge gateways.
// This module contains no environment reads and is safe to unit-test with
// synthetic keys. The only Core credential reader is sitesSecurity.ts.

// #2829 — every brand's site uses one of these renderers; there is no
// single public host any more (hosts live in brand_site_hosts).
export const SITES_RENDERER_KEYS = [
  "restaurant-website-v1",
  "sites-v2",
] as const;
export type SitesRendererKey = typeof SITES_RENDERER_KEYS[number];
/** The renderer a newly provisioned site is created for. */
export const SITES_PROVISION_RENDERER_KEY: SitesRendererKey = "sites-v2";
export const SITES_RENDERER_VERSION = 1 as const;
export const SITES_ARTIFACT_SCHEMA_VERSION = 1 as const;
/**
 * #2829 — the site id a runtime signs a HOST RESOLUTION with. The runtime
 * serves every site, so before resolving it cannot know which site a host
 * belongs to; the signed path carries the hostname instead. Every call AFTER
 * resolution is signed with the resolved site's real id.
 */
export const SITES_HOST_RESOLUTION_SITE_ID =
  "00000000-0000-4000-8000-000000000000" as const;

export const SITES_SAFE_CUSTOMER_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_STATE",
  "VALIDATION_FAILED",
  "REVISION_CONFLICT",
  "SESSION_EXPIRED",
  "OPERATION_IN_PROGRESS",
  "PUBLISH_FAILED_LAST_GOOD_PRESERVED",
  "MEDIA_REJECTED",
  "MEDIA_PROCESSING",
  "SERVICE_TEMPORARILY_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
] as const;

export type SitesSafeCustomerCode = typeof SITES_SAFE_CUSTOMER_CODES[number];
export type SitesEnvelopeDirection =
  | "core_to_cms"
  | "cms_to_core"
  | "runtime_to_core";

export interface SitesSignedEnvelope {
  readonly schema_version: 1;
  readonly issuer: string;
  readonly audience: string;
  readonly direction: SitesEnvelopeDirection;
  readonly site_id: string;
  readonly operation_id: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly nonce: string;
  readonly method: string;
  readonly path: string;
  readonly body_sha256: string;
  readonly kid: string;
  readonly signature_b64: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const KID_RE = /^[A-Za-z0-9_.-]{8,64}$/;
const HOST_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const encoder = new TextEncoder();

export function sitesJson(
  data: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

export function sitesFailure(
  code: SitesSafeCustomerCode,
  status: number,
  operationId: string | null = null,
): Response {
  const messages: Record<SitesSafeCustomerCode, string> = {
    FORBIDDEN: "This Website action is not available for your role.",
    NOT_FOUND: "Website information is not available.",
    INVALID_STATE: "The website is not ready for that action.",
    VALIDATION_FAILED: "Review the highlighted Website fields and try again.",
    REVISION_CONFLICT: "The draft changed. Refresh it before trying again.",
    SESSION_EXPIRED: "This Mingla Studio session has expired.",
    OPERATION_IN_PROGRESS: "This Website operation is still working.",
    PUBLISH_FAILED_LAST_GOOD_PRESERVED:
      "Publishing failed. Your last verified website is still live.",
    MEDIA_REJECTED: "That image could not be accepted.",
    MEDIA_PROCESSING: "That image is still being prepared.",
    SERVICE_TEMPORARILY_UNAVAILABLE:
      "Website tools are temporarily unavailable. Please try again.",
    IDEMPOTENCY_CONFLICT: "That request was already used for another action.",
  };
  return sitesJson({
    ok: false,
    error: {
      code,
      message: messages[code],
      retryable: [
        "OPERATION_IN_PROGRESS",
        "PUBLISH_FAILED_LAST_GOOD_PRESERVED",
        "MEDIA_PROCESSING",
        "SERVICE_TEMPORARILY_UNAVAILABLE",
      ].includes(code),
      operation_id: operationId,
    },
  }, status);
}

/**
 * #2829 W2 — refusals the OWNER can fix, passed through from the CMS.
 *
 * Studio refuses a draft in which two things would answer one address
 * (PATH_COLLISION) or that holds more than 100 pages (PAGE_LIMIT_EXCEEDED).
 * Neither is in the closed customer-code set, so they used to fall through to
 * SERVICE_TEMPORARILY_UNAVAILABLE (503) — telling the owner to retry, and
 * marking the operation ambiguous. They are answered as VALIDATION_FAILED
 * (409, a code every client already handles) carrying a `reason_code` the
 * Business app turns into a plain instruction. Anything else returns null.
 */
export const SITES_OWNER_FIXABLE_REASONS = {
  PATH_COLLISION:
    "Two parts of the website use the same address. Change one page's address, then try again.",
  PAGE_LIMIT_EXCEEDED:
    "The website has more than 100 pages. Remove some, then try again.",
  // #2829 W9b — a site's first publish needs the design checks run on that draft.
  DESIGN_CHECKS_REQUIRED:
    "Run the design checks on this draft before its first publish. They only warn; nothing is blocked once they have run.",
} as const;

export function sitesOwnerFixableRefusal(
  reportedCode: unknown,
  operationId: string | null = null,
): Response | null {
  if (
    typeof reportedCode !== "string" ||
    !Object.prototype.hasOwnProperty.call(SITES_OWNER_FIXABLE_REASONS, reportedCode)
  ) return null;
  const reason = reportedCode as keyof typeof SITES_OWNER_FIXABLE_REASONS;
  return sitesJson({
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: SITES_OWNER_FIXABLE_REASONS[reason],
      retryable: false,
      operation_id: operationId,
      reason_code: reason,
    },
  }, 409);
}

/**
 * #2829 — the hostname shape rule, mirrored by the
 * `brand_site_hosts_hostname_shape_ck` CHECK in
 * 20271225002829_issue_2829_sites_multi_brand_w1.sql (parity tested): lowercase,
 * 4-253 characters, at least one dot, each label 1-63 of [a-z0-9-] not starting
 * or ending with '-', no trailing dot, none of `*:/?#@`.
 */
export function isValidSiteHostname(value: unknown): value is string {
  return typeof value === "string" &&
    value === value.toLowerCase() &&
    value.length >= 4 && value.length <= 253 &&
    !/[*:/?#@]/.test(value) &&
    !value.endsWith(".") &&
    HOST_RE.test(value);
}

export function normalizeSitesHost(value: string): string | null {
  const normalized = value.toLowerCase().replace(/\.$/, "");
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes(":") ||
    normalized.includes("/") ||
    normalized.includes("*") ||
    !HOST_RE.test(normalized)
  ) return null;
  return normalized;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Bytes(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0) {
    throw new Error("SIGNATURE_INVALID");
  }
  try {
    const raw = atob(value);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("SIGNATURE_INVALID");
  }
}

export async function sitesSha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalEnvelope(
  envelope: Omit<SitesSignedEnvelope, "signature_b64">,
): string {
  return [
    envelope.schema_version,
    envelope.issuer,
    envelope.audience,
    envelope.direction,
    envelope.site_id,
    envelope.operation_id,
    envelope.issued_at,
    envelope.expires_at,
    envelope.nonce,
    envelope.method,
    envelope.path,
    envelope.body_sha256,
    envelope.kid,
  ].join("\n");
}

async function hmac(
  keyBytes: Uint8Array,
  message: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
}

export async function signSitesEnvelope(args: {
  issuer: string;
  audience: string;
  direction: SitesEnvelopeDirection;
  siteId: string;
  operationId: string;
  method: string;
  path: string;
  body: string;
  kid: string;
  keyBytes: Uint8Array;
  now?: Date;
  nonce?: string;
}): Promise<SitesSignedEnvelope> {
  if (!UUID_RE.test(args.siteId) || !UUID_RE.test(args.operationId)) {
    throw new Error("VALIDATION_FAILED");
  }
  if (!KID_RE.test(args.kid) || args.keyBytes.byteLength < 32) {
    throw new Error("SIGNATURE_INVALID");
  }
  const now = args.now ?? new Date();
  const unsigned: Omit<SitesSignedEnvelope, "signature_b64"> = {
    schema_version: 1,
    issuer: args.issuer,
    audience: args.audience,
    direction: args.direction,
    site_id: args.siteId,
    operation_id: args.operationId,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    nonce: args.nonce ?? crypto.randomUUID(),
    method: args.method.toUpperCase(),
    path: args.path,
    body_sha256: await sitesSha256Hex(args.body),
    kid: args.kid,
  };
  return {
    ...unsigned,
    signature_b64: base64(
      await hmac(args.keyBytes, canonicalEnvelope(unsigned)),
    ),
  };
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function verifySitesEnvelope(args: {
  envelope: unknown;
  expectedAudience: string;
  expectedDirection: SitesEnvelopeDirection;
  method: string;
  path: string;
  body: string;
  keys: ReadonlyArray<{ kid: string; keyBytes: Uint8Array }>;
  now?: Date;
}): Promise<SitesSignedEnvelope> {
  if (
    !args.envelope || typeof args.envelope !== "object" ||
    Array.isArray(args.envelope)
  ) {
    throw new Error("SIGNATURE_INVALID");
  }
  const value = args.envelope as Record<string, unknown>;
  const expectedKeys = [
    "audience",
    "body_sha256",
    "direction",
    "expires_at",
    "issued_at",
    "issuer",
    "kid",
    "method",
    "nonce",
    "operation_id",
    "path",
    "schema_version",
    "signature_b64",
    "site_id",
  ];
  if (
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
  ) {
    throw new Error("SIGNATURE_INVALID");
  }
  const envelope = value as unknown as SitesSignedEnvelope;
  const now = (args.now ?? new Date()).getTime();
  const issued = Date.parse(envelope.issued_at);
  const expires = Date.parse(envelope.expires_at);
  if (
    envelope.schema_version !== 1 ||
    envelope.audience !== args.expectedAudience ||
    envelope.direction !== args.expectedDirection ||
    envelope.method !== args.method.toUpperCase() ||
    envelope.path !== args.path ||
    !UUID_RE.test(envelope.site_id) ||
    !UUID_RE.test(envelope.operation_id) ||
    !UUID_RE.test(envelope.nonce) ||
    !KID_RE.test(envelope.kid) ||
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    issued > now + 5_000 ||
    expires <= now ||
    expires - issued > 60_000 ||
    !SHA256_RE.test(envelope.body_sha256) ||
    envelope.body_sha256 !== await sitesSha256Hex(args.body)
  ) throw new Error("SIGNATURE_INVALID");
  const selected = args.keys.find((key) => key.kid === envelope.kid);
  if (!selected) throw new Error("SIGNATURE_INVALID");
  const unsigned: Omit<SitesSignedEnvelope, "signature_b64"> = {
    schema_version: envelope.schema_version,
    issuer: envelope.issuer,
    audience: envelope.audience,
    direction: envelope.direction,
    site_id: envelope.site_id,
    operation_id: envelope.operation_id,
    issued_at: envelope.issued_at,
    expires_at: envelope.expires_at,
    nonce: envelope.nonce,
    method: envelope.method,
    path: envelope.path,
    body_sha256: envelope.body_sha256,
    kid: envelope.kid,
  };
  const expected = await hmac(
    selected.keyBytes,
    canonicalEnvelope(unsigned),
  );
  if (!timingSafeEqual(base64Bytes(envelope.signature_b64), expected)) {
    throw new Error("SIGNATURE_INVALID");
  }
  return envelope;
}

export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error("VALIDATION_FAILED");
  }
  return value.toLowerCase();
}

export function requireSha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new Error("VALIDATION_FAILED");
  }
  return value;
}

/**
 * #2829 W3 — the generation fields of a publication result, or null for the
 * original v1-only shape. Shape-checked here; Core checks the pairs.
 */
export function publicationGeneration(
  parsed: Record<string, unknown>,
): {
  p_artifact_schema_version: number;
  p_renderer_key: string;
  p_design_key: string | null;
  p_design_version: number | null;
  p_font_warnings: unknown[] | null;
} | null {
  if (parsed.artifact_schema_version === undefined) return null;
  const schema = parsed.artifact_schema_version;
  if (schema !== 1 && schema !== 2) throw new Error("VALIDATION_FAILED");
  if (typeof parsed.renderer_key !== "string") throw new Error("VALIDATION_FAILED");
  const designKey = parsed.design_key ?? null;
  const designVersion = parsed.design_version ?? null;
  const warnings = parsed.font_warnings ?? null;
  if (designKey !== null && typeof designKey !== "string") throw new Error("VALIDATION_FAILED");
  if (designVersion !== null && !Number.isInteger(designVersion)) throw new Error("VALIDATION_FAILED");
  if (warnings !== null && (!Array.isArray(warnings) || warnings.length > 3)) throw new Error("VALIDATION_FAILED");
  return {
    p_artifact_schema_version: schema,
    p_renderer_key: parsed.renderer_key,
    p_design_key: designKey as string | null,
    p_design_version: designVersion as number | null,
    p_font_warnings: warnings as unknown[] | null,
  };
}
