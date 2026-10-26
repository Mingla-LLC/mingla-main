import fs from "node:fs";
import path from "node:path";

import {
  activityEvents,
  contractFeeWords,
  contractMoneyState,
  contractStatusCard,
} from "../contractCopy";
import {
  hiredContracts,
  interestedApplicants,
} from "../applicantFilters";
import type {
  GigApplicant,
  HostContractSummary,
} from "../../../services/creatorGigsService";

// #3872 round 2 (approved M-contract, M-gig): after payment the Fee row still
// said "$300 held by Mingla", Activity listed both the button and the event,
// and a hired creator still showed under Interested.
const root = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("contract money words", () => {
  it("reads money_state: On the way · Ready · Paid, never held after release", () => {
    expect(contractFeeWords(30000, "USD", "on_the_way")).toBe("$300 · On the way");
    expect(contractFeeWords(30000, "USD", "ready")).toBe("$300 · Ready");
    expect(contractFeeWords(30000, "USD", "paid")).toBe("$300 paid");
    expect(contractFeeWords(30000, "USD", "refunded")).toBe("$300 refunded");
    expect(contractFeeWords(30000, "USD", "partially_refunded")).toBe(
      "$300 · part refunded",
    );
    // Nothing captured yet (unpaid offer): the fee without a money word.
    expect(contractFeeWords(30000, "USD", null)).toBe("$300");
    expect(contractMoneyState("held")).toBeNull();
    expect(contractMoneyState(null)).toBeNull();
    expect(read("app/brand/[id]/creators/contract/[contractId].tsx")).not.toContain(
      "held by Mingla`",
    );
  });

  it("puts the status in one card and says Paid only once the server says paid", () => {
    const done = contractStatusCard({
      state: "completed",
      moneyState: "paid",
      creatorName: "Ada Films",
      hostRated: false,
      stepCaption: "Step 6 of 6 · Paid",
    });
    expect(done).toMatchObject({
      title: "Paid to the creator",
      pill: "Done",
      canRate: true,
      line: "Rate Ada Films when you're ready.",
    });
    expect(
      contractStatusCard({
        state: "released",
        moneyState: "ready",
        creatorName: "Ada",
        hostRated: false,
        stepCaption: "",
      }).title,
    ).toBe("Released to the creator");
    expect(
      contractStatusCard({
        state: "delivered",
        moneyState: "on_the_way",
        creatorName: "Ada",
        hostRated: false,
        stepCaption: "Step 4 of 6 · Video",
      }),
    ).toMatchObject({ title: "Review the video", line: "Step 4 of 6 · Video", canRate: false });
  });

  it("folds Activity to events only, never the button names", () => {
    const rows = activityEvents([
      { id: "1", kind: "offer_created" },
      { id: "2", kind: "approved" },
      { id: "3", kind: "approve" },
      { id: "4", kind: "something_internal" },
      { id: "5", kind: "release" },
    ]);
    expect(rows.map((row) => row.words)).toEqual([
      "Payment released to the creator",
      "Video approved",
      "Offer sent",
    ]);
    expect(rows.some((row) => /^Approve$/.test(row.words))).toBe(false);
  });
});

const applicant = (id: string, name: string, quote: number, status = "sent") =>
  ({
    interest_id: id,
    creator_id: id,
    display_name: name,
    niches: [],
    follower_bands: [],
    rating: null,
    completed: 0,
    reliability: null,
    quote_minor: quote,
    currency: "USD",
    package_id: null,
    note: null,
    status,
  }) as GigApplicant;
const contract = (creator: string, patch: Partial<HostContractSummary> = {}) =>
  ({
    id: `c-${creator}`,
    gig_id: "g",
    state: "released",
    deadline_at: null,
    due_at: null,
    needs_host: false,
    title: "Rooftop",
    creator,
    payment_pending: false,
    fee_minor: 30000,
    currency: "USD",
    ...patch,
  }) as HostContractSummary;

describe("gig page: hired creators only under Hired", () => {
  it("leaves hired and passed creators out of Interested", () => {
    const items = [
      applicant("a", "Ada Films", 30000),
      applicant("k", "Kemi Out", 28000),
      applicant("t", "Tolu Reels", 30000, "passed"),
      applicant("h", "Hana", 20000, "hired"),
    ];
    expect(
      interestedApplicants(items, [contract("Ada Films")], "best").map((row) => row.display_name),
    ).toEqual(["Kemi Out"]);
  });

  it("does not count an unpaid or cancelled offer as a hire", () => {
    const rows = hiredContracts([
      contract("Ada Films"),
      contract("Kemi Out", { payment_pending: true }),
      contract("Tolu", { state: "cancelled" }),
    ]);
    expect(rows.map((row) => row.creator)).toEqual(["Ada Films"]);
    expect(
      interestedApplicants(
        [applicant("k", "Kemi Out", 28000)],
        [contract("Kemi Out", { payment_pending: true })],
        "best",
      ),
    ).toHaveLength(1);
  });

  it("moves Close gig into the ⋯ menu with Edit", () => {
    const page = read("app/brand/[id]/creators/[gigId]/interest.tsx");
    expect(page).toContain('accessibilityLabel="Gig options"');
    expect(page).toMatch(/<SheetBody title="Gig options">[\s\S]*label="Edit gig"[\s\S]*label="Close gig"/);
  });
});
