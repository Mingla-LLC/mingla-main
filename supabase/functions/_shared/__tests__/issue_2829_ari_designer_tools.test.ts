// MINGLA-INVARIANT: I-PROPOSED-2829-15 | issue #2829 | Ari changes a website only through typed proposals generated from site-contracts that the owner confirms, each citing the owner's words, a Mingla record or the owner's media; Ari can never publish below rank 50, never mark a review as real, and never state a number, price, date or superlative Mingla cannot back.
// deno-lint-ignore-file require-await no-explicit-any -- fakes mirror async RPC/HTTP
/*
 * #2829 W9b — Ari as the website designer (agentSiteTools.ts + the
 * brand-site-control pieces it relies on).
 *
 *  T-W9 schema: Ari's tool schemas are GENERATED from site-contracts — every
 *    catalogue block and every design's layouts, the token roles, the menu's
 *    real maximum — with no markup fields, and only provider-safe keywords.
 *  T-W9 ranks: every Sites tool carries its rank (publish/rollback, plan,
 *    first draft, confirm-real need a brand admin; trip guide an event
 *    manager); a marketing manager is refused publish_site (R-15 / R-6).
 *  Confirm mechanism: every designer write needs the confirmed proposal's
 *    operation id; a proposal without a citation, with a review that isn't
 *    word for word the pasted text, or with a block the catalogue refuses is
 *    refused BEFORE a card is shown.
 *  Refusals: Studio's CLAIM_NOT_BACKED reaches Ari with the claim sentence, never as INTERNAL.
 *  Ari cannot set confirmed_real: no Ari tool's review data carries it, and
 *    the only confirm path is the owner's own card (content confirm_review).
 *  Not-entitled brands: the honest reply and an interest record; no site.
 *  create_site_draft: provision → compose → work log, in that order.
 *  Core: evidence for designer writes and design checks comes from Core's
 *    feed and brand row, never the caller; refusals are a closed set.
 */
import { assert, assertEquals, assertNotEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapLegacyAriErrorCode } from "../agentReliability.ts";
import {
  assertSiteToolArgs,
  REVIEW_CONFIRMATION_STATEMENT,
  SITE_AGENT_READ_ONLY,
  SITE_AGENT_TOOLS,
  SITE_AGENT_WRITES,
} from "../agentSiteTools.ts";
import { AGENT_TOOL_AUTHORIZATION, authorizeAgentTool } from "../agentToolAuthorization.ts";
import { compileGeminiToolDeclarations } from "../agentGemini.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { BLOCK_TYPES } from "../siteContracts/blocks.ts";
import { DESIGN_KEYS, DESIGNS } from "../siteContracts/designs.ts";
import { ARI_EXCLUDED_FIELDS } from "../siteContracts/ariToolSchemas.ts";
import { MAX_NAV_ITEMS } from "../siteContracts/limits.ts";
import { RAMP_ROLES, SINGLE_COLOR_ROLES } from "../siteContracts/tokens.ts";
import { ariFailureFrom, siteEvidence } from "../../brand-site-control/siteAri.ts";
import { handleSiteContentRoute, type SiteContentContext } from "../../brand-site-control/siteContent.ts";

const BRAND = "733bc470-45e1-4684-8896-acd7e26074ff";
const SITE = "11111111-1111-4111-8111-111111111111";
const USER = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const OP = "22222222-2222-4222-8222-222222222222";
const CITES = [{ kind: "owner_words", quote: "We take ten people on every trip" }];

function tool(name: string) {
  const found = SITE_AGENT_TOOLS.find((item) => item.name === name);
  assert(found, `${name} is not registered`);
  return found;
}

function props(name: string): Record<string, any> {
  return (tool(name).parameters as { properties: Record<string, any> }).properties;
}

// ---------------------------------------------------------------------------
// Schema generation
// ---------------------------------------------------------------------------

Deno.test("#2829 W9b composition blocks are generated from the catalogue: every type, every design's layouts", () => {
  const branches = props("propose_site_composition").pages.items.properties.blocks.items.anyOf as Array<Record<string, any>>;
  assertEquals(branches.map((branch) => branch.properties.type.enum[0]), [...BLOCK_TYPES]);
  for (const branch of branches) {
    const type = branch.properties.type.enum[0] as (typeof BLOCK_TYPES)[number];
    const layouts = new Set(DESIGN_KEYS.flatMap((key) => DESIGNS[key].variants[type]));
    assertEquals(new Set(branch.properties.variant.enum), layouts, `${type} layouts drifted`);
  }
  // The retired hand-written union described 15 blocks with a hero that
  // demanded a photo id named `media`; the generated one names it media_id.
  const hero = branches.find((branch) => branch.properties.type.enum[0] === "hero")!;
  assert("media_id" in hero.properties && !("media" in hero.properties), "hero picture is not the declared media_id");
  // Declared exclusions are absent, and nothing else is.
  const grid = branches.find((branch) => branch.properties.type.enum[0] === "offering_grid")!;
  assert(!("offerings" in grid.properties) && ARI_EXCLUDED_FIELDS["offering_grid.offerings"], "Mingla-owned offerings leaked into Ari's grid");
});

Deno.test("#2829 W9b schemas carry no markup fields, the menu's real maximum and the full token model", () => {
  const all = JSON.stringify(SITE_AGENT_TOOLS.map((item) => item.parameters));
  assert(!/"(html|css|style|script|className|typography)"/i.test(all), "a markup or retired field is in Ari's schemas");
  assertEquals(props("propose_site_composition").menu.maxItems, MAX_NAV_ITEMS);
  assert(MAX_NAV_ITEMS > 4, "the old nav_order maximum of 4 is back");
  const colors = props("propose_site_tokens").tokens.properties.colors.properties;
  assertEquals(Object.keys(colors).sort(), [...SINGLE_COLOR_ROLES, ...RAMP_ROLES].sort());
  // Provider-safe: compiles for the model (no const / oneOf / unsupported keywords).
  const compiled = compileGeminiToolDeclarations(SITE_AGENT_TOOLS.map((item) => ({ name: item.name, description: item.description, parameters: item.parameters })));
  assertEquals(compiled.length, SITE_AGENT_TOOLS.length);
});

Deno.test("#2829 W9b no Ari tool's review data can carry confirmed_real or show the review", () => {
  const review = props("propose_site_collection_entry").data.properties.review;
  assertEquals(review.additionalProperties, false);
  for (const key of ["confirmed_real", "confirmed_by", "confirmed_at", "enabled"]) {
    assert(!(key in review.properties), `review data exposes ${key}`);
  }
  assertEquals(props("confirm_site_review").statement.enum, [REVIEW_CONFIRMATION_STATEMENT]);
});

// ---------------------------------------------------------------------------
// Ranks
// ---------------------------------------------------------------------------

Deno.test("#2829 W9b every Sites tool carries its rank", () => {
  const expected: Record<string, string> = {
    save_site_plan_answers: "brand_admin",
    save_site_plan_design: "brand_admin",
    update_brand_context: "brand_admin",
    create_site_draft: "brand_admin",
    confirm_site_review: "brand_admin",
    publish_site: "brand_admin",
    rollback_site: "brand_admin",
    propose_trip_guide_update: "event_manager",
  };
  for (const item of SITE_AGENT_TOOLS) {
    const declaration = AGENT_TOOL_AUTHORIZATION[item.name];
    assert(declaration, `${item.name} has no authorization declaration`);
    assertEquals(declaration.requiredRole, expected[item.name] ?? "marketing_manager", item.name);
    assertEquals(declaration.resource, "brand", item.name);
  }
  assertEquals(SITE_AGENT_READ_ONLY.size + SITE_AGENT_WRITES.size, SITE_AGENT_TOOLS.length);
});

function rankClient(rank: number) {
  const ranks: Record<string, number> = { scanner: 10, marketing_manager: 20, finance_manager: 30, event_manager: 40, brand_admin: 50, brand_owner: 60 };
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "biz_brand_effective_rank_for_caller") return { data: rank, error: null };
      if (fn === "biz_role_rank") return { data: ranks[String(args.p_role)] ?? 0, error: null };
      return { data: null, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: BRAND }, error: null }), is: () => ({ maybeSingle: async () => ({ data: { id: BRAND }, error: null }) }) }) }) }),
  } as any;
}

const publishArgs = { brand_id: BRAND, site_id: SITE, expected_revision: "1", source_digest: "a".repeat(64), arguments_digest: "b".repeat(64) };

Deno.test("#2829 W9b a marketing manager may propose but is refused publish_site; a brand admin is not", async () => {
  const publish = { ...tool("publish_site"), ...AGENT_TOOL_AUTHORIZATION.publish_site };
  const error = await assertRejects(() => authorizeAgentTool(publish, publishArgs, rankClient(20), USER), ToolError);
  assertEquals(error.code, "ROLE_DENIED");
  await authorizeAgentTool(publish, publishArgs, rankClient(50), USER);
  const copy = { ...tool("propose_site_copy"), ...AGENT_TOOL_AUTHORIZATION.propose_site_copy };
  await authorizeAgentTool(copy, { brand_id: BRAND, site_id: SITE, page_path: "", expected_revision: "1", title: "Home", why: "x", cites: CITES }, rankClient(20), USER);
  // The authorization seam (proposal time and confirm time) runs the Sites proposal checks.
  const uncited = await assertRejects(() => authorizeAgentTool(copy, { brand_id: BRAND, site_id: SITE, page_path: "", expected_revision: "1", title: "Home", why: "x", cites: [] }, rankClient(60), USER), ToolError);
  assertEquals(uncited.code, "INVALID_ARGS");
  const guide = { ...tool("propose_trip_guide_update"), ...AGENT_TOOL_AUTHORIZATION.propose_trip_guide_update };
  const guideArgs = { brand_id: BRAND, trip_id: OP, expected_revision: "none", guide: { highlights: ["Surf"] }, why: "x", cites: CITES };
  assertEquals((await assertRejects(() => authorizeAgentTool(guide, guideArgs, rankClient(20), USER), ToolError)).code, "ROLE_DENIED");
  await authorizeAgentTool(guide, guideArgs, rankClient(40), USER);
});

// ---------------------------------------------------------------------------
// Proposal checks before a card shows, and the confirm mechanism
// ---------------------------------------------------------------------------

Deno.test("#2829 W9b a proposal without a citation, a reworded review or a refused block never reaches a card", () => {
  const refused = (name: string, args: Record<string, unknown>, text: string) => {
    let error: unknown = null;
    try {
      assertSiteToolArgs(name, args);
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof ToolError && error.code === "INVALID_ARGS", `${name} was not refused`);
    assertStringIncludes(error.message, text);
  };
  refused("propose_site_copy", { page_path: "", expected_revision: "1", title: "Home", why: "x", cites: [] }, "at least one citation");
  refused("propose_site_collection_entry", {
    collection: "testimonials", operation: "create", why: "x", cites: CITES,
    data: { review: { quote: "Best trip ever!", reviewer: "Alex" } }, owner_source_text: "Alex wrote: Ten strangers on day one.",
  }, "word for word");
  refused("propose_site_collection_entry", {
    collection: "testimonials", operation: "create", why: "x", cites: CITES, data: { review: { quote: "Ten strangers on day one." } },
  }, "owner_source_text");
  refused("propose_site_composition", {
    expected_site_revision: "a".repeat(64), why: "x", cites: CITES,
    pages: [{ page_path: "", blocks: [{ type: "hero", variant: "cover-bottom-search", heading: "<b>Hi</b>", media_id: OP, ctas: [] }] }],
  }, "plain text");
  refused("confirm_site_review", { review_id: "r", expected_revision: "1", statement: "ok" }, "word for word");
  // Reads and well-formed proposals pass.
  assertSiteToolArgs("get_site_tokens", {});
  assertSiteToolArgs("propose_site_collection_entry", {
    collection: "testimonials", operation: "create", why: "Pasted by the owner", cites: CITES,
    data: { review: { quote: "Ten strangers on day one." } }, owner_source_text: "Alex wrote:\nTen strangers   on day one.",
  });
});

type Invocation = { route: string; body: Record<string, unknown> };

function controlClient(answer: (body: Record<string, any>) => { status: number; body: unknown }) {
  const calls: Invocation[] = [];
  const client = {
    functions: {
      invoke: async (_name: string, options: { body: Record<string, any> }) => {
        calls.push({ route: String(options.body.route), body: options.body });
        const { status, body } = answer(options.body);
        if (status >= 300) {
          return { data: null, error: { name: "FunctionsHttpError", context: new Response(JSON.stringify(body), { status }) } };
        }
        return { data: body, error: null };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: SITE }], error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  } as any;
  return { client, calls };
}

Deno.test("#2829 W9b every designer write needs the confirmed proposal's operation id", async () => {
  const { client, calls } = controlClient(() => ({ status: 200, body: { ok: true, data: {} } }));
  for (const name of ["propose_site_copy", "propose_site_tokens", "propose_site_composition", "save_site_plan_answers", "create_site_draft", "confirm_site_review", "publish_site"]) {
    const error = await assertRejects(() => tool(name).executor({ brand_id: BRAND, site_id: SITE }, client, USER, { operationId: null }), ToolError);
    assertEquals(error.code, "OPERATION_ID_REQUIRED", name);
  }
  assertEquals(calls.length, 0, "a write reached brand-site-control without a confirmed proposal");
});

Deno.test("#2829 W9b Studio's CLAIM_NOT_BACKED reaches Ari with the claim sentence, never as INTERNAL", async () => {
  const { client, calls } = controlClient(() => ({
    status: 409,
    body: { ok: false, error: { code: "CLAIM_NOT_BACKED", message: "That copy says something Mingla can't back.", claims: ["Check: '500 travellers' isn't backed by anything in Mingla"] } },
  }));
  const error = await assertRejects(() => tool("propose_site_copy").executor({
    brand_id: BRAND, site_id: SITE, page_path: "", expected_revision: "3", why: "x", cites: CITES,
    edits: [{ block_index: 0, field: "heading", value: "500 travellers and counting" }],
  }, client, USER, { operationId: OP }), ToolError);
  // An envelope code every app knows; the claim travels in the sentence.
  assertEquals(error.code, "VALIDATION_FAILED");
  assertNotEquals(mapLegacyAriErrorCode(error.code), "INTERNAL");
  assertStringIncludes(error.message, "That copy says something Mingla can't back.");
  assertStringIncludes(error.message, "Check: '500 travellers' isn't backed by anything in Mingla");
  assertEquals(calls[0]!.route, `/v1/sites/${SITE}/ari`);
  assertEquals(calls[0]!.body.action, "propose_site_copy");
  assertEquals((calls[0]!.body.args as Record<string, unknown>).cites, CITES);
});

Deno.test("#2829 W9b the confirm-real card is the owner's own content confirm (never Ari's designer path)", async () => {
  const { client, calls } = controlClient(() => ({ status: 200, body: { ok: true, data: { entry: { id: "r3", confirmed: true } } } }));
  await tool("confirm_site_review").executor({
    brand_id: BRAND, site_id: SITE, review_id: "r3", expected_revision: "rev", statement: REVIEW_CONFIRMATION_STATEMENT,
  }, client, USER, { operationId: OP });
  assertEquals(calls.map((call) => call.route), [`/v1/sites/${SITE}/content`]);
  assertEquals(calls[0]!.body.action, "confirm_review");
  assertEquals(calls[0]!.body.args, { id: "r3", expected_revision: "rev", confirmed: true });
});

Deno.test("#2829 W9b not-entitled brands get the honest reply and an interest record; no site is made", async () => {
  const { client, calls } = controlClient((body) => {
    if (String(body.route).endsWith("/site-availability")) return { status: 200, body: { ok: true, data: { available: false } } };
    if (String(body.route).endsWith("/site-interest")) return { status: 200, body: { ok: true, data: { recorded: true, entitled: false } } };
    return { status: 500, body: null };
  });
  const result = await tool("create_site_draft").executor({ brand_id: BRAND, why: "x", cites: CITES }, client, USER, { operationId: OP }) as Record<string, unknown>;
  assertEquals(result.website_state, "not_available");
  assertStringIncludes(String(result.reply), "Websites are opening brand by brand");
  assertEquals(result.interest_recorded, true);
  assertEquals(calls.map((call) => call.route), [`/v1/brands/${BRAND}/site-availability`, `/v1/brands/${BRAND}/site-interest`]);
});

Deno.test("#2829 W9b create_site_draft provisions, then composes from the plan, then logs why", async () => {
  let provisioned = false;
  const { client, calls } = controlClient((body) => {
    const route = String(body.route);
    if (route.endsWith("/site-availability")) return { status: 200, body: { ok: true, data: { available: true, site: null } } };
    if (route === `/v1/brands/${BRAND}/site` && body.method === "GET") {
      return provisioned
        ? { status: 200, body: { ok: true, data: { id: SITE, status: "draft" } } }
        : { status: 404, body: { ok: false, error: { code: "NOT_FOUND" } } };
    }
    if (route === `/v1/brands/${BRAND}/site` && body.method === "POST") {
      provisioned = true;
      return { status: 200, body: { ok: true, data: { site_id: SITE } } };
    }
    if (route.endsWith("/compose-from-plan")) return { status: 200, body: { ok: true, data: { pages: ["home", "trips", "about", "contact"] } } };
    if (route === `/v1/sites/${SITE}/ari`) return { status: 200, body: { ok: true, data: { work_log_id: "w1" } } };
    return { status: 500, body: null };
  });
  const result = await tool("create_site_draft").executor({ brand_id: BRAND, why: "The owner approved the plan.", cites: CITES }, client, USER, { operationId: OP }) as Record<string, unknown>;
  assertEquals(result, { website_state: "draft", site_id: SITE, pages: ["home", "trips", "about", "contact"], draft_only: true, work_log_saved: true });
  assertEquals(calls.map((call) => `${call.body.method} ${call.route}`), [
    `GET /v1/brands/${BRAND}/site-availability`,
    `GET /v1/brands/${BRAND}/site`,
    `POST /v1/brands/${BRAND}/site`,
    `GET /v1/brands/${BRAND}/site`,
    `POST /v1/brands/${BRAND}/site/compose-from-plan`,
    `POST /v1/sites/${SITE}/ari`,
  ]);
  assertEquals(calls[2]!.body.operation_id, OP, "provision is bound to the confirmed proposal");
  assertEquals(calls[5]!.body.action, "log_work");
  assertEquals((calls[5]!.body.args as Record<string, unknown>).part, "draft");
});

// ---------------------------------------------------------------------------
// Core: evidence and refusals
// ---------------------------------------------------------------------------

Deno.test("#2829 W9b Core's evidence is its own feed and brand row; unreadable → none (fail closed)", async () => {
  const feed = { offerings: [{ id: OP, kind: "trip", title: "Bali Escape", slug: "bali", min_price_minor: 120000, currency: "GBP", capacity: 12, spots_left: 4, public_url: "x", cover: { path: "secret" } }] };
  const evidence = await siteEvidence(async () => ({ data: feed, error: null }), async () => ({ id: BRAND, name: "Y&S", description: "Since 2019", city: "London" }), SITE, BRAND);
  assertEquals(evidence?.brand, { id: BRAND, name: "Y&S", description: "Since 2019", city: "London" });
  assertEquals(evidence?.offerings[0]?.title, "Bali Escape");
  assert(!("cover" in (evidence?.offerings[0] ?? {})) && !("public_url" in (evidence?.offerings[0] ?? {})), "evidence carries more than the truth check needs");
  assertEquals(await siteEvidence(async () => ({ data: null, error: { message: "down" } }), async () => ({ id: BRAND }), SITE, BRAND), null);
  assertEquals(await siteEvidence(async () => ({ data: feed, error: null }), async () => null, SITE, BRAND), null);
});

Deno.test("#2829 W9b Studio refusals pass to Ari as a closed set with bounded detail", async () => {
  const claim = await ariFailureFrom({ ok: false, error: { code: "CLAIM_NOT_BACKED", claims: ["Check: 'best' isn't backed by anything in Mingla"], secret: "x" } }, 409).json();
  assertEquals(claim.error.code, "CLAIM_NOT_BACKED");
  assertEquals(claim.error.claims, ["Check: 'best' isn't backed by anything in Mingla"]);
  assert(!("secret" in claim.error), "unbounded detail passed through");
  const unknown = ariFailureFrom({ ok: false, error: { code: "DROP TABLE" } }, 500);
  assertEquals(unknown.status, 503);
  assertEquals((await unknown.json()).error.code, "SERVICE_TEMPORARILY_UNAVAILABLE");
  assertEquals(ariFailureFrom({ ok: false, error: { code: "PAGE_NOT_FOUND" } }, 404).status, 404);
});

Deno.test("#2829 W9b the Publish review's design checks get Core's evidence, never the caller's", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const ctx: SiteContentContext = {
    userId: USER,
    userRpc: async () => ({ data: { site_id: SITE, brand_id: BRAND, user_id: USER, rank: 20 }, error: null }),
    serviceRpc: async (fn) => fn === "brand_site_offerings_feed" ? { data: { offerings: [] }, error: null } : { data: null, error: null },
    callCmsRaw: async ({ payload }) => {
      sent.push(payload);
      return { status: 200, body: { ok: true, data: { draft_digest: "d".repeat(64), warning_count: 0, checks: [] } } };
    },
    activeArtifactKey: async () => null,
    tripCovers: async () => ({}),
    readBrand: async () => ({ id: BRAND, name: "Y&S", description: null, city: null }),
  };
  const response = await handleSiteContentRoute(`/v1/sites/${SITE}/content`, "POST", {
    action: "design_checks", operation_id: OP, args: { evidence: { brand: { id: BRAND, name: "Award-winning #1" }, offerings: [] } },
  }, ctx);
  assertEquals(response?.status, 200);
  const args = sent[0]!.args as { evidence: { brand: { name: string } } };
  assertEquals(args.evidence.brand.name, "Y&S");
  const noBrand = await handleSiteContentRoute(`/v1/sites/${SITE}/content`, "POST", { action: "design_checks", operation_id: OP, args: {} }, { ...ctx, readBrand: async () => null });
  assertEquals(noBrand?.status, 503);
});

Deno.test("#2829 W9b no named Sites refusal ever reaches the app as INTERNAL", async () => {
  const named = [
    "NOT_ENTITLED", "PLAN_LOCKED", "PLAN_NOT_READY", "PLAN_PAUSED", "NO_ADMIN", "REVIEW_NOT_CONFIRMED", "TITLE_REQUIRED",
    "QUOTE_REQUIRED", "SLUG_TAKEN", "SLUG_INVALID", "CATEGORY_IN_USE", "CONTENT_LIMIT_EXCEEDED", "OFFERING_NOT_FOUND",
    "TRIP_NOT_ENDED", "VIDEO_TOO_LONG", "CLAIM_NOT_BACKED", "CITATION_REQUIRED", "CITATION_INVALID", "VARIANT_NOT_IN_DESIGN",
    "MEDIA_NOT_FOUND", "MEDIA_WRONG_KIND", "OWNER_SOURCE_REQUIRED", "REVIEW_SOURCE_MISMATCH", "PAGE_NOT_FOUND", "PATH_COLLISION",
  ];
  for (const code of named) {
    const { client } = controlClient(() => ({ status: 409, body: { ok: false, error: { code, message: `Core sentence for ${code}.` } } }));
    const error = await assertRejects(() => tool("propose_site_tokens").executor({
      brand_id: BRAND, site_id: SITE, expected_revision: "r", design: "voyage", why: "x", cites: CITES,
    }, client, USER, { operationId: OP }), ToolError);
    assertNotEquals(mapLegacyAriErrorCode(error.code), "INTERNAL", code);
    assertStringIncludes(error.message, `Core sentence for ${code}.`);
  }
});
