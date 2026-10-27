// Issue #4111 (D8) — independent tester adversarial proof for Admin →
// Community & Support → Reported enquiries.
//
// The implementor suite proves the panel's happy states. This one attacks what
// staff must NOT keep seeing: once a report is closed (dismissed here, handled
// by someone else, or the viewer loses the role), no enquiry text may stay on
// screen. It also feeds the pure model hostile server answers and hostile
// action names, and checks the panel never asks the server for anything but
// the three reported-enquiry RPCs.
//
// FAILS-ON-REVERT: keeping `rows` on load_fail, or not removing a row on
// action_ok, fails the D8 tests; dropping the unknown-action guard in
// runReportedEnquiryAction fails the hostile-action test.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  INITIAL_REPORTED_ENQUIRIES_STATE,
  loadReportedEnquiries,
  messageAuthorLabel,
  formatReportedAt,
  reportedEnquiriesReducer,
  runReportedEnquiryAction,
} from "../lib/reportedEnquiries.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_OPERATIONS_AREA, SUPPORT_OPERATIONS_AREA } from "../lib/access.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

const ROW = Object.freeze({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  brand_name: "Lantern Room",
  guest_name: "Gia",
  guest_email: "gia@example.test",
  report_reason: "Abusive",
  reporter_side: "brand",
  messages: [{ who: "guest", display: "Gia", body: "secret text", at: "2026-10-25T10:00:00Z" }],
});

function harness() {
  let state = INITIAL_REPORTED_ENQUIRIES_STATE;
  const dispatch = (event) => {
    state = reportedEnquiriesReducer(state, event);
  };
  return { dispatch, get: () => state };
}

describe("#4111 D8 — closed reports leave nothing on a staff screen", () => {
  it("a reload that is refused (role removed) wipes every loaded enquiry", async () => {
    const h = harness();
    await loadReportedEnquiries(h.dispatch, { listReportedEnquiries: async () => [ROW] });
    assert.equal(h.get().rows.length, 1);
    await loadReportedEnquiries(h.dispatch, {
      listReportedEnquiries: async () => {
        throw new Error("You need a Community & Support role to review reported enquiries.");
      },
    });
    assert.equal(h.get().status, "error");
    assert.deepEqual(h.get().rows, [], "enquiry text stayed on screen after access was refused");
    assert.ok(!JSON.stringify(h.get()).includes("secret text"));
  });

  it("a reload after someone else dismissed it drops the row", async () => {
    const h = harness();
    await loadReportedEnquiries(h.dispatch, { listReportedEnquiries: async () => [ROW] });
    await loadReportedEnquiries(h.dispatch, { listReportedEnquiries: async () => [] });
    assert.deepEqual(h.get().rows, []);
  });

  it("dismiss and block both remove the row the moment the server accepts", async () => {
    for (const kind of ["dismiss", "block"]) {
      const h = harness();
      await loadReportedEnquiries(h.dispatch, { listReportedEnquiries: async () => [ROW] });
      const ok = await runReportedEnquiryAction(h.dispatch, {
        dismissEnquiryReport: async () => true,
        blockEnquirySenderEverywhere: async () => true,
      }, { id: ROW.id, kind });
      assert.equal(ok, true, kind);
      assert.deepEqual(h.get().rows, [], `${kind} left the enquiry on screen`);
    }
  });

  it("a refused action keeps the row and says why — it never pretends", async () => {
    const h = harness();
    await loadReportedEnquiries(h.dispatch, { listReportedEnquiries: async () => [ROW] });
    const ok = await runReportedEnquiryAction(h.dispatch, {
      dismissEnquiryReport: async () => {
        throw new Error("This report was already handled by someone else. Refresh the list.");
      },
    }, { id: ROW.id, kind: "dismiss" });
    assert.equal(ok, false);
    assert.equal(h.get().notice, null);
    assert.match(h.get().actionError.message, /already handled/);
  });
});

describe("#4111 hostile input to the pure model", () => {
  it("an unknown action name calls no server function and reports a failure", async () => {
    const calls = [];
    const service = {
      dismissEnquiryReport: async (id) => calls.push(["dismiss", id]),
      blockEnquirySenderEverywhere: async (id) => calls.push(["block", id]),
    };
    for (const kind of ["delete", "BLOCK", "", undefined, "dismiss "]) {
      const h = harness();
      const ok = await runReportedEnquiryAction(h.dispatch, service, { id: ROW.id, kind });
      assert.equal(ok, false, String(kind));
    }
    assert.deepEqual(calls, []);
  });

  it("garbage server answers render as an empty list, not a crash", async () => {
    for (const answer of [null, undefined, "rows", 42, { rows: [] }]) {
      const h = harness();
      await loadReportedEnquiries(h.dispatch, { listReportedEnquiries: async () => answer });
      assert.equal(h.get().status, "ready");
      assert.deepEqual(h.get().rows, []);
    }
  });

  it("labels never print undefined or a raw date for broken values", () => {
    assert.equal(messageAuthorLabel(undefined, undefined), "Brand");
    assert.equal(messageAuthorLabel({ who: "guest" }, {}), "Guest");
    assert.equal(messageAuthorLabel({ who: "system", display: "Hacker" }, ROW), "Mingla");
    assert.equal(formatReportedAt("not a date"), "Unknown time");
    assert.equal(formatReportedAt(null), "Unknown time");
    assert.equal(formatReportedAt(new Date(Date.now() + 60_000).toISOString()), "Just now");
  });
});

describe("#4111 the panel only talks to the reported-enquiry RPCs", () => {
  it("no direct table reads of brand_enquiries / messages / conversations from Admin", () => {
    const panel = readFileSync(path.join(SRC, "components/community/ReportedEnquiriesPanel.jsx"), "utf8");
    const service = readFileSync(path.join(SRC, "services/communityService.js"), "utf8");
    const section = service.slice(service.indexOf("Reported enquiries (#4111)"));
    for (const text of [panel, section]) {
      assert.ok(!/from\(\s*["'](brand_enquiries|messages|conversations|conversation_participants)["']/.test(text));
    }
    const rpcs = Array.from(section.matchAll(/rpc\(\s*"([a-z_0-9]+)"/g), (m) => m[1]).sort();
    assert.deepEqual(rpcs, ["admin_enquiry_block_everywhere", "admin_enquiry_dismiss_report", "admin_list_reported_enquiries"]);
  });

  it("a Support-only or empty access never gets the Reported enquiries tab", () => {
    const tabs = ["ideas", "questions", "moderation", "enquiry-reports", "support"].map((id) => ({ id }));
    const keysFor = (access) => communitySupportTabsForAccess(access, tabs).map((t) => t.id);
    for (const access of [
      null, undefined, {}, { support: true }, { canSupport: true },
      { status: "active", areas: [SUPPORT_OPERATIONS_AREA] },
      { status: "active", areas: "community" },
      { status: "suspended", areas: ["admin_console"] },
    ]) {
      assert.ok(!keysFor(access).includes("enquiry-reports"), JSON.stringify(access));
    }
    // The positive control: the Community area does get it.
    assert.ok(keysFor({ status: "active", areas: [COMMUNITY_OPERATIONS_AREA] }).includes("enquiry-reports"));
  });
});
