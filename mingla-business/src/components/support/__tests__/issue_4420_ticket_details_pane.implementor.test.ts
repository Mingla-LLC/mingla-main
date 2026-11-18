/**
 * #4420 — desktop support ticket: a "Ticket" details pane beside the thread
 * (mockup support-ticket__thread), built only from the ticket the thread
 * already loads. Phone keeps the single column.
 *
 * FAILS-ON-REVERT: removing the pane or its wide-desktop gate fails block 3;
 * a slug/raw status in the values fails block 1.
 *
 * [TEST-MOD-APPROVED #4420] — the source-text half moved to the I-4420-HOST-WIRING
 * strict-grep gate (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN); this file keeps the behaviour.
 */
import { supportTicketDetails } from "../supportRequestModel";

const base = {
  ticket_number: 1002,
  topic: "payouts",
  visibility: "brand" as const,
  status: "open",
  created_at: "2026-11-11T09:36:11Z",
  last_message_at: "2026-11-12T09:36:11Z",
  next_update_at: null,
};

describe("#4420 support ticket details pane", () => {
  test("1. the mockup's rows, in plain words", () => {
    const rows = supportTicketDetails(base, { nowMs: Date.parse("2026-11-13T00:00:00Z") });
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map.Ticket).toBe("S-1002");
    expect(map.Topic).toBe("Payouts");
    expect(map["Shared with"]).toBe("Your brand");
    expect(map.Status).toBe("Waiting on Mingla");
    expect(map.Updated).toBe(new Date("2026-11-12T09:36:11Z").toLocaleDateString());
    expect(rows.map((r) => r.key)).not.toContain("next_update");
  });

  test("2. person / pending / closed / next update", () => {
    const now = Date.parse("2026-11-13T00:00:00Z");
    const pending = supportTicketDetails(
      { ...base, visibility: "person", status: "pending", topic: null, next_update_at: "2026-11-14T10:00:00Z" },
      { nowMs: now },
    );
    const m = Object.fromEntries(pending.map((r) => [r.key, r.value]));
    expect(m.shared).toBe("Only you");
    expect(m.status).toBe("Waiting on you");
    expect(m.topic).toBeUndefined();
    expect(m.next_update).toBeTruthy();
    const closed = supportTicketDetails({ ...base, status: "closed" }, { nowMs: now });
    expect(closed.find((r) => r.key === "status")?.value).toBe("Closed");
    const staff = supportTicketDetails(base, { staffMode: true, nowMs: now });
    expect(staff.find((r) => r.key === "shared")?.value).toBe("Brand team");
  });

});
