// #3614 [Confirming an Ari website change silently does nothing] — tester
// adversarial suite.
//
// The implementor suite proves the repair: a Website call addressed with a
// page id is re-addressed to the brand's own site and lands. This suite
// attacks the repair from the other side, because "retry a refusal" is exactly
// the shape of change that turns a safe no into an unsafe yes, or turns one
// refused write into two applied ones.
//
// The repair is allowed to re-address ONLY a refusal that brand-site-control
// raised at its own pre-flight gate, before it signed anything for the CMS.
// That is the 403. A refusal the CMS itself reported comes back as 409, and by
// then the CMS has already seen the request — retrying THAT is a double write.
//
//   A1 — a genuine role refusal is never converted into a success: when the
//        brand's site IS the site that was refused, the refusal stands
//        verbatim, the CMS is never contacted, and the wire envelope is
//        unchanged.
//   A2 — a CMS-reported FORBIDDEN (409) is never re-addressed, even when the
//        brand's site is a different site. One request reaches the control.
//   A3 — an unreadable `brand_sites` (hidden by RLS, a PostgREST error, a
//        transport throw, or a client with no PostgREST surface at all) leaves
//        the original refusal exactly as it was — never an outage, never a
//        success, never a second and less honest refusal.
//   A4 — the re-address is bounded: a control that refuses every address is
//        asked at most twice, never in a loop.
//   A5 — nothing the operator or the monitor sees carries an id.
//
// Fails on revert of agentSiteTools.ts (see the #3614 tester report).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import {
  ariErrorResponse,
  runWithAriRequest,
} from "../agentReliabilityHttp.ts";

const SUPABASE_URL = "https://fixture-3614-tester.supabase.co";
const USER_ID = "d2e3f4a5-b6c7-4d8e-9f01-a2b3c4d5e6f7";
const BRAND_ID = "733bc470-45e1-4684-8896-acd7e26074ff";
const REAL_SITE_ID = "90f19f28-42e2-4eb9-b88b-02829bfcb045";
const PAGE_ID = "044ac3b7-913d-4b6b-bcb4-e7c8c3b68837";
const OPERATION_ID = "7f88befc-661b-48ff-9797-60881e6c22b8";
const CLIENT_TURN_ID = "db179a65-829a-4882-b2b6-32bb48291b74";
const ROLE_MESSAGE = "This Website action is not available for your role.";

type Json = Record<string, unknown>;

type BrandSitesAnswer =
  | { kind: "row"; siteId: string }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "throw" };

interface Script {
  control: (route: string, callIndex: number) => Response;
  brandSites: BrandSitesAnswer;
}

interface Recorded {
  controlRoutes: string[];
  brandSitesReads: number;
  cmsCalls: number;
  warnings: string[];
}

type ToolClient = Parameters<
  (typeof SITE_AGENT_TOOLS)[number]["executor"]
>[1];

function refusal(code: string, status: number): Response {
  return Response.json({
    ok: false,
    error: {
      code,
      message: code === "FORBIDDEN"
        ? ROLE_MESSAGE
        : "Website information is not available.",
      retryable: false,
      operation_id: null,
    },
  }, { status });
}

async function withFixture<T>(
  script: Script,
  run: (client: ToolClient, recorded: Recorded) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalUrl = Deno.env.get("SUPABASE_URL");
  const recorded: Recorded = {
    controlRoutes: [],
    brandSitesReads: 0,
    cmsCalls: 0,
    warnings: [],
  };
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  console.warn = (...args: unknown[]) => {
    recorded.warnings.push(args.map(String).join(" "));
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/functions/v1/brand-site-control") {
      const body = await request.clone().json() as { route?: unknown };
      const route = String(body.route);
      const index = recorded.controlRoutes.length;
      recorded.controlRoutes.push(route);
      return script.control(route, index);
    }
    if (path === "/rest/v1/brand_sites") {
      recorded.brandSitesReads += 1;
      switch (script.brandSites.kind) {
        case "row":
          return Response.json([{ id: script.brandSites.siteId }]);
        case "empty":
          return Response.json([]);
        case "error":
          return Response.json({
            code: "42501",
            message: "permission denied for table brand_sites",
            details: null,
            hint: null,
          }, { status: 403 });
        case "throw":
          throw new TypeError("error sending request: connection reset");
      }
    }
    recorded.cmsCalls += 1;
    throw new Error(`unexpected fixture request ${request.method} ${path}`);
  }) as typeof fetch;
  try {
    const client = createClient(SUPABASE_URL, "fixture-anon-key", {
      global: { headers: { Authorization: "Bearer fixture-user-jwt" } },
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as ToolClient;
    return await run(client, recorded);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", originalUrl);
  }
}

function tool(name: string) {
  const found = SITE_AGENT_TOOLS.find((item) => item.name === name);
  assert(found, `${name} is not registered`);
  return found;
}

const PROPOSAL: Json = {
  brand_id: BRAND_ID,
  site_id: PAGE_ID,
  page_role: "about",
  expected_revision: "5",
  change_summary: "Update SEO description on the About page",
  changes: { seo: { description: "Open 24 hours in Lagos." } },
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
        ? `a RESOLVED value ${JSON.stringify(value)}`
        : String(outcome)
    }`,
  );
  return outcome;
}

async function wire(error: ToolError): Promise<{ status: number; body: Json }> {
  return await runWithAriRequest(
    { requestIdHeader: null, clientTurnId: CLIENT_TURN_ID, executionId: null },
    async () => {
      const response = ariErrorResponse(403, error.code, error.message);
      return { status: response.status, body: await response.json() as Json };
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

function propose(client: ToolClient): Promise<unknown> {
  return tool("propose_site_content_update").executor(
    PROPOSAL,
    client,
    USER_ID,
    { operationId: OPERATION_ID },
  );
}

Deno.test({
  name:
    "#3614 A1 a genuine role refusal on the brand's OWN site is never re-addressed and never becomes a success",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      // The operator really is below the floor. The site they addressed IS the
      // brand's site, so there is no wrong address to correct.
      await withFixture({
        control: () => refusal("FORBIDDEN", 403),
        brandSites: { kind: "row", siteId: PAGE_ID },
      }, async (client, recorded) => {
        const error = await captureToolError(() => propose(client));
        assertEquals(error.code, "FORBIDDEN");
        assertEquals(error.message, ROLE_MESSAGE);
        // Asked once, refused once, asked the authoritative question once,
        // and stopped.
        assertEquals(recorded.controlRoutes, [`/v1/sites/${PAGE_ID}/ari`]);
        assertEquals(recorded.brandSitesReads, 1);
        assertEquals(recorded.cmsCalls, 0);
        const { status, body } = await wire(error);
        assertEquals(status, 403);
        assertEquals(body.code, "FORBIDDEN");
        assertEquals(body.retryability, "never");
        assertEquals(body.kind, "error");
      });
    }),
});

Deno.test({
  name:
    "#3614 A2 a CMS-reported FORBIDDEN (409) is never re-addressed — the CMS has already seen the request",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      // brand-site-control relays a refusal the CMS raised as 409. The brand's
      // real site IS a different site, so the ONLY thing holding the retry back
      // is the status discriminator. If that is lost, a proposal the CMS
      // already processed is sent a second time.
      await withFixture({
        control: () => refusal("FORBIDDEN", 409),
        brandSites: { kind: "row", siteId: REAL_SITE_ID },
      }, async (client, recorded) => {
        const error = await captureToolError(() => propose(client));
        assertEquals(error.code, "FORBIDDEN");
        assertEquals(recorded.controlRoutes, [`/v1/sites/${PAGE_ID}/ari`]);
        // Not even the disambiguating read runs: a 409 is not this repair's
        // business at all.
        assertEquals(recorded.brandSitesReads, 0);
      });

      // Neither is any other 409 refusal code.
      for (const code of ["NOT_FOUND", "REVISION_CONFLICT", "INVALID_STATE"]) {
        await withFixture({
          control: () => refusal(code, 409),
          brandSites: { kind: "row", siteId: REAL_SITE_ID },
        }, async (client, recorded) => {
          const error = await captureToolError(() => propose(client));
          assertEquals(error.code, code, code);
          assertEquals(recorded.controlRoutes.length, 1, code);
          assertEquals(recorded.brandSitesReads, 0, code);
        });
      }
    }),
});

Deno.test({
  name:
    "#3614 A3 an unreadable brand_sites leaves the original refusal verbatim — never an outage, never a success",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      const answers: Array<[string, BrandSitesAnswer]> = [
        ["RLS hides the row", { kind: "empty" }],
        ["PostgREST refuses the read", { kind: "error" }],
        ["the read's transport dies", { kind: "throw" }],
      ];
      for (const [label, brandSites] of answers) {
        await withFixture({
          control: () => refusal("FORBIDDEN", 403),
          brandSites,
        }, async (client, recorded) => {
          const error = await captureToolError(() => propose(client));
          // The refusal Ari could not qualify is passed on exactly as it
          // arrived — it is NOT replaced by SITE_SERVICE_UNAVAILABLE, which
          // would blame an outage for a refusal that really happened.
          assertEquals(error.code, "FORBIDDEN", label);
          assertEquals(error.message, ROLE_MESSAGE, label);
          assertEquals(recorded.controlRoutes.length, 1, label);
          assertEquals(recorded.brandSitesReads, 1, label);
        });
      }

      // A client with no PostgREST surface at all must not turn a refusal into
      // a TypeError escaping as a non-ToolError.
      const noPostgrest = {
        functions: {
          invoke: () =>
            Promise.resolve({
              data: {
                ok: false,
                error: { code: "FORBIDDEN", message: ROLE_MESSAGE },
              },
              error: null,
            }),
        },
      };
      const error = await captureToolError(() =>
        propose(noPostgrest as unknown as ToolClient)
      );
      assertEquals(error.code, "FORBIDDEN");
    }),
});

Deno.test({
  name: "#3614 A4 the re-address is bounded to one extra attempt, never a loop",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      await withFixture({
        // Refuses EVERY address, including the brand's real one.
        control: () => refusal("FORBIDDEN", 403),
        brandSites: { kind: "row", siteId: REAL_SITE_ID },
      }, async (client, recorded) => {
        const error = await captureToolError(() => propose(client));
        assertEquals(error.code, "FORBIDDEN");
        assertEquals(error.message, ROLE_MESSAGE);
        assertEquals(recorded.controlRoutes, [
          `/v1/sites/${PAGE_ID}/ari`,
          `/v1/sites/${REAL_SITE_ID}/ari`,
        ]);
        // One disambiguating read, not one per attempt.
        assertEquals(recorded.brandSitesReads, 1);
      });
    }),
});

Deno.test({
  name:
    "#3614 A5 neither the operator's message nor the monitor line carries a brand, site or user id",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    silenceTelemetry(async () => {
      await withFixture({
        control: () => refusal("FORBIDDEN", 403),
        brandSites: { kind: "row", siteId: REAL_SITE_ID },
      }, async (client, recorded) => {
        const error = await captureToolError(() => propose(client));
        const { body } = await wire(error);
        const serialized = JSON.stringify(body) + error.message +
          recorded.warnings.join(" ");
        for (const token of [BRAND_ID, REAL_SITE_ID, PAGE_ID, USER_ID]) {
          assert(!serialized.includes(token), `leaked ${token}`);
        }
        // The correction IS reported — a silent repair is its own blind spot.
        const corrections = recorded.warnings.filter((line) =>
          line.includes("sites address corrected")
        );
        assertEquals(corrections.length, 1);
        assert(
          corrections[0].includes("site_id_is_not_this_brands_site"),
          "the monitor line does not say what was corrected",
        );
      });
    }),
});
