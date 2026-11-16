// #4452 pass 2: the lead drawer keeps the #4339 "Was: <original call time>"
// line for a moved call, and the status line keeps when the status changed.
//
// FAILS-ON-REVERT: deleting the data-booking-original span in
// components/leads/BookingLine.jsx fails W-1; deleting original_call_at from
// admin_lead_get's booking JSON fails the pg17 twin in issue_4452_leads.
//
// Run: node --test src/__tests__/issue4452_lead_drawer_was.implementor.test.js (from mingla-admin).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHarness } from "./support/issue4452Harness.js";
import { formatDateTime } from "../lib/formatters.js";

let h;
before(async () => {
  h = await buildHarness(`
import { renderToStaticMarkup } from "react-dom/server";
import { BookingLine } from "../../components/leads/BookingLine.jsx";
export const line = (booking) => renderToStaticMarkup(<BookingLine booking={booking} />);
`, { name: "issue4452-was" });
});

describe("#4452 W-1 the moved call keeps its booked time", () => {
  it("shows Was: <original call time> and when it moved", () => {
    const html = h.line({ status: "moved", call_at: "2026-12-02T15:00:00Z", original_call_at: "2026-12-01T10:00:00Z", status_changed_at: "2026-11-20T09:00:00Z" });
    assert.match(html, /data-booking-original=""/);
    assert.ok(html.includes(`Was: ${formatDateTime("2026-12-01T10:00:00Z")}`), html);
    assert.ok(html.includes(`Moved ${formatDateTime("2026-11-20T09:00:00Z")}`), html);
  });
  it("a call that never moved has no Was line", () => {
    const html = h.line({ status: "booked", call_at: "2026-12-02T15:00:00Z" });
    assert.doesNotMatch(html, /Was:/);
    assert.match(html, /Booked/);
  });
  it("a cancelled call is struck through", () => {
    const html = h.line({ status: "cancelled", call_at: "2026-12-02T15:00:00Z", status_changed_at: "2026-11-21T09:00:00Z" });
    assert.match(html, /class="line-through"/);
  });
});
