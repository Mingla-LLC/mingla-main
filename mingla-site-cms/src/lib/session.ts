import type { TypedUser } from "payload";
import { cmsConfig } from "./config";
import { base64url, fromBase64url, hmac, timingSafeEqual } from "./crypto";
import { MINGLA_BUSINESS_ORIGIN } from "./origins";

export const STUDIO_COOKIE = "__Host-mingla_studio";
export const STUDIO_CSRF_COOKIE = "__Host-mingla_studio_csrf";

export type StudioSession = {
  version: 1; site_id: string; brand_id: string; user_id: string; rank: number;
  tenant_id: string; issued_at: number; absolute_expires_at: number; idle_expires_at: number; nonce: string;
  return_surface: "web" | "native";
};

export type PreviewGrant = {
  version: 1;
  issuer: "mingla-site-cms";
  audience: "mingla-studio-preview";
  site_id: string;
  brand_id: string;
  user_id: string;
  tenant_id: string;
  source_revision: string;
  source_digest: string;
  renderer_key: "restaurant-website-v1";
  renderer_version: 1;
  issued_at: number;
  expires_at: number;
  nonce: string;
  return_surface: "web" | "native";
};

export type StudioReturnResult =
  | "exchange_expired"
  | "session_expired"
  | "preview_expired"
  | "preview_publish";

export type StudioReturnContext = Pick<
  StudioSession,
  "brand_id" | "site_id" | "return_surface"
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function encodeSigned(value: Record<string, unknown>): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(value)));
  return `${payload}.${await hmac(cmsConfig().previewSecret, payload)}`;
}

async function decodeSigned(value: string | null): Promise<Record<string, unknown> | null> {
  if (!value || value.length > 8192) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  if (!await timingSafeEqual(signature, await hmac(cmsConfig().previewSecret, payload))) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    return decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function encodeSession(session: StudioSession): Promise<string> {
  return encodeSigned(session);
}

export async function decodeSession(value: string | null): Promise<StudioSession | null> {
  const decoded = await decodeSigned(value);
  if (!decoded) return null;
  const session = decoded as unknown as StudioSession;
  const now = Math.floor(Date.now() / 1000);
  if (session.version !== 1 || session.rank < 20 || session.absolute_expires_at <= now || session.idle_expires_at <= now) return null;
  if (session.return_surface !== "web" && session.return_surface !== "native") return null;
  if (![session.site_id, session.brand_id, session.user_id, session.tenant_id].every((id) => /^[0-9a-f-]{36}$/i.test(id))) return null;
  return session;
}

function returnContext(value: Record<string, unknown> | null): StudioReturnContext | null {
  if (
    !value ||
    !UUID.test(String(value.brand_id || "")) ||
    !UUID.test(String(value.site_id || "")) ||
    (value.return_surface !== "web" && value.return_surface !== "native")
  ) return null;
  return {
    brand_id: String(value.brand_id),
    site_id: String(value.site_id),
    return_surface: value.return_surface,
  };
}

/** Validates the signature and closed context even when the session has expired. */
export async function decodeSessionReturnContext(
  value: string | null,
): Promise<StudioReturnContext | null> {
  const decoded = await decodeSigned(value);
  return decoded?.version === 1 ? returnContext(decoded) : null;
}

export async function encodePreviewGrant(grant: PreviewGrant): Promise<string> {
  return encodeSigned(grant);
}

export async function decodePreviewGrant(value: string | null): Promise<PreviewGrant | null> {
  const decoded = await decodeSigned(value);
  if (!decoded) return null;
  const grant = decoded as unknown as PreviewGrant;
  const now = Math.floor(Date.now() / 1000);
  if (
    grant.version !== 1 ||
    grant.issuer !== "mingla-site-cms" ||
    grant.audience !== "mingla-studio-preview" ||
    grant.renderer_key !== "restaurant-website-v1" ||
    grant.renderer_version !== 1 ||
    (grant.return_surface !== "web" && grant.return_surface !== "native") ||
    grant.issued_at > now + 5 ||
    grant.expires_at <= now ||
    grant.expires_at - grant.issued_at > 1800 ||
    ![grant.site_id, grant.brand_id, grant.user_id, grant.tenant_id, grant.nonce]
      .every((id) => /^[0-9a-f-]{36}$/i.test(id)) ||
    typeof grant.source_revision !== "string" ||
    grant.source_revision.length < 1 ||
    grant.source_revision.length > 200 ||
    typeof grant.source_digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(grant.source_digest)
  ) return null;
  return grant;
}


/** Validates a preview's signed return context without accepting an expired grant. */
export async function decodePreviewReturnContext(
  value: string | null,
): Promise<StudioReturnContext | null> {
  const decoded = await decodeSigned(value);
  return decoded?.version === 1 &&
      decoded.issuer === "mingla-site-cms" &&
      decoded.audience === "mingla-studio-preview"
    ? returnContext(decoded)
    : null;
}

export function cookieValue(headers: Headers, name: string): string | null {
  const match = headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export async function sessionFromHeaders(headers: Headers): Promise<StudioSession | null> { return decodeSession(cookieValue(headers, STUDIO_COOKIE)); }

export function studioReturnLocationFromContext(
  context: StudioReturnContext,
  result?: StudioReturnResult,
): string {
  const brandId = encodeURIComponent(context.brand_id);
  const suffix = result ? `&result=${encodeURIComponent(result)}` : "";
  return context.return_surface === "native"
    ? `mingla-business://website-return?brandId=${brandId}${suffix}`
    : `${MINGLA_BUSINESS_ORIGIN}/brand/${brandId}/website${
      result ? `?studioResult=${encodeURIComponent(result)}` : ""
    }`;
}

export function studioReturnLocation(
  session: StudioSession,
  result?: StudioReturnResult,
): string {
  return studioReturnLocationFromContext(session, result);
}

export function assertMutationRequest(headers: Headers): void {
  const config = cmsConfig();
  if (headers.get("origin") !== config.cmsOrigin) throw new Error("FORBIDDEN");
  const csrf = headers.get("x-mingla-csrf");
  if (!csrf || csrf !== cookieValue(headers, STUDIO_CSRF_COOKIE)) throw new Error("FORBIDDEN");
}

export function payloadUser(session: StudioSession): TypedUser & Record<string, unknown> {
  return {
    id: session.user_id, collection: "studio-users", email: `${session.user_id}@session.invalid`,
    siteId: session.site_id, brandId: session.brand_id, tenantId: session.tenant_id,
    rank: session.rank, tenants: [{ tenant: session.tenant_id }],
  } as unknown as TypedUser & Record<string, unknown>;
}
