// #3614 [Confirming an Ari website change silently does nothing] — implementor
// happy suite.
//
// Proven in production on 2026-09-28: the operator confirmed
// "CONFIRM WEBSITE DRAFT — propose site content update" and nothing happened.
// The confirm DID reach the server. agent_pending_actions 7f88befc-…
// terminalized as `failed` with
// "FORBIDDEN: This Website action is not available for your role", and
// brand-site-control answered 403 at 14:41:39.117.
//
// The refusal was a lie. The proposal carried
// site_id = 044ac3b7-913d-4b6b-bcb4-e7c8c3b68837, which is the About PAGE's id
// (`get_site_page` had returned that page as `{ id, role: "about", slug, … }`
// at 10:47:27), while the brand's site is 90f19f28-…. `brand_sites` has no row
// with a page's id, so `brand_site_internal_authorize`'s
// `SELECT … INTO STRICT` raised, and brand-site-control's ari route answers
// EVERY error from that RPC with FORBIDDEN 403.
//
// This suite drives the real tool executors against the real in-process
// brand-site-control handler, with an authorize RPC that raises for an id that
// is not this brand's site exactly as the database does. It proves:
//
//   H1 — a draft proposal addressed with a page id still reaches the CMS, and
//        reaches it addressed to the BRAND'S site, in the route AND in the
//        payload the CMS reads.
//   H2 — the same holds for a read, which is what aborted every later turn in
//        that conversation (TURN_ABORTED at 14:42:44.678).
//   H3 — a correctly addressed call is untouched: one control call, no extra
//        authorize, no re-address.
//
// Fails on revert of agentSiteTools.ts (see the #3614 implementor report).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleBrandSiteControl } from "../../brand-site-control/index.ts";
import { SITE_AGENT_TOOLS } from "../agentSiteTools.ts";

const SUPABASE_URL = "https://fixture-3614-implementor.supabase.co";
const CMS_ORIGIN = "https://cms.fixture-3614.invalid";
const USER_ID = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const BRAND_ID = "733bc470-45e1-4684-8896-acd7e26074ff";
// The brand's real site, as `get_brand_site` reported it at 10:46:37.
const REAL_SITE_ID = "90f19f28-42e2-4eb9-b88b-02829bfcb045";
// The About PAGE's id, as `get_site_page` reported it at 10:47:27. This is the
// value the model then handed to propose_site_content_update as `site_id`.
const PAGE_ID = "044ac3b7-913d-4b6b-bcb4-e7c8c3b68837";
const OPERATION_ID = "7f88befc-661b-48ff-9797-60881e6c22b8";

type Json = Record<string, unknown>;

interface CmsCall {
  action: string;
  siteIdInRoute: string;
  siteIdInPayload: unknown;
  siteIdInArgs: unknown;
  brandId: unknown;
}

interface Recorded {
  controlRoutes: string[];
  authorizeSiteIds: string[];
  brandSitesReads: number;
  cms: CmsCall[];
}

function securityEnvelope(): string {
  const material = (byte: number) =>
    btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
  return JSON.stringify({
    schema_version: 1,
    core_to_cms_current_kid: "core-cms-current",
    core_to_cms_current_key_b64: material(21),
    core_to_cms_previous_kid: null,
    core_to_cms_previous_key_b64: null,
    cms_to_core_current_kid: "cms-core-current",
    cms_to_core_current_key_b64: material(22),
    cms_to_core_previous_kid: null,
    cms_to_core_previous_key_b64: null,
    runtime_to_core_current_kid: "runtime-core-current",
    runtime_to_core_current_key_b64: material(23),
    runtime_to_core_previous_kid: null,
    runtime_to_core_previous_key_b64: null,
    attribution_pepper_b64: material(24),
  });
}

const ENV_NAMES = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MINGLA_SITES_SECURITY_JSON",
];

type ToolClient = Parameters<
  (typeof SITE_AGENT_TOOLS)[number]["executor"]
>[1];

/**
 * The fixture's authorize RPC is the production one, narrowed to the branch
 * that matters: `SELECT * INTO STRICT v_site FROM brand_sites WHERE id = …`
 * raises `no_data_found` for an id that is not a site row, and the caller maps
 * every error from it to FORBIDDEN 403.
 */
async function withFixture<T>(
  options: { brandHasSite?: boolean },
  run: (client: ToolClient, recorded: Recorded) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalEnv = new Map(ENV_NAMES.map((n) => [n, Deno.env.get(n)]));
  const recorded: Recorded = {
    controlRoutes: [],
    authorizeSiteIds: [],
    brandSitesReads: 0,
    cms: [],
  };
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  Deno.env.set("MINGLA_SITES_SECURITY_JSON", securityEnvelope());
  console.warn = () => {};
  let lastControlRoute = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === CMS_ORIGIN) {
      const payload = await request.clone().json() as Json;
      const args = payload.args as Json | undefined;
      recorded.cms.push({
        action: String(payload.action ?? ""),
        siteIdInRoute: lastControlRoute.split("/")[3] ?? "",
        siteIdInPayload: payload.site_id,
        siteIdInArgs: args?.site_id,
        brandId: payload.brand_id,
      });
      return Response.json({ ok: true, data: { applied: true, revision: 6 } });
    }
    const path = url.pathname;
    if (path === "/functions/v1/brand-site-control") {
      const body = await request.clone().json() as { route?: unknown };
      lastControlRoute = String(body.route);
      recorded.controlRoutes.push(lastControlRoute);
      return await handleBrandSiteControl(request);
    }
    if (path === "/auth/v1/user") {
      return Response.json({
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "operator@example.invalid",
      });
    }
    if (path === "/rest/v1/rpc/brand_site_internal_authorize") {
      const body = await request.clone().json() as { p_site_id?: unknown };
      const siteId = String(body.p_site_id);
      recorded.authorizeSiteIds.push(siteId);
      if (siteId !== REAL_SITE_ID) {
        // plpgsql `SELECT … INTO STRICT` with no row.
        return Response.json({
          code: "P0002",
          message: "query returned no rows",
          details: null,
          hint: null,
        }, { status: 400 });
      }
      return Response.json({
        site_id: REAL_SITE_ID,
        brand_id: BRAND_ID,
        user_id: USER_ID,
        rank: 60,
        authorized: true,
      });
    }
    if (path === "/rest/v1/brands") {
      return Response.json([{
        id: BRAND_ID,
        name: "gögi",
        slug: "gogi",
        default_currency: "NGN",
        cover_media_url: null,
      }]);
    }
    if (path === "/rest/v1/brand_team_members") {
      return Response.json([]);
    }
    if (path === "/rest/v1/brand_sites") {
      recorded.brandSitesReads += 1;
      return Response.json(
        options.brandHasSite === false ? [] : [{ id: REAL_SITE_ID }],
      );
    }
    if (path === "/rest/v1/brand_site_service_config") {
      return Response.json([{ cms_origin: CMS_ORIGIN }]);
    }
    if (path === "/rest/v1/rpc/brand_site_mark_operation_ambiguous") {
      return Response.json(null);
    }
    throw new Error(`unexpected fixture request ${request.method} ${path}`);
  }) as typeof fetch;
  try {
    // Mirrors the caller-scoped client agent-confirm-action hands the executor.
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

function tool(name: string) {
  const found = SITE_AGENT_TOOLS.find((item) => item.name === name);
  assert(found, `${name} is not registered`);
  return found;
}

// The exact confirmed payload, copied from agent_pending_actions 7f88befc-….
function proposalArgs(siteId: string): Json {
  return {
    brand_id: BRAND_ID,
    site_id: siteId,
    page_role: "about",
    expected_revision: "5",
    change_summary: "Update SEO description on the About page",
    changes: {
      seo: {
        title: "About gögi — a 24/7 food house in Lekki",
        description:
          "Open 24 hours in Lagos for burgers, rice bowls, shawarma, smoothies and cocktails.",
      },
    },
  };
}

Deno.test({
  name:
    "#3614 H1 the confirmed draft edit reaches the CMS addressed to the brand's site, not the page id the model supplied",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withFixture({}, async (client, recorded) => {
      const result = await tool("propose_site_content_update").executor(
        proposalArgs(PAGE_ID),
        client,
        USER_ID,
        { operationId: OPERATION_ID },
      );

      // It APPLIED. In production this call died as FORBIDDEN and wrote
      // nothing at all.
      assertEquals(result, { applied: true, revision: 6 });

      // The wrong address was tried once and refused, then the call was
      // re-addressed to the brand's real site.
      assertEquals(recorded.authorizeSiteIds, [PAGE_ID, REAL_SITE_ID]);
      assertEquals(recorded.controlRoutes, [
        `/v1/sites/${PAGE_ID}/ari`,
        `/v1/sites/${REAL_SITE_ID}/ari`,
      ]);
      assertEquals(recorded.brandSitesReads, 1);

      // The CMS was contacted exactly once, and the page id never reached it —
      // not in the route, not in the envelope, not in the args the CMS reads.
      assertEquals(recorded.cms.length, 1);
      assertEquals(recorded.cms[0], {
        action: "propose_site_content_update",
        siteIdInRoute: REAL_SITE_ID,
        siteIdInPayload: REAL_SITE_ID,
        siteIdInArgs: REAL_SITE_ID,
        brandId: BRAND_ID,
      });
    });
  },
});

Deno.test({
  name:
    "#3614 H2 a read carrying the same poisoned id also lands, so the next turn in the conversation is not aborted",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withFixture({}, async (client, recorded) => {
      const result = await tool("get_site_page").executor(
        { brand_id: BRAND_ID, site_id: PAGE_ID, page_role: "about" },
        client,
        USER_ID,
        { operationId: null },
      );
      assertEquals(result, { applied: true, revision: 6 });
      assertEquals(recorded.cms.length, 1);
      assertEquals(recorded.cms[0].siteIdInRoute, REAL_SITE_ID);
      assertEquals(recorded.cms[0].action, "get_site_page");
    });
  },
});

Deno.test({
  name:
    "#3614 H3 a correctly addressed proposal is untouched — one control call, no second authorize, no brand_sites read",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withFixture({}, async (client, recorded) => {
      const result = await tool("propose_site_content_update").executor(
        proposalArgs(REAL_SITE_ID),
        client,
        USER_ID,
        { operationId: OPERATION_ID },
      );
      assertEquals(result, { applied: true, revision: 6 });
      assertEquals(recorded.authorizeSiteIds, [REAL_SITE_ID]);
      assertEquals(recorded.controlRoutes, [`/v1/sites/${REAL_SITE_ID}/ari`]);
      // The hot path costs nothing: the disambiguating read only happens after
      // a refusal that needs qualifying.
      assertEquals(recorded.brandSitesReads, 0);
      assertEquals(recorded.cms.length, 1);
      assertEquals(recorded.cms[0].siteIdInRoute, REAL_SITE_ID);
    });
  },
});
