// issue #1978 — Ari venue listings and claims.
//
// The three venue write tools were false promises: create sent only name+city
// to a 22-argument RPC, and both claim mutations used parameter names the
// canonical RPCs do not accept. This suite pins the corrected contracts:
//   - create_venue_listing → the EXACT 22-arg biz_create_venue_listing envelope
//     (event_manager+), landing pending_review (never public);
//   - submit_venue_claim   → venue-keyed biz_resubmit_venue_claim(p_venue_id)
//     (brand_owner only);
//   - mark_claim_feedback_fixed → reversible
//     biz_mark_feedback_item_fixed(p_feedback_id, p_fixed) (brand_owner only);
//   - the PII-minimised venue reads (list/status/feedback) exist, run inline,
//     and Ari is never given a publish/approve tool.

// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AGENT_TOOLS,
  findTool,
  READ_ONLY_TOOL_NAMES,
  ToolError,
} from "../agentTools.ts";
import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { buildSystemPrompt } from "../agentSystemPrompt.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const VENUE = "22222222-2222-4222-8222-222222222222";
const FEEDBACK = "33333333-3333-4333-8333-333333333333";
const PLACE = "44444444-4444-4444-8444-444444444444";

/** Raw (pre-authorization) domain executor, so we can assert RPC param maps. */
function domainTool(name: string) {
  const found = DOMAIN_TOOLS.find((tool) => tool.name === name);
  if (!found) throw new Error(`missing domain tool: ${name}`);
  return found;
}

/** Fake caller-JWT client capturing exactly one rpc(name, params) call. */
function rpcCapture(result: unknown = { ok: true }) {
  const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const client: any = {
    rpc(fn: string, params: Record<string, unknown>) {
      calls.push({ fn, params });
      return Promise.resolve({ data: result, error: null });
    },
  };
  return { client, calls };
}

const HOURS = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  open_time: "09:00",
  close_time: "17:00",
  is_closed: false,
}));

Deno.test("#1978 create_venue_listing sends the exact 22-arg canonical envelope", async () => {
  const { client, calls } = rpcCapture(VENUE);
  await domainTool("create_venue_listing").executor(
    {
      brand_id: BRAND,
      name: "Blue Room",
      slug: "blueroom",
      description: "A tagline\n\nA description",
      google_place_id: "gpid-123",
      lat: 51.5,
      lng: -0.12,
      city: "London",
      country_code: "GB",
      address: "1 High St",
      venue_category: "restaurant",
      contact_email: "ops@example.com",
      contact_phone: "+441234567890",
      cover_media_url: "https://cdn/x.jpg",
      cover_media_poster_url: "https://cdn/x.jpg",
      cover_media_type: "image",
      hours: HOURS,
      place_pool_id: PLACE,
      coordinate_precision: "approximate",
      theme_color: "#eb7825",
      theme_font: "",
      theme_animation: "",
    },
    client,
    "user",
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "biz_create_venue_listing");
  const keys = Object.keys(calls[0].params).sort();
  assertEquals(keys, [
    "p_address",
    "p_brand_id",
    "p_city",
    "p_contact_email",
    "p_contact_phone",
    "p_coordinate_precision",
    "p_country_code",
    "p_cover_media_poster_url",
    "p_cover_media_type",
    "p_cover_media_url",
    "p_description",
    "p_google_place_id",
    "p_hours",
    "p_lat",
    "p_lng",
    "p_name",
    "p_place_pool_id",
    "p_slug",
    "p_theme_animation",
    "p_theme_color",
    "p_theme_font",
    "p_venue_category",
  ]);
  // 22 canonical arguments — no legacy 3-arg shape survives.
  assertEquals(keys.length, 22);
  assertEquals(calls[0].params.p_hours, HOURS);
  assertEquals(calls[0].params.p_place_pool_id, PLACE);
});

Deno.test("#1978 create_venue_listing coalesces optional fields to the RPC's empty-string sentinels", async () => {
  const { client, calls } = rpcCapture(VENUE);
  await domainTool("create_venue_listing").executor(
    {
      brand_id: BRAND,
      name: "Bare",
      slug: "bare",
      lat: 1,
      lng: 2,
      venue_category: "play",
      hours: HOURS,
    },
    client,
    "user",
  );
  const p = calls[0].params;
  assertEquals(p.p_description, "");
  assertEquals(p.p_cover_media_url, "");
  assertEquals(p.p_cover_media_poster_url, "");
  assertEquals(p.p_theme_color, "");
  assertEquals(p.p_place_pool_id, null);
});

Deno.test("#1978 create_venue_listing refuses a non-7-row week before any RPC", async () => {
  const { client, calls } = rpcCapture();
  await assertRejects(
    () =>
      domainTool("create_venue_listing").executor(
        {
          brand_id: BRAND,
          name: "X",
          slug: "x",
          lat: 1,
          lng: 2,
          venue_category: "restaurant",
          hours: HOURS.slice(0, 3),
        },
        client,
        "user",
      ),
    ToolError,
  );
  assertEquals(calls.length, 0);
});

Deno.test("#1978 submit_venue_claim is venue-keyed to biz_resubmit_venue_claim(p_venue_id)", async () => {
  const { client, calls } = rpcCapture({ ok: true, venue_id: VENUE });
  await domainTool("submit_venue_claim").executor(
    { venue_id: VENUE },
    client,
    "user",
  );
  assertEquals(calls[0].fn, "biz_resubmit_venue_claim");
  assertEquals(calls[0].params, { p_venue_id: VENUE });
});

Deno.test("#1978 mark_claim_feedback_fixed carries the reversible p_feedback_id/p_fixed pair", async () => {
  const open = rpcCapture({ ok: true, status: "open" });
  await domainTool("mark_claim_feedback_fixed").executor(
    { feedback_id: FEEDBACK, fixed: false },
    open.client,
    "user",
  );
  assertEquals(open.calls[0].fn, "biz_mark_feedback_item_fixed");
  assertEquals(open.calls[0].params, { p_feedback_id: FEEDBACK, p_fixed: false });

  // fixed defaults to true — the canonical RPC default.
  const fixed = rpcCapture({ ok: true, status: "fixed" });
  await domainTool("mark_claim_feedback_fixed").executor(
    { feedback_id: FEEDBACK },
    fixed.client,
    "user",
  );
  assertEquals(fixed.calls[0].params, { p_feedback_id: FEEDBACK, p_fixed: true });
});

Deno.test("#1978 venue mutations reject malformed ids before any RPC", async () => {
  for (
    const [name, args] of [
      ["submit_venue_claim", { venue_id: "nope" }],
      ["mark_claim_feedback_fixed", { feedback_id: "nope" }],
    ] as const
  ) {
    const { client, calls } = rpcCapture();
    await assertRejects(
      () => domainTool(name).executor(args as any, client, "user"),
      ToolError,
    );
    assertEquals(calls.length, 0);
  }
});

Deno.test("#1978 authorization pins canonical venue roles and derived resources", () => {
  const auth = AGENT_TOOL_AUTHORIZATION as Record<
    string,
    { requiredRole: string; resource: string }
  >;
  assertEquals(auth.create_venue_listing, {
    requiredRole: "event_manager",
    resource: "brand",
  });
  assertEquals(auth.submit_venue_claim, {
    requiredRole: "brand_owner",
    resource: "venue",
  });
  assertEquals(auth.mark_claim_feedback_fixed, {
    requiredRole: "brand_owner",
    resource: "venue_feedback",
  });
  assertEquals(auth.list_venue_listings, {
    requiredRole: "scanner",
    resource: "brand",
  });
  assertEquals(auth.get_venue_listing_status, {
    requiredRole: "scanner",
    resource: "venue",
  });
  assertEquals(auth.list_venue_claim_feedback, {
    requiredRole: "brand_owner",
    resource: "venue",
  });
});

Deno.test("#1978 venue reads are registered, inline read-only, and PII-minimised", () => {
  const names = new Set(AGENT_TOOLS.map((tool) => tool.name));
  for (
    const read of [
      "list_venue_listings",
      "get_venue_listing_status",
      "list_venue_claim_feedback",
    ]
  ) {
    assert(names.has(read), `${read} missing from registry`);
    assert(READ_ONLY_TOOL_NAMES.has(read), `${read} must run inline`);
    assert(DOMAIN_READ_ONLY.has(read), `${read} must be read-only`);
  }
});

Deno.test("#1978 list_venue_listings never leaks contact/coordinate/rejection PII", async () => {
  const row = {
    id: VENUE,
    name: "Blue Room",
    slug: "blueroom",
    city: "London",
    venue_category: "restaurant",
    claim_status: "pending_review",
    claim_follow_up_at: "2026-08-14T00:00:00Z",
    place_pool_id: PLACE,
    created_at: "2026-08-01T00:00:00Z",
  };
  const client: any = {
    from() {
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => Promise.resolve({ data: [row], error: null }),
      };
      return q;
    },
  };
  const out = await domainTool("list_venue_listings").executor(
    { brand_id: BRAND },
    client,
    "user",
  ) as { venues: Array<Record<string, unknown>> };
  assertEquals(out.venues.length, 1);
  const keys = Object.keys(out.venues[0]).sort();
  assertEquals(keys, [
    "city",
    "claim_status",
    "created_at",
    "name",
    "needs_follow_up",
    "place_pool_id",
    "slug",
    "venue_category",
    "venue_id",
  ]);
  assertEquals(out.venues[0].needs_follow_up, true);
  const serialized = JSON.stringify(out);
  for (const leak of ["contact", "email", "phone", "lat", "lng", "address", "rejection"]) {
    assert(!serialized.includes(leak), `list_venue_listings leaked ${leak}`);
  }
});

Deno.test("#1978 Ari is never given a venue publish/approve tool", () => {
  for (const tool of AGENT_TOOLS) {
    assert(
      !/publish_venue|approve_venue|verify_venue/.test(tool.name),
      `forbidden venue publication tool: ${tool.name}`,
    );
  }
  const prompt = buildSystemPrompt(null, []);
  assert(!prompt.includes("- publish_venue"), "prompt advertised a venue publish tool");
  // The create capability line must frame submission as review, not publication.
  assert(
    /create_venue_listing — submit a venue for admin review/.test(prompt),
    "create_venue_listing must be advertised as a review submission",
  );
});
