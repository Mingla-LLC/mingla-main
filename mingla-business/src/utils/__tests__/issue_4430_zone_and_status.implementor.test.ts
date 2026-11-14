// #4430 Host leg: every gig time in the gig's zone with a plain-English label
// (items 1a-1d), ended and disputed contracts never read "Paid" (item 5), the
// cancel sheet includes a pending counter difference (P-2), and Activity shows
// one row per action (item 2).
//
// The phone is in New York; the gig is in Lagos. FAILS-ON-REVERT: the
// phone-zone videoDueWords on the applicants summary, a getHours() prefill,
// hostContractStep's default 6 for cancelled, or a cancel quote without the
// counter difference fails here.
process.env.TZ = "America/New_York";

import fs from "node:fs";
import path from "node:path";

import {
  cancelRefundQuote,
  formatInZone,
  hostContractEndedWords,
  hostContractStep,
  postDeadlineShownIso,
  workspacePendingRefundMinor,
  zoneLabel,
} from "../creatorProgramFormat";
import { agreedVideoDueWords, dueChangeInitial, proposalChangeWords } from "../../components/programs/dueChange";
import { activityEvents, contractFeeWords, contractMoneyState, dedupeGigEvents } from "../../components/programs/contractCopy";
import { hiredContracts, interestedApplicants } from "../../components/programs/applicantFilters";

const LAGOS_NOON = "2026-12-15T11:00:00Z";
const WANT = "Tue Dec 15, 12:00 PM Lagos time";
const root = path.resolve(__dirname, "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const IANA = /\b(Africa|America|Europe|Asia|Australia|Pacific|Atlantic|Indian|Etc)\/[A-Za-z_]+/;

/** Seth: no slugs. A time label never shows "Region/City" or any "/". */
function expectPlainZone(text: string): void {
  expect(text).not.toContain("/");
  expect(text).not.toMatch(IANA);
}

describe("#4430 item 1: gig times in the gig's zone", () => {
  // process.env.TZ only takes effect where the runtime re-reads it (macOS);
  // CI's Linux workers keep UTC. The zone-formatting assertions below hold
  // either way; this guard only runs where the phone zone really applied.
  const phoneInNewYork = new Date(LAGOS_NOON).getHours() === 6;
  (phoneInNewYork ? it : it.skip)("runs with the phone in New York", () => {
    expect(new Date(LAGOS_NOON).getHours()).toBe(6);
  });
  it("1a: the applicants summary reads the gig's zone", () => {
    expect(formatInZone(LAGOS_NOON, "Africa/Lagos")).toBe(WANT);
    const screen = read("src/components/creators/screens/GigApplicantsScreen.tsx");
    expect(screen).toMatch(/formatInZone\(gig\.video_due_at, gigZone\(gig\)\)/);
  });
  it("1b: Agreed now reads the gig's zone", () => {
    expect(agreedVideoDueWords({ videoDueAt: LAGOS_NOON, postBy: "2026-12-15" }, "Africa/Lagos")).toBe(WANT);
    expect(read("src/components/creators/screens/HostGigContractScreen.tsx")).toContain(
      "Agreed now: ${agreedVideoDueWords(agreedDue, zone)}",
    );
  });
  it("1c: the change sheet prefills the zone's wall clock and says so", () => {
    expect(dueChangeInitial({ videoDueAt: LAGOS_NOON, postBy: "2026-12-15" }, "Africa/Lagos")).toEqual({
      day: "2026-12-15",
      time: "12:00",
    });
    expect(read("src/components/creators/screens/HostGigContractScreen.tsx")).toContain(
      "Times are ${zoneLabel(zone)}.",
    );
    expect(`Times are ${zoneLabel("Africa/Lagos")}.`).toBe("Times are Lagos time.");
  });
  it("1d: proposal words read the gig's zone", () => {
    expect(proposalChangeWords({ video_due_at: LAGOS_NOON }, "Africa/Lagos")).toBe(`Proposed: ${WANT}`);
    expect(proposalChangeWords({ video_due_at: "2026-12-15T12:00" }, "Africa/Lagos")).toBe(`Proposed: ${WANT}`);
  });
  it("never renders a zone slug", () => {
    for (const zone of ["Africa/Lagos", "America/New_York", "America/Argentina/Buenos_Aires", "Europe/London", "UTC"]) {
      expectPlainZone(formatInZone(LAGOS_NOON, zone));
      expectPlainZone(agreedVideoDueWords({ videoDueAt: LAGOS_NOON, postBy: null }, zone));
      expectPlainZone(proposalChangeWords({ video_due_at: "2026-12-15T12:00" }, zone));
      expectPlainZone(formatInZone(postDeadlineShownIso("2026-12-16T23:00:00Z"), zone));
      expectPlainZone(zoneLabel(zone));
    }
  });
});

describe("#4430 item 5: ended contracts read their status, never Paid", () => {
  it.each([
    ["cancelled", "Cancelled"],
    ["declined", "Declined"],
    ["expired", "Expired"],
    ["disputed", "In dispute"],
    ["resolved_release", "Dispute settled"],
    ["resolved_partial", "Dispute settled"],
    ["resolved_refund", "Dispute settled"],
  ])("%s has no step and reads %s", (state, words) => {
    expect(hostContractStep(state)).toBeNull();
    expect(hostContractEndedWords(state)).toBe(words);
  });
  it("working states keep their step", () => {
    expect(hostContractStep("offered")).toBe(1);
    expect(hostContractStep("posts_submitted")).toBe(5);
    expect(hostContractStep("released")).toBe(6);
  });
  it("a split ending shows what went back and what the creator kept", () => {
    expect(contractMoneyState("cancelled_partial")).toBe("cancelled_partial");
    expect(contractMoneyState("dispute_partial")).toBe("dispute_partial");
    expect(contractFeeWords(10000, "NGN", "cancelled_partial", 9000, 11500, 2500)).toBe("₦90 back to you · ₦25 to the creator");
    expect(contractFeeWords(15000, "NGN", "dispute_partial", 11750, 23000, 9000)).toBe("₦117.50 back to you · ₦90 to the creator");
    expect(contractFeeWords(10000, "NGN", "cancelled_partial", 9000, 11500, 2500)).not.toMatch(/Ready|Paid/);
  });
});

describe("#4430 P-2: the cancel sheet matches the server quote", () => {
  it("adds the pending counter difference on both branches", () => {
    // Fee 15000 + booking 2250 after a lower counter, 5750 not yet paid back.
    const gig = cancelRefundQuote("gig", 15000, 2250, 5750);
    expect(gig).toEqual({ feeShareMinor: 11250, bookingMinor: 2250, counterMinor: 5750, totalMinor: 19250, creatorKeepsMinor: 3750 });
    expect(cancelRefundQuote("offer", 15000, 2250, 5750).totalMinor).toBe(23000);
    expect(cancelRefundQuote("gig", 15000, 2250).counterMinor).toBe(0);
    // 75% rounds down, like the server's integer division.
    expect(cancelRefundQuote("gig", 10001, 1500).feeShareMinor).toBe(7500);
  });
  it("reads pending_refund from the workspace", () => {
    expect(workspacePendingRefundMinor({ pending_refund: { amount_minor: 5750, currency: "NGN" } })).toBe(5750);
    expect(workspacePendingRefundMinor({ pending_refund: null })).toBe(0);
    const screen = read("src/components/creators/screens/HostGigContractScreen.tsx");
    expect(screen).toContain("workspacePendingRefundMinor(workspace)");
    expect(screen).toContain('title="Counter-offer difference"');
  });
});

describe("#4430 item 2: Activity shows one row per action", () => {
  it("drops the action row when its fact partner follows within 5 s", () => {
    const events = [
      { id: "1", kind: "send_script", actor: "creator", at: "2026-12-01T10:00:00.000Z", data: {} },
      { id: "2", kind: "script_sent", actor: "creator", at: "2026-12-01T10:00:01.000Z", data: {} },
    ];
    expect(dedupeGigEvents(events).map((e) => e.kind)).toEqual(["script_sent"]);
    expect(activityEvents(events)).toHaveLength(1);
  });
});

describe("#4430 Q1: a settled dispute makes the creator offerable again", () => {
  const applicant = { interest_id: "i1", creator_id: "c1", display_name: "Ada Creator", status: "shortlisted", quote_minor: 20000, completed: 0 };
  it.each(["resolved_release", "resolved_partial", "resolved_refund", "cancelled", "declined", "expired"])(
    "a %s contract does not hide the creator from Interested",
    (state) => {
      const contracts = [{ id: "k1", gig_id: "g1", state, creator: "Ada Creator", payment_pending: false }];
      expect(interestedApplicants([applicant] as never, contracts as never, "best")).toHaveLength(1);
    },
  );
  it("a live or completed hire still hides them, and stays under Hired", () => {
    for (const state of ["accepted", "posts_submitted", "completed"]) {
      const contracts = [{ id: "k1", gig_id: "g1", state, creator: "Ada Creator", payment_pending: false }];
      expect(interestedApplicants([applicant] as never, contracts as never, "best")).toHaveLength(0);
      expect(hiredContracts(contracts as never)).toHaveLength(1);
    }
  });
});
