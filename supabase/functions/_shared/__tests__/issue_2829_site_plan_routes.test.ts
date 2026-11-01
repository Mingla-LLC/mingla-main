// deno-lint-ignore-file require-await -- the fakes mirror async RPC and HTTP
/*
 * #2829 W9a — the website plan routes of brand-site-control: every refusal
 * from Core reaches the owner as its own code (never "temporarily
 * unavailable" for a lock or a role), a conflict returns the latest plan,
 * and "Create website draft" ticks the plan ONLY after Studio answered, with
 * exactly the pages Studio reported, sending Studio nothing but Mingla's own
 * brand fields and the owner's answers.
 */
import { brandCoverPhotoPath, handleSitePlanRoute, type SitePlanContext } from "../../brand-site-control/sitePlan.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const BRAND = "733bc470-45e1-4684-8896-acd7e26074ff";
const SITE = "11111111-1111-4111-8111-111111111111";
const USER = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const OP = "22222222-2222-4222-8222-222222222222";

type Call = { fn: string; args: Record<string, unknown> };

function fakes(options: {
  user?: (call: Call) => { data: unknown; error: { message: string } | null };
  service?: (call: Call) => { data: unknown; error: { message: string } | null };
  cms?: (payload: Record<string, unknown>) => Response;
} = {}) {
  const userCalls: Call[] = [];
  const serviceCalls: Call[] = [];
  const cmsCalls: Array<{ path: string; payload: Record<string, unknown>; siteId: string }> = [];
  const ctx: SitePlanContext = {
    userId: USER,
    userRpc: async (fn, args) => {
      userCalls.push({ fn, args });
      return options.user ? options.user({ fn, args }) : { data: { ok: fn }, error: null };
    },
    serviceRpc: async (fn, args) => {
      serviceCalls.push({ fn, args });
      return options.service ? options.service({ fn, args }) : { data: {}, error: null };
    },
    callCms: async ({ path, payload, siteId }) => {
      cmsCalls.push({ path, payload, siteId });
      return options.cms
        ? options.cms(payload)
        : new Response(JSON.stringify({ ok: true, data: { pages: ["home", "trips", "about", "contact"] } }), { status: 202 });
    },
  };
  return { ctx, userCalls, serviceCalls, cmsCalls };
}

async function body(response: Response | null): Promise<Record<string, unknown>> {
  assert(response, "route not handled");
  return await response.json();
}

const composeInputs = {
  site_id: SITE,
  brand_id: BRAND,
  revision: 7,
  offerings_selected: ["trips"],
  venue_descriptor: null,
  story: { who: "First-time solo travellers", why: "You leave with a group", main_action: "Reserve the next trip" },
  brand: {
    name: "Neutral Trips",
    description: "Travel the world.\n\nWe run small group trips.",
    contact_email: "hello@neutral.invalid",
    city: "Raleigh",
    address: { line1: "never sent" },
  },
};

Deno.test("#2829 W9a plan read and save map to Core's RPCs", async () => {
  const { ctx, userCalls } = fakes();
  const read = await body(await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan`, "GET", {}, ctx));
  assert(read.ok === true && userCalls[0]?.fn === "brand_site_plan_get", "read did not call plan_get");
  await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan`, "POST", { revision: 3, patch: { offerings_selected: [] } }, ctx);
  const saveCall = userCalls.find((call) => call.fn === "brand_site_plan_save");
  assert(saveCall?.args.p_revision === 3, "save did not carry the revision");
  const bad = await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan`, "POST", { revision: "3", patch: {} }, ctx);
  assert(bad?.status === 400, "a non-integer revision was accepted");
  const notOurs = await handleSitePlanRoute("/v1/sites/x/versions", "GET", {}, ctx);
  assert(notOurs === null, "a non-plan route was claimed");
});

Deno.test("#2829 W9a refusals keep their meaning (role, lock, pause, entitlement)", async () => {
  for (const [message, code, status] of [
    ["sites_forbidden", "FORBIDDEN", 403],
    ["sites_plan_locked", "PLAN_LOCKED", 409],
    ["sites_plan_paused", "PLAN_PAUSED", 409],
    ["sites_not_entitled", "NOT_ENTITLED", 403],
    ["sites_plan_not_ready", "PLAN_NOT_READY", 409],
    ["boom", "SERVICE_TEMPORARILY_UNAVAILABLE", 503],
  ] as const) {
    const { ctx } = fakes({ user: () => ({ data: null, error: { message } }) });
    const response = await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan/take-over`, "POST", {}, ctx);
    const json = await body(response);
    assert(response?.status === status && (json.error as { code: string }).code === code, `${message} -> ${response?.status} ${(json.error as { code: string }).code}`);
  }
});

Deno.test("#2829 W9a a revision conflict returns the latest plan to re-show", async () => {
  const { ctx } = fakes({
    user: ({ fn }) => fn === "brand_site_plan_save"
      ? { data: null, error: { message: "sites_revision_conflict" } }
      : { data: { plan: { revision: 9 } }, error: null },
  });
  const response = await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan`, "POST", { revision: 3, patch: { story: null } }, ctx);
  const json = await body(response);
  assert(response?.status === 409, "conflict status");
  assert((json.latest as { plan: { revision: number } }).plan.revision === 9, "latest plan not returned");
});

Deno.test("#2829 W9a 'Ask an admin to start it' calls the start request", async () => {
  const { ctx, userCalls } = fakes({ user: () => ({ data: { notified: 2, already_asked: false }, error: null }) });
  const json = await body(await handleSitePlanRoute(`/v1/brands/${BRAND}/site-start-request`, "POST", {}, ctx));
  assert(userCalls[0]?.fn === "brand_site_request_start" && (json.data as { notified: number }).notified === 2, "start request");
});

Deno.test("#2829 W9a create website draft: Studio gets only brand fields and answers; build recorded after Studio confirms", async () => {
  const { ctx, cmsCalls, serviceCalls } = fakes({
    user: () => ({ data: composeInputs, error: null }),
    cms: () => new Response(JSON.stringify({ ok: true, data: { pages: ["home", "trips", "about", "contact", "admin"] } }), { status: 202 }),
  });
  const response = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP }, ctx);
  const json = await body(response);
  assert(response?.status === 200 && json.ok === true, "compose failed");
  const sent = cmsCalls[0];
  assert(sent?.path === "/api/internal/compose-from-plan" && sent.siteId === SITE, "Studio not called for the plan's site");
  const brand = sent.payload.brand as Record<string, unknown>;
  assert(brand.tagline === "Travel the world." && brand.bio === "We run small group trips.", "tagline/bio not split the Mingla way");
  assert(!("address" in brand) && !("description" in brand), "Studio received fields beyond the brand words");
  assert((sent.payload.plan as { offerings_selected: string[] }).offerings_selected[0] === "trips", "plan answers missing");
  const record = serviceCalls.find((call) => call.fn === "brand_site_plan_record_build");
  assert(record && JSON.stringify(record.args.p_pages) === JSON.stringify(["home", "trips", "about", "contact"]), "build recorded with pages Studio did not report (or an unknown page)");
  assert(record.args.p_actor === USER && record.args.p_site_id === SITE, "build actor/site");
});

Deno.test("#2829 W9a no tick on an unknown or failed build", async () => {
  // Core refuses (plan not approved): Studio is never called.
  const refused = fakes({ user: () => ({ data: null, error: { message: "sites_plan_not_ready" } }) });
  const r1 = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP }, refused.ctx);
  assert(r1?.status === 409 && refused.cmsCalls.length === 0, "Studio called for an unapproved plan");
  // Studio fails: nothing is recorded.
  const failed = fakes({
    user: () => ({ data: composeInputs, error: null }),
    cms: () => new Response(JSON.stringify({ ok: false, error: { code: "SERVICE_TEMPORARILY_UNAVAILABLE" } }), { status: 503 }),
  });
  const r2 = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP }, failed.ctx);
  assert(r2?.status === 503 && failed.serviceCalls.length === 0, "a failed build was recorded");
  // Studio answers without a home page: not believed, nothing recorded.
  const odd = fakes({
    user: () => ({ data: composeInputs, error: null }),
    cms: () => new Response(JSON.stringify({ ok: true, data: { pages: ["trips"] } }), { status: 202 }),
  });
  const r3 = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP }, odd.ctx);
  assert(r3?.status === 503 && odd.serviceCalls.length === 0, "a build without a home page was recorded");
  // No operation id: refused before Core.
  const noOp = fakes();
  const r4 = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", {}, noOp.ctx);
  assert(r4?.status === 400 && noOp.userCalls.length === 0, "compose without an operation id");
});

Deno.test("#2829 W11 create website draft hands Studio the brand's Mingla cover photo (and only a Mingla one)", async () => {
  const withCover = { ...composeInputs, brand: { ...composeInputs.brand, cover_media_type: "image", cover_media_url: "https://abc.supabase.co/storage/v1/object/public/brand_covers/b1/cover-1.jpg" } };
  const { ctx, cmsCalls } = fakes({ user: () => ({ data: withCover, error: null }) });
  await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP }, ctx);
  assert((cmsCalls[0]?.payload.brand as Record<string, unknown>).cover_photo_path === "brand_covers/b1/cover-1.jpg", "cover photo path not sent");
  const without = fakes({ user: () => ({ data: composeInputs, error: null }) });
  await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP }, without.ctx);
  assert(!("cover_photo_path" in (without.cmsCalls[0]?.payload.brand as Record<string, unknown>)), "a brand without a cover sent one");
});

Deno.test("#2829 W11 the cover path: photos as is, a video's still, never stock links or odd paths", () => {
  const url = (path: string) => `https://abc.supabase.co/storage/v1/object/public/${path}`;
  assert(brandCoverPhotoPath({ cover_media_type: "image", cover_media_url: url("brand_covers/b/c.jpg") }) === "brand_covers/b/c.jpg", "photo");
  assert(brandCoverPhotoPath({ cover_media_type: "video", cover_media_url: url("brand_covers/b/v.mp4"), cover_media_poster_url: url("brand_covers/b/v.jpg") }) === "brand_covers/b/v.jpg", "video still");
  assert(brandCoverPhotoPath({ cover_media_type: "video", cover_media_url: url("brand_covers/b/v.mp4") }) === null, "video without a still");
  assert(brandCoverPhotoPath({ cover_media_type: "image", cover_media_url: "https://images.pexels.com/photos/1/a.jpg" }) === null, "stock link");
  assert(brandCoverPhotoPath({ cover_media_type: "image", cover_media_url: url("event_covers/e/c.jpg") }) === null, "another bucket");
  assert(brandCoverPhotoPath({ cover_media_type: "image", cover_media_url: url("brand_covers/../secret/c.jpg") }) === null, "dot-dot");
  assert(brandCoverPhotoPath({ cover_media_type: "image", cover_media_url: "not a url" }) === null, "garbage");
  assert(brandCoverPhotoPath({}) === null, "nothing");
});
