// #4452 §6.9 (SC-143, SC-144): the smart report emails and the tool follow-ups.
//   TE-1 SC-143 the subject and headline follow the result (and the spec's own example)
//   TE-2 SC-143 the button text is the scenario's CTA when one applied, else the tool's
//   TE-3 SC-143 "Your 3 fixes, in order." numbered with their tags, in report order
//   TE-4 SC-139 an unpriced trip: "(prices to follow)" and no money anywhere
//   TE-5 nothing invented: a missing value hides its row
//   TE-6 the frame: label pill, the host action bar with the tool's icp, the 30-day link line
//   TE-7 SC-144 the gate enrols the follow-ups only when the tips box was ticked; the
//        "Next from us" line appears only then
// FAILS-ON-REVERT: ignoring report.followup in buildToolReportEmail fails TE-1/TE-2; dropping
// the tripUnpriced branch fails TE-4; removing the `if (tips)` guard around the enrolment fails TE-7.
import { assert, assertEquals, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildToolReportEmail, tripUnpriced } from "./toolEmail.ts";
import { handler, recordToolGateLead } from "./index.ts";
import { parseHostAdContext } from "../_shared/hostFunnelConversion.ts";
import { hostFakeDb } from "../_shared/__tests__/hostFunnelFakeDb.issue4238.ts";
import { installStub, post } from "../growth-tools-run/__tests__/harness_1734.ts";

const LINK = "https://usemingla.com/tools/venues/report?id=r1&t=tok";
const fixes3 = [
  { title: "Add a Book button above the fold", change: "Most visitors are on phones.", impact: "high", effort: "this_week" },
  { title: "Make the site load in under 2 seconds", change: "It takes 4.8 seconds on a phone today.", impact: "medium", effort: "this_month" },
  { title: "Put the menu in text, not a PDF", change: "Google can read it.", impact: "medium", effort: "project" },
];
const venue = { venue: { name: "Angus Barn" }, scores: { overall: 74, grade: "B" }, percentile: { city: "Raleigh", better_than_pct: 75 }, site_signals: { checks: [{ status: "fail" }, { status: "pass" }] }, fixes: fixes3 };
const noSite = { venue: { name: "Chidi’s Kitchen", website: "" }, scores: { overall: 41, grade: "D" }, fixes: fixes3, followup: { reason: "no_website", found_via: "instagram" } };
const event = { event: { title: "Afrobeats Rooftop Sessions", currency: "NGN" }, forecast: { total_low: 280, total_high: 340, capacity: 400, confidence: "medium" }, plan: { kind: "paid_optimized", currency: "NGN", ads_worth_it: true, recommended_budget: 180000 }, competitors: [{}, {}, {}], fixes: fixes3 };
const trip = { trip: { title: "Marrakech, 4 nights", destination: "Marrakech", days: 5, group_size: 10, currency: "USD" }, plan: { currency: "USD", recommended_price_per_person: 1240, recommended_margin_pct: 18, group_profit: 2232, cost_lines: [{ per_person: 600 }, { per_person: 400 }] }, fixes: fixes3 };
const tripZero = { ...trip, trip: { ...trip.trip, title: "Ibiza Summer Escape", destination: "Ibiza" }, plan: { currency: "USD", recommended_price_per_person: 0, recommended_margin_pct: 18, group_profit: 0, cost_lines: [{ per_person: 0 }, { per_person: 0 }] } };
const pricing = { experience: { description: "Pasta supper club", currency: "GBP" }, audit: { currency: "GBP", verdict: "underpriced", extra_per_head: 14, cost_per_head: 31, recommended_price: 49, monthly_upside: 672 }, comps: [{ price_pp: 45 }, { price_pp: 60 }], fixes: fixes3 };

Deno.test("TE-1 SC-143 the subject and headline follow the result", () => {
  const v = buildToolReportEmail({ tool: "venues", report: venue, reportLink: LINK, tips: false });
  assertEquals(v.subject, "Angus Barn: 74 out of 100. Here are your 3 fixes.");
  assertStringIncludes(v.bodyHtml, "74 out of <em>100.</em>");
  // The spec's own example (§6.9).
  const n = buildToolReportEmail({ tool: "venues", report: noSite, reportLink: LINK, tips: false });
  assertEquals(n.subject, "Chidi’s Kitchen: No website, yet. You don’t have a website yet. Here’s what that costs you.");
  assertStringIncludes(n.bodyHtml, "No website, <em>yet.</em>");
  assertEquals(buildToolReportEmail({ tool: "events", report: event, reportLink: LINK, tips: false }).subject, "Afrobeats Rooftop Sessions: 280–340 people, likely. Here are your 3 fixes.");
  assertEquals(buildToolReportEmail({ tool: "events", report: { ...event, followup: { reason: "free_rsvp", rsvp_goal: 400, no_shows: "lots" } }, reportLink: LINK, tips: false }).subject,
    "Afrobeats Rooftop Sessions: 280–340 people, likely. Free events fill differently. Here’s your plan.");
  assertEquals(buildToolReportEmail({ tool: "trips", report: trip, reportLink: LINK, tips: false }).subject, "Marrakech, 4 nights: $1,240 per person. Here are your 3 fixes.");
  assertEquals(buildToolReportEmail({ tool: "experiences", report: pricing, reportLink: LINK, tips: false }).subject, "Pasta supper club: Raise it £14 a seat. Here are your 3 fixes.");
  const free = buildToolReportEmail({ tool: "experiences", report: { ...pricing, followup: { reason: "free_today", session_cost: 370, deposit: "probably" } }, reportLink: LINK, tips: false });
  assertEquals(free.subject, "Pasta supper club: You pay £31 a head. Free is costing you. Here’s what to charge.");
  // A follow-up for another tool's scenario is ignored.
  assertEquals(buildToolReportEmail({ tool: "venues", report: { ...venue, followup: { reason: "free_rsvp" } }, reportLink: LINK, tips: false }).reason, null);
});

Deno.test("TE-2 SC-143 the button follows the scenario", () => {
  const cases: Array<[Parameters<typeof buildToolReportEmail>[0]["tool"], Record<string, unknown>, string, string]> = [
    ["venues", venue, "Open my full report", LINK],
    ["venues", noSite, "Make my free Mingla Host page", "https://usemingla.com/host/get"],
    ["events", event, "Open my full forecast", LINK],
    ["events", { ...event, followup: { reason: "free_rsvp", rsvp_goal: 400, no_shows: "few" } }, "Set up RSVPs on Mingla Host", "https://usemingla.com/host/get"],
    ["trips", trip, "Open my full quote", LINK],
    ["trips", { ...trip, followup: { reason: "group_over_15", coach: true, rooms: "twin" } }, "Turn this into a bookable trip on Mingla Host", "https://usemingla.com/host/get"],
    ["experiences", pricing, "Open my full audit", LINK],
    ["experiences", { ...pricing, followup: { reason: "free_today", session_cost: 370, deposit: "not_sure" } }, "Start charging with Mingla Host", "https://usemingla.com/host/get"],
  ];
  for (const [tool, report, want, href] of cases) {
    const e = buildToolReportEmail({ tool, report, reportLink: LINK, tips: false });
    assertEquals(e.cta, want, `${tool}`);
    assertMatch(e.bodyHtml, new RegExp(`<a href="${href.replace(/[?&.]/g, (c) => `\\${c}`).replace(/&/g, "&amp;")}"[^>]*>${want}</a>`), `${tool}: ${want} → ${href}`);
    assertStringIncludes(e.bodyHtml, "/tools/venues/report?id=r1", `${tool}: the private report link is always there`);
  }
});

Deno.test("TE-3 SC-143 three numbered fixes with their tags, in order", () => {
  const e = buildToolReportEmail({ tool: "events", report: event, reportLink: LINK, tips: false });
  assertStringIncludes(e.bodyHtml, "Your 3 fixes, <em>in order.</em>");
  const order = [...e.bodyHtml.matchAll(/>(\d)<\/span><\/td><td[^>]*><b[^>]*>([^<]+)<\/b> <span[^>]*>([^<]+)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
  assertEquals(order, [["1", fixes3[0].title, "Biggest win"], ["2", fixes3[1].title, "This month"], ["3", fixes3[2].title, "Bigger project"]]);
  assertStringIncludes(e.text, "1. Add a Book button above the fold [Biggest win]");
  const one = buildToolReportEmail({ tool: "venues", report: { ...venue, fixes: [fixes3[0]] }, reportLink: LINK, tips: false });
  assertStringIncludes(one.bodyHtml, "Your fixes, <em>in order.</em>");
  assertEquals(one.subject, "Angus Barn: 74 out of 100. Here is your fix.");
});

Deno.test("TE-4 SC-139 an unpriced trip: (prices to follow), no money", () => {
  assert(tripUnpriced(tripZero) && !tripUnpriced(trip));
  assert(tripUnpriced({ ...trip, pricing_status: "unpriced" }));
  const e = buildToolReportEmail({ tool: "trips", report: tripZero, reportLink: LINK, tips: false });
  assertEquals(e.subject, "Ibiza Summer Escape: your plan is ready (prices to follow)");
  assert(!/\$\s?\d|US\$/.test(e.bodyHtml + e.text), "no money in the email");
  assertStringIncludes(e.bodyHtml, "Your plan is <em>ready.</em>");
});

Deno.test("TE-5 nothing invented: a missing value hides its row", () => {
  const e = buildToolReportEmail({ tool: "venues", report: { venue: { name: "Bar" }, scores: { overall: 60 }, fixes: [] }, reportLink: LINK, tips: false });
  assert(!e.bodyHtml.includes("Against places nearby") && !e.bodyHtml.includes("Site checks failing") && !e.bodyHtml.includes(">Grade<"));
  assert(!e.bodyHtml.includes("fixes, <em>in order"), "no fixes, no fixes block");
  const p = buildToolReportEmail({ tool: "experiences", report: { experience: { description: "Yoga" }, audit: { verdict: "healthy", recommended_price: 20, currency: "USD" } }, reportLink: LINK, tips: false });
  assert(!p.bodyHtml.includes("Similar experiences nearby") && !p.bodyHtml.includes("Extra per month"));
  assertStringIncludes(p.bodyHtml, "Priced about <em>right.</em>");
});

const RUN = "aaaaaaaa-1111-4111-8111-aaaaaaaa4452";
const row = (tool: string, report: Record<string, unknown>) => ({ id: RUN, tool, status: "report_ready", lane: "web", report, report_token: "t".repeat(64), email: null, created_at: new Date().toISOString() });

Deno.test("TE-6 the frame: label pill, host action bar with the tool's icp, the 30-day line", async () => {
  const stub = installStub({ toolLeads: [row("events", event)] });
  try {
    const r = await post(handler, { run_id: RUN, email: "host@example.test" });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    const sent = stub.state.resendSends.find((s) => (s.to as string[])[0] === "host@example.test") as Record<string, string>;
    assertEquals(sent.subject, "Afrobeats Rooftop Sessions: 280–340 people, likely. Here are your 3 fixes.");
    assertStringIncludes(sent.html, ">Turnout forecast</span>");
    assertStringIncludes(sent.html, "Run it");
    assertStringIncludes(sent.html, "https://usemingla.com/schedule?icp=events");
    assertStringIncludes(sent.html, "Get Mingla Host");
    assertStringIncludes(sent.html, "works for 30 days");
  } finally {
    stub.restore();
  }
});

Deno.test("TE-7 SC-144 follow-ups only with the tips box ticked", async () => {
  const enrolCalls = (s: ReturnType<typeof installStub>) => s.state.requests.filter((q) => q.url.includes("/rest/v1/rpc/forms_tool_followup_enroll")).length;
  const a = installStub({ toolLeads: [row("venues", venue)] });
  try {
    const r = await post(handler, { run_id: RUN, email: "host@example.test" });
    assertEquals(r.status, 200);
    assertEquals(enrolCalls(a), 0, "no tick, no follow-ups");
    const sent = a.state.resendSends.find((s) => (s.to as string[])[0] === "host@example.test") as Record<string, string>;
    assert(!sent.html.includes("Next from us"));
  } finally {
    a.restore();
  }
  const b = installStub({ toolLeads: [row("venues", venue)] });
  try {
    const r = await post(handler, { run_id: RUN, email: "host@example.test", marketing_consent: true, time_zone: "Africa/Lagos" });
    assertEquals(r.status, 200);
    assertEquals(enrolCalls(b), 1, "ticked: enrolled once");
    const sent = b.state.resendSends.find((s) => (s.to as string[])[0] === "host@example.test") as Record<string, string>;
    assertStringIncludes(sent.html, "Next from us: day 2, “Fix #1 in ten minutes”; day 7, a free re-check.");
  } finally {
    b.restore();
  }
  // "true" as a string is not consent.
  const c = installStub({ toolLeads: [row("venues", venue)] });
  try {
    await post(handler, { run_id: RUN, email: "host@example.test", marketing_consent: "true" });
    assertEquals(enrolCalls(c), 0);
  } finally {
    c.restore();
  }
});

// #4452 B20: a test or internal email (public.inbound_lead_is_test) unlocking a
// tool report sends no Lead and answers lead_event_id null (no browser twin).
// FAILS-ON-REVERT: removing the guard from recordLabelledLead, or the contact the
// gate passes, fails B20-gate-a.
const GATE_RUN = "4452a000-0000-4000-8000-0000000000aa";
const gateReq = new Request("https://fn/", { headers: { "user-agent": "UA/9", "x-forwarded-for": "198.51.100.9" } });
const gateDb = () => hostFakeDb({ ad_attribution_touches: [], ad_connections: [] }, { testLeadEmails: ["staff@usemingla.com"] });

Deno.test("B20-gate-a an internal email sends no Lead and stores no context", async () => {
  const d = gateDb();
  const ad = parseHostAdContext({ fbc: "fb.1.1.GATE", tracking_opt_out: false, page_url: "https://usemingla.com/tools/venues" }, gateReq);
  const id = await recordToolGateLead(d.client, { runId: GATE_RUN, tool: "venues", email: "staff@usemingla.com", name: "Angus Barn", ad });
  assertEquals(id, null);
  assertEquals(d.tables.ad_conversions?.length ?? 0, 0);
  assertEquals(d.tables.ad_match_contexts?.length ?? 0, 0);
  assertEquals(d.rpcCalls.find((c) => c.name === "inbound_lead_is_test")?.args, { p_email: "staff@usemingla.com", p_name: "Angus Barn" });
});

Deno.test("B20-gate-b a normal email still sends lead:tool:<id>; a real opted-out visitor keeps the opt-out-only Lead", async () => {
  const d = gateDb();
  const ad = parseHostAdContext({ fbc: "fb.1.1.GATE", tracking_opt_out: false }, gateReq);
  assertEquals(await recordToolGateLead(d.client, { runId: GATE_RUN, tool: "venues", email: "owner@example.org", name: "Angus Barn", ad }), `lead:tool:${GATE_RUN}`);
  assert(d.row("ad_conversions", (r) => r.event_id === `lead:tool:${GATE_RUN}`));
  const o = gateDb();
  const off = parseHostAdContext({ fbc: "fb.1.1.GATE", tracking_opt_out: true }, gateReq);
  assertEquals(await recordToolGateLead(o.client, { runId: GATE_RUN, tool: "venues", email: "owner@example.org", name: null, ad: off }), `lead:tool:${GATE_RUN}`);
  const ctx = o.row("ad_match_contexts", (r) => r.subject_id === `tool:${GATE_RUN}`);
  assertEquals([ctx?.ad_tracking_opt_out, ctx?.fbc, ctx?.client_ip], [true, null, null]);
  assertEquals(await recordToolGateLead(o.client, { runId: GATE_RUN, tool: "venues", email: "owner@example.org", name: null, ad: null }), null, "no ad object: no Lead (today's rule)");
});

Deno.test("B20-gate-c the handler passes the unlocking email and the run's name to the lead", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertStringIncludes(src, '.select("id, tool, status, report, report_token, input")');
  assertMatch(src, /await recordToolGateLead\(supabase, \{\s*runId: runId as string,\s*tool,\s*email,\s*name: leadName,\s*ad: parseHostAdContext\(body\.ad, req\),/);
  assertStringIncludes(src, "contact: { email: input.email, name: input.name },");
});
