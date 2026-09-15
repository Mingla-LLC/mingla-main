// #3184 [Ari no-website 500] — implementor happy path (T-I1..T-I5).
//
// A brand with no website must be a normal get_brand_site answer, not the
// SITE_SERVICE_UNAVAILABLE -> INTERNAL -> HTTP 500 that every website question
// produced. The seam under test is real: the pinned supabase-js@2.45.4 client
// (functions-js 2.4.1) invokes the in-process brand-site-control handler, and
// only PostgREST/Auth are answered by a fetch fixture.
//
// Fails on revert: restore `if (error) throw SITE_SERVICE_UNAVAILABLE` in
// agentSiteTools.ts and T-I1/T-I2 throw instead of returning a result.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleBrandSiteControl } from "../../brand-site-control/index.ts";
import { SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import {
  ARI_ERROR_REGISTRY,
  mapLegacyAriErrorCode,
} from "../agentReliability.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";

const SUPABASE_URL = "https://fixture-3184.supabase.co";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAND_ID = "5b6c1d2e-3f40-4a51-8b62-7c83d94ea5f6";
const SITE_ID = "90f19f28-42e2-4eb9-b88b-02829bfcb045";

type Availability =
  | { available: false }
  | { available: true; site: null }
  | { available: true; site: Record<string, unknown> };

interface Fixture {
  siteRow: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  availability: Availability;
}

interface Recorded {
  controlRoutes: string[];
  unexpected: string[];
  unavailableWarnings: string[];
}

function wantsObject(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes(
    "vnd.pgrst.object+json",
  );
}

// PostgREST answers for maybeSingle(): an object-mode request gets 406
// PGRST116 for zero rows; an array-mode request gets [] or [row].
function maybeSingleRows(
  request: Request,
  row: Record<string, unknown> | null,
): Response {
  if (wantsObject(request)) {
    return row ? Response.json(row) : Response.json({
      code: "PGRST116",
      details: "The result contains 0 rows",
      hint: null,
      message: "JSON object requested, multiple (or no) rows returned",
    }, { status: 406 });
  }
  return Response.json(row ? [row] : []);
}

async function withSitesFixture(
  fixture: Fixture,
  run: (
    execute: () => Promise<unknown>,
    recorded: Recorded,
  ) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalEnv = new Map(
    ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].map((
      name,
    ) => [name, Deno.env.get(name)]),
  );
  const recorded: Recorded = {
    controlRoutes: [],
    unexpected: [],
    unavailableWarnings: [],
  };

  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  console.warn = (...args: unknown[]) => {
    if (
      String(args[0]).includes("[agentSiteTools] sites control unavailable")
    ) {
      recorded.unavailableWarnings.push(args.map(String).join(" "));
    }
  };
  // Installed BEFORE any client exists: supabase-js captures fetch at creation.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/functions/v1/brand-site-control") {
      const body = await request.clone().json() as { route?: unknown };
      recorded.controlRoutes.push(String(body.route));
      return await handleBrandSiteControl(request);
    }
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "owner@example.invalid",
      });
    }
    if (url.pathname === "/rest/v1/brands") {
      return Response.json([{
        id: BRAND_ID,
        name: "Fixture Kitchen",
        slug: "fixture-kitchen",
        default_currency: "USD",
        cover_media_url: null,
      }]);
    }
    if (url.pathname === "/rest/v1/brand_team_members") {
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/brand_sites") {
      return maybeSingleRows(request, fixture.siteRow);
    }
    if (url.pathname === "/rest/v1/brand_site_operation_receipts") {
      return maybeSingleRows(request, fixture.receipt);
    }
    if (url.pathname === "/rest/v1/rpc/brand_site_business_availability") {
      return Response.json(fixture.availability);
    }
    recorded.unexpected.push(`${request.method} ${url.pathname}`);
    return Response.json({ message: "unexpected fixture request" }, {
      status: 599,
    });
  }) as typeof fetch;

  try {
    // Mirrors agent-chat's caller-scoped client.
    const client = createClient(SUPABASE_URL, "fixture-anon-key", {
      global: { headers: { Authorization: "Bearer fixture-user-jwt" } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const tool = SITE_AGENT_TOOLS.find((item) =>
      item.name === "get_brand_site"
    );
    assert(tool, "get_brand_site is not registered");
    await run(
      () => tool.executor({ brand_id: BRAND_ID }, client, USER_ID),
      recorded,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    for (const [name, value] of originalEnv) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

const NOT_AVAILABLE = {
  website_state: "not_available",
  brand_id: BRAND_ID,
  can_create_from_chat: false,
  setup_role: null,
  setup_screen: null,
};

const NOT_SET_UP = {
  website_state: "not_set_up",
  brand_id: BRAND_ID,
  can_create_from_chat: false,
  setup_role: "brand_admin_or_owner",
  setup_screen: {
    name: "Website",
    location: "Brand profile → Website",
    route: `/brand/${BRAND_ID}/website`,
  },
};

Deno.test({
  name:
    "#3184 T-I1 no-site non-pilot brand: get_brand_site resolves not_available, not an error",
  // Supabase Auth owns background timers even with session persistence off.
  // The fixture restores fetch, console.warn and env state in finally.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withSitesFixture(
      { siteRow: null, receipt: null, availability: { available: false } },
      async (execute, recorded) => {
        const result = await execute();
        // Exact keys in exact order.
        assertEquals(JSON.stringify(result), JSON.stringify(NOT_AVAILABLE));
        assertEquals(recorded.controlRoutes, [
          `/v1/brands/${BRAND_ID}/site`,
          `/v1/brands/${BRAND_ID}/site-availability`,
        ]);
        assertEquals(recorded.unavailableWarnings, []);
        assertEquals(recorded.unexpected, []);
      },
    );
  },
});

Deno.test({
  name:
    "#3184 T-I2 no-site pilot brand: get_brand_site resolves not_set_up with a nested Website screen",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withSitesFixture(
      {
        siteRow: null,
        receipt: null,
        availability: { available: true, site: null },
      },
      async (execute, recorded) => {
        const result = await execute() as Record<string, unknown>;
        assertEquals(JSON.stringify(result), JSON.stringify(NOT_SET_UP));
        assert(
          !("handoff_route" in result),
          "read result carries handoff_route",
        );
        assert(!("choices" in result), "read result carries choices");
        assertEquals(
          (result.setup_screen as { route: string }).route,
          `/brand/${BRAND_ID}/website`,
        );
        assertEquals(recorded.unavailableWarnings, []);
        assertEquals(recorded.unexpected, []);
      },
    );
  },
});

Deno.test({
  name:
    "#3184 T-I3 brand with a site: get_brand_site returns brand-site-control data unchanged",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const siteRow = {
      id: SITE_ID,
      brand_id: BRAND_ID,
      renderer_key: "restaurant-website-v1",
      renderer_version: 1,
      status: "draft",
      active_publication_id: null,
      last_successful_publication_id: null,
      provisioning_error_code: null,
      created_at: "2026-09-01T12:00:00.000Z",
      updated_at: "2026-09-02T12:00:00.000Z",
      brand_site_hosts: [],
    };
    const receipt = {
      operation_id: "2c1d8e4f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
      status: "succeeded",
      error_code: null,
      authorized_at: "2026-09-01T12:00:00.000Z",
      updated_at: "2026-09-01T12:01:00.000Z",
      result_summary: null,
    };
    await withSitesFixture(
      {
        siteRow,
        receipt,
        availability: { available: true, site: siteRow },
      },
      async (execute, recorded) => {
        const result = await execute();
        assertEquals(result, {
          ...siteRow,
          latest_provision_operation: receipt,
          menu_changed_since_publish: false,
        });
        assertEquals(recorded.controlRoutes, [`/v1/brands/${BRAND_ID}/site`]);
        assertEquals(recorded.unavailableWarnings, []);
        assertEquals(recorded.unexpected, []);
      },
    );
  },
});

Deno.test({
  name:
    "#3184 T-I4 site appears between the two reads: REVISION_CONFLICT maps to CONFLICT 409, never fabricated",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withSitesFixture(
      {
        siteRow: null,
        receipt: null,
        availability: {
          available: true,
          site: { id: SITE_ID, brand_id: BRAND_ID, status: "draft" },
        },
      },
      async (execute, recorded) => {
        let thrown: unknown = null;
        try {
          await execute();
        } catch (error) {
          thrown = error;
        }
        assert(
          thrown instanceof ToolError,
          `expected ToolError, got ${thrown}`,
        );
        assertEquals(thrown.code, "REVISION_CONFLICT");
        const mapped = mapLegacyAriErrorCode(thrown.code);
        assertEquals(mapped, "CONFLICT");
        assertEquals(ARI_ERROR_REGISTRY[mapped].httpStatus, 409);
        assertEquals(recorded.unavailableWarnings, []);
        assertEquals(recorded.unexpected, []);
      },
    );
  },
});

Deno.test({
  name: "#3184 T-I5 prompt carries the four no-website rules verbatim",
  // Pure prompt read, but Supabase Auth timers started by the fixture tests
  // above (or by an earlier file in the same deno test run) can complete
  // while this test runs, which the op sanitizer would misreport as a leak.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    assertEquals(PROMPT_VERSION, "v22"); // [TEST-MOD-APPROVED #1984] prompt bumped for analytics ads
    const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
    for (
      const line of [
        '- You cannot create, set up, or provision a website: no tool does that. Never offer to create or set up a website, never ask the user to confirm creating one, never describe a website as something you will build, and never use the "coming in a future update" phrase for websites.',
        "- For any request to create, start, or set up a website, and for any question about a brand's website, call get_brand_site for that brand first and answer from its result.",
        '- If get_brand_site returns website_state "not_set_up": say plainly that this brand has no website yet and that a brand admin or owner sets one up on the brand\'s Website screen (Brand profile → Website). Do not propose content, settings, media, previews, or publishing until a website exists.',
        '- If get_brand_site returns website_state "not_available": say plainly that Mingla websites aren\'t available for this brand right now. Do not point to a Website screen, do not promise a date, and do not suggest a workaround.',
      ]
    ) {
      assertStringIncludes(prompt, line);
    }
    const websiteRules = prompt.slice(prompt.indexOf("WEBSITE RULES:"));
    assert(
      websiteRules.indexOf("- You cannot create, set up, or provision") <
        websiteRules.indexOf("- Read the current page or settings revision"),
      "no-website rules must sit ahead of the edit rules",
    );
  },
});
