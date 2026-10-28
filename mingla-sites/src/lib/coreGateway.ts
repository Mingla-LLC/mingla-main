import { hmacBase64, sha256 } from "./crypto";
import { runtimeConfig } from "./config";

/**
 * #2829 — the site id a HOST RESOLUTION is signed with (mirrors
 * SITES_HOST_RESOLUTION_SITE_ID in supabase/functions/_shared/sitesContracts.ts).
 * The runtime serves every brand, so it cannot know the site before Core
 * answers; the signed path pins the hostname instead.
 */
export const HOST_RESOLUTION_SITE_ID = "00000000-0000-4000-8000-000000000000";

/** The part of a resolved site a Core call is bound to. */
export type SiteBinding = { readonly site_id: string };

async function sign(input: {
  edgeFunction: "brand-site-runtime-resolve" | "brand-site-attribution";
  path: string;
  siteId: string;
  body: Record<string, unknown>;
}): Promise<Response> {
  const config = runtimeConfig();
  const serialized = JSON.stringify(input.body);
  const issuedAt = new Date();
  const unsigned = {
    schema_version: 1,
    issuer: config.runtimeIssuer,
    audience: config.runtimeAudience,
    direction: "runtime_to_core",
    site_id: input.siteId,
    operation_id: crypto.randomUUID(),
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + 60_000).toISOString(),
    nonce: crypto.randomUUID(),
    method: "POST",
    path: input.path,
    body_sha256: await sha256(serialized),
    kid: config.runtimeKeyId,
  } as const;
  const canonical = [
    unsigned.schema_version,
    unsigned.issuer,
    unsigned.audience,
    unsigned.direction,
    unsigned.site_id,
    unsigned.operation_id,
    unsigned.issued_at,
    unsigned.expires_at,
    unsigned.nonce,
    unsigned.method,
    unsigned.path,
    unsigned.body_sha256,
    unsigned.kid,
  ].join("\n");
  const envelope = {
    ...unsigned,
    signature_b64: await hmacBase64(config.runtimeHmac, canonical),
  };
  return fetch(
    `${config.coreBaseUrl}/functions/v1/${input.edgeFunction}${input.path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mingla-sites-envelope": Buffer.from(JSON.stringify(envelope))
          .toString("base64"),
      },
      body: serialized,
      cache: "no-store",
    },
  );
}

/**
 * #2829 — a Core call on behalf of ONE resolved site. The site comes from the
 * object Core resolved for this request's host, never from a caller-supplied
 * string: the path must be that site's path and any `site_id` in the body must
 * be that site, or the call is refused before anything is signed.
 */
export async function signedCorePost(input: {
  edgeFunction: "brand-site-attribution" | "brand-site-runtime-resolve";
  path: string;
  site: SiteBinding;
  body: Record<string, unknown>;
}): Promise<Response> {
  const siteId = input.site?.site_id;
  if (
    typeof siteId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(siteId) ||
    siteId === HOST_RESOLUTION_SITE_ID ||
    !input.path.startsWith(`/internal/v1/sites/${siteId}/`) ||
    (input.body.site_id !== undefined && input.body.site_id !== siteId)
  ) {
    throw new Error("SITE_SCOPE_MISMATCH");
  }
  return sign({ ...input, siteId });
}

/** #2829 — ask Core which site (and publication) a host belongs to. */
export async function signedHostResolution(
  hostname: string,
  kind: "publication" | "site" | "probe",
): Promise<Response> {
  return sign({
    edgeFunction: "brand-site-runtime-resolve",
    path: `/internal/v1/hosts/${hostname}/${kind}`,
    siteId: HOST_RESOLUTION_SITE_ID,
    body: { hostname },
  });
}
