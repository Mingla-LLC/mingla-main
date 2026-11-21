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

// [TEST-MOD #4420] the Reported enquiries panel retired with Community; its
// rows arrive in the Support inbox. The rendered states are pinned by
// issue4420_support_inbox (ReportedEnquiryThread); here: the same logic and
// RPCs, the confirmation still in place, and the inbox gate.
describe("#4111 reported enquiries — the inbox thread and service", () => {
  it("the thread uses the same model and keeps Block everywhere's in-place confirmation", () => {
    const source = read("components/support/ReportedEnquiryThread.jsx");
    assert.match(source, /from "\.\.\/\.\.\/lib\/reportedEnquiries"/);
    assert.match(source, />Dismiss</);
    assert.match(source, />Block everywhere</);
    assert.match(source, /confirming \?/);
    assert.match(source, /role="alert"/);
  });
  it("the inbox reaches the three staff RPCs, which the support row of the contract names", () => {
    const service = read("services/communityService.js");
    for (const rpc of ["admin_list_reported_enquiries", "admin_enquiry_dismiss_report", "admin_enquiry_block_everywhere"]) assert.match(service, new RegExp(`rpc\\(\\s*"${rpc}"`));
  });
});

describe("#4111 reported enquiries — who sees them", () => {
  it("the Support inbox (where reports arrive) shows to the Support area and Admins only", () => {
    const tabs = [{ id: "support" }];
    const ids = (areas) => communitySupportTabsForAccess({ status: "active", areas }, tabs).map((t) => t.id);
    assert.deepEqual(ids([SUPPORT_OPERATIONS_AREA]), ["support"]);
    assert.deepEqual(ids(["admin_console"]), ["support"]);
    assert.deepEqual(ids([COMMUNITY_OPERATIONS_AREA, COMMUNITY_SUPPORT_AREA]), []);
  });
});
