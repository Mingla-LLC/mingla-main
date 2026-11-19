// Issue #4453 — website change requests on the Admin Support desk: the
// "Website changes" view, the request details, the 24-hour clock and the
// "Ready for review" button.
//
// MINGLA-INVARIANT: I-4453-WEBSITE-CLOCK-ONE-RULE | issue #4453 | A website change request reads as overdue on the desk exactly when it is still open, not yet marked ready and its due time has passed; a ready or finished request never shows a running clock.
// MINGLA-INVARIANT: I-4453-WEBSITE-READY-THROUGH-RPC | issue #4453 | The desk marks a website change request ready only through the issue_4453_website_request_ready RPC; it never writes support_website_requests or support_tickets from the browser, and the button is held while a press is in flight or after the owner has been told.
//
// FAILS-ON-REVERT: drop the "website" view or its topic rule and the view tests fail; let a
// ready or resolved request keep a running clock, or stop using the desk's overdue rule, and
// the clock tests fail; let the button fire while sending or after the owner was told, or
// write the table directly, and the Ready tests fail; make a failed detail read throw and
// the "inbox still loads" test fails.
//
// Run: node --test src/__tests__/issue4453_website_requests.implementor.test.js

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SUPPORT_INBOX_VIEWS,
  inboxViewCoverage,
  isOverdueTicket,
  supportInboxCounts,
  supportInboxRows,
} from "../lib/supportTicketMetrics.js";
import {
  READY_NOTE_MAX,
  WEBSITE_TOPIC,
  adminSiteHref,
  formatSpan,
  isWebsiteRequestTicket,
  readyButtonState,
  readyErrorMessage,
  websiteRequestClock,
  websiteRequestCouldNot,
  websiteRequestDueAt,
  websiteRequestWhere,
} from "../lib/websiteRequestModel.js";
import { TOPIC_LABEL } from "../components/support/supportOptions.js";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const now = Date.parse("2026-11-19T12:00:00Z");
const HOUR = 3_600_000;
const at = (offsetHours) => new Date(now + offsetHours * HOUR).toISOString();

function request(overrides = {}) {
  return {
    ticket_id: "t", brand_id: "b-1", site_id: "site-1", page_path: "/", section_id: "sec-1",
    section_label: "Top of the page", what: "Add a video background", why: "Launch film",
    missing_capability: "Ari cannot add video", draft_digest: "sha256:abc", due_at: at(5),
    ready_at: null, ready_by: null, ready_note: null, ...overrides,
  };
}

function ticket(id, overrides = {}, requestOverrides = {}) {
  const website = overrides.website_request === null ? null : request({ ticket_id: id, ...requestOverrides });
  return {
    id, ticket_number: 2000, subject: `Website change: ${id}`, origin: "customer", visibility: "brand",
    requester_segment: "business", topic: WEBSITE_TOPIC, status: "new", last_sender_kind: "customer",
    assigned_staff_id: null, brand_id: "b-1", priority: "normal", last_message_at: at(-1),
    next_update_at: website?.due_at ?? at(5), ...overrides, website_request: website,
  };
}

describe("#4453: the Website changes view", () => {
  const rows = [
    ticket("late", {}, { due_at: at(-3) }),
    ticket("soon", {}, { due_at: at(2) }),
    ticket("later", { status: "open", last_sender_kind: "staff" }, { due_at: at(20) }),
    ticket("ready", { status: "pending", next_update_at: at(160) }, { due_at: at(-10), ready_at: at(-1) }),
    ticket("done", { status: "resolved", next_update_at: at(160) }, { due_at: at(-30), ready_at: at(-20) }),
    { id: "payout", topic: "payouts", origin: "customer", status: "open", last_sender_kind: "customer", last_message_at: at(-2) },
    { id: "untopiced", topic: null, origin: "customer", status: "open", last_sender_kind: "customer", last_message_at: at(-2) },
  ];
  const base = { nowMs: now, me: "staff-me" };

  it("is in the rail, in the Work group, after Waiting on customer", () => {
    const ids = SUPPORT_INBOX_VIEWS.map((view) => view.id);
    assert.equal(ids.indexOf("website"), ids.indexOf("waiting") + 1);
    const view = SUPPORT_INBOX_VIEWS.find((entry) => entry.id === "website");
    assert.deepEqual({ ...view }, { id: "website", label: "Website changes", group: "Work" });
    assert.equal(TOPIC_LABEL.website_change, "Website change");
  });

  it("lists active tickets with the website topic only: to-do first by due time, then the ready ones", () => {
    assert.deepEqual(supportInboxRows(rows, "website", base).map((row) => row.id), ["late", "soon", "later", "ready"]);
    assert.equal(supportInboxCounts(rows, base).website, 4);
  });

  it("its count equals its rows under the Opened-by switch, filters and search", () => {
    for (const ctx of [base, { ...base, openedBy: "staff" }, { ...base, filters: { brand: "b-1" } }, { ...base, filters: { owner: "none" } }, { ...base, search: "soon" }]) {
      assert.equal(supportInboxCounts(rows, ctx).website, supportInboxRows(rows, "website", ctx).length);
    }
    assert.equal(supportInboxCounts(rows, { ...base, search: "soon" }).website, 1);
  });

  it("is a work view: every active ticket is loaded, so it never needs Load older", () => {
    const coverage = inboxViewCoverage({ activeLoaded: 10, activeTotal: 10, closedLoaded: 300, closedTotal: 900 }, "website");
    assert.deepEqual(coverage, { partial: false, loaded: 10, total: 10, canLoadOlder: false });
  });

  it("the other views still see website tickets by their own rules", () => {
    assert.deepEqual(supportInboxRows(rows, "overdue", base).map((row) => row.id), ["late"]);
    assert.ok(supportInboxRows(rows, "waiting", base).some((row) => row.id === "ready"));
    assert.ok(supportInboxRows(rows, "resolved", base).some((row) => row.id === "done"));
  });
});

describe("#4453: the 24-hour clock", () => {
  it("counts down, turns to a warning in the last four hours, then reads overdue", () => {
    assert.deepEqual(websiteRequestClock(ticket("a", {}, { due_at: at(23.5) }), now), { state: "due", label: "Due in 23h", tone: "info" });
    assert.deepEqual(websiteRequestClock(ticket("a", {}, { due_at: at(3) }), now), { state: "due", label: "Due in 3h", tone: "warning" });
    assert.deepEqual(websiteRequestClock(ticket("a", {}, { due_at: at(0.5) }), now), { state: "due", label: "Due in 30 min", tone: "warning" });
    assert.deepEqual(websiteRequestClock(ticket("a", {}, { due_at: at(-2) }), now), { state: "overdue", label: "Overdue by 2h", tone: "error" });
    assert.deepEqual(websiteRequestClock(ticket("a", {}, { due_at: at(-75) }), now), { state: "overdue", label: "Overdue by 3d 3h", tone: "error" });
  });

  it("agrees with the desk's own overdue rule for an unready request", () => {
    for (const offset of [-30, -1, -0.01, 0.01, 1, 30]) {
      const row = ticket("a", {}, { due_at: at(offset) });
      assert.equal(websiteRequestClock(row, now).state === "overdue", isOverdueTicket(row, now), `offset ${offset}h`);
    }
  });

  it("stops once the request is ready or finished", () => {
    assert.deepEqual(websiteRequestClock(ticket("a", { status: "pending" }, { due_at: at(-9), ready_at: at(-1) }), now), { state: "ready", label: "Ready for review", tone: "success" });
    assert.equal(websiteRequestClock(ticket("a", { status: "resolved" }, { due_at: at(-9) }), now).state, "done");
    assert.equal(websiteRequestClock(ticket("a", { status: "closed" }, { due_at: at(-9), ready_at: at(-1) }), now).state, "done");
  });

  it("falls back to the ticket's promised update when the details did not load, and ignores other topics", () => {
    const bare = ticket("a", { website_request: null, next_update_at: at(-1) });
    assert.equal(websiteRequestDueAt(bare), at(-1));
    assert.equal(websiteRequestClock(bare, now).state, "overdue");
    assert.equal(websiteRequestClock(ticket("a", { website_request: null, next_update_at: null }), now).label, "No due time");
    assert.equal(websiteRequestClock({ topic: "payouts", status: "open", next_update_at: at(-1) }, now).state, "none");
    assert.equal(isWebsiteRequestTicket({ topic: "payouts" }), false);
  });

  it("writes lengths of time plainly", () => {
    assert.equal(formatSpan(0), "1 min");
    assert.equal(formatSpan(59 * 60_000), "59 min");
    assert.equal(formatSpan(HOUR), "1h");
    assert.equal(formatSpan(47.9 * HOUR), "47h");
    assert.equal(formatSpan(48 * HOUR), "2d");
  });
});

describe("#4453: the request details", () => {
  it("says where on the site in plain words", () => {
    assert.equal(websiteRequestWhere(request()), "Home page · Top of the page");
    assert.equal(websiteRequestWhere(request({ page_path: "/menu", section_label: null })), "/menu");
    assert.equal(websiteRequestWhere(request({ page_path: null, section_label: null })), "The whole website");
    assert.equal(websiteRequestWhere(null), "");
  });

  it("what Ari could not do is plain words, never a bare code", () => {
    assert.equal(websiteRequestCouldNot({ missing_capability: "The website has no live chat section yet." }), "The website has no live chat section yet.");
    assert.equal(websiteRequestCouldNot({ missing_capability: "custom_change" }), "A custom change the website editor has no control for yet");
    assert.equal(websiteRequestCouldNot({ missing_capability: "  " }), "");
    assert.equal(websiteRequestCouldNot(null), "");
  });

  it("links to the brand's website in Admin, with the id escaped", () => {
    assert.equal(adminSiteHref(request()), "#/brand-sites?siteId=site-1");
    assert.equal(adminSiteHref(request({ site_id: "a b&c" })), "#/brand-sites?siteId=a%20b%26c");
    assert.equal(adminSiteHref(request({ site_id: null })), null);
  });

  it("the panel shows what, where, why, what Ari could not do, the draft version, the clock and the site link", () => {
    const box = read("components/support/WebsiteRequestBox.jsx");
    for (const label of ['label="What"', 'label="Where"', 'label="Why"', 'label="Ari could not"', 'label="Draft version"']) {
      assert.ok(box.includes(label), label);
    }
    assert.match(box, /<Badge variant=\{clock\.tone\}>\{clock\.label\}<\/Badge>/);
    assert.match(box, /Open this brand's website/);
    assert.match(box, /no request details/);
    const panel = read("components/support/TicketPanel.jsx");
    assert.match(panel, /\{isWebsiteRequestTicket\(ticket\) && \(\s*<WebsiteRequestBox/);
    // The request sits above the thread, inside the scrolling area, and the composer stays pinned below.
    assert.ok(panel.indexOf("<WebsiteRequestBox") > panel.indexOf('data-testid="ticket-panel-scroll"'));
    assert.ok(panel.indexOf("<WebsiteRequestBox") < panel.indexOf('data-testid="ticket-thread"'));
    assert.ok(panel.indexOf("<SupportComposer") > panel.indexOf("<WebsiteRequestBox"));
  });

  it("an inbox row shows the clock instead of a second Overdue badge", () => {
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /const clock = isWebsiteRequestTicket\(t\) \? websiteRequestClock\(t\) : null;/);
    assert.match(desk, /\{clock && clock\.state !== "done"\s*\? <Badge variant=\{clock\.tone\}>\{clock\.label\}<\/Badge>\s*: isOverdueTicket\(t\) && <Badge variant="error">Overdue<\/Badge>\}/);
    assert.match(desk, /view === "website" \? "No website change requests are open\."/);
  });
});

describe("#4453: Ready for review", () => {
  it("can be pressed on an active request that has not been marked ready", () => {
    assert.deepEqual(readyButtonState(ticket("a")), { ok: true, reason: "" });
    assert.equal(readyButtonState(ticket("a", { status: "open" })).ok, true);
    // After the owner replied (the ticket reopened) it can be marked ready again.
    assert.equal(readyButtonState(ticket("a", { status: "open" }, { ready_at: at(-5) })).ok, true);
    assert.equal(readyButtonState(ticket("a"), { note: "x".repeat(READY_NOTE_MAX) }).ok, true);
  });

  it("is held, with the reason in words, in every other case", () => {
    assert.match(readyButtonState(ticket("a"), { sending: true }).reason, /Telling the owner/);
    assert.match(readyButtonState(ticket("a", { status: "pending" }, { ready_at: at(-1) })).reason, /owner has been told/);
    assert.match(readyButtonState(ticket("a", { status: "resolved" })).reason, /finished/);
    assert.match(readyButtonState(ticket("a", { status: "closed" })).reason, /finished/);
    assert.match(readyButtonState(ticket("a", { website_request: null })).reason, /no request details/);
    assert.match(readyButtonState({ topic: "payouts", status: "open" }).reason, /not a website change request/);
    assert.match(readyButtonState(ticket("a"), { note: "x".repeat(READY_NOTE_MAX + 1) }).reason, /under 1000 characters/);
    for (const state of [readyButtonState(ticket("a"), { sending: true }), readyButtonState(ticket("a", { status: "closed" }))]) {
      assert.equal(state.ok, false);
    }
  });

  it("the button obeys that rule, shows it is working, and shows a refusal beside it", () => {
    const box = read("components/support/WebsiteRequestBox.jsx");
    assert.match(box, /const ready = readyButtonState\(ticket, \{ sending, note \}\);/);
    assert.match(box, /if \(!ready\.ok\) return;/);
    assert.match(box, /loading=\{sending\} disabled=\{!ready\.ok\} onClick=\{\(\) => void press\(\)\}>\s*Ready for review/);
    assert.match(box, /\{error \? \(\s*<p role="alert"/);
    assert.match(box, /<label htmlFor=\{noteId\}/);
    assert.match(box, /else setError\(result\?\.error \|\| "Couldn't mark this ready"\);/);
  });

  it("goes through the RPC only, with an empty note sent as null", () => {
    const service = read("services/supportDeskService.js");
    assert.match(service, /supabase\.rpc\("issue_4453_website_request_ready", \{\s*p_ticket_id: ticketId,\s*p_note: trimmed \|\| null,\s*\}\)/);
    assert.doesNotMatch(service, /from\("support_website_requests"\)\s*\.(insert|update|upsert|delete)/);
    assert.doesNotMatch(service, /from\("support_tickets"\)\s*\.(insert|update|upsert|delete)/);
    const desk = read("pages/SupportDeskPage.jsx");
    assert.match(desk, /const res = await markWebsiteRequestReady\(ticketId, note\);/);
    assert.match(desk, /onWebsiteReady=\{handleWebsiteReady\}/);
    assert.match(desk, /logAdminAction\("support\.website_request_ready", "support_ticket", ticketId,/);
    // A refused press reaches the box (returned), a session expiry reaches the banner.
    assert.match(desk, /\} else \{\s*noteResult\(res\);\s*\}\s*return res;/);
  });

  it("says a refusal in plain words", () => {
    assert.equal(readyErrorMessage("forbidden"), "Only Support staff can mark a request ready.");
    assert.equal(readyErrorMessage("illegal_transition"), "This request is finished. Set it back to Open first.");
    assert.equal(readyErrorMessage("ticket_closed"), "This ticket is closed. Set it back to Open first.");
    assert.equal(readyErrorMessage("request_not_found"), "This ticket has no website request details.");
    assert.match(readyErrorMessage("note_too_long"), /under 1000 characters/);
    assert.match(readyErrorMessage("Could not find the function public.issue_4453_website_request_ready(p_note, p_ticket_id) in the schema cache"), /aren't live in the database yet/);
    assert.equal(readyErrorMessage("network down"), "network down");
    assert.equal(readyErrorMessage(""), "Couldn't mark this ready");
  });
});

describe("#4453: loading the details", () => {
  it("reads the detail rows for website tickets only, and a failed read never blocks the inbox", () => {
    const service = read("services/supportDeskService.js");
    assert.match(service, /tickets\.filter\(\(ticket\) => ticket\.topic === WEBSITE_TOPIC\)\.map\(\(ticket\) => ticket\.id\)/);
    assert.match(service, /website_request: websiteRequests\.get\(ticket\.id\) \|\| null,/);
    assert.match(service, /if \(error\) \{\s*console\.warn\([^)]*\);\s*return byTicket;\s*\}/);
    // The ticket query still asks for the topic.
    assert.match(service, /"visibility", "origin", "topic", "product_area", "client_meta",/);
  });
});
