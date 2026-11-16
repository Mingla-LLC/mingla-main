// #4452 §6.2 (SC-132–136): the free tools' adaptive follow-up answers on the server.
//   FU-1 the shared parser accepts exactly each tool's shape, only for its scenario
//   FU-2 each tool's validator: the right scenario passes, the wrong one is rejected
//        (400 fields:["followup"]), and without the answers the input is today's
//   FU-3 the answers reach the research prompts; without them the prompt has no new lines
//   FU-4 handler level: a wrong-scenario follow-up is a 400 with no row and no model call;
//        a venue with no website runs with the answer, persists it and never fetches a site
// FAILS-ON-REVERT: dropping parseToolFollowup from a validator fails FU-2 (the wrong
// scenario passes); dropping the followupPromptLines spread fails FU-3; restoring the
// unconditional fetchSite(input.website) fails FU-4 (a request to the empty website).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { followupApplies, parseToolFollowup, TRIP_GROUP_THRESHOLD } from "../_shared/growthToolFollowups.ts";
import { buildGeminiUserPrompt, handler as venuesHandler, validateRunInput } from "./index.ts";
import { buildResearchPrompt as eventsPrompt, handler as eventsHandler, validateEventInput } from "../growth-tools-events/index.ts";
import { buildResearchPrompt as tripsPrompt, handler as tripsHandler, validateTripInput } from "../growth-tools-trips/index.ts";
import { buildResearchPrompt as pricingPrompt, validatePricingInput } from "../growth-tools-pricing/index.ts";
import { eventsInput, installStub, post, PRICING_INPUT, tripsInput, VENUES_INPUT, VENUES_PASS1_PAYLOAD } from "./__tests__/harness_1734.ts";

const PLACE = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";

Deno.test("FU-1 the parser: each shape, only for its scenario; null is today's behaviour", () => {
  assertEquals(parseToolFollowup("events", undefined, { ticketPrice: 20 }), { ok: true, value: null });
  assertEquals(parseToolFollowup("events", null, { ticketPrice: 0 }), { ok: true, value: null });
  assertEquals(parseToolFollowup("events", { rsvp_goal: 400, no_shows: "lots" }, { ticketPrice: 0 }), { ok: true, value: { reason: "free_rsvp", rsvp_goal: 400, no_shows: "lots" } });
  assertEquals(parseToolFollowup("events", { rsvp_goal: 400, no_shows: "lots" }, { ticketPrice: 15 }).ok, false, "paid event: wrong scenario");
  assertEquals(parseToolFollowup("events", { rsvp_goal: 0, no_shows: "lots" }, { ticketPrice: 0 }).ok, false, "goal is bounded");
  assertEquals(parseToolFollowup("events", { rsvp_goal: 400, no_shows: "maybe" }, { ticketPrice: 0 }).ok, false, "enum only");
  assertEquals(parseToolFollowup("events", { rsvp_goal: 400, no_shows: "few", note: "free text" }, { ticketPrice: 0 }).ok, false, "no extra keys (no free text)");
  assertEquals(TRIP_GROUP_THRESHOLD, 16, "groups over 15");
  assertEquals(followupApplies("trips", { groupSize: 15 }), false);
  assertEquals(followupApplies("trips", { groupSize: 16 }), true);
  assertEquals(parseToolFollowup("trips", { coach: true, rooms: "twin" }, { groupSize: 24 }), { ok: true, value: { reason: "group_over_15", coach: true, rooms: "twin" } });
  assertEquals(parseToolFollowup("trips", { coach: "yes", rooms: "twin" }, { groupSize: 24 }).ok, false);
  assertEquals(parseToolFollowup("experiences", { session_cost: 370, deposit: "probably" }, { currentPrice: 0 }), { ok: true, value: { reason: "free_today", session_cost: 370, deposit: "probably" } });
  assertEquals(parseToolFollowup("experiences", { session_cost: -1, deposit: "probably" }, { currentPrice: 0 }).ok, false);
  assertEquals(parseToolFollowup("venues", { found_via: "instagram" }, { website: "", placeId: PLACE }), { ok: true, value: { reason: "no_website", found_via: "instagram" } });
  assertEquals(parseToolFollowup("venues", { found_via: "instagram" }, { website: "https://a.example/", placeId: PLACE }).ok, false, "has a website");
  assertEquals(parseToolFollowup("venues", { found_via: "instagram" }, { website: "", placeId: null }).ok, false, "not a Google pick");
  assertEquals(parseToolFollowup("venues", { found_via: "instagram", reason: "free_rsvp" }, { website: "", placeId: PLACE }).ok, false, "another tool's reason");
});

Deno.test("FU-2 validators: right scenario passes, wrong scenario is rejected, none is today's input", () => {
  const ev = eventsInput();
  const evToday = validateEventInput(ev);
  assert(evToday.ok);
  assertEquals(evToday.input.followup, null);
  const evWrong = validateEventInput({ ...ev, followup: { rsvp_goal: 400, no_shows: "lots" } });
  assert(!evWrong.ok && evWrong.fields.includes("followup"), "a paid event cannot carry RSVP answers");
  const evFree = validateEventInput({ ...ev, ticket_price: 0, followup: { rsvp_goal: 400, no_shows: "lots" } });
  assert(evFree.ok);
  assertEquals(evFree.input.followup, { reason: "free_rsvp", rsvp_goal: 400, no_shows: "lots" });

  const tr = tripsInput();
  assert(!validateTripInput({ ...tr, followup: { coach: true, rooms: "twin" } }).ok, "10 people: not asked");
  const tr24 = validateTripInput({ ...tr, group_size: 24, followup: { coach: true, rooms: "twin" } });
  assert(tr24.ok);
  assertEquals(tr24.input.followup?.coach, true);
  const tr24none = validateTripInput({ ...tr, group_size: 24 });
  assert(tr24none.ok && tr24none.input.followup === null, "the answers stay optional");

  const pr = validatePricingInput({ ...PRICING_INPUT, followup: { session_cost: 370, deposit: "probably" } });
  assert(!pr.ok && pr.fields.includes("followup"), "charging today: not asked");
  const prFree = validatePricingInput({ ...PRICING_INPUT, current_price: 0, followup: { session_cost: 370, deposit: "not_sure" } });
  assert(prFree.ok && prFree.input.followup?.session_cost === 370);

  const vToday = validateRunInput(VENUES_INPUT);
  assert(vToday.ok);
  assertEquals(Object.keys(vToday.input).sort(), ["city", "name", "place_id", "website"], "no followup key without the answer");
  const vNoSite = validateRunInput({ name: "Chidi's Kitchen", city: "Lagos", website: "", place_id: PLACE, followup: { found_via: "whatsapp" } });
  assert(vNoSite.ok);
  assertEquals(vNoSite.input.website, "");
  assertEquals(vNoSite.input.followup, { reason: "no_website", found_via: "whatsapp" });
  const vMissing = validateRunInput({ name: "Chidi's Kitchen", city: "Lagos", website: "", place_id: PLACE });
  assert(!vMissing.ok && vMissing.fields.includes("website"), "no website and no answer: still a website error");
  const vWrong = validateRunInput({ ...VENUES_INPUT, place_id: PLACE, followup: { found_via: "instagram" } });
  assert(!vWrong.ok && vWrong.fields.includes("followup"), "a venue with a website cannot claim it has none");
});

Deno.test("FU-3 the answers reach the research prompts; none adds no lines", () => {
  const ev = validateEventInput({ ...eventsInput(), ticket_price: 0, followup: { rsvp_goal: 400, no_shows: "lots" } });
  const evPlain = validateEventInput({ ...eventsInput(), ticket_price: 0 });
  assert(ev.ok && evPlain.ok);
  const p = eventsPrompt(ev.input);
  assert(p.includes("RSVP goal: 400") && p.includes("SITUATION: a FREE, RSVP-only event"));
  assert(!eventsPrompt(evPlain.input).includes("SITUATION"));
  assertEquals(eventsPrompt(evPlain.input).split("\n").length + 4, p.split("\n").length, "exactly the follow-up lines are added");

  const tr = validateTripInput({ ...tripsInput(), group_size: 24, followup: { coach: false, rooms: "single" } });
  assert(tr.ok && tripsPrompt(tr.input).includes("Coach between stops: no. Rooms: single."));
  const pr = validatePricingInput({ ...PRICING_INPUT, current_price: 0, followup: { session_cost: 370, deposit: "probably" } });
  assert(pr.ok && pricingPrompt(pr.input).includes("What each session costs the host: 370 USD."));
  const v = validateRunInput({ name: "Chidi's Kitchen", city: "Lagos", website: "", place_id: PLACE, followup: { found_via: "instagram" } });
  assert(v.ok);
  const site = { fetch_failed: true, title: null, meta_description: null, og_image_url: null, visible_text: "", signals: [] };
  const vp = buildGeminiUserPrompt(v.input, site, { found: false } as never);
  assert(vp.includes("Where people find them today: Instagram.") && vp.includes("website: (none: Google lists no website)"));
  assert(!vp.includes("The website could not be fetched"), "not graded as a broken site");
});

Deno.test("FU-4 handler: a wrong-scenario follow-up is a 400 with no row; no-website venue runs without fetching a site", async () => {
  const stub = installStub({});
  try {
    const r = await post(eventsHandler, { action: "run", input: { ...eventsInput(), followup: { rsvp_goal: 400, no_shows: "lots" } } }, "sb-anon-key-bearer", { "x-forwarded-for": "7.7.7.7" });
    assertEquals(r.status, 400);
    assertEquals(r.body.fields, ["followup"]);
    const t = await post(tripsHandler, { action: "run", input: { ...tripsInput(), followup: { coach: true, rooms: "twin" } } }, "sb-anon-key-bearer", { "x-forwarded-for": "7.7.7.7" });
    assertEquals(t.status, 400);
    assertEquals(stub.state.toolLeads.length, 0);
    assertEquals(stub.state.geminiCalls.structured + stub.state.geminiCalls.grounded, 0);
  } finally {
    stub.restore();
  }

  const stub2 = installStub({ gemini: { structuredPayload: VENUES_PASS1_PAYLOAD } });
  try {
    const r = await post(venuesHandler, { action: "run", input: { name: "Chidi's Kitchen", city: "Lagos", website: "", place_id: PLACE, followup: { found_via: "instagram" } } }, "sb-anon-key-bearer", { "x-forwarded-for": "8.8.8.8" });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    const row = stub2.state.toolLeads[0];
    assertEquals(row.input.followup, { reason: "no_website", found_via: "instagram" });
    assertEquals(row.input.website, "");
    assertEquals(row.report.followup.reason, "no_website");
    assertEquals(row.report.screenshot.image_url, null);
    assertEquals(r.body.report, undefined, "the web lane still answers the preview only");
    assert(!stub2.state.requests.some((q) => q.url === "https:///" || q.url === ""), "no fetch of an empty website");
  } finally {
    stub2.restore();
  }
});
