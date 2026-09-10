/*
 * #3149 — SPENDING an attribution touch on a venue order, RUN not read.
 *
 * `brand_site_consume_attribution` shipped with the #2830 foundation and had
 * no caller: the trigger that binds a touch fires on `ticket_checkout_sessions`,
 * which the venue-order rail never writes. So an order placed from a brand's
 * own website earned that website no credit at all — the switch existed and
 * nothing ever flipped it.
 *
 * This drives the real handler with a real signed envelope and intercepts the
 * PostgREST traffic the Supabase client actually emits, so the assertions are
 * about what the function DOES: which digest it computes, which site it scopes
 * the touch to, and whether an order can ever depend on its analytics.
 */
import { handleBrandSiteAttribution } from "../../brand-site-attribution/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SITE_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_SITE = "11111111-2222-4333-8444-555555555556";
const ORDER_ID = "99999999-8888-4777-8666-555555555555";
const TOKEN = "T".repeat(43);
const KID = "runtime-core-current";
const KEY_B64 = btoa("E".repeat(32));
const PEPPER_B64 = btoa("P".repeat(32));

const ENVELOPE_JSON = JSON.stringify({
  schema_version: 1,
  attribution_pepper_b64: PEPPER_B64,
  core_to_cms_current_kid: "core-cms-current",
  core_to_cms_current_key_b64: btoa("A".repeat(32)),
  core_to_cms_previous_kid: null,
  core_to_cms_previous_key_b64: null,
  cms_to_core_current_kid: "cms-core-current",
  cms_to_core_current_key_b64: btoa("B".repeat(32)),
  cms_to_core_previous_kid: null,
  cms_to_core_previous_key_b64: null,
  runtime_to_core_current_kid: KID,
  runtime_to_core_current_key_b64: KEY_B64,
  runtime_to_core_previous_kid: null,
  runtime_to_core_previous_key_b64: null,
});

const encoder = new TextEncoder();

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function hex(algorithm: "sha256", value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      algorithm === "sha256" ? "SHA-256" : "SHA-256",
      encoder.encode(value),
    ),
  );
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The SAME HMAC the function uses to turn a raw token into a digest. */
async function pepperDigest(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes(PEPPER_B64)).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(signed).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The runtime's own signing, reproduced from `mingla-sites/src/lib/coreGateway.ts`. */
async function signedRequest(
  path: string,
  body: Record<string, unknown>,
  siteId = SITE_ID,
): Promise<Request> {
  const serialized = JSON.stringify(body);
  const issuedAt = new Date();
  const unsigned = {
    schema_version: 1,
    issuer: "mingla-sites-runtime",
    audience: "mingla-core",
    direction: "runtime_to_core",
    site_id: siteId,
    operation_id: crypto.randomUUID(),
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + 60_000).toISOString(),
    nonce: crypto.randomUUID(),
    method: "POST",
    path,
    body_sha256: await hex("sha256", serialized),
    kid: KID,
  };
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
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes(KEY_B64)).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)),
  );
  let raw = "";
  for (const byte of signature) raw += String.fromCharCode(byte);
  const envelope = { ...unsigned, signature_b64: btoa(raw) };
  return new Request(
    `https://fixture.supabase.co/functions/v1/brand-site-attribution${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mingla-sites-envelope": btoa(JSON.stringify(envelope)),
      },
      body: serialized,
    },
  );
}

type Seen = { path: string; search: string; body: unknown };

function installStubs(
  options: { touch: unknown; rpcFails?: boolean },
): { seen: Seen[]; restore: () => void } {
  const seen: Seen[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const request = input instanceof Request
      ? input
      : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    seen.push({
      path: url.pathname,
      search: url.search,
      body: text ? JSON.parse(text) : null,
    });
    if (url.pathname === "/rest/v1/brand_site_gateway_nonces") {
      return Response.json([], { status: 201 });
    }
    if (url.pathname === "/rest/v1/brand_site_attribution_touches") {
      return new Response(
        options.touch === null ? "null" : JSON.stringify(options.touch),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.pathname === "/rest/v1/rpc/brand_site_consume_attribution") {
      return options.rpcFails
        ? Response.json({
          message: "sites_attribution_forbidden",
          code: "P0001",
        }, { status: 400 })
        : Response.json({ accepted: true });
    }
    throw new Error(`unexpected dependency ${url.pathname}`);
  }) as typeof fetch;
  return {
    seen,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function withEnvironment<T>(run: () => Promise<T>): Promise<T> {
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", ENVELOPE_JSON);
  Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
  return run();
}

const CONSUME_PATH = `/internal/v1/sites/${SITE_ID}/attribution/consume`;

Deno.test({
  name: "#3149 a consumed touch is bound to the venue order it produced",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const stubs = installStubs({ touch: { id: "touch-1" } });
      try {
        const response = await handleBrandSiteAttribution(
          await signedRequest(CONSUME_PATH, {
            action: "consume",
            site_id: SITE_ID,
            token: TOKEN,
            order_id: ORDER_ID,
          }),
        );
        assert(response.status === 200, `status ${response.status}`);
        const answered = await response.json();
        assert(answered.ok === true, "consume did not succeed");
        assert(answered.data.accepted === true, "touch was not accepted");

        const digest = await pepperDigest(TOKEN);
        const lookup = stubs.seen.find((call) =>
          call.path === "/rest/v1/brand_site_attribution_touches"
        );
        assert(lookup !== undefined, "the touch was never looked up");
        // Scoped to THIS site: a signed runtime cannot spend another's touch.
        assert(
          lookup.search.includes(digest) && lookup.search.includes(SITE_ID),
          `lookup was not scoped by digest and site: ${lookup.search}`,
        );

        const rpc = stubs.seen.find((call) =>
          call.path === "/rest/v1/rpc/brand_site_consume_attribution"
        );
        assert(rpc !== undefined, "the RPC that had no caller still has none");
        const sent = rpc.body as Record<string, unknown>;
        assert(
          sent.p_token_digest === digest,
          "the RPC was given the wrong digest",
        );
        assert(
          sent.p_order_id === ORDER_ID,
          "the RPC was given the wrong order",
        );
        // The RAW token never leaves this function.
        assert(
          !JSON.stringify(rpc.body).includes(TOKEN),
          "the raw token was forwarded to the database",
        );
      } finally {
        stubs.restore();
      }
    }),
});

Deno.test({
  name: "#3149 a touch belonging to another site is never spent",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      // maybeSingle() over a site-scoped filter finds nothing.
      const stubs = installStubs({ touch: null });
      try {
        const response = await handleBrandSiteAttribution(
          await signedRequest(
            `/internal/v1/sites/${OTHER_SITE}/attribution/consume`,
            {
              action: "consume",
              site_id: OTHER_SITE,
              token: TOKEN,
              order_id: ORDER_ID,
            },
            OTHER_SITE,
          ),
        );
        assert(response.status === 200, `status ${response.status}`);
        assert((await response.json()).data.accepted === false, "it was spent");
        assert(
          !stubs.seen.some((call) =>
            call.path === "/rest/v1/rpc/brand_site_consume_attribution"
          ),
          "the RPC ran for a touch this site does not own",
        );
      } finally {
        stubs.restore();
      }
    }),
});

Deno.test({
  name: "#3149 an expired or already-spent touch answers false, never an error",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const stubs = installStubs({ touch: { id: "touch-1" }, rpcFails: true });
      try {
        const response = await handleBrandSiteAttribution(
          await signedRequest(CONSUME_PATH, {
            action: "consume",
            site_id: SITE_ID,
            token: TOKEN,
            order_id: ORDER_ID,
          }),
        );
        assert(response.status === 200, `status ${response.status}`);
        const answered = await response.json();
        assert(answered.ok === true, "a spent touch was reported as a failure");
        assert(answered.data.accepted === false, "a spent touch was re-spent");
      } finally {
        stubs.restore();
      }
    }),
});

Deno.test({
  name: "#3149 consume refuses a path, a token or a field it does not own",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const stubs = installStubs({ touch: { id: "touch-1" } });
      try {
        // The issue path may not be used to consume.
        const wrongPath = await handleBrandSiteAttribution(
          await signedRequest(`/internal/v1/sites/${SITE_ID}/attribution`, {
            action: "consume",
            site_id: SITE_ID,
            token: TOKEN,
            order_id: ORDER_ID,
          }),
        );
        assert(wrongPath.status === 403, `path status ${wrongPath.status}`);

        const badToken = await handleBrandSiteAttribution(
          await signedRequest(CONSUME_PATH, {
            action: "consume",
            site_id: SITE_ID,
            token: "../../etc/passwd",
            order_id: ORDER_ID,
          }),
        );
        assert(badToken.status === 400, `token status ${badToken.status}`);

        const extraField = await handleBrandSiteAttribution(
          await signedRequest(CONSUME_PATH, {
            action: "consume",
            site_id: SITE_ID,
            token: TOKEN,
            order_id: ORDER_ID,
            brand_id: SITE_ID,
          }),
        );
        assert(extraField.status === 400, `field status ${extraField.status}`);

        assert(
          !stubs.seen.some((call) =>
            call.path === "/rest/v1/rpc/brand_site_consume_attribution"
          ),
          "a refused request still reached the database",
        );
      } finally {
        stubs.restore();
      }
    }),
});
