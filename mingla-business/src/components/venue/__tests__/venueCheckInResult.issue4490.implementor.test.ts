/**
 * #4490 P2-5 — the door: every server result maps to a tone, words and the
 * right buttons (reconciliation 14), the wrong-day result names the day, door
 * refusals are plain words, a typed code finds the guest, and only a /visit/
 * pay link can reach the gate's pay-code QR.
 */
import {
  checkInResultView,
  doorErrorCopy,
  matchTypedCode,
} from "../features/checkin/venueCheckInResult";
import { isVenuePayUrl, toVenuePayUrl, assertVenuePayUrl } from "../features/checkin/venuePayLink";
import type { CheckInPass, ScanOutcome, ScanResultCode } from "../../../types/venueOffers";

function pass(over: Partial<CheckInPass> = {}): CheckInPass {
  return {
    passId: "11111111-1111-4111-8111-111111111111",
    groupId: "g",
    reference: "VB-7275266F8CD140E69C7E",
    holderName: "Adaobi Nwosu",
    offerName: "Entry",
    offerKind: "entry",
    admits: 2,
    admittedCount: 0,
    remaining: 2,
    validLocalDate: "2026-11-20",
    dayLabel: "Friday 20 Nov",
    idCheckLabel: null,
    idCheckCount: 0,
    status: "valid",
    source: "mingla",
    time: null,
    lastAdmittedAt: null,
    ...over,
  };
}

function outcome(result: ScanResultCode, over: Partial<ScanOutcome> = {}): ScanOutcome {
  return {
    result,
    admitted: null,
    logId: "log-1",
    balanceDueMinor: 0,
    kind: "pass",
    pass: pass(),
    ticketHolder: null,
    ticketName: null,
    venueName: null,
    ...over,
  };
}

describe("venueCheckInResult", () => {
  it("admitted → ok, green, Scan next with Undo", () => {
    const v = checkInResultView(outcome("admitted", { admitted: 2, pass: pass({ admittedCount: 2, remaining: 0 }) }));
    expect(v).toMatchObject({ state: "ok", tone: "success", title: "Checked in", primary: "scan_next", secondary: "undo" });
    expect(v.subject).toBe("Adaobi Nwosu · Entry × 2");
    expect(v.body).toBe("2 guests in.");
  });

  it("id_required → needs_id with the option's ID label and an ID-seen button", () => {
    const v = checkInResultView(outcome("id_required", { pass: pass({ idCheckLabel: "Student or NYSC ID" }) }));
    expect(v).toMatchObject({ state: "needs_id", tone: "warning", title: "Check ID first", primary: "id_seen", secondary: "sell_walk_in" });
    expect(v.body).toContain("Student or NYSC ID");
  });

  it("wrong_day names the day the pass is for and keeps it valid", () => {
    const v = checkInResultView(outcome("wrong_day"));
    expect(v).toMatchObject({ state: "wrong_day", tone: "danger", title: "Not valid today", primary: "close", secondary: "sell_walk_in" });
    expect(v.body).toBe("This pass is for Friday 20 Nov. It stays valid for that day.");
  });

  it("already_used → already_in with the time; void, not_yet, wrong_venue, not_found, undone all have words", () => {
    const already = checkInResultView(outcome("already_used", {
      pass: pass({ lastAdmittedAt: "2026-11-21T11:56:00Z" }),
    }), "Africa/Lagos");
    expect(already).toMatchObject({ state: "already_in", body: "Everyone on this pass came in at 12:56." });
    expect(checkInResultView(outcome("void")).title).toBe("Cancelled pass");
    expect(checkInResultView(outcome("not_yet")).title).toBe("Too early");
    expect(checkInResultView(outcome("wrong_venue", { venueName: "Gameland Lagos", pass: null })).body).toBe(
      "This is for Gameland Lagos, not this venue.",
    );
    const nf = checkInResultView(outcome("not_found", { pass: null }));
    expect(nf).toMatchObject({ state: "not_found", title: "Code not recognised", subject: null });
    expect(checkInResultView(outcome("undone")).title).toBe("Check-in undone");
  });

  it("event tickets name the holder and ticket", () => {
    const v = checkInResultView(outcome("admitted", { kind: "event_ticket", pass: null, ticketHolder: "Musa", ticketName: "Early bird" }));
    expect(v.subject).toBe("Musa · Early bird");
  });

  it.each([
    "not_authorized", "admit_count_invalid", "check_in_undo_too_late", "check_in_already_undone", "event_scan_not_allowed",
    "offer_sold_out", "offer_day_closed", "offer_wrong_weekday", "offer_guest_email_required", "offer_amount_too_large",
    "rate_limited", "network", "anything_else",
  ])("door error %s is plain words", (code) => {
    const text = doorErrorCopy(code);
    expect(text).not.toContain(code);
    expect(text).not.toMatch(/_/);
  });

  it("admit_count_invalid says how many are left", () => {
    expect(doorErrorCopy("admit_count_invalid", "1")).toBe("Only 1 still to come on this pass.");
  });
});

describe("typing a code at the door", () => {
  const list = [
    pass(),
    pass({ passId: "p2", reference: "VB-2942EEEE39DB45D8AF7F", holderName: "Walk-in" }),
    pass({ passId: "p3", reference: "VB-E2D0042619C44639B503", holderName: "Walk-in" }),
  ];
  it("a full QR payload goes to the server as a scan", () => {
    expect(matchTypedCode("  mingla:v1:vpass:abc:sig:00 ", list)).toEqual({ kind: "qr", payload: "mingla:v1:vpass:abc:sig:00" });
  });
  it("a booking code or its start finds one pass", () => {
    expect(matchTypedCode("vb-2942", list)).toMatchObject({ kind: "pass", pass: { passId: "p2" } });
    expect(matchTypedCode("VB-7275266F8CD140E69C7E", list)).toMatchObject({ kind: "pass", pass: { passId: list[0].passId } });
  });
  it("a name that matches several asks for more", () => {
    expect(matchTypedCode("walk", list)).toEqual({ kind: "many", count: 2 });
    expect(matchTypedCode("   ", list)).toEqual({ kind: "none" });
  });
});

describe("gate pay code", () => {
  const good = "http://127.0.0.1:8491/visit/68ad3a13-3194-42ed-bee9-9016b5dfa390#t=v1.abcdefghijklmnopqrstuvwx";
  it("accepts only a /visit/<uuid>#t= link", () => {
    expect(isVenuePayUrl(good)).toBe(true);
    expect(toVenuePayUrl("https://host.usemingla.com/visit/68ad3a13-3194-42ed-bee9-9016b5dfa390#t=abcdefghijklmnopqrstu")).not.toBeNull();
    expect(isVenuePayUrl("mingla:v1:vpass:68ad3a13-3194-42ed-bee9-9016b5dfa390:sig:00")).toBe(false);
    expect(isVenuePayUrl("http://x/pay/door/ABCDEFGH")).toBe(false);
    expect(isVenuePayUrl("http://x/visit/not-a-uuid#t=abcdefghijklmnopqrstu")).toBe(false);
    expect(isVenuePayUrl("http://x/visit/68ad3a13-3194-42ed-bee9-9016b5dfa390")).toBe(false);
    expect(() => assertVenuePayUrl("javascript:alert(1)")).toThrow();
  });
});
