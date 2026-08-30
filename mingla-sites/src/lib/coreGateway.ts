import { hmacBase64, sha256 } from "./crypto";
import { runtimeConfig } from "./config";

export async function signedCorePost(input: {
  edgeFunction: "brand-site-runtime-resolve";
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
