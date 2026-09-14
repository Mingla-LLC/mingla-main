// #3184 [Ari no-website 500] — tester adversarial suite (T-A1..T-A7, edge).
//
// The implementor's suite proves the happy answers: a brand without a website
// reads as not_available / not_set_up. This suite attacks the seam from the
// other side. Laundering must fail in BOTH directions:
//
//   - a refusal (403 / 409) must never be reported as an outage or INTERNAL;
//   - an outage (fetch, relay, gateway HTML, unsafe body, database error) must
//     never be reported as a refusal, as "no website yet", or as a success;
//   - a low-rank caller must learn nothing about whether a site exists;
//   - a read result must never carry an auto-navigation key.
//
// The seam is real: the pinned supabase-js@2.45.4 client (functions-js 2.4.1)
// and the in-process brand-site-control handler. Only PostgREST, Auth and the
// CMS origin are answered by a fetch fixture. Where a response shape cannot be
// produced by the handler (relay error, gateway HTML), the fixture scripts the
// raw brand-site-control HTTP response and the real library still parses it.
// Every refusal is carried to the wire through runWithAriRequest +
// ariErrorResponse, which is exactly what agent-chat calls for a read error.
//
// Fails on revert of agentSiteTools.ts / agentReliability.ts /
// brand-site-control/index.ts (see the #3184 tester report for the run).

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleBrandSiteControl } from "../../brand-site-control/index.ts";
import { SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { AGENT_TOOLS } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import {
  ARI_ERROR_REGISTRY,
  mapLegacyAriErrorCode,
} from "../agentReliability.ts";
import {
  ariErrorResponse,
  runWithAriRequest,
} from "../agentReliabilityHttp.ts";
import { SITES_SAFE_CUSTOMER_CODES } from "../sitesContracts.ts";
import { corsHeaders } from "../cors.ts";

const SUPABASE_URL = "https://fixture-3184-tester.supabase.co";
const CMS_ORIGIN = "https://cms.fixture-3184.invalid";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRAND_ID = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const OTHER_BRAND_ID = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const SITE_ID = "81e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6";
const OPERATION_ID = "92f3a4b5-c6d7-4e8f-9a01-b2c3d4e5f6a7";
const CLIENT_TURN_ID = "a3b4c5d6-e7f8-4a9b-8c0d-e1f2a3b4c5d6";
const DIGEST = "a".repeat(64);
const UNAVAILABLE_MESSAGE = "Ari could not reach Website tools right now.";
const WARN_PREFIX = "[agentSiteTools] sites control unavailable";

type Json = Record<string, unknown>;

interface PostgrestFailure {
  status: number;
  body: Json;
}

interface Script {
  // undefined -> the real in-process brand-site-control handler answers.
  control?: (route: string) => Response | Promise<Response>;
  ownsBrand?: boolean;
  memberRole?: string | null;
  siteRow?: Json | null;
  siteFailure?: PostgrestFailure | "network";
  availability?: unknown;
  availabilityFailure?: PostgrestFailure;
  internalAuthorize?: unknown;
  cms?: () => Response;
  callerRank?: number;
}

interface Recorded {
  controlRoutes: string[];
  warnings: string[];
  unexpected: string[];
  cmsCalls: number;
  ambiguousMarks: number;
  rankCalls: number;
}

function securityEnvelope(): string {
  const material = (byte: number) =>
    btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
  return JSON.stringify({
    schema_version: 1,
    core_to_cms_current_kid: "core-cms-current",
    core_to_cms_current_key_b64: material(11),
    core_to_cms_previous_kid: null,
    core_to_cms_previous_key_b64: null,
    cms_to_core_current_kid: "cms-core-current",
    cms_to_core_current_key_b64: material(12),
    cms_to_core_previous_kid: null,
    cms_to_core_previous_key_b64: null,
    runtime_to_core_current_kid: "runtime-core-current",
    runtime_to_core_current_key_b64: material(13),
    runtime_to_core_previous_kid: null,
    runtime_to_core_previous_key_b64: null,
    attribution_pepper_b64: material(14),
  });
}

function maybeSingle(request: Request, row: Json | null): Response {
  const wantsObject = (request.headers.get("accept") ?? "").includes(
    "vnd.pgrst.object+json",
  );
  if (wantsObject) {
    return row ? Response.json(row) : Response.json({
      code: "PGRST116",
      details: "The result contains 0 rows",
      hint: null,
      message: "JSON object requested, multiple (or no) rows returned",
    }, { status: 406 });
  }
  return Response.json(row ? [row] : []);
}

type ToolClient = Parameters<
  (typeof SITE_AGENT_TOOLS)[number]["executor"]
>[1];

const ENV_NAMES = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MINGLA_SITES_SECURITY_JSON",
];

async function withFixture<T>(
  script: Script,
  run: (
    client: ToolClient,
    recorded: Recorded,
  ) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalEnv = new Map(ENV_NAMES.map((n) => [n, Deno.env.get(n)]));
  const recorded: Recorded = {
    controlRoutes: [],
    warnings: [],
    unexpected: [],
    cmsCalls: 0,
    ambiguousMarks: 0,
    rankCalls: 0,
  };
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", securityEnvelope());
  console.warn = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes(WARN_PREFIX)) recorded.warnings.push(line);
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === CMS_ORIGIN) {
      recorded.cmsCalls += 1;
      return script.cms ? script.cms() : Response.json({ ok: true, data: {} });
    }
    const path = url.pathname;
    if (path === "/functions/v1/brand-site-control") {
      const body = await request.clone().json() as { route?: unknown };
      const route = String(body.route);
      recorded.controlRoutes.push(route);
      return script.control
        ? await script.control(route)
        : await handleBrandSiteControl(request);
    }
    if (path === "/auth/v1/user") {
      return Response.json({
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "tester@example.invalid",
      });
    }
    if (path === "/rest/v1/brands") {
      return Response.json(
        script.ownsBrand === false ? [] : [{
          id: BRAND_ID,
          name: "Tester Kitchen",
          slug: "tester-kitchen",
          default_currency: "USD",
          cover_media_url: null,
        }],
      );
    }
    if (path === "/rest/v1/brand_team_members") {
      return Response.json(
        script.memberRole
          ? [{
            brand_id: BRAND_ID,
            role: script.memberRole,
            brand: {
              id: BRAND_ID,
              name: "Tester Kitchen",
              slug: "tester-kitchen",
              default_currency: "USD",
              cover_media_url: null,
              deleted_at: null,
            },
          }]
          : [],
      );
    }
    if (path === "/rest/v1/brand_sites") {
      if (script.siteFailure === "network") {
        throw new TypeError("error sending request: connection reset");
      }
      if (script.siteFailure) {
        return Response.json(script.siteFailure.body, {
          status: script.siteFailure.status,
        });
      }
      return maybeSingle(request, script.siteRow ?? null);
    }
    if (path === "/rest/v1/brand_site_operation_receipts") {
      return maybeSingle(request, null);
    }
    if (path === "/rest/v1/rpc/brand_site_business_availability") {
      if (script.availabilityFailure) {
        return Response.json(script.availabilityFailure.body, {
          status: script.availabilityFailure.status,
        });
      }
      return Response.json(script.availability ?? { available: false });
    }
    if (path === "/rest/v1/rpc/brand_site_internal_authorize") {
      return Response.json(script.internalAuthorize ?? null);
    }
    if (path === "/rest/v1/brand_site_service_config") {
      return maybeSingle(request, { cms_origin: CMS_ORIGIN });
    }
    if (path === "/rest/v1/rpc/brand_site_mark_operation_ambiguous") {
      recorded.ambiguousMarks += 1;
      return Response.json(null);
    }
    if (path === "/rest/v1/rpc/biz_brand_effective_rank_for_caller") {
      recorded.rankCalls += 1;
      return Response.json(script.callerRank ?? 60);
    }
    if (path === "/rest/v1/rpc/biz_role_rank") {
      const body = await request.clone().json() as { p_role?: unknown };
      const ranks: Record<string, number> = {
        scanner: 10,
        marketing_manager: 20,
        finance_manager: 30,
        event_manager: 40,
        brand_admin: 50,
        brand_owner: 60,
      };
      return Response.json(ranks[String(body.p_role)] ?? 0);
    }
    recorded.unexpected.push(`${request.method} ${path}`);
    return Response.json({ message: "unexpected fixture request" }, {
      status: 599,
    });
  }) as typeof fetch;
  try {
    // Mirrors agent-chat's caller-scoped client. Created AFTER the fetch stub:
    // supabase-js captures fetch at construction.
    const client = createClient(SUPABASE_URL, "fixture-anon-key", {
      global: { headers: { Authorization: "Bearer fixture-user-jwt" } },
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as ToolClient;
    return await run(client, recorded);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    for (const [name, value] of originalEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

function rawTool(name: string) {
  const found = SITE_AGENT_TOOLS.find((item) => item.name === name);
  assert(found, `${name} is not registered`);
  return found;
}

const TOOL_ARGS: Record<string, Json> = {
  get_brand_site: { brand_id: BRAND_ID },
  list_site_pages: { brand_id: BRAND_ID, site_id: SITE_ID },
  get_site_page: { brand_id: BRAND_ID, site_id: SITE_ID, page_role: "home" },
  propose_site_content_update: {
    brand_id: BRAND_ID,
    site_id: SITE_ID,
    page_role: "home",
    expected_revision: "rev-1",
    changes: { title: "Dinner" },
    change_summary: "Retitle",
  },
  propose_site_settings_update: {
    brand_id: BRAND_ID,
    site_id: SITE_ID,
    expected_revision: "rev-1",
    changes: { display_name: "Tester Kitchen" },
    change_summary: "Rename",
  },
  attach_approved_site_media: {
    brand_id: BRAND_ID,
    site_id: SITE_ID,
    page_role: "gallery",
    expected_revision: "rev-1",
    media_id: OPERATION_ID,
    block_index: 0,
    field: "images",
    alt: "Dining room",
  },
  validate_site_draft: { brand_id: BRAND_ID, site_id: SITE_ID },
  create_site_preview: {
    brand_id: BRAND_ID,
    site_id: SITE_ID,
    expected_revision: "rev-1",
    source_digest: DIGEST,
    arguments_digest: DIGEST,
  },
  publish_site: {
    brand_id: BRAND_ID,
    site_id: SITE_ID,
    expected_revision: "rev-1",
    source_digest: DIGEST,
    arguments_digest: DIGEST,
  },
  get_site_operation_status: {
    brand_id: BRAND_ID,
    site_id: SITE_ID,
    operation_id: OPERATION_ID,
  },
  list_site_versions: { brand_id: BRAND_ID, site_id: SITE_ID },
  rollback_site: {
    brand_id: BRAND_ID,
    site_id: SITE_ID,
    expected_revision: "rev-1",
    source_digest: DIGEST,
    arguments_digest: DIGEST,
  },
};

async function captureToolError(
  execute: () => Promise<unknown>,
): Promise<ToolError> {
  let outcome: unknown = "resolved";
  let value: unknown;
  try {
    value = await execute();
  } catch (error) {
    outcome = error;
  }
  assert(
    outcome instanceof ToolError,
    `expected a ToolError, got ${
      outcome === "resolved"
        ? `a resolved value ${JSON.stringify(value)}`
        : String(outcome)
    }`,
  );
  return outcome;
}

// What agent-chat sends for a read that stopped with this ToolError.
async function wire(error: ToolError): Promise<{ status: number; body: Json }> {
  return await runWithAriRequest(
    { requestIdHeader: null, clientTurnId: CLIENT_TURN_ID, executionId: null },
    async () => {
      const response = ariErrorResponse(403, error.code, error.message);
      return {
        status: response.status,
        body: await response.json() as Json,
      };
    },
  );
}

const quietLog = console.log;
function silenceTelemetry<T>(fn: () => Promise<T>): Promise<T> {
  console.log = () => {};
  return fn().finally(() => {
    console.log = quietLog;
  });
}

// ---------------------------------------------------------------------------
// T-A1 — 403 laundering
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "#3184 T-A1 a real brand-site-control 403 reaches Ari as FORBIDDEN 403, never an outage or INTERNAL",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const scenarios: Array<{ label: string; script: Script }> = [
        {
          label: "caller below the site rank floor",
          script: { internalAuthorize: null },
        },
        {
          label: "site id belongs to another brand",
          script: {
            internalAuthorize: {
              brand_id: OTHER_BRAND_ID,
              user_id: USER_ID,
              rank: 60,
            },
          },
        },
      ];
      for (const { label, script } of scenarios) {
        await withFixture(script, async (client, recorded) => {
          const error = await captureToolError(() =>
            rawTool("list_site_pages").executor(
              TOOL_ARGS.list_site_pages,
              client,
              USER_ID,
            )
          );
          assertEquals(error.code, "FORBIDDEN", label);
          assertEquals(
            error.message,
            "This Website action is not available for your role.",
            label,
          );
          const { status, body } = await wire(error);
          assertEquals(status, 403, label);
          assertEquals(body.code, "FORBIDDEN", label);
          assertEquals(body.retryability, "never", label);
          // A refusal is not an outage: the outage monitor stays silent and
          // the CMS is never contacted.
          assertEquals(recorded.warnings, [], label);
          assertEquals(recorded.cmsCalls, 0, label);
          assertEquals(recorded.unexpected, [], label);
        });
      }

      // get_brand_site: a 403 on /site must not be read as "no website" and
      // must not trigger the availability read.
      await withFixture({
        control: () =>
          Response.json({
            ok: false,
            error: { code: "FORBIDDEN", message: "x", retryable: false },
          }, { status: 403 }),
      }, async (client, recorded) => {
        const error = await captureToolError(() =>
          rawTool("get_brand_site").executor(
            TOOL_ARGS.get_brand_site,
            client,
            USER_ID,
          )
        );
        assertEquals(error.code, "FORBIDDEN");
        assertEquals(recorded.controlRoutes, [`/v1/brands/${BRAND_ID}/site`]);
        assertEquals((await wire(error)).status, 403);
        assertEquals(recorded.warnings, []);
      });
    }),
});

// ---------------------------------------------------------------------------
// T-A2 — 409 laundering (real handler -> real callCms -> CMS answers)
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "#3184 T-A2 every CMS refusal the handler forwards keeps its exact code and §4.3 wire status",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const expected: Array<[string, string, number, string]> = [
        ["INVALID_STATE", "STALE_PROPOSAL", 409, "never"],
        ["REVISION_CONFLICT", "CONFLICT", 409, "after_backoff"],
        ["OPERATION_IN_PROGRESS", "CONFLICT", 409, "after_backoff"],
        ["IDEMPOTENCY_CONFLICT", "STALE_PROPOSAL", 409, "never"],
        ["MEDIA_PROCESSING", "CONFLICT", 409, "after_backoff"],
        ["SESSION_EXPIRED", "STALE_PROPOSAL", 409, "never"],
        ["MEDIA_REJECTED", "VALIDATION_FAILED", 400, "never"],
        [
          "PUBLISH_FAILED_LAST_GOOD_PRESERVED",
          "DEPENDENCY_UNAVAILABLE",
          503,
          "after_backoff",
        ],
      ];
      for (const [cmsCode, family, httpStatus, retryability] of expected) {
        await withFixture({
          internalAuthorize: { brand_id: BRAND_ID, user_id: USER_ID, rank: 60 },
          cms: () =>
            Response.json({
              ok: false,
              error: { code: cmsCode, message: "cms internals must not leak" },
            }, { status: 409 }),
        }, async (client, recorded) => {
          const error = await captureToolError(() =>
            rawTool("list_site_pages").executor(
              TOOL_ARGS.list_site_pages,
              client,
              USER_ID,
            )
          );
          assertEquals(error.code, cmsCode);
          assertEquals(recorded.cmsCalls, 1, cmsCode);
          const { status, body } = await wire(error);
          assertEquals(body.code, family, cmsCode);
          assertEquals(status, httpStatus, cmsCode);
          assertEquals(body.retryability, retryability, cmsCode);
          assert(
            !JSON.stringify(body).includes("cms internals"),
            `${cmsCode} echoed CMS text`,
          );
          assertEquals(recorded.warnings, [], cmsCode);
          assertEquals(recorded.unexpected, [], cmsCode);
        });
      }

      // An unsafe CMS code is collapsed by the handler to 503
      // SERVICE_TEMPORARILY_UNAVAILABLE: a dependency outage, not INTERNAL.
      await withFixture({
        internalAuthorize: { brand_id: BRAND_ID, user_id: USER_ID, rank: 60 },
        cms: () =>
          Response.json({ ok: false, error: { code: "DROP_TABLE" } }, {
            status: 500,
          }),
      }, async (client, recorded) => {
        const error = await captureToolError(() =>
          rawTool("list_site_pages").executor(
            TOOL_ARGS.list_site_pages,
            client,
            USER_ID,
          )
        );
        assertEquals(error.code, "SERVICE_TEMPORARILY_UNAVAILABLE");
        assertEquals(recorded.ambiguousMarks, 1);
        const { status, body } = await wire(error);
        assertEquals([status, body.code], [503, "DEPENDENCY_UNAVAILABLE"]);
        assert(!JSON.stringify(body).includes("DROP_TABLE"));
      });
    }),
});

// ---------------------------------------------------------------------------
// T-A3 — real transport failures stay outages, never refusals or successes
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "#3184 T-A3 fetch, relay, gateway HTML, non-JSON 2xx and unsafe bodies become SITE_SERVICE_UNAVAILABLE 503 with one id-free warn",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const secret = `relation brand_sites ${BRAND_ID} ${SITE_ID} ${USER_ID}`;
      const scenarios: Array<{
        label: string;
        control: () => Response | Promise<Response>;
        reason: string;
        httpStatus: number | null;
        leak?: string;
      }> = [
        {
          label: "fetch rejects",
          control: () => Promise.reject(new TypeError(`dns failure ${secret}`)),
          reason: "fetch",
          httpStatus: null,
        },
        {
          // A relay error is an outage even when its body LOOKS like a safe
          // Sites refusal. Trusting it would launder an outage into FORBIDDEN.
          label: "relay error carrying a refusal-shaped body",
          control: () =>
            new Response(
              JSON.stringify({ ok: false, error: { code: "FORBIDDEN" } }),
              {
                status: 502,
                headers: {
                  "Content-Type": "application/json",
                  "x-relay-error": "true",
                },
              },
            ),
          reason: "relay",
          httpStatus: 502,
        },
        {
          label: "gateway 502 HTML page",
          control: () =>
            new Response(`<html><body>Bad gateway ${secret}</body></html>`, {
              status: 502,
              headers: { "Content-Type": "text/html" },
            }),
          reason: "http_unrecognized",
          httpStatus: 502,
          leak: "Bad gateway",
        },
        {
          label: "worker limit 546 JSON without a Sites body",
          control: () =>
            Response.json({ code: "WORKER_LIMIT", message: secret }, {
              status: 546,
            }),
          reason: "http_unrecognized",
          httpStatus: 546,
          leak: "WORKER_LIMIT",
        },
        {
          label: "2xx text/plain",
          control: () =>
            new Response(`ok ${secret}`, {
              status: 200,
              headers: { "Content-Type": "text/plain" },
            }),
          reason: "body_unrecognized",
          httpStatus: null,
        },
        {
          label: "404 with an unsafe code",
          control: () =>
            Response.json({
              ok: false,
              error: { code: "DROP_TABLE", message: secret },
            }, { status: 404 }),
          reason: "http_unrecognized",
          httpStatus: 404,
          leak: "DROP_TABLE",
        },
        {
          label: "409 with a prototype-key code",
          control: () =>
            Response.json({ ok: false, error: { code: "constructor" } }, {
              status: 409,
            }),
          reason: "http_unrecognized",
          httpStatus: 409,
        },
        {
          label: "409 with a lower-case lookalike code",
          control: () =>
            Response.json({ ok: false, error: { code: "forbidden" } }, {
              status: 409,
            }),
          reason: "http_unrecognized",
          httpStatus: 409,
        },
        {
          label: "2xx JSON refusal with an unsafe code",
          control: () =>
            Response.json({ ok: false, error: { code: "toString" } }),
          reason: "body_unrecognized",
          httpStatus: null,
        },
      ];
      for (const scenario of scenarios) {
        await withFixture(
          { control: scenario.control },
          async (client, recorded) => {
            const error = await captureToolError(() =>
              rawTool("list_site_pages").executor(
                TOOL_ARGS.list_site_pages,
                client,
                USER_ID,
              )
            );
            assertEquals(
              error.code,
              "SITE_SERVICE_UNAVAILABLE",
              scenario.label,
            );
            assertEquals(error.message, UNAVAILABLE_MESSAGE, scenario.label);
            const { status, body } = await wire(error);
            assertEquals(status, 503, scenario.label);
            assertEquals(body.code, "DEPENDENCY_UNAVAILABLE", scenario.label);
            assertEquals(body.retryability, "after_backoff", scenario.label);
            const serialized = JSON.stringify(body) + error.message;
            for (const token of [BRAND_ID, SITE_ID, USER_ID, "relation"]) {
              assert(
                !serialized.includes(token),
                `${scenario.label} echoed ${token}`,
              );
            }
            if (scenario.leak) {
              assert(
                !serialized.includes(scenario.leak),
                `${scenario.label} echoed ${scenario.leak}`,
              );
            }
            // Exactly one monitor line, with the reason and status, no ids.
            assertEquals(recorded.warnings.length, 1, scenario.label);
            const warning = recorded.warnings[0];
            const payload = JSON.parse(
              warning.slice(warning.indexOf("{")),
            ) as Json;
            assertEquals(payload, {
              fn: "agentSiteTools",
              reason: scenario.reason,
              http_status: scenario.httpStatus,
            }, scenario.label);
            for (const token of [BRAND_ID, SITE_ID, USER_ID, "relation"]) {
              assert(
                !warning.includes(token),
                `${scenario.label} warn leaked ${token}`,
              );
            }
          },
        );
      }

      // A client whose invoke throws synchronously is still an outage.
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      try {
        const throwingClient = {
          functions: {
            invoke: () => {
              throw new Error(`client exploded ${BRAND_ID}`);
            },
          },
        };
        const error = await captureToolError(() =>
          rawTool("create_site_preview").executor(
            TOOL_ARGS.create_site_preview,
            throwingClient as never,
            USER_ID,
            { operationId: OPERATION_ID },
          )
        );
        assertEquals(error.code, "SITE_SERVICE_UNAVAILABLE");
        const monitor = warnings.filter((line) => line.includes(WARN_PREFIX));
        assertEquals(monitor.length, 1);
        assert(monitor[0].includes('"reason":"threw"'));
        assert(!monitor[0].includes(BRAND_ID));
      } finally {
        console.warn = originalWarn;
      }
    }),
});

Deno.test({
  name:
    "#3184 T-A3b an outage on either get_brand_site read is never reported as no website, a refusal or a success",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const notFound = () =>
        Response.json({
          ok: false,
          error: { code: "NOT_FOUND", message: "x", retryable: false },
        }, { status: 404 });
      const outages: Array<[string, (route: string) => Response]> = [
        [
          "relay on /site",
          () =>
            new Response("{}", {
              status: 503,
              headers: { "x-relay-error": "true" },
            }),
        ],
        [
          "gateway HTML on availability",
          (route) =>
            route.endsWith("/site") ? notFound() : new Response(
              "<html>504</html>",
              { status: 504, headers: { "Content-Type": "text/html" } },
            ),
        ],
        [
          "availability route drift answers NOT_FOUND",
          () => notFound(),
        ],
        [
          "availability returns a string boolean",
          (route) =>
            route.endsWith("/site")
              ? notFound()
              : Response.json({ ok: true, data: { available: "false" } }),
        ],
        [
          "availability true without a site key",
          (route) =>
            route.endsWith("/site")
              ? notFound()
              : Response.json({ ok: true, data: { available: true } }),
        ],
        [
          "availability true with a non-object site",
          (route) =>
            route.endsWith("/site") ? notFound() : Response.json({
              ok: true,
              data: { available: true, site: "site-row" },
            }),
        ],
        [
          "availability null data",
          (route) =>
            route.endsWith("/site")
              ? notFound()
              : Response.json({ ok: true, data: null }),
        ],
      ];
      for (const [label, control] of outages) {
        await withFixture({ control }, async (client, recorded) => {
          const error = await captureToolError(() =>
            rawTool("get_brand_site").executor(
              TOOL_ARGS.get_brand_site,
              client,
              USER_ID,
            )
          );
          assertEquals(error.code, "SITE_SERVICE_UNAVAILABLE", label);
          const { status, body } = await wire(error);
          assertEquals(
            [status, body.code],
            [503, "DEPENDENCY_UNAVAILABLE"],
            label,
          );
          if (label === "relay on /site") {
            // An outage on /site must not be taken as "no website".
            assertEquals(recorded.controlRoutes, [
              `/v1/brands/${BRAND_ID}/site`,
            ]);
          }
        });
      }

      // An availability refusal other than NOT_FOUND keeps its code.
      await withFixture({
        control: (route) =>
          route.endsWith("/site") ? notFound() : Response.json({
            ok: false,
            error: { code: "FORBIDDEN", message: "x", retryable: false },
          }, { status: 403 }),
      }, async (client) => {
        const error = await captureToolError(() =>
          rawTool("get_brand_site").executor(
            TOOL_ARGS.get_brand_site,
            client,
            USER_ID,
          )
        );
        assertEquals(error.code, "FORBIDDEN");
      });
    }),
});

// ---------------------------------------------------------------------------
// T-A4 — exhaustiveness: no Sites code can reach INTERNAL
// ---------------------------------------------------------------------------

const SECTION_4_3: Record<string, [string, number, string]> = {
  FORBIDDEN: ["FORBIDDEN", 403, "never"],
  NOT_FOUND: ["VALIDATION_FAILED", 400, "never"],
  VALIDATION_FAILED: ["VALIDATION_FAILED", 400, "never"],
  MEDIA_REJECTED: ["VALIDATION_FAILED", 400, "never"],
  INVALID_STATE: ["STALE_PROPOSAL", 409, "never"],
  SESSION_EXPIRED: ["STALE_PROPOSAL", 409, "never"],
  IDEMPOTENCY_CONFLICT: ["STALE_PROPOSAL", 409, "never"],
  OPERATION_ID_REQUIRED: ["STALE_PROPOSAL", 409, "never"],
  REVISION_CONFLICT: ["CONFLICT", 409, "after_backoff"],
  OPERATION_IN_PROGRESS: ["CONFLICT", 409, "after_backoff"],
  MEDIA_PROCESSING: ["CONFLICT", 409, "after_backoff"],
  SERVICE_TEMPORARILY_UNAVAILABLE: [
    "DEPENDENCY_UNAVAILABLE",
    503,
    "after_backoff",
  ],
  PUBLISH_FAILED_LAST_GOOD_PRESERVED: [
    "DEPENDENCY_UNAVAILABLE",
    503,
    "after_backoff",
  ],
  SITE_SERVICE_UNAVAILABLE: ["DEPENDENCY_UNAVAILABLE", 503, "after_backoff"],
  INVALID_ARGS: ["VALIDATION_FAILED", 400, "never"],
  BRAND_ACCESS_DENIED: ["FORBIDDEN", 403, "never"],
  ROLE_DENIED: ["FORBIDDEN", 403, "never"],
  TENANT_SCOPE_UNAVAILABLE: ["DEPENDENCY_UNAVAILABLE", 503, "after_backoff"],
  ROLE_CHECK_UNAVAILABLE: ["DEPENDENCY_UNAVAILABLE", 503, "after_backoff"],
};

Deno.test({
  name:
    "#3184 T-A4 every code a Sites tool can raise (runtime-enumerated) maps to its §4.3 family and wire status, never INTERNAL",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const raisable = new Set<string>([
        // Enumerated at runtime: a new Sites code turns this red until it is
        // registered in mapLegacyAriErrorCode AND pinned in §4.3.
        ...SITES_SAFE_CUSTOMER_CODES,
        "SITE_SERVICE_UNAVAILABLE",
        "OPERATION_ID_REQUIRED",
        "INVALID_ARGS",
        "BRAND_ACCESS_DENIED",
        "ROLE_DENIED",
        "TENANT_SCOPE_UNAVAILABLE",
        "ROLE_CHECK_UNAVAILABLE",
      ]);
      // Every literal ToolError code in the Sites tool module is raisable too.
      const source = await Deno.readTextFile(
        new URL("../agentSiteTools.ts", import.meta.url),
      );
      for (const match of source.matchAll(/new ToolError\(\s*"([A-Z_]+)"/g)) {
        raisable.add(match[1]);
      }
      for (const code of raisable) {
        assert(
          code in SECTION_4_3,
          `${code} can be raised by a Sites tool but has no §4.3 row`,
        );
        const mapped = mapLegacyAriErrorCode(code);
        assertNotEquals(mapped, "INTERNAL", `${code} reaches INTERNAL`);
        const [family, httpStatus, retryability] = SECTION_4_3[code];
        assertEquals(mapped, family, code);
        const error = new ToolError(code, "m");
        const { status, body } = await wire(error);
        assertEquals(status, httpStatus, code);
        assertEquals(ARI_ERROR_REGISTRY[mapped].httpStatus, httpStatus, code);
        assertEquals(body.code, family, code);
        assertEquals(body.retryability, retryability, code);
        assertEquals(body.kind, "error", code);
        assert(!("data" in body), `${code} error envelope carries data`);
      }
    }),
});

Deno.test({
  name:
    "#3184 T-A4b no Sites tool ever throws a non-ToolError or an INTERNAL code, whatever brand-site-control answers",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const answers: Array<[string, () => Response | Promise<Response>]> = [
        ["fetch rejects", () => Promise.reject(new TypeError("offline"))],
        ["502 html", () =>
          new Response("<html/>", {
            status: 502,
            headers: { "Content-Type": "text/html" },
          })],
        ...SITES_SAFE_CUSTOMER_CODES.map((code) =>
          [
            `409 ${code}`,
            () =>
              Response.json({ ok: false, error: { code } }, { status: 409 }),
          ] as [string, () => Response]
        ),
      ];
      assertEquals(SITE_AGENT_TOOLS.length, Object.keys(TOOL_ARGS).length);
      for (const tool of SITE_AGENT_TOOLS) {
        const args = TOOL_ARGS[tool.name];
        assert(args, `no adversarial args for ${tool.name}`);
        for (const [label, control] of answers) {
          await withFixture({ control }, async (client) => {
            const error = await captureToolError(() =>
              tool.executor(args, client, USER_ID, {
                operationId: OPERATION_ID,
              })
            );
            assertNotEquals(
              mapLegacyAriErrorCode(error.code),
              "INTERNAL",
              `${tool.name} / ${label} -> ${error.code}`,
            );
            assert(
              !error.message.includes("<html"),
              `${tool.name} / ${label} echoed a body`,
            );
          });
        }
      }
    }),
});

// ---------------------------------------------------------------------------
// T-A5 — rank-10 oracle (SC-6)
// ---------------------------------------------------------------------------

function withoutCorrelation(body: Json): Json {
  const copy = { ...body };
  delete copy.request_id;
  delete copy.client_turn_id;
  delete copy.execution_id;
  return copy;
}

const SITE_ROW = {
  id: SITE_ID,
  brand_id: BRAND_ID,
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  status: "published",
  active_publication_id: null,
  last_successful_publication_id: null,
  provisioning_error_code: null,
  created_at: "2026-09-01T12:00:00.000Z",
  updated_at: "2026-09-02T12:00:00.000Z",
  brand_site_hosts: [],
};

Deno.test({
  name:
    "#3184 T-A5 a rank-10 caller gets the same FORBIDDEN 403 whether or not a site exists, and no Website call is made",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const secured = AGENT_TOOLS.find((item) =>
        item.name === "get_brand_site"
      );
      assert(secured, "secured get_brand_site is not registered");

      // (1) The production path: the authorization gate refuses before the
      // executor. Preserved invariant, not changed by #3184.
      const gated: Json[] = [];
      for (
        const script of [
          {
            callerRank: 10,
            siteRow: SITE_ROW,
            availability: { available: true, site: SITE_ROW },
          },
          { callerRank: 10, siteRow: null, availability: { available: false } },
        ] as Script[]
      ) {
        await withFixture(script, async (client, recorded) => {
          const error = await captureToolError(() =>
            secured.executor(TOOL_ARGS.get_brand_site, client, USER_ID)
          );
          assertEquals(error.code, "ROLE_DENIED");
          assertEquals(recorded.controlRoutes, []);
          assertEquals(recorded.rankCalls, 1);
          const { status, body } = await wire(error);
          assertEquals([status, body.code], [403, "FORBIDDEN"]);
          gated.push(withoutCorrelation(body));
        });
      }
      assertEquals(gated[0], gated[1]);

      // (2) Defence in depth — rank drift lets the executor run for a
      // scanner. For a rank-10 caller RLS hides a site row exactly as if none
      // existed (/site 404), and brand_site_business_availability raises
      // sites_forbidden before it ever looks for a site. The executor must
      // turn that into FORBIDDEN — never not_available (which would tell a
      // scanner the brand has no website) and never an outage — and the wire
      // envelope must be indistinguishable from the gated refusal above.
      await withFixture({
        ownsBrand: false,
        memberRole: "scanner",
        siteRow: null,
        availabilityFailure: {
          status: 400,
          body: {
            code: "P0001",
            message: "sites_forbidden",
            details: null,
            hint: null,
          },
        },
      }, async (client, recorded) => {
        const error = await captureToolError(() =>
          rawTool("get_brand_site").executor(
            TOOL_ARGS.get_brand_site,
            client,
            USER_ID,
          )
        );
        assertEquals(error.code, "FORBIDDEN");
        assertEquals(recorded.controlRoutes, [
          `/v1/brands/${BRAND_ID}/site`,
          `/v1/brands/${BRAND_ID}/site-availability`,
        ]);
        assertEquals(recorded.warnings, []);
        const { status, body } = await wire(error);
        assertEquals([status, body.code], [403, "FORBIDDEN"]);
        assertEquals(withoutCorrelation(body), gated[0]);
      });
    }),
});

// ---------------------------------------------------------------------------
// T-A6 — brand-site-control branch splits (SC-7)
// ---------------------------------------------------------------------------

async function invokeHandler(route: string): Promise<{
  status: number;
  body: Json;
  headers: Headers;
}> {
  const response = await handleBrandSiteControl(
    new Request(`${SUPABASE_URL}/functions/v1/brand-site-control`, {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-user-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ route, method: "GET" }),
    }),
  );
  return {
    status: response.status,
    body: await response.json() as Json,
    headers: response.headers,
  };
}

Deno.test({
  name:
    "#3184 T-A6 a database error in brand-site-control is 503, never NOT_FOUND ('no website yet') or FORBIDDEN",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const siteRoute = `/v1/brands/${BRAND_ID}/site`;
      const availabilityRoute = `/v1/brands/${BRAND_ID}/site-availability`;
      const cases: Array<{
        label: string;
        script: Script;
        route: string;
        status: number;
        code: string;
      }> = [
        {
          label: "/site statement timeout",
          script: {
            siteFailure: {
              status: 500,
              body: {
                code: "57014",
                message: "canceling statement due to statement timeout",
                details: null,
                hint: null,
              },
            },
          },
          route: siteRoute,
          status: 503,
          code: "SERVICE_TEMPORARILY_UNAVAILABLE",
        },
        {
          label: "/site PostgREST unreachable",
          script: { siteFailure: "network" },
          route: siteRoute,
          status: 503,
          code: "SERVICE_TEMPORARILY_UNAVAILABLE",
        },
        {
          label: "/site zero rows",
          script: { siteRow: null },
          route: siteRoute,
          status: 404,
          code: "NOT_FOUND",
        },
        {
          label: "availability sites_forbidden",
          script: {
            availabilityFailure: {
              status: 400,
              body: {
                code: "P0001",
                message: "sites_forbidden",
                details: null,
                hint: null,
              },
            },
          },
          route: availabilityRoute,
          status: 403,
          code: "FORBIDDEN",
        },
        {
          label: "availability statement timeout",
          script: {
            availabilityFailure: {
              status: 500,
              body: {
                code: "57014",
                message: "canceling statement due to statement timeout",
                details: null,
                hint: null,
              },
            },
          },
          route: availabilityRoute,
          status: 503,
          code: "SERVICE_TEMPORARILY_UNAVAILABLE",
        },
        {
          label: "availability missing grant",
          script: {
            availabilityFailure: {
              status: 401,
              body: {
                code: "42501",
                message:
                  "permission denied for function brand_site_business_availability",
                details: null,
                hint: null,
              },
            },
          },
          route: availabilityRoute,
          status: 503,
          code: "SERVICE_TEMPORARILY_UNAVAILABLE",
        },
      ];
      for (const item of cases) {
        await withFixture(item.script, async () => {
          const { status, body, headers } = await invokeHandler(item.route);
          assertEquals(status, item.status, item.label);
          assertEquals(
            (body.error as Json | undefined)?.code,
            item.code,
            item.label,
          );
          for (const [name, value] of Object.entries(corsHeaders)) {
            assertEquals(
              headers.get(name),
              value,
              `${item.label} lost ${name}`,
            );
          }
          assert(
            (headers.get("x-mingla-request-id") ?? "").length > 0,
            `${item.label} lost x-mingla-request-id`,
          );
        });
      }

      // Through Ari: a DB error on /site must not open the no-website branch.
      await withFixture({
        siteFailure: {
          status: 500,
          body: {
            code: "57014",
            message: "timeout",
            details: null,
            hint: null,
          },
        },
        availability: { available: false },
      }, async (client, recorded) => {
        const error = await captureToolError(() =>
          rawTool("get_brand_site").executor(
            TOOL_ARGS.get_brand_site,
            client,
            USER_ID,
          )
        );
        assertEquals(error.code, "SERVICE_TEMPORARILY_UNAVAILABLE");
        assertEquals(recorded.controlRoutes, [`/v1/brands/${BRAND_ID}/site`]);
        const { status, body } = await wire(error);
        assertEquals([status, body.code], [503, "DEPENDENCY_UNAVAILABLE"]);
      });

      // Through Ari: a DB error on availability must not become FORBIDDEN.
      await withFixture({
        siteRow: null,
        availabilityFailure: {
          status: 500,
          body: {
            code: "57014",
            message: "timeout",
            details: null,
            hint: null,
          },
        },
      }, async (client) => {
        const error = await captureToolError(() =>
          rawTool("get_brand_site").executor(
            TOOL_ARGS.get_brand_site,
            client,
            USER_ID,
          )
        );
        assertEquals(error.code, "SERVICE_TEMPORARILY_UNAVAILABLE");
        const { status, body } = await wire(error);
        assertEquals([status, body.code], [503, "DEPENDENCY_UNAVAILABLE"]);
      });
    }),
});

// ---------------------------------------------------------------------------
// T-A7 (edge half) — a read result never carries auto-navigation keys
// ---------------------------------------------------------------------------

// Mirrors agent-chat commitTextTurn + replay: the read result is spread into
// content.structured, and replay lifts structured.handoff_route when it is a
// string; stored choices are replayed too.
function replayNavigation(result: unknown): {
  handoffRoute: string | null;
  hasChoices: boolean;
} {
  const structured: Json = result !== null && typeof result === "object" &&
      !Array.isArray(result)
    ? { ...(result as Json) }
    : { result };
  return {
    handoffRoute: typeof structured.handoff_route === "string"
      ? structured.handoff_route
      : null,
    hasChoices: "choices" in structured,
  };
}

function keysDeep(value: unknown, into: string[] = []): string[] {
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Json)) {
      into.push(key);
      keysDeep(nested, into);
    }
  }
  return into;
}

Deno.test({
  name:
    "#3184 T-A7 no-website read results never carry handoff_route or choices, and a hostile brand_id never reaches a route",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      for (
        const availability of [
          { available: false },
          { available: true, site: null },
        ]
      ) {
        await withFixture(
          { siteRow: null, availability },
          async (client, recorded) => {
            const result = await rawTool("get_brand_site").executor(
              TOOL_ARGS.get_brand_site,
              client,
              USER_ID,
            ) as Json;
            assertEquals(
              Object.keys(result),
              [
                "website_state",
                "brand_id",
                "can_create_from_chat",
                "setup_role",
                "setup_screen",
              ],
            );
            assertEquals(result.can_create_from_chat, false);
            const navigation = replayNavigation(result);
            assertEquals(navigation, { handoffRoute: null, hasChoices: false });
            const allKeys = keysDeep(result);
            assert(!allKeys.includes("handoff_route"), "nested handoff_route");
            assert(!allKeys.includes("choices"), "nested choices");
            assert(!allKeys.includes("pending_action_id"), "proposal key");
            if (availability.available) {
              assertEquals(
                (result.setup_screen as Json).route,
                `/brand/${BRAND_ID}/website`,
              );
            } else {
              assertEquals(result.setup_screen, null);
              assertEquals(result.setup_role, null);
            }
            assertEquals(recorded.warnings, []);
          },
        );
      }

      // A brand_id that is not a UUID never reaches brand-site-control and
      // never produces a website_state result with a route built from it.
      for (
        const hostile of [
          `${BRAND_ID}/../../admin`,
          "javascript:alert(1)",
          `${BRAND_ID}?next=/logout`,
        ]
      ) {
        await withFixture(
          { siteRow: null, availability: { available: true, site: null } },
          async (client, recorded) => {
            const error = await captureToolError(() =>
              rawTool("get_brand_site").executor(
                { brand_id: hostile },
                client,
                USER_ID,
              )
            );
            assertEquals(error.code, "INVALID_ARGS");
            assertEquals(recorded.controlRoutes, []);
          },
        );
      }
    }),
});
