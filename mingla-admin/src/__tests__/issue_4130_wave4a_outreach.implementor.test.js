// Issue #4130 (Wave 4a) — Dashboard, Notifications, Hosts and creators,
// Inbound leads, Calendar.
//
//   W4A-1  Dashboard: trends coloured by direction; "Needs you today" lists a
//          failed source as failed (with Retry), never as nothing to do; the
//          page reads one admin aggregate, with no place stats, no raw table
//          counts and no buttons to pages that no longer exist
//   W4A-2  Notifications: new-ticket alerts are listed; Work card changes are
//          one grouped row; a resolved ticket's alert is not new; settings sit
//          behind the gear
//   W4A-3  Hosts and creators: the list is the default; the due chips follow
//          the server's rules (stale leaves out Lost and Passed); the funnel's
//          conversion and weakest step; the board holds only Replied onward;
//          phone numbers are hidden from card text; bulk reset goes through
//          the audited server function
//   W4A-4  Inbound leads: "no new lead" warning; a lead already in Hosts or
//          without a business name cannot be added; a tool lead's email goes
//          on the card as a contact detail; Competitor Ops left the page
//   W4A-5  Calendar: event times in the event's own time zone; test brands
//          hidden unless asked; Event runway and Content tabs, posts on the
//          Content tab by default
//   W4A-6  Server: every new function refuses anon and checks its gate; app
//          runs are never inbound leads
//
// Run: node --test src/__tests__/issue_4130_wave4a_outreach.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INBOUND_QUIET_DAYS, healthProblems, needsYouToday, queueHealthItem, weekTrend, weeklyRows } from "../lib/dashboardToday.js";
import { SUPPORT_ALERT_TYPES } from "../lib/emailAlerts.js";
import { alertIsNew, inAppRoute, inboxRows, markScope, tabCounts } from "../lib/notificationsInbox.js";
import {
  DUE_CHIPS, filterByDueChip, forDisplay, funnelSteps, inDueChip, lateStageDef, lateStageRange, maskPhones, staleIds,
} from "../lib/outreachView.js";
import { EMPTY_CRM_STATE, buildCrmSearch, parseCrmSearch } from "../lib/crmUrl.js";
import { leadView, quietWarning, toolLeadHostFields } from "../lib/inboundLeads.js";
import { localWhen, testAnchorIds, visibleRunwayRows, zoneCity } from "../lib/calendarRunway.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const MIGRATION = fs.readFileSync(
  path.join(SRC, "../../supabase/migrations/20280114004130_issue_4130_dashboard_outreach_inbound.sql"),
  "utf8"
);

const HOSTS_DEF = {
  stages: [
    { id: "prospect", label: "Prospect" },
    { id: "contacted", label: "Contacted" },
    { id: "replied", label: "Replied" },
    { id: "meeting", label: "Meeting" },
    { id: "onboarded", label: "Onboarded" },
    { id: "live", label: "Live", auto: true },
    { id: "lost", label: "Lost", terminal: true },
  ],
};

describe("#4130 W4A-1: the Dashboard", () => {
  it("a week's trend reads up, down or level, with words", () => {
    assert.deepEqual(weekTrend(25, 21), { direction: "up", label: "19% vs the 7 days before" });
    assert.deepEqual(weekTrend(14, 20), { direction: "down", label: "30% vs the 7 days before" });
    assert.equal(weekTrend(5, 5).direction, "flat");
    assert.equal(weekTrend(3, 0).direction, "up");
    assert.equal(weekTrend(undefined, 2).direction, "flat");
  });

  it("a source that failed is listed as failed with Retry, never as nothing to do", () => {
    const items = needsYouToday({
      money: { status: "error", error: new Error("boom") },
      health: { status: "ready", data: { services: [] } },
      work: { status: "ready", data: { cards: 0 } },
      summary: { status: "ready", data: { support: { waiting_first_reply: 0 }, inbound: { days_since_last: 2 } } },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].tone, "error");
    assert.equal(items[0].retry, "money");
    assert.match(items[0].title, /Couldn't check money/);
  });

  it("lists what needs a person, most urgent first", () => {
    const items = needsYouToday({
      money: { status: "ready", data: { exceptions: { late_on_mingla: { count: 1 }, never_in_payout: { count: 7 } } } },
      health: { status: "ready", data: { services: [
        { service_key: "twilio", display_name: "Twilio", alert_state: "ok", layers: { a: { status: "degraded" } } },
        { service_key: "stripe", display_name: "Stripe", alert_state: "alerting", layers: {} },
        { service_key: "mapbox", display_name: "Mapbox", alert_state: "ok", layers: { a: { status: "healthy" } } },
      ] } },
      queue: { status: "error", error: new Error("Could not find the function public.admin_get_queue_health") },
      work: { status: "ready", data: { cards: 5 } },
      summary: { status: "ready", data: { support: { waiting_first_reply: 2 }, inbound: { days_since_last: 53 } } },
    });
    const ids = items.map((i) => i.id);
    assert.deepEqual(ids.slice(0, 3).sort(), ["health-stripe", "money-late", "money-never"].sort());
    assert.ok(ids.includes("health-twilio") && !ids.includes("health-mapbox"));
    assert.ok(ids.includes("queue-not-set-up"), "a missing queue function is a setup gap, not an outage");
    assert.ok(ids.includes("work-waiting") && ids.includes("support-waiting") && ids.includes("inbound-quiet"));
    assert.match(items.find((i) => i.id === "money-late").title, /^1 payout is late on Mingla$/);
    assert.match(items.find((i) => i.id === "inbound-quiet").title, /53 days/);
    const ranks = items.map((i) => ({ error: 0, bad: 1, warn: 2 })[i.tone]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  });

  it("no inbound warning while leads keep coming; a queue that loads says nothing", () => {
    const items = needsYouToday({ summary: { status: "ready", data: { support: {}, inbound: { days_since_last: INBOUND_QUIET_DAYS - 1 } } } });
    assert.equal(items.length, 0);
    assert.equal(queueHealthItem({ status: "ready" }), null);
    assert.equal(queueHealthItem({ status: "error", error: new Error("timeout") }).tone, "error");
    assert.equal(healthProblems(null).length, 0);
    assert.deepEqual(weeklyRows({ weekly: [{ week_start: "2026-10-19", signups: 3, paid_tickets: 4 }] }), [{ week: "2026-10-19", signups: 3, paidTickets: 4 }]);
  });

  it("the page reads one admin aggregate, colours trends by direction, and drops place stats and dead buttons", () => {
    const page = stripComments(read("pages/OverviewPage.jsx"));
    const service = read("services/dashboardService.js");
    assert.match(service, /rpc\("admin_dashboard_summary", \{ p_today: today \|\| null \}\)/);
    assert.ok(page.includes("getDashboardSummary(today)"));
    assert.ok(page.includes("trendTone(trendUpFromDirection(signups.direction))"));
    assert.ok(page.includes("headline(profit.data).profit.usdTotal"), "profit comes from the Wave 2a money summary");
    assert.ok(!/supabase\.from\(|STAT_CARDS|place_pool|place_scores|engagement_metrics/.test(page), "no table counts or place stats");
    assert.ok(!/onTabChange\("(reports|content|feedback)"\)/.test(page), "no buttons to pages that no longer exist");
    assert.ok(page.includes("<KpiFailed"), "a failed tile says it failed");
    assert.ok(!read("lib/constants.js").includes("STAT_CARDS"));
  });
});

describe("#4130 W4A-2: Notifications", () => {
  const inbox = {
    mentions: [
      { id: "m1", kind: "mention", actor_name: "Abimbola", body_excerpt: "Can you approve?", deep_link: "https://admin.usemingla.com/#/work-board?card=1", created_at: "2026-10-26T10:00:00Z", read_at: null },
      { id: "m2", kind: "work_update", card_id: "c1", actor_name: "Claude", body_excerpt: "moved", created_at: "2026-10-26T09:00:00Z", read_at: null },
      { id: "m3", kind: "work_update", card_id: "c1", actor_name: "Claude", body_excerpt: "closed", created_at: "2026-10-26T08:00:00Z", read_at: null },
      { id: "m4", kind: "work_update", card_id: "c2", actor_name: "Seth", body_excerpt: "updated", created_at: "2026-10-25T08:00:00Z", read_at: "2026-10-25T09:00:00Z" },
    ],
    alerts: [
      { id: "a1", type: "business.support_new_ticket", title: "New ticket", body: "Can't add my bank", created_at: "2026-10-26T11:00:00Z", read_at: null, ticket_resolved: false },
      { id: "a2", type: "business.support_new_ticket", title: "New ticket", body: "Old one", created_at: "2026-10-20T11:00:00Z", read_at: null, ticket_resolved: true },
    ],
    unread: { mentions: 1, work_updates: 2, support: 1 },
  };

  it("new-ticket alerts are listed", () => {
    assert.ok(SUPPORT_ALERT_TYPES.includes("business.support_new_ticket"));
    assert.ok(!SUPPORT_ALERT_TYPES.includes("admin.team_mention"));
  });

  it("Work updates are one grouped row; mentions keep who wrote them", () => {
    const rows = inboxRows(inbox, "all");
    const groups = rows.filter((r) => r.type === "work_group");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "2 Work cards changed");
    assert.equal(groups[0].unread, 2);
    assert.equal(rows.filter((r) => r.type === "mention").length, 1);
    assert.equal(rows.find((r) => r.type === "mention").title, "Abimbola mentioned you");
    assert.equal(inboxRows(inbox, "mentions").every((r) => r.type === "mention"), true);
    assert.equal(inboxRows(inbox, "support").length, 2);
  });

  it("a resolved ticket's alert is not new; counts come from the server", () => {
    assert.equal(alertIsNew(inbox.alerts[0]), true);
    assert.equal(alertIsNew(inbox.alerts[1]), false);
    assert.equal(inboxRows(inbox, "support").find((r) => r.id === "a-a2").isNew, false);
    assert.deepEqual(tabCounts(inbox, [{ id: "q" }]), { all: 5, mentions: 1, support: 1, system: 1 });
    assert.equal(markScope("system"), "all");
    assert.equal(markScope("mentions"), "mentions");
    assert.equal(inAppRoute("https://admin.usemingla.com/#/work-board?card=1"), "#/work-board?card=1");
    assert.equal(inAppRoute("https://evil.example/#/work-board"), null);
  });

  it("inbox first, Mark all read on the server, settings behind the gear", () => {
    const page = stripComments(read("pages/NotificationsPage.jsx"));
    assert.ok(page.indexOf("<Tabs") < page.indexOf("<EmailSettings open"), "the inbox comes before the settings");
    assert.match(page, /\{settingsOpen && <EmailSettings open/);
    assert.match(page, /markInboxRead\(markScope\(tab\), SUPPORT_ALERT_TYPES\)/);
    assert.match(read("services/dashboardService.js"), /rpc\("team_inbox_mark_read", \{ p_scope: scope, p_alert_types: alertTypes \}\)/);
    assert.ok(!/A teammate"\}\{!mention/.test(page));
  });
});

describe("#4130 W4A-3: Hosts and creators", () => {
  const today = "2026-10-26";
  const cards = [
    { id: "t", stage: "contacted", due_on: "2026-10-26", region_id: "r" },
    { id: "w", stage: "prospect", due_on: "2026-11-01", region_id: "r" },
    { id: "far", stage: "prospect", due_on: "2026-11-02", region_id: "r" },
    { id: "s", stage: "contacted", due_on: "2026-10-20", region_id: null },
    { id: "lost", stage: "lost", due_on: "2026-10-01", region_id: "r" },
    { id: "r", stage: "replied", due_on: null, region_id: "r" },
  ];

  it("the list is the default view; the board and the due chip have their own address", () => {
    assert.equal(EMPTY_CRM_STATE.view, "list");
    assert.equal(buildCrmSearch({ view: "list" }), "");
    assert.equal(buildCrmSearch({ view: "board", due: "stale" }), "view=board&due=stale");
    assert.equal(parseCrmSearch("due=stale").due, "stale");
    assert.equal(parseCrmSearch("due=__proto__").due, "");
  });

  it("the chips follow the server's rules", () => {
    assert.deepEqual(filterByDueChip(cards, "today", today).map((c) => c.id), ["t"]);
    assert.deepEqual(filterByDueChip(cards, "week", today).map((c) => c.id), ["t", "w"]);
    assert.deepEqual(filterByDueChip(cards, "stale", today).map((c) => c.id), ["s"], "Lost is never stale");
    assert.deepEqual(filterByDueChip(cards, "replied", today).map((c) => c.id), ["r"]);
    assert.deepEqual(filterByDueChip(cards, "noregion", today).map((c) => c.id), ["s"]);
    assert.deepEqual(filterByDueChip(cards, "nodue", today).map((c) => c.id), ["r"]);
    assert.equal(filterByDueChip(cards, "", today).length, cards.length);
    assert.deepEqual(staleIds(cards, today), ["s"]);
    assert.equal(inDueChip(null, "stale", today), false);
    assert.deepEqual(DUE_CHIPS.hosts.map((c) => c.label), ["Due today", "This week", "Stale", "Replied, waiting on us"]);
  });

  it("the funnel shows each step's conversion and marks the weakest", () => {
    // #4130: made-up stage counts (never production pipeline figures).
    const steps = funnelSteps(HOSTS_DEF, { prospect: 200, contacted: 250, replied: 10, meeting: 6, onboarded: 5, live: 4, lost: 30 });
    assert.deepEqual(steps.map((s) => s.id), ["prospect", "contacted", "replied", "meeting", "onboarded", "live"]);
    const replied = steps.find((s) => s.id === "replied");
    assert.equal(replied.conversion, 4);
    assert.equal(replied.weakest, true);
    assert.equal(steps.filter((s) => s.weakest).length, 1);
    assert.equal(steps[0].conversion, null);
  });

  it("the board holds Replied onward, without Lost", () => {
    assert.deepEqual(lateStageDef(HOSTS_DEF).stages.map((s) => s.id), ["replied", "meeting", "onboarded", "live"]);
    assert.equal(lateStageRange(HOSTS_DEF), "Replied → Live");
  });

  it("phone numbers are hidden from card text; dates and prices are not", () => {
    assert.equal(maskPhones("WhatsApp +234 803 555 0101 tomorrow"), "WhatsApp +••• 101 tomorrow");
    assert.equal(maskPhones("Call (919) 555-0101."), "Call ••• 101.");
    assert.equal(maskPhones("Call 08035550101"), "Call ••• 101");
    for (const keep of ["Onboarding call 2026-10-29 10:30", "Offer ₦80,000 (1000000 views)", "Send welcome + giveaway offer"]) {
      assert.equal(maskPhones(keep), keep);
    }
    const card = { id: "1", stage: "contacted", next_action: "Text 0803 555 0101" };
    assert.equal(forDisplay(card).next_action, "Text ••• 101");
    assert.equal(card.next_action, "Text 0803 555 0101", "the card itself is untouched (the drawer edits the real text)");
  });

  it("the page draws masked rows, the late-stage board, and resets through the audited server function", () => {
    const page = stripComments(read("pages/PipelinePage.jsx"));
    assert.match(page, /const listRecords = useMemo\(\(\) => dueShown\.map\(forDisplay\), \[dueShown\]\);/);
    assert.match(page, /<PipelineList\s+def=\{def\}\s+records=\{listRecords\}/);
    assert.match(page, /<PipelineBoard\s+def=\{boardDef\}\s+records=\{boardRecords\}/);
    assert.match(page, /resetStaleDue\(pipeline, staleOnScreen\.map\(\(r\) => r\.id\), newDue, today\)/);
    assert.match(page, /<ResetDueModal/);
    assert.match(read("services/dashboardService.js"), /rpc\("outreach_reset_stale_due"/);
    const hub = read("pages/HostsAndCreatorsHub.jsx");
    assert.match(hub, /canOpenOwnPage\(access, tab\.hosts\)/, "each tab only to whoever could open its old page");
    assert.match(hub, /getOutreachSummary\(localToday\(\)\)/);
  });
});

describe("#4130 W4A-4: Inbound leads", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  it("warns when no lead arrived for two weeks", () => {
    assert.equal(quietWarning({ last_lead_at: "2026-10-20T12:00:00Z" }, now), null);
    assert.deepEqual(quietWarning({ last_lead_at: "2026-09-03T12:00:00Z" }, now), { days: 53, lastAt: "2026-09-03T12:00:00Z" });
    assert.deepEqual(quietWarning({ last_lead_at: null }, now), { days: null, lastAt: null });
    assert.equal(quietWarning(null, now), null);
  });

  it("a lead already in Hosts, or without a business name, cannot be added", () => {
    assert.equal(leadView({ id: "1", source: "beta", business: "Kitchen", host: { id: "h" } }).canAdd, false);
    assert.equal(leadView({ id: "2", source: "tool", business: null }).canAdd, false);
    assert.equal(leadView({ id: "3", source: "tool", tool: "venues", business: "Rooftop" }).canAdd, true);
    assert.equal(leadView({ id: "3", source: "tool", tool: "venues", business: "Rooftop" }).tool, "Venue website grader");
  });

  it("a tool lead's email goes on the card as a contact detail", () => {
    assert.deepEqual(toolLeadHostFields({ business: "Rooftop" }, { email: " owner@rooftop.example " }), {
      name: "Rooftop", source: "inbound", identifiers: [{ kind: "email", value: "owner@rooftop.example" }], channel: "email",
    });
    assert.deepEqual(toolLeadHostFields({ business: "Rooftop" }, null), { name: "Rooftop", source: "inbound" });
  });

  it("the page reads the one inbound list, asks before Add to Hosts, and no longer holds Competitor Ops", () => {
    const page = stripComments(read("pages/InboundLeadsPage.jsx"));
    assert.match(read("services/dashboardService.js"), /rpc\("admin_inbound_leads", \{ p_show_test: !!showTest, p_limit: 500 \}\)/);
    assert.ok(page.includes("listInboundLeads(showTest)"));
    assert.ok(!/CompetitorOps|tool_leads|lane/.test(page));
    assert.match(page, /<Modal open=\{!!confirm\}/);
    assert.match(page, /betaLeadToHost\(lead\.id\)/);
    assert.match(read("pages/ToolLeadsPage.jsx"), /export function CompetitorOpsPanel/);
    assert.match(read("App.jsx"), /inbound: InboundLeadsPage,/);
  });
});

describe("#4130 W4A-5: Calendar", () => {
  it("event times are the event's own local time", () => {
    assert.equal(localWhen({ start_at: "2026-12-19T20:00:00Z", timezone: "Africa/Lagos" }), "19 Dec, 21:00 Lagos");
    assert.equal(localWhen({ start_at: "2026-11-08T13:00:00Z", timezone: "America/New_York" }), "8 Nov, 08:00 New York");
    assert.equal(localWhen({ start_on: "2026-11-08" }), "8 Nov, time not set");
    assert.equal(zoneCity("America/New_York"), "New York");
  });

  it("test brands are hidden unless asked; search covers title and host", () => {
    const rows = [
      { anchor_id: "a", title: "Detty December", host_name: "Harmattan Club", is_test: false },
      { anchor_id: "b", title: "Staff test night", brand_name: "Mingla Staff", is_test: true },
    ];
    assert.deepEqual(visibleRunwayRows(rows).map((r) => r.anchor_id), ["a"]);
    assert.deepEqual(visibleRunwayRows(rows, { showTest: true }).map((r) => r.anchor_id), ["a", "b"]);
    assert.deepEqual(visibleRunwayRows(rows, { q: "harmattan" }).map((r) => r.anchor_id), ["a"]);
    assert.deepEqual([...testAnchorIds(rows)], ["b"]);
  });

  it("Event runway and Content tabs; posts show by default on Content", () => {
    const page = stripComments(read("pages/ContentCalendarPage.jsx"));
    assert.match(page, /\{ id: "events", label: "Event runway" \}/);
    assert.match(page, /\{ id: "posts", label: "Content" \}/);
    assert.match(page, /return show === "posts" \? "board" : "list";/);
    assert.match(page, /getCalendarRunway\(runwayFrom, runwayTo, todayIso\(\)\)/);
    assert.match(page, /\{localWhen\(r\)\}/);
  });
});

describe("#4130 W4A-6: the server functions", () => {
  const fns = [
    "admin_dashboard_summary(date)", "admin_inbound_leads(boolean, integer)", "outreach_summary(date)",
    "outreach_reset_stale_due(text, uuid[], date, date)", "team_inbox(text[], integer)",
    "team_inbox_mark_read(text, text[])", "calendar_runway(date, date, date)",
  ];
  it("every client function refuses anon and is SECURITY DEFINER with a pinned search path", () => {
    for (const fn of fns) {
      assert.ok(MIGRATION.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`), fn);
      const name = fn.split("(")[0];
      const body = MIGRATION.slice(MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`));
      assert.match(body.slice(0, 600), /SECURITY DEFINER\s+SET search_path = public, pg_temp/, name);
    }
  });
  it("each checks who is asking first", () => {
    const first = (name) => {
      const body = MIGRATION.slice(MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`));
      return body.slice(body.indexOf("BEGIN") + 5).trim().split("\n")[0];
    };
    assert.match(first("admin_dashboard_summary"), /IF NOT public\.is_admin_user\(\) THEN RAISE EXCEPTION 'not_authorized'/);
    assert.match(first("admin_inbound_leads"), /IF NOT \(public\.is_admin_user\(\) OR COALESCE\(public\.admin_team_can\('beta_leads'\), false\)\)/);
    assert.match(first("outreach_summary"), /SELECT \* INTO v FROM public\.crm_ctx\(\);/);
    assert.match(first("outreach_reset_stale_due"), /SELECT \* INTO v FROM public\.crm_ctx\(\);/);
    assert.match(first("team_inbox"), /IF NOT public\.issue_3720_active_team_member\(v_me\)/);
    assert.match(first("calendar_runway"), /SELECT \* INTO v FROM public\.crm_ctx\(\);/);
  });
  it("app runs are never inbound leads, and web tool leads are admin-only", () => {
    assert.match(MIGRATION, /WHERE v_tools AND l\.lane = 'web'/);
    assert.match(MIGRATION, /v_tools := public\.is_admin_user\(\);/);
  });
});
