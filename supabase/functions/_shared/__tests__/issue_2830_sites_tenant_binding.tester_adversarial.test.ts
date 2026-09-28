/*
 * #2830 — INDEPENDENT TESTER PASS: can one brand reach another brand's site?
 *
 * Checklist item 12 of #2830 ("Independent tenant-isolation and seven-surface
 * PASS") had no tester-written suite. This is it, for the Core gateways.
 *
 * Written against a DIFFERENT angle from the implementor suites, which prove
 * the happy path signs and verifies. These tests assume the gateways are
 * broken and try to walk through them sideways:
 *
 *   - a correctly signed envelope pointed at ANOTHER tenant's path
 *   - the exact boundaries of the freshness window, one millisecond either side
 *   - a rotated key used with the wrong key id
 *   - a body that is semantically identical but not byte-identical
 *   - an envelope carrying one field too many
 *
 * It also holds a COVERAGE invariant over the callback router itself. Every
 * other site-scoped route in that file refuses when the site named in the URL
 * is not the site the envelope was signed for. Stating that as an invariant is
 * the only way a route added later cannot quietly skip it — which is exactly
 * how the one gap this suite reports came to exist.
 *
 * Run: deno test --allow-env --allow-read --allow-net=deno.land,esm.sh <file>
 *
 * NOT WIRED INTO CI, deliberately. Every Deno lane here enumerates its test
 * files by name, and adding a file to one drifts the frozen PR-family digest
 * the #2851 gate holds. Registering this suite is a follow-up that has to
 * re-pin that seal. (The lane is named without its extension on purpose: the
 * #2148 provider seal treats a workflow filename written out in full as a
 * discovered reference and reds the inventory check.)
 */
import { handleBrandSiteCmsCallback } from "../../brand-site-cms-callback/index.ts";
import { handleBrandSiteRuntimeResolve } from "../../brand-site-runtime-resolve/index.ts";
import { verifySitesEnvelope } from "../sitesContracts.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const CMS_KID = "cms-core-current";
const CMS_KEY_B64 = btoa("C".repeat(32));
const CMS_PREV_KID = "cms-core-previous";
const CMS_PREV_KEY_B64 = btoa("D".repeat(32));
const RUNTIME_KID = "runtime-core-current";
const RUNTIME_KEY_B64 = btoa("E".repeat(32));

const SECURITY_JSON = JSON.stringify({
  schema_version: 1,
  attribution_pepper_b64: btoa("P".repeat(32)),
  core_to_cms_current_kid: "core-cms-current",
  core_to_cms_current_key_b64: btoa("A".repeat(32)),
  core_to_cms_previous_kid: null,
  core_to_cms_previous_key_b64: null,
  cms_to_core_current_kid: CMS_KID,
  cms_to_core_current_key_b64: CMS_KEY_B64,
  cms_to_core_previous_kid: CMS_PREV_KID,
  cms_to_core_previous_key_b64: CMS_PREV_KEY_B64,
  runtime_to_core_current_kid: RUNTIME_KID,
  runtime_to_core_current_key_b64: RUNTIME_KEY_B64,
  runtime_to_core_previous_kid: null,
  runtime_to_core_previous_key_b64: null,
});

const encoder = new TextEncoder();

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface Unsigned {
  schema_version: number;
  issuer: string;
  audience: string;
  direction: string;
  site_id: string;
  operation_id: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  method: string;
  path: string;
  body_sha256: string;
  kid: string;
}

function canonical(unsigned: Unsigned): string {
  return [
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
}

async function signWith(
  keyB64: string,
  unsigned: Unsigned,
): Promise<Record<string, unknown>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes(keyB64)).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(canonical(unsigned))),
  );
  let raw = "";
  for (const byte of signature) raw += String.fromCharCode(byte);
  return { ...unsigned, signature_b64: btoa(raw) };
}

/**
 * Build an envelope exactly as a well-behaved signer would, then let the caller
 * bend ONE thing. `siteId` is what the envelope claims; `path` is where the
 * request is actually sent. Making those two independent is the whole point.
 */
async function buildEnvelope(options: {
  path: string;
  body: string;
  siteId: string;
  direction?: string;
  audience?: string;
  method?: string;
  kid?: string;
  keyB64?: string;
  issuedOffsetMs?: number;
  lifetimeMs?: number;
  nonce?: string;
}): Promise<Record<string, unknown>> {
  const issued = new Date(Date.now() + (options.issuedOffsetMs ?? -1000));
  const unsigned: Unsigned = {
    schema_version: 1,
    issuer: "mingla-site-cms",
    audience: options.audience ?? "mingla-core",
    direction: options.direction ?? "cms_to_core",
    site_id: options.siteId,
    operation_id: crypto.randomUUID(),
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + (options.lifetimeMs ?? 60_000))
      .toISOString(),
    nonce: options.nonce ?? crypto.randomUUID(),
    method: options.method ?? "POST",
    path: options.path,
    body_sha256: await sha256Hex(options.body),
    kid: options.kid ?? CMS_KID,
  };
  return await signWith(options.keyB64 ?? CMS_KEY_B64, unsigned);
}

function request(
  service: string,
  path: string,
  body: string,
  envelope: Record<string, unknown>,
  method = "POST",
): Request {
  return new Request(
    `https://fixture.supabase.co/functions/v1/${service}${path}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        "x-mingla-sites-envelope": btoa(JSON.stringify(envelope)),
      },
      ...(method === "GET" ? {} : { body }),
    },
  );
}

type Seen = { path: string; body: unknown };

/**
 * Stand in for PostgREST. Every dependency answers success, so anything this
 * suite reports as refused was refused by the GATEWAY and not by a stub that
 * happened to be unhelpful.
 */
function installStubs(
  overrides: Record<string, () => Response> = {},
): { seen: Seen[]; restore: () => void } {
  const seen: Seen[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const incoming = input instanceof Request
      ? input
      : new Request(String(input), init);
    const url = new URL(incoming.url);
    const text = incoming.method === "GET" ? "" : await incoming.text();
    seen.push({ path: url.pathname, body: text ? JSON.parse(text) : null });
    const override = overrides[url.pathname];
    if (override) return override();
    if (url.pathname === "/rest/v1/brand_site_gateway_nonces") {
      return Response.json([], { status: 201 });
    }
    return Response.json({ authorized: true });
  }) as typeof fetch;
  return {
    seen,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function withEnvironment<T>(run: () => Promise<T>): Promise<T> {
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", SECURITY_JSON);
  Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
  return run();
}

async function errorCode(response: Response): Promise<string | null> {
  const payload = await response.json().catch(() => null) as
    | { error?: { code?: unknown } }
    | null;
  const code = payload?.error?.code;
  return typeof code === "string" ? code : null;
}

const CALLBACK_SOURCE = await Deno.readTextFile(
  new URL("../../brand-site-cms-callback/index.ts", import.meta.url),
);

/* ------------------------------------------------------------------ *
 * 1. The router's own coverage. A guard that most routes carry is not
 *    a guard; it is a habit. State it as an invariant instead.
 * ------------------------------------------------------------------ */

Deno.test("#2830 every site-scoped callback route binds the URL site to the signed site", () => {
  /*
   * Find every route in the callback router whose path pattern captures a site
   * id, then require that the branch handling it compares that id with
   * `envelope.site_id`. The comparison is written identically everywhere it
   * appears, so its ABSENCE is what this looks for.
   */
  const SITE_CAPTURE = "sites\\/([^/]+)";
  const routes: string[] = [];
  for (
    const match of CALLBACK_SOURCE.matchAll(
      /const (\w+Match)\s*=\s*path\.match\(([\s\S]{0,240}?)\);/g,
    )
  ) {
    if (match[2].includes(SITE_CAPTURE)) routes.push(match[1]);
  }
  assert(
    routes.length >= 8,
    `expected the callback to declare at least 8 site-scoped routes, found ${routes.length}`,
  );
  const unguarded: string[] = [];
  for (const route of routes) {
    /*
     * The branch runs from `if (<route>` to the next `const <name>Match` or the
     * end of the router. Anything shorter risks reading a neighbour's guard as
     * this route's, which would make the test pass for the wrong reason.
     */
    const start = CALLBACK_SOURCE.indexOf(`if (${route}`);
    assert(start > 0, `no handler branch found for ${route}`);
    const nextRoute = CALLBACK_SOURCE.slice(start + 1).search(
      /\n\s*const \w+Match = path\.match\(/,
    );
    const branch = CALLBACK_SOURCE.slice(
      start,
      nextRoute < 0 ? undefined : start + 1 + nextRoute,
    );
    if (!branch.includes("!== envelope.site_id")) unguarded.push(route);
  }
  assert(
    unguarded.length === 0,
    `site-scoped callback routes with no envelope/site binding: ${
      unguarded.join(", ")
    }. Every such route must refuse with TENANT_MISMATCH when the site in the URL is not the site the envelope was signed for.`,
  );
});

/* ------------------------------------------------------------------ *
 * 2. Drive the gateway with a cross-tenant request and watch what
 *    reaches the database.
 * ------------------------------------------------------------------ */

Deno.test({
  name:
    "#2830 a publication callback signed for one site cannot act on another site",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const stubs = installStubs();
      try {
        const path = `/internal/v1/sites/${SITE_B}/publication-results`;
        const body = JSON.stringify({
          publication_id: crypto.randomUUID(),
          source_revision_id: "rev-1",
          source_digest: "a".repeat(64),
          artifact_key: "publications/x/y/z.json",
          artifact_digest: "b".repeat(64),
          probe_summary: {},
        });
        const response = await handleBrandSiteCmsCallback(
          request(
            "brand-site-cms-callback",
            path,
            body,
            // Signed for SITE_A, aimed at SITE_B's publication endpoint.
            await buildEnvelope({ path, body, siteId: SITE_A }),
          ),
        );
        assert(
          response.status === 403,
          `expected 403 for a cross-tenant publication callback, got ${response.status}`,
        );
        assert(
          await errorCode(response) === "TENANT_MISMATCH",
          "a cross-tenant publication callback must name TENANT_MISMATCH",
        );
        assert(
          !stubs.seen.some((call) =>
            call.path.includes("brand_site_complete_publication")
          ),
          "the publish RPC must never be reached on a cross-tenant callback",
        );
      } finally {
        stubs.restore();
      }
    }),
});

Deno.test({
  name:
    "#2830 an authorize callback signed for one site cannot ask about another site",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const stubs = installStubs();
      try {
        const path = `/internal/v1/sites/${SITE_B}/authorize`;
        const body = JSON.stringify({
          user_id: "cccccccc-3333-4333-8333-333333333333",
          min_rank: 20,
        });
        const response = await handleBrandSiteCmsCallback(
          request(
            "brand-site-cms-callback",
            path,
            body,
            await buildEnvelope({ path, body, siteId: SITE_A }),
          ),
        );
        const reachedCore = stubs.seen.some((call) =>
          call.path.includes("brand_site_internal_authorize")
        );
        assert(
          !reachedCore,
          "an authorize callback whose URL site differs from its signed site reached Core's authorization RPC; it must be refused at the gateway like every other site-scoped route",
        );
        assert(
          await errorCode(response) === "TENANT_MISMATCH",
          "a cross-tenant authorize callback must name TENANT_MISMATCH",
        );
      } finally {
        stubs.restore();
      }
    }),
});

Deno.test({
  name: "#2830 a resolved host that is not the signed site is not served",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const hostname = "gogi.sites.usemingla.com";
      const path = `/internal/v1/hosts/${hostname}/publication`;
      const body = JSON.stringify({ hostname });
      const stubs = installStubs({
        "/rest/v1/rpc/brand_site_resolve_publication": () =>
          // The host genuinely belongs to SITE_B.
          Response.json([{ site_id: SITE_B, artifact_digest: "f".repeat(64) }]),
      });
      try {
        const response = await handleBrandSiteRuntimeResolve(
          request(
            "brand-site-runtime-resolve",
            path,
            body,
            await buildEnvelope({
              path,
              body,
              siteId: SITE_A,
              direction: "runtime_to_core",
              kid: RUNTIME_KID,
              keyB64: RUNTIME_KEY_B64,
            }),
          ),
        );
        assert(
          response.status === 404,
          `a runtime signed for one site must not receive another site's publication, got ${response.status}`,
        );
        const payload = await response.json() as { data?: unknown };
        assert(
          payload.data === undefined,
          "no publication payload may cross a site boundary",
        );
      } finally {
        stubs.restore();
      }
    }),
});

Deno.test({
  name: "#2830 a replayed nonce is refused before any work is done",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withEnvironment(async () => {
      const path = `/internal/v1/sites/${SITE_A}/retention-protection`;
      const stubs = installStubs({
        "/rest/v1/brand_site_gateway_nonces": () =>
          Response.json({ code: "23505", message: "duplicate key" }, {
            status: 409,
          }),
      });
      try {
        const response = await handleBrandSiteCmsCallback(
          request(
            "brand-site-cms-callback",
            path,
            "",
            await buildEnvelope({
              path,
              body: "",
              siteId: SITE_A,
              method: "GET",
            }),
            "GET",
          ),
        );
        assert(
          await errorCode(response) === "REPLAY_DETECTED",
          "a nonce the replay table already holds must be named as a replay",
        );
        assert(
          !stubs.seen.some((call) => call.path.includes("rpc/")),
          "a replayed envelope must not reach any Core RPC",
        );
      } finally {
        stubs.restore();
      }
    }),
});

/* ------------------------------------------------------------------ *
 * 3. The envelope's own edges, one millisecond and one byte at a time.
 * ------------------------------------------------------------------ */

const VERIFY_KEYS = [
  { kid: CMS_KID, keyBytes: bytes(CMS_KEY_B64) },
  { kid: CMS_PREV_KID, keyBytes: bytes(CMS_PREV_KEY_B64) },
];

async function verifies(
  envelope: Record<string, unknown>,
  body: string,
  path: string,
  method = "POST",
): Promise<boolean> {
  try {
    await verifySitesEnvelope({
      envelope,
      expectedAudience: "mingla-core",
      expectedDirection: "cms_to_core",
      method,
      path,
      body,
      keys: VERIFY_KEYS,
    });
    return true;
  } catch {
    return false;
  }
}

Deno.test("#2830 the freshness window holds at the millisecond either side of it", async () => {
  const path = "/internal/v1/sites/x/edge";
  const body = "{}";
  const exact = await buildEnvelope({
    path,
    body,
    siteId: SITE_A,
    issuedOffsetMs: -1,
    lifetimeMs: 60_000,
  });
  assert(
    await verifies(exact, body, path),
    "a lifetime of exactly 60s is the documented maximum and must verify",
  );
  const tooLong = await buildEnvelope({
    path,
    body,
    siteId: SITE_A,
    issuedOffsetMs: -1,
    lifetimeMs: 60_001,
  });
  assert(
    !(await verifies(tooLong, body, path)),
    "a lifetime one millisecond past the maximum must be refused",
  );
  const expired = await buildEnvelope({
    path,
    body,
    siteId: SITE_A,
    issuedOffsetMs: -120_000,
    lifetimeMs: 60_000,
  });
  assert(
    !(await verifies(expired, body, path)),
    "an envelope whose expiry has passed must be refused",
  );
  const fromTheFuture = await buildEnvelope({
    path,
    body,
    siteId: SITE_A,
    issuedOffsetMs: 6_000,
    lifetimeMs: 60_000,
  });
  assert(
    !(await verifies(fromTheFuture, body, path)),
    "an envelope issued beyond the allowed clock skew must be refused",
  );
});

Deno.test("#2830 a rotated key id cannot be paired with a different key's bytes", async () => {
  const path = "/internal/v1/sites/x/edge";
  const body = "{}";
  const honestPrevious = await buildEnvelope({
    path,
    body,
    siteId: SITE_A,
    kid: CMS_PREV_KID,
    keyB64: CMS_PREV_KEY_B64,
  });
  assert(
    await verifies(honestPrevious, body, path),
    "the previous key must keep verifying through a rotation",
  );
  const mismatched = await buildEnvelope({
    path,
    body,
    siteId: SITE_A,
    kid: CMS_PREV_KID,
    keyB64: CMS_KEY_B64,
  });
  assert(
    !(await verifies(mismatched, body, path)),
    "naming the previous key while signing with the current one must be refused",
  );
});

Deno.test("#2830 the body digest is over bytes, not over meaning", async () => {
  const path = "/internal/v1/sites/x/edge";
  const signedBody = JSON.stringify({ alpha: 1, beta: 2 });
  const envelope = await buildEnvelope({
    path,
    body: signedBody,
    siteId: SITE_A,
  });
  assert(
    await verifies(envelope, signedBody, path),
    "the body it was signed over must verify",
  );
  const reordered = JSON.stringify({ beta: 2, alpha: 1 });
  assert(
    reordered !== signedBody,
    "the fixture must actually differ byte for byte",
  );
  assert(
    !(await verifies(envelope, reordered, path)),
    "a semantically identical body with different bytes must not verify",
  );
  const trailingSpace = `${signedBody} `;
  assert(
    !(await verifies(envelope, trailingSpace, path)),
    "a single appended byte must not verify",
  );
});

Deno.test("#2830 an envelope with one field too many or too few is refused", async () => {
  const path = "/internal/v1/sites/x/edge";
  const body = "{}";
  const envelope = await buildEnvelope({ path, body, siteId: SITE_A });
  assert(await verifies(envelope, body, path), "the control must verify");
  assert(
    !(await verifies({ ...envelope, extra: "field" }, body, path)),
    "an envelope carrying an unknown field must be refused",
  );
  const { nonce: _dropped, ...missing } = envelope;
  assert(
    !(await verifies(missing, body, path)),
    "an envelope missing a signed field must be refused",
  );
  assert(
    !(await verifies(
      { ...envelope, audience: "mingla-site-cms" },
      body,
      path,
    )),
    "an envelope addressed to a different audience must be refused",
  );
  assert(
    !(await verifies({ ...envelope, path: "/internal/v1/other" }, body, path)),
    "an envelope signed for a different path must be refused",
  );
  assert(
    !(await verifies(envelope, body, path, "GET")),
    "an envelope signed for POST must not verify a GET",
  );
});
