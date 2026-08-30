import type { PayloadRequest } from "payload";
import { cmsConfig } from "./config";
import { hmac, sha256, timingSafeEqual } from "./crypto";

export type GatewayEnvelope = {
  schema_version: 1;
  issuer: string;
  audience: string;
  direction: "core_to_cms" | "cms_to_core";
  site_id: string;
  operation_id: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  method: string;
  path: string;
  body_sha256: string;
  kid: string;
  signature_b64: string;
};

function canonical(value: Omit<GatewayEnvelope, "signature_b64">): string {
  return [
    value.schema_version,
    value.issuer,
    value.audience,
    value.direction,
    value.site_id,
    value.operation_id,
    value.issued_at,
    value.expires_at,
    value.nonce,
    value.method,
    value.path,
    value.body_sha256,
    value.kid,
  ].join("\n");
}

export async function signCmsRequest(input: {
  siteId: string;
  operationId: string;
  method: string;
  path: string;
  body: string;
}): Promise<GatewayEnvelope> {
  const config = cmsConfig();
  const issued = new Date();
  const value: Omit<GatewayEnvelope, "signature_b64"> = {
    schema_version: 1,
    issuer: "mingla-site-cms",
    audience: "mingla-core",
    direction: "cms_to_core",
    site_id: input.siteId,
    operation_id: input.operationId,
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + 60_000).toISOString(),
    nonce: crypto.randomUUID(),
    method: input.method.toUpperCase(),
    path: input.path,
    body_sha256: await sha256(input.body),
    kid: config.cmsToCoreCurrentKeyId,
  };
  return {
    ...value,
    signature_b64: Buffer.from(
      await hmac(config.cmsToCoreCurrent, canonical(value)),
      "base64url",
    ).toString("base64"),
  };
}

export async function verifyCoreRequest(
  request: PayloadRequest,
  body: string,
  expectedPath: string,
): Promise<GatewayEnvelope> {
  const raw = request.headers.get("x-mingla-sites-envelope");
  if (!raw || raw.length > 16384) throw new Error("SIGNATURE_INVALID");
  let envelope: GatewayEnvelope;
  try {
    envelope = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new Error("SIGNATURE_INVALID");
  }
  const now = Date.now();
  const issued = Date.parse(envelope.issued_at);
  const expires = Date.parse(envelope.expires_at);
  if (
    envelope.schema_version !== 1 ||
    envelope.issuer !== "mingla-core" ||
    envelope.audience !== "mingla-site-cms" ||
    envelope.direction !== "core_to_cms" ||
    envelope.method !== request.method ||
    envelope.path !== expectedPath ||
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires - issued > 60_000 ||
    issued > now + 5_000 ||
    expires <= now ||
    envelope.body_sha256 !== (await sha256(body))
  )
    throw new Error("SIGNATURE_INVALID");
  const config = cmsConfig();
  const secret =
    envelope.kid === config.coreToCmsCurrentKeyId
      ? config.coreToCmsCurrent
      : envelope.kid === config.coreToCmsPreviousKeyId
        ? config.coreToCmsPrevious
        : null;
  const { signature_b64, ...unsigned } = envelope;
  void signature_b64;
  const expected = Buffer.from(
    await hmac(
      secret || "",
      canonical(unsigned as Omit<GatewayEnvelope, "signature_b64">),
    ),
    "base64url",
  ).toString("base64");
  if (!secret || !(await timingSafeEqual(envelope.signature_b64, expected)))
    throw new Error("SIGNATURE_INVALID");
  if (!/^[0-9a-f-]{36}$/i.test(envelope.nonce))
    throw new Error("SIGNATURE_INVALID");
  try {
    await request.payload.create({
      collection: "gateway-nonces",
      overrideAccess: true,
      data: {
        nonce: envelope.nonce,
        direction: "core_to_cms",
        site_id: envelope.site_id,
        operation_id: envelope.operation_id,
        expires_at: new Date(expires).toISOString(),
      },
    });
  } catch {
    // The nonce is unique for the lifetime of the ledger. A duplicate is a
    // replay even when its original request has expired.
    throw new Error("REPLAY_DETECTED");
  }
  return envelope;
}

export async function callCore(
  path: string,
  siteId: string,
  operationId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload);
  const envelope = await signCmsRequest({
    siteId,
    operationId,
    method: "POST",
    path,
    body,
  });
  const response = await fetch(
    `${cmsConfig().coreBaseUrl}/functions/v1/brand-site-cms-callback${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mingla-sites-envelope": Buffer.from(
          JSON.stringify(envelope),
        ).toString("base64"),
      },
      body,
      cache: "no-store",
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok)
    throw new Error(String(result?.error?.code || "CORE_UNAVAILABLE"));
  return result.data;
}

export async function readCoreProjection(
  path: string,
  siteId: string,
  operationId: string,
  offeringIds: string[],
): Promise<Record<string, unknown>> {
  const body = "";
  const envelope = await signCmsRequest({
    siteId,
    operationId,
    method: "GET",
    path,
    body,
  });
  const query = new URLSearchParams();
  for (const id of offeringIds) query.append("offering_id", id);
  const response = await fetch(
    `${cmsConfig().coreBaseUrl}/functions/v1/brand-site-cms-callback${path}?${query}`,
    {
      method: "GET",
      headers: {
        "x-mingla-sites-envelope": Buffer.from(
          JSON.stringify(envelope),
        ).toString("base64"),
      },
      cache: "no-store",
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok)
    throw new Error(String(result?.error?.code || "CORE_UNAVAILABLE"));
  return result.data;
}

export async function readCoreRetentionProjection(
  siteId: string,
  operationId: string,
): Promise<{ protected_artifact_keys: string[] }> {
  const path = `/internal/v1/sites/${siteId}/retention-protection`;
  const envelope = await signCmsRequest({
    siteId,
    operationId,
    method: "GET",
    path,
    body: "",
  });
  const response = await fetch(
    `${cmsConfig().coreBaseUrl}/functions/v1/brand-site-cms-callback${path}`,
    {
      method: "GET",
      headers: {
        "x-mingla-sites-envelope": Buffer.from(JSON.stringify(envelope))
          .toString("base64"),
      },
      cache: "no-store",
    },
  );
  const result = await response.json().catch(() => null);
  if (
    !response.ok || !result?.ok ||
    !Array.isArray(result.data?.protected_artifact_keys)
  ) throw new Error("CORE_UNAVAILABLE");
  return {
    protected_artifact_keys: result.data.protected_artifact_keys.map(String),
  };
}

export async function readCorePublicationSource(
  siteId: string,
  publicationId: string,
  operationId: string,
): Promise<Record<string, unknown>> {
  const path =
    `/internal/v1/sites/${siteId}/publications/${publicationId}/source`;
  const envelope = await signCmsRequest({
    siteId,
    operationId,
    method: "GET",
    path,
    body: "",
  });
  const response = await fetch(
    `${cmsConfig().coreBaseUrl}/functions/v1/brand-site-cms-callback${path}`,
    {
      method: "GET",
      headers: {
        "x-mingla-sites-envelope": Buffer.from(JSON.stringify(envelope))
          .toString("base64"),
      },
      cache: "no-store",
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok || !result.data) {
    throw new Error("CORE_UNAVAILABLE");
  }
  return result.data as Record<string, unknown>;
}
