// deno-lint-ignore-file require-await -- the fakes mirror async RPC and HTTP
/*
 * #2829 W9r — the Website content routes of brand-site-control: Core checks
 * the member's rank for the action BEFORE Studio is called, sends Studio only
 * Core's own site/brand/member/rank (never a caller's), checks every Mingla
 * offering id against the brand's own feed (a hidden trip must have ended),
 * audits a change only after Studio confirmed it (never the words), and turns
 * a stale save into "<Name> saved a newer version" with the latest revision.
 */
import { handleSiteContentRoute, type SiteContentContext } from "../../brand-site-control/siteContent.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const BRAND = "733bc470-45e1-4684-8896-acd7e26074ff";
const OTHER_BRAND = "99999999-9999-4999-8999-999999999999";
const SITE = "11111111-1111-4111-8111-111111111111";
const USER = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const MATE = "d1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const OP = "22222222-2222-4222-8222-222222222222";
const ENDED_TRIP = "33333333-3333-4333-8333-333333333333";
const UPCOMING_TRIP = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-10-26T12:00:00Z");

type Call = { fn: string; args: Record<string, unknown> };

const feed = {
  offerings: [
    { id: ENDED_TRIP, kind: "trip", title: "Coast Week", slug: "coast", start_at: "2025-06-20T00:00:00Z", end_at: "2025-06-27T00:00:00Z", timezone: "UTC", status: "ended", capacity: 12, spots_left: 2, destination_text: "Coast", public_url: "https://host.usemingla.com/t/b/coast" },
    { id: UPCOMING_TRIP, kind: "trip", title: "Island Week", slug: "island", start_at: "2027-06-20T00:00:00Z", end_at: "2027-06-27T00:00:00Z", timezone: "UTC", status: "scheduled", capacity: null, spots_left: null, destination_text: null, public_url: "https://host.usemingla.com/t/b/island" },
  ],
};

function fakes(options: {
  rank?: number;
  authError?: string;
  cms?: (payload: Record<string, unknown>) => { status: number; body: Record<string, unknown> | null } | null;
} = {}) {
  const userCalls: Call[] = [];
  const serviceCalls: Call[] = [];
  const cmsCalls: Array<Record<string, unknown>> = [];
  const ctx: SiteContentContext = {
    userId: USER,
    now: () => NOW,
    userRpc: async (fn, args) => {
      userCalls.push({ fn, args });
      if (fn === "brand_site_content_authorize") {
        if (options.authError) return { data: null, error: { message: options.authError } };
        return { data: { site_id: SITE, brand_id: BRAND, user_id: USER, rank: options.rank ?? 60 }, error: null };
      }
      return { data: { notified: 2 }, error: null };
    },
    serviceRpc: async (fn, args) => {
      serviceCalls.push({ fn, args });
      if (fn === "brand_site_offerings_feed") return { data: feed, error: null };
      if (fn === "brand_site_content_person_name") return { data: "Ada", error: null };
      return { data: null, error: null };
    },
    callCmsRaw: async ({ payload }) => {
      cmsCalls.push(payload);
      if (options.cms) return options.cms(payload);
      if (payload.action === "get_display") {
        return { status: 200, body: { ok: true, data: { revision: "r1", hidden_offering_ids: [ENDED_TRIP] } } };
      }
      return { status: 200, body: { ok: true, data: { entry: { id: "7" }, audit: { action: "content.created", collection: "destinations", entry: "7" } } } };
    },
    tripCovers: async () => ({ [ENDED_TRIP]: "https://cdn.example.invalid/coast.jpg" }),
    activeArtifactKey: async () => `publications/${SITE}/live/abc.json`,
  };
  return { ctx, userCalls, serviceCalls, cmsCalls };
}

async function json(response: Response | null): Promise<Record<string, unknown>> {
  assert(response, "route not handled");
  return await response.json();
}

const route = `/v1/sites/${SITE}/content`;

Deno.test("#2829 W9r Core checks the rank for the action before Studio is called", async () => {
  const { ctx, userCalls, cmsCalls } = fakes({ authError: "sites_forbidden" });
  const response = await handleSiteContentRoute(route, "POST", { action: "confirm_review", operation_id: OP, args: { id: "9", confirmed: true, expected_revision: "x" } }, ctx);
  assert(response?.status === 403, "a refused rank was not 403");
  assert(userCalls[0]?.fn === "brand_site_content_authorize" && userCalls[0].args.p_action === "confirm_review", "the gate was not asked for this action");
  assert(cmsCalls.length === 0, "Studio was called although Core refused");
  const body = await json(response);
  assert((body.error as Record<string, unknown>).code === "FORBIDDEN", "wrong refusal code");
});

Deno.test("#2829 W9r Studio receives Core's own site, brand, member and rank — never the caller's", async () => {
  const { ctx, cmsCalls } = fakes({ rank: 20 });
  await handleSiteContentRoute(route, "POST", {
    action: "create",
    operation_id: OP,
    brand_id: OTHER_BRAND,
    user_id: MATE,
    rank: 60,
    args: { collection: "destinations", data: { title: "France" } },
  }, ctx);
  const sent = cmsCalls[0]!;
  assert(sent.site_id === SITE && sent.brand_id === BRAND && sent.user_id === USER && sent.rank === 20,
    `Studio got caller-supplied identity: ${JSON.stringify(sent)}`);
  assert(Object.keys(sent).sort().join(",") === "action,args,brand_id,rank,site_id,user_id", "unexpected keys sent to Studio");
});

Deno.test("#2829 W9r a change is audited only after Studio confirmed it, without its words", async () => {
  const ok = fakes();
  const response = await json(await handleSiteContentRoute(route, "POST", { action: "create", operation_id: OP, args: { collection: "destinations", data: { title: "France" } } }, ok.ctx));
  const audit = ok.serviceCalls.find((call) => call.fn === "brand_site_content_record");
  assert(audit && audit.args.p_action === "content.created" && audit.args.p_entry === "7" && audit.args.p_actor === USER, "change not audited");
  assert(JSON.stringify(audit.args).indexOf("France") === -1, "the audit carried the entry's words");
  assert(!("audit" in (response.data as Record<string, unknown>)), "the audit note leaked to the app");

  const refused = fakes({ cms: () => ({ status: 409, body: { ok: false, error: { code: "REVIEW_NOT_CONFIRMED" } } }) });
  const body = await json(await handleSiteContentRoute(route, "POST", { action: "set_visibility", operation_id: OP, args: { collection: "testimonials", id: "9", enabled: true, expected_revision: "r" } }, refused.ctx));
  assert((body.error as Record<string, unknown>).code === "REVIEW_NOT_CONFIRMED", "Studio's named refusal did not reach the app");
  assert(!refused.serviceCalls.some((call) => call.fn === "brand_site_content_record"), "a refused change was audited");
});

Deno.test("#2829 W9r a stale save names the teammate and returns the latest revision", async () => {
  const { ctx } = fakes({ cms: () => ({ status: 409, body: { ok: false, error: { code: "REVISION_CONFLICT", latest: { revision: "2026-10-26T11:58:00.000Z", updated_by: MATE, updated_at: "2026-10-26T11:58:00.000Z" } } } }) });
  const response = await handleSiteContentRoute(route, "POST", { action: "update", operation_id: OP, args: { collection: "stories", id: "3", expected_revision: "old", data: { title: "x" } } }, ctx);
  assert(response?.status === 409, "conflict was not 409");
  const error = (await json(response)).error as Record<string, unknown>;
  const latest = error.latest as Record<string, unknown>;
  assert(error.code === "REVISION_CONFLICT" && latest.updated_by_name === "Ada" && latest.revision === "2026-10-26T11:58:00.000Z", "conflict lacks the name or revision");
  assert(!("updated_by" in latest), "the teammate's user id reached the app");
});

Deno.test("#2829 W9r offering ids must be the brand's own; only an ENDED trip can be hidden", async () => {
  const foreign = fakes();
  const notOurs = await handleSiteContentRoute(route, "POST", { action: "update", operation_id: OP, args: { collection: "destinations", id: "7", expected_revision: "r", data: { related_offerings: ["55555555-5555-4555-8555-555555555555"] } } }, foreign.ctx);
  assert(notOurs?.status === 409 && ((await json(notOurs)).error as Record<string, unknown>).code === "OFFERING_NOT_FOUND", "a foreign trip was linked");
  assert(foreign.cmsCalls.length === 0, "Studio was called with a foreign trip");

  const upcoming = fakes();
  const refused = await handleSiteContentRoute(route, "POST", { action: "set_offering_visibility", operation_id: OP, args: { offering_id: UPCOMING_TRIP, hidden: true, expected_revision: "r1" } }, upcoming.ctx);
  assert(((await json(refused)).error as Record<string, unknown>).code === "TRIP_NOT_ENDED", "an upcoming trip was hidden");

  const ended = fakes({ cms: () => ({ status: 200, body: { ok: true, data: { revision: "r2", hidden_offering_ids: [ENDED_TRIP], audit: { action: "content.offering_visibility", collection: "offerings", entry: ENDED_TRIP, visible: false } } } }) });
  const hidden = await json(await handleSiteContentRoute(route, "POST", { action: "set_offering_visibility", operation_id: OP, args: { offering_id: ENDED_TRIP, hidden: true, expected_revision: "r1" } }, ended.ctx));
  assert(hidden.ok === true, "an ended trip could not be hidden");
  // Display only: Core wrote nothing about the trip itself.
  assert(!ended.serviceCalls.some((call) => /event|trip/.test(call.fn) && call.fn !== "brand_site_offerings_feed"), "the Mingla trip was touched");
});

Deno.test("#2829 W9r past trips come from Mingla's feed with the site's hidden list", async () => {
  const { ctx } = fakes({ rank: 20 });
  const body = await json(await handleSiteContentRoute(route, "POST", { action: "past_trips", operation_id: OP }, ctx));
  const data = body.data as Record<string, unknown>;
  const trips = data.trips as Array<Record<string, unknown>>;
  assert(trips.length === 1 && trips[0]!.id === ENDED_TRIP, "past trips were not exactly the ended ones");
  assert(trips[0]!.hidden === true && trips[0]!.travellers === 10 && trips[0]!.cover_url, "hidden flag, travellers or cover missing");
  assert(data.can_hide === false, "a marketing manager was offered the hide switch");
});

Deno.test("#2829 W9r unknown actions and malformed ids never reach the gate", async () => {
  const { ctx, userCalls } = fakes();
  for (const input of [
    { action: "drop_everything", operation_id: OP },
    { action: "list", operation_id: "not-a-uuid" },
  ]) {
    const response = await handleSiteContentRoute(route, "POST", input, ctx);
    assert(response?.status === 400, `bad input accepted: ${JSON.stringify(input)}`);
  }
  const badSite = await handleSiteContentRoute("/v1/sites/not-a-site/content", "POST", { action: "list", operation_id: OP }, ctx);
  assert(badSite?.status === 400, "a malformed site id was accepted");
  assert(userCalls.length === 0, "the gate was called for bad input");
  assert(await handleSiteContentRoute(`/v1/sites/${SITE}/versions`, "GET", {}, ctx) === null, "claimed a route it does not own");
});

Deno.test("#2829 W9r Ask an admin maps Core's refusals", async () => {
  const { ctx, userCalls } = fakes();
  const ok = await json(await handleSiteContentRoute(`/v1/brands/${BRAND}/site-admin-request`, "POST", { action: "publish" }, ctx));
  assert(ok.ok === true && userCalls[0]?.fn === "brand_site_request_admin" && userCalls[0].args.p_action === "publish", "ask not sent");
  const refused: SiteContentContext = { ...ctx, userRpc: async () => ({ data: null, error: { message: "sites_forbidden" } }) };
  const response = await handleSiteContentRoute(`/v1/brands/${BRAND}/site-admin-request`, "POST", { action: "publish" }, refused);
  assert(response?.status === 403, "an owner's ask was not refused as FORBIDDEN");
});

Deno.test("#2829 W9r changes since the last publish compare with the LIVE version Core points at", async () => {
  const { ctx, cmsCalls } = fakes({ rank: 20, cms: () => ({ status: 200, body: { ok: true, data: { changes: [] } } }) });
  await handleSiteContentRoute(route, "POST", {
    action: "draft_changes",
    operation_id: OP,
    args: { active_artifact_key: "publications/someone-else/x/y.json" },
  }, ctx);
  const sent = cmsCalls[0]!.args as Record<string, unknown>;
  assert(sent.active_artifact_key === `publications/${SITE}/live/abc.json`, "a caller-named artifact reached Studio");
});
