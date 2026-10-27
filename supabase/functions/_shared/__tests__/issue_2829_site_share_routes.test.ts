/*
 * #2829 W10 (S2) — private share-preview links, Core side (implementor suite).
 *
 *  brand-site-control /v1/sites/<id>/share-links:
 *   - creating mints a 256-bit token HERE and hands Core only its peppered
 *     digest (never the token); the token comes back once, in the link
 *     address on the site's own origin; Core's refusals keep their meaning
 *     (rank → 403 "Only brand admins and owners…", bad length → 400 without
 *     asking Core); a fresh preview is built only for a real draft reference,
 *     and a failed build never loses the link; list and revoke map to Core.
 *  brand-site-runtime-resolve /internal/v1/sites/<id>/share-preview:
 *   - only for the site the runtime signed for (path, envelope and body
 *     agree) and only a well-formed token; Core is asked with the SAME
 *     digest the link was stored under; nothing found → 404.
 *  brand-site-cms-callback /internal/v1/sites/<id>/preview-artifacts:
 *   - Studio's newest preview is recorded for the envelope's site only.
 */
import { handleSiteShareRoute, type SiteShareContext } from "../../brand-site-control/siteShare.ts";
import { handleBrandSiteRuntimeResolve } from "../../brand-site-runtime-resolve/index.ts";
import { handleBrandSiteCmsCallback } from "../../brand-site-cms-callback/index.ts";
import { SITES_HOST_RESOLUTION_SITE_ID, signSitesEnvelope } from "../sitesContracts.ts";
import { SITES_SHARE_TOKEN_RE, sitesShareTokenDigest } from "../sitesSecurity.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const LINK = "cccccccc-3333-4333-8333-333333333333";
const OP = "dddddddd-4444-4444-8444-444444444444";
const DIGEST = "e".repeat(64);
const RUNTIME_KEY = new TextEncoder().encode("E".repeat(32));
const CMS_KEY = new TextEncoder().encode("C".repeat(32));
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
  runtime_to_core_current_kid: "runtime-core-current",
  runtime_to_core_current_key_b64: btoa("E".repeat(32)),
  runtime_to_core_previous_kid: null,
  runtime_to_core_previous_key_b64: null,
});

function env() {
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", SECURITY_JSON);
  Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
}

type Call = { fn: string; args: Record<string, unknown> };

function ctx(over: Partial<SiteShareContext> & { rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null } } = {}) {
  const calls: Call[] = [];
  const built: Array<Record<string, unknown>> = [];
  const value: SiteShareContext = {
    userRpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve(over.rpc ? over.rpc(fn, args) : { data: { id: LINK, created_at: "2026-10-27T00:00:00Z", expires_at: "2026-11-03T00:00:00Z" }, error: null });
    },
    buildFreshPreview: over.buildFreshPreview ?? ((args) => { built.push(args); return Promise.resolve(true); }),
    previewReady: over.previewReady ?? (() => Promise.resolve(true)),
    siteOrigin: over.siteOrigin ?? (() => Promise.resolve("https://young.sites.usemingla.com")),
  };
  return { calls, built, value };
}

Deno.test("#2829 W10 creating a link sends Core only the token's digest and returns the token once", async () => {
  env();
  const { calls, built, value } = ctx();
  const response = await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links`, "POST", {
    ttl_days: 7, operation_id: OP, source_digest: DIGEST, expected_revision: "12",
  }, value);
  assert(response && response.status === 201, `status ${response?.status}`);
  const body = await response.json() as { data: { url: string; preview_ready: boolean; id: string } };
  const match = body.data.url.match(/^https:\/\/young\.sites\.usemingla\.com\/preview\/share\/([A-Za-z0-9_-]+)$/);
  assert(match && SITES_SHARE_TOKEN_RE.test(match[1]), `link address ${body.data.url}`);
  const token = match[1];
  assert(calls.length === 1 && calls[0].fn === "brand_site_create_preview_link", `rpc ${JSON.stringify(calls)}`);
  assert(calls[0].args.p_site_id === SITE_A && calls[0].args.p_ttl_days === 7, "wrong site or length");
  assert(calls[0].args.p_token_digest === await sitesShareTokenDigest(token), "Core did not get the peppered digest");
  assert(!JSON.stringify(calls).includes(token), "the token reached Core");
  assert(/^[0-9a-f]{64}$/.test(String(calls[0].args.p_token_digest)), "digest shape");
  assert(built.length === 1 && built[0].sourceDigest === DIGEST && built[0].operationId === OP && built[0].expectedRevision === "12", "fresh preview not built for the draft");
  assert(body.data.preview_ready === true && body.data.id === LINK, "answer shape");
  const second = await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links`, "POST", { ttl_days: 1 }, value);
  const again = (await second!.json() as { data: { url: string } }).data.url;
  assert(again !== body.data.url, "two links share a token");
});

Deno.test("#2829 W10 a link is kept when the fresh preview can't be built, and no draft means no build", async () => {
  env();
  const failing = ctx({ buildFreshPreview: () => Promise.reject(new Error("studio down")), previewReady: () => Promise.resolve(false) });
  const response = await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links`, "POST", { ttl_days: 14, operation_id: OP, source_digest: DIGEST }, failing.value);
  assert(response!.status === 201, `status ${response!.status}`);
  assert((await response!.json() as { data: { preview_ready: boolean } }).data.preview_ready === false, "preview_ready must be honest");
  const plain = ctx();
  await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links`, "POST", { ttl_days: 3, source_digest: "nope", operation_id: OP }, plain.value);
  assert(plain.built.length === 0, "built a preview without a real draft reference");
});

Deno.test("#2829 W10 refusals keep their meaning", async () => {
  env();
  for (const ttl of [0, 15, 2.5, "7", null]) {
    const { calls, value } = ctx();
    const response = await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links`, "POST", { ttl_days: ttl }, value);
    assert(response!.status === 400 && calls.length === 0, `ttl ${ttl} → ${response!.status}`);
  }
  const forbidden = ctx({ rpc: () => ({ data: null, error: { message: "sites_forbidden" } }) });
  const refused = await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links`, "POST", { ttl_days: 7, operation_id: OP, source_digest: DIGEST }, forbidden.value);
  const refusedBody = await refused!.json() as { error: { code: string; message: string } };
  assert(refused!.status === 403 && refusedBody.error.code === "FORBIDDEN", `forbidden ${refused!.status}`);
  assert(refusedBody.error.message === "Only brand admins and owners can share a private preview.", refusedBody.error.message);
  assert(forbidden.built.length === 0, "built a preview for a refused member");
  const full = ctx({ rpc: () => ({ data: null, error: { message: "sites_invalid_state" } }) });
  assert((await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links`, "POST", { ttl_days: 7 }, full.value))!.status === 409, "20-link cap");
  const bad = ctx();
  assert((await handleSiteShareRoute(`/v1/sites/not-a-site/share-links`, "GET", {}, bad.value))!.status === 400 && bad.calls.length === 0, "bad site id");
  assert(await handleSiteShareRoute(`/v1/sites/${SITE_A}/previews`, "POST", {}, bad.value) === null, "took another route");
});

Deno.test("#2829 W10 list and revoke go to Core's rank-checked readers", async () => {
  env();
  const list = ctx({ rpc: () => ({ data: [{ id: LINK, state: "active" }], error: null }) });
  const listed = await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links`, "GET", {}, list.value);
  assert(listed!.status === 200, "list status");
  assert(JSON.stringify(await listed!.json()).includes(LINK) && list.calls[0].fn === "brand_site_list_preview_links", "list rpc");
  const revoke = ctx({ rpc: () => ({ data: { id: LINK, revoked: true }, error: null }) });
  const revoked = await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links/${LINK}/revoke`, "POST", {}, revoke.value);
  assert(revoked!.status === 200 && revoke.calls[0].fn === "brand_site_revoke_preview_link" && revoke.calls[0].args.p_link_id === LINK, "revoke rpc");
  const denied = ctx({ rpc: () => ({ data: null, error: { message: "sites_forbidden" } }) });
  assert((await handleSiteShareRoute(`/v1/sites/${SITE_A}/share-links/${LINK}/revoke`, "POST", {}, denied.value))!.status === 403, "revoke rank");
});

async function signed(direction: "runtime_to_core" | "cms_to_core", fn: string, path: string, envelopeSite: string, body: Record<string, unknown>): Promise<Request> {
  const raw = JSON.stringify(body);
  const envelope = await signSitesEnvelope({
    issuer: direction === "runtime_to_core" ? "mingla-sites" : "mingla-site-cms",
    audience: "mingla-core",
    direction,
    siteId: envelopeSite,
    operationId: crypto.randomUUID(),
    method: "POST",
    path,
    body: raw,
    kid: direction === "runtime_to_core" ? "runtime-core-current" : "cms-core-current",
    keyBytes: direction === "runtime_to_core" ? RUNTIME_KEY : CMS_KEY,
  });
  return new Request(`https://fixture.supabase.co/functions/v1/${fn}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mingla-sites-envelope": btoa(JSON.stringify(envelope)) },
    body: raw,
  });
}

function stubCore(rpcAnswer: unknown) {
  const rpcs: Call[] = [];
  let nonces = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === "/rest/v1/brand_site_gateway_nonces") {
      nonces += 1;
      return Response.json([], { status: 201 });
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (rpc) {
      rpcs.push({ fn: rpc[1], args: JSON.parse(await request.text()) });
      return Response.json(rpcAnswer);
    }
    throw new Error(`unexpected ${url.pathname}`);
  }) as typeof fetch;
  return { rpcs, nonces: () => nonces, restore: () => { globalThis.fetch = original; } };
}

const TOKEN = "Q".repeat(43);
const KEY = `publications/${SITE_A}/preview-${"c".repeat(32)}/${"d".repeat(64)}.json`;

Deno.test({
  name: "#2829 W10 the runtime reads a link only for its own site, by the stored digest",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    env();
    const stub = stubCore({ link_id: LINK, site_id: SITE_A, artifact_key: KEY, expires_at: "2026-11-03T00:00:00Z" });
    try {
      const path = `/internal/v1/sites/${SITE_A}/share-preview`;
      const response = await handleBrandSiteRuntimeResolve(await signed("runtime_to_core", "brand-site-runtime-resolve", path, SITE_A, { site_id: SITE_A, token: TOKEN }));
      assert(response.status === 200, `status ${response.status}`);
      const body = await response.json() as { data: { artifact_key: string; site_id: string } };
      assert(body.data.artifact_key === KEY && body.data.site_id === SITE_A, JSON.stringify(body));
      assert(stub.rpcs.length === 1 && stub.rpcs[0].fn === "brand_site_resolve_preview_link", JSON.stringify(stub.rpcs));
      assert(stub.rpcs[0].args.p_site_id === SITE_A && stub.rpcs[0].args.p_token_digest === await sitesShareTokenDigest(TOKEN), "not the stored digest");
      assert(!JSON.stringify(stub.rpcs).includes(TOKEN), "the raw token reached the database");
      assert(stub.nonces() === 1, "no replay row");
    } finally {
      stub.restore();
    }
  },
});

Deno.test({
  name: "#2829 W10 a mismatched site, a host-resolution envelope or a malformed token reads nothing; no link is 404",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    env();
    const shapes: Array<{ envelope: string; path: string; body: Record<string, unknown> }> = [
      { envelope: SITE_A, path: SITE_B, body: { site_id: SITE_B, token: TOKEN } },
      { envelope: SITE_A, path: SITE_A, body: { site_id: SITE_B, token: TOKEN } },
      { envelope: SITE_B, path: SITE_A, body: { site_id: SITE_A, token: TOKEN } },
      { envelope: SITES_HOST_RESOLUTION_SITE_ID, path: SITE_A, body: { site_id: SITE_A, token: TOKEN } },
      { envelope: SITE_A, path: SITE_A, body: { site_id: SITE_A, token: "short" } },
      { envelope: SITE_A, path: SITE_A, body: { site_id: SITE_A, token: `${TOKEN}=` } },
    ];
    for (const shape of shapes) {
      const stub = stubCore({ artifact_key: KEY });
      try {
        const path = `/internal/v1/sites/${shape.path}/share-preview`;
        const response = await handleBrandSiteRuntimeResolve(await signed("runtime_to_core", "brand-site-runtime-resolve", path, shape.envelope, shape.body));
        assert(response.status === 404, `${JSON.stringify(shape)} → ${response.status}`);
        assert(stub.rpcs.length === 0 && stub.nonces() === 0, `read on ${JSON.stringify(shape)}`);
      } finally {
        stub.restore();
      }
    }
    const none = stubCore(null);
    try {
      const path = `/internal/v1/sites/${SITE_A}/share-preview`;
      const response = await handleBrandSiteRuntimeResolve(await signed("runtime_to_core", "brand-site-runtime-resolve", path, SITE_A, { site_id: SITE_A, token: TOKEN }));
      assert(response.status === 404, `expired/revoked/unknown answered ${response.status}`);
    } finally {
      none.restore();
    }
  },
});

Deno.test({
  name: "#2829 W10 Studio's newest preview is recorded only for the envelope's site",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    env();
    const stub = stubCore({ site_id: SITE_A, recorded: true });
    try {
      const path = `/internal/v1/sites/${SITE_A}/preview-artifacts`;
      const ok = await handleBrandSiteCmsCallback(await signed("cms_to_core", "brand-site-cms-callback", path, SITE_A, { artifact_key: KEY }));
      assert(ok.status === 200, `status ${ok.status}`);
      assert(stub.rpcs[0].fn === "brand_site_record_preview_artifact" && stub.rpcs[0].args.p_site_id === SITE_A && stub.rpcs[0].args.p_artifact_key === KEY, JSON.stringify(stub.rpcs));
      const crossPath = `/internal/v1/sites/${SITE_B}/preview-artifacts`;
      const cross = await handleBrandSiteCmsCallback(await signed("cms_to_core", "brand-site-cms-callback", crossPath, SITE_A, { artifact_key: KEY }));
      assert(cross.status === 403 && stub.rpcs.length === 1, `cross-site callback answered ${cross.status}`);
    } finally {
      stub.restore();
    }
  },
});
