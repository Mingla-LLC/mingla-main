// Issue #4111 (D8 / D11) — Admin → Community & Support → Reported enquiries.
//
// Mingla staff see an enquiry only after the brand or the guest reports it.
// This suite proves the panel's states (loading, error with retry, empty,
// populated), its two actions (Dismiss; Block everywhere behind a confirmation
// built into the page, never window.confirm), the service's RPC calls, and
// that only the Community (moderate) area sees the tab.
//
// It renders the real components through Vite's SSR loader, so it needs the
// admin app's packages: run `npm ci` in mingla-admin first. Without them it
// FAILS; it never skips.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  INITIAL_REPORTED_ENQUIRIES_STATE,
  REPORTED_ENQUIRIES_EMPTY_COPY,
  loadReportedEnquiries,
  reportedEnquiriesReducer,
  reporterLabel,
  runReportedEnquiryAction,
} from "../lib/reportedEnquiries.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_OPERATIONS_AREA, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA } from "../lib/access.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.resolve(HERE, "../..");
const read = (relative) => readFileSync(path.join(ADMIN_ROOT, "src", relative), "utf8");

const ROW_A = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  brand_id: "b-1",
  brand_name: "Lantern Room",
  brand_slug: "lantern-room",
  guest_name: "Ada Guest",
  guest_email: "ada@example.test",
  has_account: true,
  source: "web",
  topic_label: "Refund",
  status: "waiting",
  spam_flag: false,
  reported_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  reporter_side: "guest",
  report_reason: "The brand asked me to pay outside Mingla",
  messages: [
    { id: "m1", who: "guest", display: "Ada Guest", body: "Can I get a refund?", at: new Date().toISOString(), mine: false },
    { id: "m2", who: "brand", display: "Tunde (Lantern Room)", body: "Pay me by bank transfer instead", at: new Date().toISOString(), mine: false },
  ],
});
const ROW_B = Object.freeze({
  ...ROW_A,
  id: "22222222-2222-4222-8222-222222222222",
  brand_name: "Soft Life",
  guest_name: "Spam Sender",
  guest_email: "spam@example.test",
  has_account: false,
  reporter_side: "brand",
  report_reason: "Spam",
  messages: [],
});

function recordingService(overrides = {}) {
  const calls = [];
  return {
    calls,
    async listReportedEnquiries() { calls.push(["list"]); return [ROW_A, ROW_B]; },
    async dismissEnquiryReport(id) { calls.push(["dismiss", id]); return true; },
    async blockEnquirySenderEverywhere(id) { calls.push(["block", id]); return true; },
    ...overrides,
  };
}

/** Drives the pure reducer the way useReducer does. */
function harness(initial = INITIAL_REPORTED_ENQUIRIES_STATE) {
  let state = initial;
  return {
    dispatch: (event) => { state = reportedEnquiriesReducer(state, event); },
    get state() { return state; },
  };
}

describe("#4111 reported enquiries — model and actions", () => {
  it("loads only what the server returns, then Dismiss calls the dismiss RPC and removes the row", async () => {
    const service = recordingService();
    const h = harness();
    assert.equal(h.state.status, "loading");
    await loadReportedEnquiries(h.dispatch, service);
    assert.equal(h.state.status, "ready");
    assert.deepEqual(h.state.rows.map((r) => r.id), [ROW_A.id, ROW_B.id]);

    const ok = await runReportedEnquiryAction(h.dispatch, service, { id: ROW_A.id, kind: "dismiss" });
    assert.equal(ok, true);
    assert.deepEqual(service.calls, [["list"], ["dismiss", ROW_A.id]]);
    assert.deepEqual(h.state.rows.map((r) => r.id), [ROW_B.id]);
    assert.equal(h.state.notice, "Report dismissed.");
    assert.equal(h.state.busy, null);
  });

  it("Block everywhere waits for the in-page confirmation, then calls the block RPC", async () => {
    const service = recordingService();
    const h = harness();
    await loadReportedEnquiries(h.dispatch, service);
    h.dispatch({ type: "ask_block", id: ROW_B.id });
    assert.equal(h.state.confirmBlockId, ROW_B.id);
    assert.deepEqual(service.calls, [["list"]], "asking to block must not call the server");
    h.dispatch({ type: "cancel_block" });
    assert.equal(h.state.confirmBlockId, null);
    assert.equal(h.state.rows.length, 2, "cancel keeps the report");

    h.dispatch({ type: "ask_block", id: ROW_B.id });
    await runReportedEnquiryAction(h.dispatch, service, { id: ROW_B.id, kind: "block" });
    assert.deepEqual(service.calls, [["list"], ["block", ROW_B.id]]);
    assert.deepEqual(h.state.rows.map((r) => r.id), [ROW_A.id]);
    assert.equal(h.state.confirmBlockId, null);
    assert.match(h.state.notice, /blocked everywhere/);
  });

  it("no silent failures: a failed load is an error state, a failed action keeps the row and says why", async () => {
    const failing = recordingService({
      async listReportedEnquiries() { throw new Error("You need a Community & Support role to review reported enquiries."); },
    });
    const h = harness();
    await loadReportedEnquiries(h.dispatch, failing);
    assert.equal(h.state.status, "error");
    assert.match(h.state.loadError, /Community & Support role/);

    const blockFails = recordingService({
      async blockEnquirySenderEverywhere() { throw new Error(""); },
    });
    const h2 = harness();
    await loadReportedEnquiries(h2.dispatch, blockFails);
    const ok = await runReportedEnquiryAction(h2.dispatch, blockFails, { id: ROW_A.id, kind: "block" });
    assert.equal(ok, false);
    assert.equal(h2.state.rows.length, 2);
    assert.equal(h2.state.actionError.id, ROW_A.id);
    assert.match(h2.state.actionError.message, /Couldn't block this sender\. Nothing changed/);
  });

  it("names who reported it", () => {
    assert.equal(reporterLabel("brand"), "Reported by the brand");
    assert.equal(reporterLabel("guest"), "Reported by the guest");
  });
});

describe("#4111 reported enquiries — rendered states and service", () => {
  let vite;
  let View;
  let Panel;
  let service;
  let supabaseModule;

  before(async () => {
    vite = await createServer({
      root: ADMIN_ROOT,
      appType: "custom",
      server: { middlewareMode: true },
      logLevel: "silent",
    });
    const panelModule = await vite.ssrLoadModule("/src/components/community/ReportedEnquiriesPanel.jsx");
    View = panelModule.ReportedEnquiriesView;
    Panel = panelModule.ReportedEnquiriesPanel;
    service = await vite.ssrLoadModule("/src/services/communityService.js");
    supabaseModule = await vite.ssrLoadModule("/src/lib/supabase.js");
  });
  after(async () => { await vite?.close(); });

  const noop = () => {};
  const render = (state) => renderToStaticMarkup(React.createElement(View, {
    state, onRetry: noop, onDismiss: noop, onAskBlock: noop, onCancelBlock: noop, onConfirmBlock: noop,
  }));
  const ready = (extra = {}) => ({ ...INITIAL_REPORTED_ENQUIRIES_STATE, status: "ready", rows: [ROW_A, ROW_B], ...extra });

  it("loading, error with retry, and empty states", () => {
    assert.match(render(INITIAL_REPORTED_ENQUIRIES_STATE), /aria-label="Loading reported enquiries"/);
    const error = render({ ...INITIAL_REPORTED_ENQUIRIES_STATE, status: "error", loadError: "Network down." });
    assert.match(error, /Couldn&#x27;t load reported enquiries/);
    assert.match(error, /Network down\./);
    assert.match(error, />Try again</);
    const empty = render({ ...INITIAL_REPORTED_ENQUIRIES_STATE, status: "ready", rows: [] });
    assert.ok(
      empty.includes(REPORTED_ENQUIRIES_EMPTY_COPY.replace("'", "&#x27;")),
      "empty copy is the approved sentence",
    );
    assert.equal(
      REPORTED_ENQUIRIES_EMPTY_COPY,
      "No reported enquiries. Mingla only sees an enquiry when the brand or the guest reports it.",
    );
  });

  it("each report shows brand, sender, who reported it, reason, when, and the messages, with both actions", () => {
    const html = render(ready());
    for (const text of [
      "Lantern Room", "Ada Guest", "ada@example.test", "Reported by the guest", "Reported by the brand",
      "Reason: The brand asked me to pay outside Mingla", "3h ago", "Can I get a refund?",
      "Pay me by bank transfer instead", "Tunde (Lantern Room)", "Soft Life", "No messages in this enquiry.",
    ]) assert.ok(html.includes(text), `missing: ${text}`);
    assert.equal((html.match(/>Dismiss</g) || []).length, 2);
    assert.equal((html.match(/>Block everywhere</g) || []).length, 2);
    assert.doesNotMatch(html, /role="alertdialog"/);
  });

  it("Block everywhere shows a confirmation inside the row, and action errors are shown", () => {
    const html = render(ready({ confirmBlockId: ROW_A.id, actionError: { id: ROW_B.id, message: "This report was already handled by someone else. Refresh the list." } }));
    assert.match(html, /role="alertdialog"/);
    assert.match(html, /Block Ada Guest everywhere\?/);
    assert.match(html, /from ada@example\.test or from their Mingla account/);
    assert.match(html, />Yes, block everywhere</);
    assert.match(html, />Cancel</);
    assert.match(html, /role="alert"[^>]*>This report was already handled/);
    const notice = render(ready({ notice: "Report dismissed." }));
    assert.match(notice, /role="status"[^>]*>Report dismissed\./);
    const source = read("components/community/ReportedEnquiriesPanel.jsx");
    assert.doesNotMatch(source, /window\.confirm|\bconfirm\(/);
  });

  it("the stateful panel renders its loading state first", () => {
    const html = renderToStaticMarkup(React.createElement(Panel, { service: recordingService() }));
    assert.match(html, /Loading reported enquiries/);
  });

  it("the service calls the three staff RPCs and turns their errors into plain words", async () => {
    const calls = [];
    const original = supabaseModule.supabase.rpc;
    let next = { data: [ROW_A], error: null };
    supabaseModule.supabase.rpc = async (name, args) => { calls.push([name, args]); return next; };
    try {
      assert.deepEqual(await service.listReportedEnquiries(), [ROW_A]);
      next = { data: true, error: null };
      assert.equal(await service.dismissEnquiryReport(ROW_A.id), true);
      assert.equal(await service.blockEnquirySenderEverywhere(ROW_A.id), true);
      assert.deepEqual(calls, [
        ["admin_list_reported_enquiries", { p_limit: 100 }],
        ["admin_enquiry_dismiss_report", { p_enquiry_id: ROW_A.id }],
        ["admin_enquiry_block_everywhere", { p_enquiry_id: ROW_A.id }],
      ]);
      next = { data: null, error: { message: "forbidden", code: "42501" } };
      await assert.rejects(service.listReportedEnquiries(), /Community & Support role/);
      next = { data: null, error: { message: "report_not_found", code: "P0002" } };
      await assert.rejects(service.dismissEnquiryReport(ROW_A.id), /already handled/);
      next = { data: false, error: null };
      await assert.rejects(service.blockEnquirySenderEverywhere(ROW_A.id), /Nothing changed/);
    } finally {
      supabaseModule.supabase.rpc = original;
    }
  });
});

describe("#4111 reported enquiries — only moderators see the tab", () => {
  it("the page lists the tab and renders the panel only for the Community area", () => {
    const page = read("pages/CommunitySupportPage.jsx");
    assert.match(page, /\{ id: "enquiry-reports", label: "Reported enquiries" \}/);
    assert.match(page, /activeTab === "enquiry-reports" && capabilities\.canCommunity && <ReportedEnquiriesPanel \/>/);
    const nav = read("components/community/CommunitySupportNavigation.jsx");
    assert.match(nav, /\{ id: "enquiry-reports", label: "Reported enquiries" \}/);
  });

  it("the access filter shows it to Community moderators and Admins, never to Support-only", () => {
    const tabs = [{ id: "enquiry-reports", label: "Reported enquiries" }];
    const access = (areas, role = "growth") => ({ email: "t@example.test", role, status: "active", areas });
    const shown = (a) => communitySupportTabsForAccess(a, tabs).length === 1;
    assert.equal(shown(access([COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA])), true);
    assert.equal(shown(access([COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA])), false);
    assert.equal(shown(access([COMMUNITY_SUPPORT_AREA])), false);
    assert.equal(shown(access(["admin_console"], "admin")), true);
  });
});
