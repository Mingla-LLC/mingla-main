import assert from "node:assert/strict";
import test from "node:test";

import {
  activateGogiPilot,
  GOGI_ACTIVATION,
} from "../activate-gogi-pilot.mjs";

const SITE_ID = "123e4567-e89b-42d3-a456-426614174000";
const PUBLICATION_ID = "123e4567-e89b-42d3-a456-426614174002";
const ARTIFACT_DIGEST = "a".repeat(64);
const NOW = new Date("2026-09-01T12:00:00.000Z");
const IDS = [
  "123e4567-e89b-42d3-a456-426614174010",
  "123e4567-e89b-42d3-a456-426614174011",
  "123e4567-e89b-42d3-a456-426614174012",
  "123e4567-e89b-42d3-a456-426614174013",
];

function environment(overrides = {}) {
  return {
    SITES_PILOT_SITE_ID: SITE_ID,
    SITES_CORE_BASE_URL: GOGI_ACTIVATION.coreOrigin,
    SITES_CORE_SERVICE_ROLE_KEY: "s".repeat(100),
    SITES_CANDIDATE_PROBE_SECRET: Buffer.alloc(32, 7).toString("base64"),
    ...overrides,
  };
}

function candidateData(overrides = {}) {
  return {
    http_ok: true,
    digest_ok: true,
    renderer_ok: true,
    schema_ok: true,
    canonical_ok: true,
    assets_ok: true,
    accessibility_ok: true,
    consent_ok: true,
    cta_ok: true,
    leak_check_ok: true,
    observed_digest: ARTIFACT_DIGEST,
    status_code: 200,
    ...overrides,
  };
}

function fixtureFetch({
  candidate = candidateData(),
  activationStatus = 200,
  servicePilotEnabled = true,
} = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const rpc = url.match(/\/rest\/v1\/rpc\/([^?]+)/)?.[1];
    if (rpc) {
      calls.push(rpc);
      const body = JSON.parse(String(init.body));
      if (rpc === "brand_site_configure_pilot_binding") {
        assert.deepEqual(body, {
          p_brand_id: GOGI_ACTIVATION.brandId,
          p_site_id: SITE_ID,
          p_cms_origin: GOGI_ACTIVATION.cmsOrigin,
          p_public_runtime_origin: GOGI_ACTIVATION.runtimeOrigin,
          p_operator_user_id: GOGI_ACTIVATION.configuredBy,
          p_operation_id: IDS[0],
        });
        return Response.json({
          site_id: SITE_ID,
          brand_id: GOGI_ACTIVATION.brandId,
          status: "configured",
          pilot_enabled: false,
        });
      }
      if (rpc === "brand_site_record_host_readiness") {
        assert.equal(body.p_operation_id, IDS[1]);
        assert.equal(body.p_hostname, GOGI_ACTIVATION.hostname);
        assert.match(body.p_tls_evidence_digest, /^[0-9a-f]{64}$/);
        assert.match(body.p_probe_evidence_digest, /^[0-9a-f]{64}$/);
        return Response.json({
          site_id: SITE_ID,
          hostname: GOGI_ACTIVATION.hostname,
          publication_id: PUBLICATION_ID,
          status: "verified",
        });
      }
      if (rpc === "brand_site_activate_gogi_pilot") {
        if (activationStatus !== 200) {
          return Response.json({ message: "ambiguous" }, {
            status: activationStatus,
          });
        }
        return Response.json({
          site_id: SITE_ID,
          brand_id: GOGI_ACTIVATION.brandId,
          hostname: GOGI_ACTIVATION.hostname,
          publication_id: PUBLICATION_ID,
          status: "active",
          activated_at: NOW.toISOString(),
        });
      }
      if (rpc === "brand_site_deactivate_gogi_pilot") {
        assert.equal(body.p_operation_id, IDS[3]);
        assert.equal(body.p_reason_code, "PUBLIC_POST_ACTIVATION_FAILED");
        return Response.json({
          site_id: SITE_ID,
          hostname: GOGI_ACTIVATION.hostname,
          status: "disabled",
          deactivated_at: NOW.toISOString(),
          last_good_preserved: true,
        });
      }
    }
    if (url.includes("/rest/v1/brand_sites?")) {
      calls.push("read_site");
      return Response.json([{
        id: SITE_ID,
        brand_id: GOGI_ACTIVATION.brandId,
        status: "published",
        active_publication_id: PUBLICATION_ID,
        last_successful_publication_id: PUBLICATION_ID,
      }]);
    }
    if (url.includes("/rest/v1/brand_site_publications?")) {
      calls.push("read_publication");
      return Response.json([{
        id: PUBLICATION_ID,
        site_id: SITE_ID,
        status: "published",
        artifact_key:
          `publications/${SITE_ID}/${PUBLICATION_ID}/${ARTIFACT_DIGEST}.json`,
        artifact_digest: ARTIFACT_DIGEST,
        artifact_schema_version: 1,
        renderer_key: "restaurant-website-v1",
        renderer_version: 1,
      }]);
    }
    if (url.endsWith("/api/internal/candidate-probe")) {
      calls.push("candidate_probe");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("x-mingla-probe-time"), NOW.toISOString());
      assert.match(headers.get("x-mingla-probe-signature"), /^[A-Za-z0-9_-]{43}$/);
      assert.equal(String(init.body).includes(environment().SITES_CANDIDATE_PROBE_SECRET), false);
      return Response.json({ ok: true, data: candidate });
    }
    if (url.includes("/rest/v1/brand_site_service_config?")) {
      calls.push("read_service");
      return Response.json([{
        config_key: "sites_v1",
        pilot_brand_id: GOGI_ACTIVATION.brandId,
        pilot_site_id: SITE_ID,
        pilot_enabled: servicePilotEnabled,
        cms_origin: GOGI_ACTIVATION.cmsOrigin,
        public_runtime_origin: GOGI_ACTIVATION.runtimeOrigin,
        host_readiness_hostname: GOGI_ACTIVATION.hostname,
        public_probe_publication_id: PUBLICATION_ID,
        public_probe_artifact_digest: ARTIFACT_DIGEST,
      }]);
    }
    if (url.includes("/rest/v1/brand_site_hosts?")) {
      calls.push("read_host");
      return Response.json([{
        site_id: SITE_ID,
        hostname: GOGI_ACTIVATION.hostname,
        kind: "mingla_subdomain",
        is_primary: true,
        status: "active",
        activated_at: NOW.toISOString(),
      }]);
    }
    if (url === `${GOGI_ACTIVATION.runtimeOrigin}/`) {
      calls.push("public_home");
      return new Response(`<html><body>${"Gogi Lagos ".repeat(20)}</body></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  return { calls, fetchImpl };
}

function uuidSequence() {
  let index = 0;
  return () => IDS[index++];
}

test("#2893 Gogi operator probes, records, atomically activates, then reads live state", async () => {
  const fixture = fixtureFetch();
  const result = await activateGogiPilot({
    env: environment(),
    fetchImpl: fixture.fetchImpl,
    now: NOW,
    uuid: uuidSequence(),
  });
  assert.deepEqual(fixture.calls, [
    "brand_site_configure_pilot_binding",
    "read_site",
    "read_publication",
    "candidate_probe",
    "brand_site_record_host_readiness",
    "brand_site_activate_gogi_pilot",
    "read_service",
    "read_host",
    "public_home",
  ]);
  assert.equal(result.status, "active");
  assert.equal(result.hostname, GOGI_ACTIVATION.hostname);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /supabase|vercel|service_role|secret/i);
});

test("#2893 corrupt candidate media stops before host evidence or activation", async () => {
  const fixture = fixtureFetch({ candidate: candidateData({ assets_ok: false }) });
  await assert.rejects(() => activateGogiPilot({
    env: environment(),
    fetchImpl: fixture.fetchImpl,
    now: NOW,
    uuid: uuidSequence(),
  }), /CANDIDATE_PROBE_FAILED/);
  assert.deepEqual(fixture.calls, [
    "brand_site_configure_pilot_binding",
    "read_site",
    "read_publication",
    "candidate_probe",
  ]);
});

test("#2893 ambiguous activation response triggers the stable fail-safe deactivation", async () => {
  const fixture = fixtureFetch({ activationStatus: 502 });
  await assert.rejects(() => activateGogiPilot({
    env: environment(),
    fetchImpl: fixture.fetchImpl,
    now: NOW,
    uuid: uuidSequence(),
  }), /PILOT_ACTIVATION_FAILED/);
  assert.deepEqual(fixture.calls.slice(-2), [
    "brand_site_activate_gogi_pilot",
    "brand_site_deactivate_gogi_pilot",
  ]);
});

test("#2893 wrong committed readback deactivates and arbitrary Core origin never reaches fetch", async () => {
  const fixture = fixtureFetch({ servicePilotEnabled: false });
  await assert.rejects(() => activateGogiPilot({
    env: environment(),
    fetchImpl: fixture.fetchImpl,
    now: NOW,
    uuid: uuidSequence(),
  }), /PILOT_COMMITTED_READBACK_FAILED/);
  assert.equal(fixture.calls.at(-1), "brand_site_deactivate_gogi_pilot");

  let reachedFetch = false;
  await assert.rejects(() => activateGogiPilot({
    env: environment({ SITES_CORE_BASE_URL: "https://evil.invalid" }),
    fetchImpl: async () => {
      reachedFetch = true;
      return Response.json({});
    },
  }), /CORE_ORIGIN_MISMATCH/);
  assert.equal(reachedFetch, false);
});
