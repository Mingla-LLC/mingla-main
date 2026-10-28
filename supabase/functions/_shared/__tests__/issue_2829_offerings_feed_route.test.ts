/*
 * #2829 W4 — the runtime's live offerings feed route (implementor suite).
 *
 *  - a feed request signed for site A, naming site A, returns site A's feed
 *    and records the replay row against site A;
 *  - a request whose envelope, path or body disagree on the site is refused
 *    before anything is read (no RPC call, no nonce);
 *  - a host-resolution envelope can never read a site's feed;
 *  - the CMS projection route returns the feed for the builder's snapshot
 *    only when asked (include=feed).
 */
import { SITES_HOST_RESOLUTION_SITE_ID } from "../sitesContracts.ts";
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

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function feedRequest(input: {
  envelopeSite: string;
  pathSite: string;
  bodySite: string;
}): Promise<Request> {
  const path = `/internal/v1/sites/${input.pathSite}/offerings`;
  const body = JSON.stringify({ site_id: input.bodySite });
  const issued = new Date(Date.now() - 1000);
  const unsigned = {
    schema_version: 1,
    issuer: "mingla-sites",
    audience: "mingla-core",
    direction: "runtime_to_core",
    site_id: input.envelopeSite,
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
    await crypto.subtle.sign("HMAC", key, encoder.encode(Object.values(unsigned).join("\n"))),
  );
  let raw = "";
  for (const byte of signature) raw += String.fromCharCode(byte);
  return new Request(
    `https://fixture.supabase.co/functions/v1/brand-site-runtime-resolve${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mingla-sites-envelope": btoa(JSON.stringify({ ...unsigned, signature_b64: btoa(raw) })),
      },
      body,
    },
  );
}

function stubCore() {
  const nonces: Array<{ site_id?: string }> = [];
  const feedCalls: Array<{ p_site_id?: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === "/rest/v1/brand_site_gateway_nonces") {
      nonces.push(JSON.parse(await request.text()));
      return Response.json([], { status: 201 });
    }
    if (url.pathname === "/rest/v1/rpc/brand_site_offerings_feed") {
      const args = JSON.parse(await request.text()) as { p_site_id?: string };
      feedCalls.push(args);
      return Response.json({
        generated_at: "2026-10-26T00:00:00.000Z",
        brand: { slug: "brand-a", currency: "USD", payment_rails: "stripe" },
        offerings: [{ id: "x", site: args.p_site_id }],
      });
    }
    throw new Error(`unexpected ${url.pathname}`);
  }) as typeof fetch;
  return { nonces, feedCalls, restore: () => { globalThis.fetch = original; } };
}

function env() {
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", SECURITY_JSON);
  Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
}

Deno.test({
  name: "#2829 W4 a site-bound feed request returns that site's feed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    env();
    const stub = stubCore();
    try {
      const response = await handleBrandSiteRuntimeResolve(
        await feedRequest({ envelopeSite: SITE_A, pathSite: SITE_A, bodySite: SITE_A }),
      );
      assert(response.status === 200, `feed refused: ${response.status}`);
      const payload = await response.json() as { data?: { brand?: { slug?: string } } };
      assert(payload.data?.brand?.slug === "brand-a", "feed body not returned");
      assert(stub.feedCalls.length === 1 && stub.feedCalls[0].p_site_id === SITE_A, "feed read for the wrong site");
      assert(stub.nonces.length === 1 && stub.nonces[0].site_id === SITE_A, "replay row not bound to the site");
      assert(
        (response.headers.get("cache-control") ?? "").includes("max-age=60"),
        "feed is not cacheable for 60 s",
      );
    } finally {
      stub.restore();
    }
  },
});

Deno.test({
  name: "#2829 W4 a feed request that disagrees on the site reads nothing",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    env();
    for (
      const shape of [
        { envelopeSite: SITE_A, pathSite: SITE_B, bodySite: SITE_B },
        { envelopeSite: SITE_A, pathSite: SITE_A, bodySite: SITE_B },
        { envelopeSite: SITE_B, pathSite: SITE_A, bodySite: SITE_A },
        { envelopeSite: SITES_HOST_RESOLUTION_SITE_ID, pathSite: SITE_A, bodySite: SITE_A },
      ]
    ) {
      const stub = stubCore();
      try {
        const response = await handleBrandSiteRuntimeResolve(await feedRequest(shape));
        assert(response.status === 404, `mismatched feed request answered ${response.status}: ${JSON.stringify(shape)}`);
        assert(stub.feedCalls.length === 0, `feed read on a mismatched request: ${JSON.stringify(shape)}`);
        assert(stub.nonces.length === 0, "a refused feed request burned a nonce row");
      } finally {
        stub.restore();
      }
    }
  },
});

Deno.test({
  name: "#2829 W4 the CMS projection hands the builder the feed only when asked",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const callback = await Deno.readTextFile(
      new URL("../../brand-site-cms-callback/index.ts", import.meta.url),
    );
    assert(callback.includes('includes.has("feed")'), "projection has no feed include");
    assert(callback.includes('"brand_site_offerings_feed"'), "projection does not read the feed RPC");
  },
});
