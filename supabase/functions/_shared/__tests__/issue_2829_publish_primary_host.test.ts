// deno-lint-ignore-file require-await -- the fixture mirrors async HTTP
/*
 * #2829 W8 — every publish (and rollback) Core sends the CMS carries the
 * site's CURRENT main address, read by Core, so the artifact's canonical
 * follows a brand's own domain becoming the main address (or the Mingla
 * address taking over again). A caller-supplied value never reaches the CMS.
 *
 * Drives the REAL brand-site-control handler; Supabase and the CMS are faked
 * at the HTTP layer.
 */
import { handleBrandSiteControl } from "../../brand-site-control/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SUPABASE_URL = "https://fixture-2829-w8.supabase.co";
const CMS_ORIGIN = "https://cms.fixture-2829-w8.invalid";
const USER_ID = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const BRAND_ID = "733bc470-45e1-4684-8896-acd7e26074ff";
const SITE_ID = "90f19f28-42e2-4eb9-b88b-02829bfcb045";
const OPERATION_ID = "7f88befc-661b-48ff-9797-60881e6c22b8";

function securityEnvelope(): string {
  const material = (byte: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
  return JSON.stringify({
    schema_version: 1,
    core_to_cms_current_kid: "core-cms-current", core_to_cms_current_key_b64: material(31),
    core_to_cms_previous_kid: null, core_to_cms_previous_key_b64: null,
    cms_to_core_current_kid: "cms-core-current", cms_to_core_current_key_b64: material(32),
    cms_to_core_previous_kid: null, cms_to_core_previous_key_b64: null,
    runtime_to_core_current_kid: "runtime-core-current", runtime_to_core_current_key_b64: material(33),
    runtime_to_core_previous_kid: null, runtime_to_core_previous_key_b64: null,
    attribution_pepper_b64: material(34),
  });
}

const ENV_NAMES = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MINGLA_SITES_SECURITY_JSON"];

async function publishWith(primaryHosts: Array<{ hostname: string }>, extraInput: Record<string, unknown> = {}) {
  const originalFetch = globalThis.fetch;
  const originalEnv = new Map(ENV_NAMES.map((name) => [name, Deno.env.get(name)]));
  const sent: Array<Record<string, unknown>> = [];
  const hostQueries: string[] = [];
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
    switch (url.pathname) {
      case "/auth/v1/user":
        return Response.json({ id: USER_ID, aud: "authenticated", role: "authenticated", email: "owner@example.invalid" });
      case "/rest/v1/rpc/brand_site_authorize_operation":
        return Response.json({ site_id: SITE_ID, brand_id: BRAND_ID, status: "authorized", publication_id: crypto.randomUUID() });
      case "/rest/v1/brand_site_hosts":
        hostQueries.push(url.search);
        return Response.json(primaryHosts[0] ?? null, { status: primaryHosts[0] ? 200 : 406 });
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
        route: `/v1/sites/${SITE_ID}/publications`,
        method: "POST",
        operation_id: OPERATION_ID,
        expected_revision: "rev-1",
        source_digest: "a".repeat(64),
        ...extraInput,
      }),
    }));
    return { response, sent, hostQueries };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of originalEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test({ name: "#2829 W8 publish signs the site's current main address into the CMS request", sanitizeOps: false, sanitizeResources: false }, async () => {
  const { response, sent, hostQueries } = await publishWith([{ hostname: "youngandstamped.com" }]);
  assert(response.status === 202, `status ${response.status}`);
  assert(sent.length === 1, "one CMS call");
  assert(sent[0].primary_hostname === "youngandstamped.com", `primary sent: ${JSON.stringify(sent[0].primary_hostname)}`);
  const query = decodeURIComponent(hostQueries[0] ?? "");
  assert(query.includes(`site_id=eq.${SITE_ID}`) && query.includes("is_primary=eq.true") && query.includes("status=eq.active"),
    `reads THIS site's active main address: ${query}`);
});

Deno.test({ name: "#2829 W8 a caller-supplied main address never reaches the CMS", sanitizeOps: false, sanitizeResources: false }, async () => {
  const forged = await publishWith([{ hostname: "young-stamped.sites.usemingla.com" }], { primary_hostname: "evil.example.com" });
  assert(forged.sent[0]?.primary_hostname === "young-stamped.sites.usemingla.com", `forged value passed: ${JSON.stringify(forged.sent[0]?.primary_hostname)}`);
  const none = await publishWith([], { primary_hostname: "evil.example.com" });
  assert(none.sent[0]?.primary_hostname === null, `no main address -> null, got ${JSON.stringify(none.sent[0]?.primary_hostname)}`);
});
