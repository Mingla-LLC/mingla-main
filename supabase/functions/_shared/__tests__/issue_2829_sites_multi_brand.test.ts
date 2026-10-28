/*
 * #2829 W1 — Core gateways for more than one brand (implementor suite).
 *
 *  - the hostname shape rule matches the SQL CHECK (parity cases);
 *  - no single-brand host or renderer constant survives in the contracts;
 *  - a runtime host resolution signed with the host-resolution id receives the
 *    host's own site, and a resolution signed for one site never receives
 *    another;
 *  - the recovery callback alerts and switches nothing off;
 *  - the Business control routes for offline/online/exports exist and keep
 *    the user-JWT pattern (rank is re-derived in Core).
 */
import {
  isValidSiteHostname,
  SITES_HOST_RESOLUTION_SITE_ID,
  SITES_RENDERER_KEYS,
} from "../sitesContracts.ts";
import * as contracts from "../sitesContracts.ts";
import { handleBrandSiteRuntimeResolve } from "../../brand-site-runtime-resolve/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const encoder = new TextEncoder();
const RUNTIME_KID = "runtime-core-current";
const RUNTIME_KEY_B64 = btoa("E".repeat(32));
const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";

const SECURITY_JSON = JSON.stringify({
  schema_version: 1,
  attribution_pepper_b64: btoa("P".repeat(32)),
  core_to_cms_current_kid: "core-cms-current",
  core_to_cms_current_key_b64: btoa("A".repeat(32)),
  core_to_cms_previous_kid: null,
  core_to_cms_previous_key_b64: null,
  cms_to_core_current_kid: "cms-core-current",
  cms_to_core_current_key_b64: btoa("C".repeat(32)),
  cms_to_core_previous_kid: null,
  cms_to_core_previous_key_b64: null,
  runtime_to_core_current_kid: RUNTIME_KID,
  runtime_to_core_current_key_b64: RUNTIME_KEY_B64,
  runtime_to_core_previous_kid: null,
  runtime_to_core_previous_key_b64: null,
});

Deno.test({
  name: "#2829 hostname shape rule (parity with the SQL CHECK)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    // Same cases as issue_2829_sites_multi_brand.test.sql.
    for (
      const valid of [
        "gogi.sites.usemingla.com",
        "young-stamped.sites.localhost",
        "a1.example.co.uk",
      ]
    ) assert(isValidSiteHostname(valid), `valid host refused: ${valid}`);
    for (
      const invalid of [
        "Upper.example.com",
        "a..b.com",
        "-a.example.com",
        "example.com.",
        "no-dot",
        "a*b.example.com",
        "x.y",
        "host.example.com:443",
        "user@host.example.com",
        `${"a".repeat(64)}.example.com`,
      ]
    ) {
      assert(
        !isValidSiteHostname(invalid),
        `invalid host accepted: ${invalid}`,
      );
    }
  },
});

Deno.test({
  name: "#2829 the contracts carry no single public host or renderer",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const exported = contracts as Record<string, unknown>;
    assert(!("SITES_PUBLIC_HOST" in exported), "SITES_PUBLIC_HOST survived");
    assert(!("SITES_RENDERER_KEY" in exported), "single renderer key survived");
    assert(
      JSON.stringify(SITES_RENDERER_KEYS) ===
        JSON.stringify(["restaurant-website-v1", "sites-v2"]),
      "renderer union drifted from the SQL CHECK",
    );
  },
});

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function runtimeRequest(
  siteId: string,
  hostname: string,
): Promise<Request> {
  const path = `/internal/v1/hosts/${hostname}/publication`;
  const body = JSON.stringify({ hostname });
  const issued = new Date(Date.now() - 1000);
  const unsigned = {
    schema_version: 1,
    issuer: "mingla-sites",
    audience: "mingla-core",
    direction: "runtime_to_core",
    site_id: siteId,
    operation_id: crypto.randomUUID(),
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + 60_000).toISOString(),
    nonce: crypto.randomUUID(),
    method: "POST",
    path,
    body_sha256: await sha256Hex(body),
    kid: RUNTIME_KID,
  };
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(RUNTIME_KEY_B64), (c) => c.charCodeAt(0)).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(Object.values(unsigned).join("\n")),
    ),
  );
  let raw = "";
  for (const byte of signature) raw += String.fromCharCode(byte);
  return new Request(
    `https://fixture.supabase.co/functions/v1/brand-site-runtime-resolve${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mingla-sites-envelope": btoa(
          JSON.stringify({ ...unsigned, signature_b64: btoa(raw) }),
        ),
      },
      body,
    },
  );
}

function stubResolver(owner: string) {
  const nonces: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const request = input instanceof Request
      ? input
      : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === "/rest/v1/brand_site_gateway_nonces") {
      nonces.push(JSON.parse(await request.text()));
      return Response.json([], { status: 201 });
    }
    if (url.pathname === "/rest/v1/rpc/brand_site_resolve_publication") {
      return Response.json([{
        site_id: owner,
        artifact_digest: "f".repeat(64),
      }]);
    }
    throw new Error(`unexpected ${url.pathname}`);
  }) as typeof fetch;
  return {
    nonces,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function env() {
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", SECURITY_JSON);
  Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
}

Deno.test({
  name:
    "#2829 a host resolution returns the host's own site; a site-bound one never another",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    env();
    let stub = stubResolver(SITE_B);
    try {
      const response = await handleBrandSiteRuntimeResolve(
        await runtimeRequest(
          SITES_HOST_RESOLUTION_SITE_ID,
          "second.sites.usemingla.com",
        ),
      );
      assert(
        response.status === 200,
        `host resolution refused: ${response.status}`,
      );
      const payload = await response.json() as { data?: { site_id?: string } };
      assert(
        payload.data?.site_id === SITE_B,
        "resolution returned the wrong site",
      );
      // The replay row is bound to the RESOLVED site, never the placeholder.
      assert(
        (stub.nonces[0] as { site_id?: string }).site_id === SITE_B,
        "nonce recorded against the host-resolution placeholder",
      );
    } finally {
      stub.restore();
    }
    stub = stubResolver(SITE_B);
    try {
      const response = await handleBrandSiteRuntimeResolve(
        await runtimeRequest(SITE_A, "second.sites.usemingla.com"),
      );
      assert(
        response.status === 404,
        `a site-A envelope received site B (${response.status})`,
      );
      assert(
        stub.nonces.length === 0,
        "a refused resolution burned a nonce row",
      );
    } finally {
      stub.restore();
    }
  },
});

Deno.test({
  name: "#2829 the recovery callback alerts and turns nothing off",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const callback = await Deno.readTextFile(
      new URL("../../brand-site-cms-callback/index.ts", import.meta.url),
    );
    assert(
      !callback.includes("pilot-deactivation"),
      "the deactivation route survived",
    );
    assert(
      !callback.includes("brand_site_deactivate_gogi_pilot"),
      "the deactivation RPC survived",
    );
    assert(
      callback.includes('"brand_site_record_recovery_state"'),
      "no recovery-state record",
    );
    assert(
      !/gogi\.sites\.usemingla\.com"/.test(callback),
      "a literal host survived in code",
    );
  },
});

Deno.test({
  name: "#2829 the control plane exposes owner offline, online and exports",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const control = await Deno.readTextFile(
      new URL("../../brand-site-control/index.ts", import.meta.url),
    );
    for (
      const token of [
        '"brand_site_set_owner_offline"',
        '"brand_site_request_export"',
        '"brand_site_complete_export"',
        '"brand_site_propose_label"',
        "SITES_PROVISION_RENDERER_KEY",
      ]
    ) assert(control.includes(token), `control lost ${token}`);
    assert(
      !control.includes('"restaurant-website-v1"'),
      "renderer literal in control",
    );
    // Offline/export run as the signed-in user so Core re-derives rank (>= 50).
    const offline = control.slice(control.indexOf("if (offlineMatch"));
    assert(
      offline.slice(0, 800).includes(
        'db.user.rpc(\n        "brand_site_set_owner_offline"',
      ),
      "offline must call Core as the user, not the service role",
    );
  },
});
