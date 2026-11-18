/*
 * #4453 Fault 1 — provisioning accepts every registered design.
 *
 * Core's provision route used to accept only `atelier` and `voyage`, so a
 * brand that chose Pop (or any other gallery design) was refused with 409
 * INVALID_STATE before Studio ever heard of it. Every DESIGN_KEYS value must
 * now provision and reach Studio with the same `design_key`; a null or
 * unknown key is still refused.
 *
 * Drives the REAL brand-site-control handler; Supabase and Studio are faked
 * at the HTTP layer.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleBrandSiteControl } from "./index.ts";
import { DESIGN_KEYS } from "../_shared/siteContracts/designs.ts";

const SUPABASE_URL = "https://fixture-4453-provision.supabase.co";
const CMS_ORIGIN = "https://cms.fixture-4453-provision.invalid";
const USER_ID = "44530000-0000-4000-8000-000000000001";
const BRAND_ID = "44530000-0000-4000-8000-000000000002";
const SITE_ID = "44530000-0000-4000-8000-000000000003";

function securityEnvelope(): string {
  const material = (byte: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
  return JSON.stringify({
    schema_version: 1,
    core_to_cms_current_kid: "core-cms-current", core_to_cms_current_key_b64: material(41),
    core_to_cms_previous_kid: null, core_to_cms_previous_key_b64: null,
    cms_to_core_current_kid: "cms-core-current", cms_to_core_current_key_b64: material(42),
    cms_to_core_previous_kid: null, cms_to_core_previous_key_b64: null,
    runtime_to_core_current_kid: "runtime-core-current", runtime_to_core_current_key_b64: material(43),
    runtime_to_core_previous_kid: null, runtime_to_core_previous_key_b64: null,
    attribution_pepper_b64: material(44),
  });
}

const ENV_NAMES = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MINGLA_SITES_SECURITY_JSON"];

async function provisionWith(designKey: unknown) {
  const originalFetch = globalThis.fetch;
  const originalEnv = new Map(ENV_NAMES.map((name) => [name, Deno.env.get(name)]));
  const sent: Array<Record<string, unknown>> = [];
  const rpcs: string[] = [];
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", securityEnvelope());
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === CMS_ORIGIN) {
      sent.push(await request.clone().json());
      return Response.json({ ok: true, data: { status: "queued" } });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) rpcs.push(url.pathname.slice("/rest/v1/rpc/".length));
    switch (url.pathname) {
      case "/auth/v1/user":
        return Response.json({ id: USER_ID, aud: "authenticated", role: "authenticated", email: "owner@example.invalid" });
      case "/rest/v1/rpc/brand_site_plan_authorize_provision":
        return Response.json({ design_key: designKey, context_complete: true });
      case "/rest/v1/rpc/brand_site_provision":
        return Response.json({ site_id: SITE_ID, status: "provisioning" });
      case "/rest/v1/brands":
        return Response.json({ name: "Gameland" });
      case "/rest/v1/brand_site_hosts":
        return Response.json({ hostname: "gameland.sites.usemingla.com" });
      case "/rest/v1/brand_site_service_config":
        return Response.json({ cms_origin: CMS_ORIGIN, environment: "production" });
      case "/rest/v1/rpc/brand_site_mark_operation_ambiguous":
        return Response.json(null);
    }
    throw new Error(`unexpected fixture request ${request.method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    const response = await handleBrandSiteControl(new Request(`${SUPABASE_URL}/functions/v1/brand-site-control`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture-user-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({
        route: `/v1/brands/${BRAND_ID}/site`,
        method: "POST",
        operation_id: crypto.randomUUID(),
      }),
    }));
    const payload = await response.json() as Record<string, unknown>;
    return { response, payload, sent, rpcs };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of originalEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test({
  name: "#4453 every registered design provisions and reaches Studio with the same design_key",
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  assertEquals(DESIGN_KEYS.length >= 11, true, "the gallery designs are registered");
  for (const designKey of DESIGN_KEYS) {
    const { response, sent, rpcs } = await provisionWith(designKey);
    assertEquals(response.status, 202, `${designKey}: status ${response.status}`);
    assertEquals(rpcs.includes("brand_site_provision"), true, `${designKey}: Core provisioned`);
    assertEquals(sent.length, 1, `${designKey}: one Studio call`);
    assertEquals(sent[0].kind, "provision");
    assertEquals(sent[0].design_key, designKey, `${designKey}: Studio got the same design`);
  }
});

Deno.test({
  name: "#4453 a null or unknown design is still refused with 409 INVALID_STATE before provisioning",
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  for (const designKey of [null, "bogus", "Pop", 7]) {
    const { response, payload, sent, rpcs } = await provisionWith(designKey);
    assertEquals(response.status, 409, `${JSON.stringify(designKey)}: status ${response.status}`);
    assertEquals((payload.error as Record<string, unknown>)?.code, "INVALID_STATE");
    assertEquals(rpcs.includes("brand_site_provision"), false, "Core never provisions");
    assertEquals(sent.length, 0, "Studio is never called");
  }
});
