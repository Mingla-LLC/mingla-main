#!/usr/bin/env node

import { createHash, createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  fail,
  requiredEnv,
  requireUuid,
  stableJson,
} from "./lib/sites-ops.mjs";

export const GOGI_ACTIVATION = Object.freeze({
  brandId: "733bc470-45e1-4684-8896-acd7e26074ff",
  configuredBy: "1f3d2ddf-b741-4e2f-8884-d7222a660c7e",
  hostname: "gogi.sites.usemingla.com",
  cmsOrigin: "https://studio.sites.usemingla.com",
  runtimeOrigin: "https://gogi.sites.usemingla.com",
  coreOrigin: "https://gqnoajqerqhnvulmnyvv.supabase.co",
});

const SHA256 = /^[0-9a-f]{64}$/;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function operatorConfig(env) {
  const siteId = requireUuid(requiredEnv(env, "SITES_PILOT_SITE_ID"));
  const coreOrigin = requiredEnv(env, "SITES_CORE_BASE_URL");
  if (coreOrigin !== GOGI_ACTIVATION.coreOrigin) fail("CORE_ORIGIN_MISMATCH");
  const serviceKey = requiredEnv(env, "SITES_CORE_SERVICE_ROLE_KEY");
  if (serviceKey.length < 80 || /\s/.test(serviceKey)) fail("INVALID_CORE_SERVICE_KEY");
  const candidateSecret = Buffer.from(
    requiredEnv(env, "SITES_CANDIDATE_PROBE_SECRET"),
    "base64",
  );
  if (candidateSecret.byteLength !== 32) fail("INVALID_CANDIDATE_PROBE_SECRET");
  return { siteId, serviceKey, candidateSecret };
}

function coreHeaders(serviceKey, json = false) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    accept: "application/json",
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function responseJson(response, code) {
  const value = await response.json().catch(() => null);
  if (!response.ok) fail(code);
  return value;
}

async function callRpc(fetchImpl, config, name, body, code) {
  const response = await fetchImpl(
    `${GOGI_ACTIVATION.coreOrigin}/rest/v1/rpc/${name}`,
    {
      method: "POST",
      headers: coreHeaders(config.serviceKey, true),
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
    },
  );
  return exactObject(await responseJson(response, code), code);
}

async function readOne(fetchImpl, config, table, query, code) {
  const response = await fetchImpl(
    `${GOGI_ACTIVATION.coreOrigin}/rest/v1/${table}?${query}`,
    {
      method: "GET",
      headers: coreHeaders(config.serviceKey),
      cache: "no-store",
      redirect: "error",
    },
  );
  const rows = await responseJson(response, code);
  if (!Array.isArray(rows) || rows.length !== 1) fail(code);
  return exactObject(rows[0], code);
}

async function candidateProbe(fetchImpl, config, publication, now, nonce) {
  const body = JSON.stringify({
    site_id: config.siteId,
    brand_id: GOGI_ACTIVATION.brandId,
    publication_id: publication.id,
    artifact_key: publication.artifact_key,
    artifact_digest: publication.artifact_digest,
    artifact_schema_version: 1,
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
  });
  const timestamp = now.toISOString();
  const signature = createHmac("sha256", config.candidateSecret)
    .update(`${timestamp}\n${nonce}\n${digest(body)}`)
    .digest("base64url");
  const response = await fetchImpl(
    `${GOGI_ACTIVATION.runtimeOrigin}/api/internal/candidate-probe`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mingla-probe-time": timestamp,
        "x-mingla-probe-nonce": nonce,
        "x-mingla-probe-signature": signature,
      },
      body,
      cache: "no-store",
      redirect: "error",
    },
  );
  const envelope = await responseJson(response, "CANDIDATE_PROBE_FAILED");
  const data = exactObject(envelope?.data, "CANDIDATE_PROBE_FAILED");
  const requiredTrue = [
    "http_ok", "digest_ok", "renderer_ok", "schema_ok", "canonical_ok",
    "assets_ok", "accessibility_ok", "consent_ok", "cta_ok", "leak_check_ok",
  ];
  if (
    envelope.ok !== true || response.status !== 200 ||
    requiredTrue.some((key) => data[key] !== true) ||
    data.status_code !== 200 ||
    data.observed_digest !== publication.artifact_digest
  ) fail("CANDIDATE_PROBE_FAILED");
  return {
    data,
    tlsEvidenceDigest: digest(stableJson({
      schema_version: 1,
      hostname: GOGI_ACTIVATION.hostname,
      observed_at: timestamp,
      transport: "https-default-ca-verification",
      endpoint: "/api/internal/candidate-probe",
      status_code: response.status,
    })),
    probeEvidenceDigest: digest(stableJson({
      schema_version: 1,
      publication_id: publication.id,
      artifact_digest: publication.artifact_digest,
      result: data,
    })),
  };
}

async function deactivateAfterFailedPublicReadback(
  fetchImpl,
  config,
  operationId,
) {
  await callRpc(fetchImpl, config, "brand_site_deactivate_gogi_pilot", {
    p_brand_id: GOGI_ACTIVATION.brandId,
    p_site_id: config.siteId,
    p_hostname: GOGI_ACTIVATION.hostname,
    p_operation_id: operationId,
    p_reason_code: "PUBLIC_POST_ACTIVATION_FAILED",
  }, "PILOT_DEACTIVATION_FAILED");
}

export async function activateGogiPilot({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  uuid = randomUUID,
} = {}) {
  const config = operatorConfig(env);
  const operationIds = {
    configure: uuid(),
    probe: uuid(),
    activate: uuid(),
    deactivate: uuid(),
  };
  Object.values(operationIds).forEach((value) => requireUuid(value));

  const configured = await callRpc(
    fetchImpl,
    config,
    "brand_site_configure_pilot_binding",
    {
      p_brand_id: GOGI_ACTIVATION.brandId,
      p_site_id: config.siteId,
      p_cms_origin: GOGI_ACTIVATION.cmsOrigin,
      p_public_runtime_origin: GOGI_ACTIVATION.runtimeOrigin,
      p_operator_user_id: GOGI_ACTIVATION.configuredBy,
      p_operation_id: operationIds.configure,
    },
    "PILOT_CONFIGURATION_FAILED",
  );
  if (
    configured.site_id !== config.siteId ||
    configured.brand_id !== GOGI_ACTIVATION.brandId ||
    configured.status !== "configured" ||
    configured.pilot_enabled !== false
  ) fail("PILOT_CONFIGURATION_READBACK_MISMATCH");

  const site = await readOne(
    fetchImpl,
    config,
    "brand_sites",
    new URLSearchParams({
      id: `eq.${config.siteId}`,
      brand_id: `eq.${GOGI_ACTIVATION.brandId}`,
      select: "id,brand_id,status,active_publication_id,last_successful_publication_id",
    }).toString(),
    "PILOT_SITE_READBACK_FAILED",
  );
  if (
    site.status !== "published" ||
    !requireUuid(String(site.active_publication_id), "PILOT_PUBLICATION_INVALID") ||
    site.last_successful_publication_id !== site.active_publication_id
  ) fail("PILOT_SITE_NOT_PUBLISHED");
  const publication = await readOne(
    fetchImpl,
    config,
    "brand_site_publications",
    new URLSearchParams({
      id: `eq.${site.active_publication_id}`,
      site_id: `eq.${config.siteId}`,
      status: "eq.published",
      select: "id,site_id,status,artifact_key,artifact_digest,artifact_schema_version,renderer_key,renderer_version",
    }).toString(),
    "PILOT_PUBLICATION_READBACK_FAILED",
  );
  if (
    publication.id !== site.active_publication_id ||
    publication.site_id !== config.siteId ||
    publication.status !== "published" ||
    publication.artifact_schema_version !== 1 ||
    publication.renderer_key !== "restaurant-website-v1" ||
    publication.renderer_version !== 1 ||
    !SHA256.test(String(publication.artifact_digest || "")) ||
    publication.artifact_key !==
      `publications/${config.siteId}/${publication.id}/${publication.artifact_digest}.json`
  ) fail("PILOT_PUBLICATION_INVALID");

  const probe = await candidateProbe(
    fetchImpl,
    config,
    publication,
    now,
    operationIds.probe,
  );
  const hostReadiness = await callRpc(
    fetchImpl,
    config,
    "brand_site_record_host_readiness",
    {
      p_site_id: config.siteId,
      p_operation_id: operationIds.probe,
      p_observed_at: now.toISOString(),
      p_hostname: GOGI_ACTIVATION.hostname,
      p_publication_id: publication.id,
      p_artifact_digest: publication.artifact_digest,
      p_tls_evidence_digest: probe.tlsEvidenceDigest,
      p_probe_evidence_digest: probe.probeEvidenceDigest,
    },
    "HOST_READINESS_RECORD_FAILED",
  );
  if (
    hostReadiness.site_id !== config.siteId ||
    hostReadiness.hostname !== GOGI_ACTIVATION.hostname ||
    hostReadiness.publication_id !== publication.id ||
    hostReadiness.status !== "verified"
  ) fail("HOST_READINESS_READBACK_MISMATCH");

  try {
    // Activation-response loss is ambiguous: PostgreSQL may have committed
    // before the network failed. Keep the attempt itself inside the same
    // compensating boundary as every post-activation readback.
    const activated = await callRpc(
      fetchImpl,
      config,
      "brand_site_activate_gogi_pilot",
      {
        p_brand_id: GOGI_ACTIVATION.brandId,
        p_site_id: config.siteId,
        p_hostname: GOGI_ACTIVATION.hostname,
        p_operation_id: operationIds.activate,
      },
      "PILOT_ACTIVATION_FAILED",
    );
    if (
      activated.site_id !== config.siteId ||
      activated.brand_id !== GOGI_ACTIVATION.brandId ||
      activated.hostname !== GOGI_ACTIVATION.hostname ||
      activated.publication_id !== publication.id ||
      activated.status !== "active"
    ) fail("PILOT_ACTIVATION_READBACK_MISMATCH");

    const [service, host, live] = await Promise.all([
      readOne(
        fetchImpl,
        config,
        "brand_site_service_config",
        "config_key=eq.sites_v1&select=config_key,pilot_brand_id,pilot_site_id,pilot_enabled,cms_origin,public_runtime_origin,host_readiness_hostname,public_probe_publication_id,public_probe_artifact_digest",
        "PILOT_COMMITTED_READBACK_FAILED",
      ),
      readOne(
        fetchImpl,
        config,
        "brand_site_hosts",
        new URLSearchParams({
          site_id: `eq.${config.siteId}`,
          hostname: `eq.${GOGI_ACTIVATION.hostname}`,
          select: "site_id,hostname,kind,is_primary,status,activated_at",
        }).toString(),
        "PILOT_COMMITTED_READBACK_FAILED",
      ),
      fetchImpl(`${GOGI_ACTIVATION.runtimeOrigin}/`, {
        method: "GET",
        headers: { accept: "text/html" },
        cache: "no-store",
        redirect: "error",
      }),
    ]);
    const html = await live.text();
    if (
      service.pilot_enabled !== true ||
      service.pilot_brand_id !== GOGI_ACTIVATION.brandId ||
      service.pilot_site_id !== config.siteId ||
      service.cms_origin !== GOGI_ACTIVATION.cmsOrigin ||
      service.public_runtime_origin !== GOGI_ACTIVATION.runtimeOrigin ||
      service.host_readiness_hostname !== GOGI_ACTIVATION.hostname ||
      service.public_probe_publication_id !== publication.id ||
      service.public_probe_artifact_digest !== publication.artifact_digest ||
      host.site_id !== config.siteId || host.hostname !== GOGI_ACTIVATION.hostname ||
      host.kind !== "mingla_subdomain" || host.is_primary !== true ||
      host.status !== "active" || !Number.isFinite(Date.parse(host.activated_at)) ||
      !live.ok || live.status !== 200 ||
      !(live.headers.get("content-type") || "").toLowerCase().includes("text/html") ||
      html.length < 100 ||
      /(payload|supabase|vercel|database_url|secret_access_key)/i.test(html)
    ) fail("PILOT_COMMITTED_READBACK_FAILED");
  } catch (error) {
    await deactivateAfterFailedPublicReadback(
      fetchImpl,
      config,
      operationIds.deactivate,
    );
    throw error;
  }

  process.stdout.write(
    `SITES_GOGI_ACTIVATED site=${config.siteId} publication=${publication.id}\n`,
  );
  return {
    ok: true,
    status: "active",
    site_id: config.siteId,
    brand_id: GOGI_ACTIVATION.brandId,
    hostname: GOGI_ACTIVATION.hostname,
    publication_id: publication.id,
    artifact_digest: publication.artifact_digest,
    tls_evidence_digest: probe.tlsEvidenceDigest,
    probe_evidence_digest: probe.probeEvidenceDigest,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  activateGogiPilot().catch((error) => {
    const code = error?.code || error?.message || "GOGI_ACTIVATION_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  });
}
