const mockRpc = jest.fn();
const mockInvoke = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    rpc: mockRpc,
    functions: { invoke: mockInvoke },
    from: jest.fn(),
  },
}));
jest.mock("../postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

import {
  creatorGigsService,
  normalizeApplicants,
  normalizeHostHome,
  openCounter,
  pendingTopup,
} from "../creatorGigsService";
import {
  contractNeedsHost,
  hostContractPill,
} from "../../utils/creatorProgramFormat";
import { confirmGigHire, startGigHire, startGigTopup } from "../gigHireService";
import { interestedApplicants } from "../../components/programs/applicantFilters";
import {
  fixesLeft,
  latestScript,
  scriptChecks,
  sectionLabel,
  sectionLines,
  shootInstant,
} from "../../components/programs/contractCopy";
import { hireTerms } from "../../components/gigs/hireTerms";

// #3872 walkthrough: 09-host-gig-interest-crash (a gig with no interest
// rendered/crashed on a phantom row), 25-host-hire-provider-unavailable
// ("Edge Function returned a non-2xx status code"), 28-host-contract-script-
// review (the host was asked to approve a script it could not see).

beforeEach(() => {
  mockRpc.mockReset();
  mockInvoke.mockReset();
});

describe("applicants", () => {
  it("drops the all-null row gig_applicants returns for a gig with no interest", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          interest_id: null,
          creator_id: null,
          display_name: null,
          niches: null,
          follower_bands: null,
          quote_minor: null,
          currency: "USD",
        },
      ],
      error: null,
    });
    await expect(creatorGigsService.applicants("gig-1")).resolves.toEqual([]);
  });

  it("keeps real applicants and fills safe defaults", () => {
    const [row] = normalizeApplicants([
      {
        interest_id: "i1",
        creator_id: "c1",
        display_name: "Ada Films",
        niches: ["food"],
        follower_bands: [
          { platform: "instagram", band: "10k_50k", verified: true },
        ],
        rating: null,
        completed: 0,
        quote_minor: 30000,
        currency: "USD",
        status: "sent",
        note: "  ",
      },
    ]);
    expect(row).toMatchObject({
      interest_id: "i1",
      quote_minor: 30000,
      rating: null,
      note: null,
    });
  });

  // Round 2 (approved M-gig): Within budget became Lowest price.
  it("sorts by price and top rated, hiding passed creators", () => {
    const base = normalizeApplicants([
      {
        interest_id: "a",
        creator_id: "a",
        display_name: "A",
        quote_minor: 30000,
        currency: "USD",
        rating: 4.2,
        completed: 3,
        status: "sent",
      },
      {
        interest_id: "b",
        creator_id: "b",
        display_name: "B",
        quote_minor: 24000,
        currency: "USD",
        rating: 4.8,
        completed: 6,
        status: "sent",
      },
      {
        interest_id: "c",
        creator_id: "c",
        display_name: "C",
        quote_minor: 10000,
        currency: "USD",
        rating: 5,
        completed: 1,
        status: "passed",
      },
    ]);
    expect(
      interestedApplicants(base, [], "price").map((x) => x.interest_id),
    ).toEqual(["b", "a"]);
    expect(
      interestedApplicants(base, [], "rated").map((x) => x.interest_id),
    ).toEqual(["b", "a"]);
  });
});

describe("hire and pay", () => {
  it("turns an edge non-2xx into {ok:false,error} with the server's code", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { json: async () => ({ error: "provider_start_failed" }) },
      },
    });
    await expect(
      startGigHire({
        interestId: "i1",
        feeMinor: 30000,
        idempotencyKey: "gig-i1-30000-abcd",
      }),
    ).resolves.toEqual({ ok: false, error: "provider_start_failed" });
  });

  it("treats a 200 with ok:false as a failure, never as success", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { ok: false, error: "payment_not_proven" },
      error: null,
    });
    await expect(
      confirmGigHire({
        contractId: "c",
        termsVersion: 1,
        rail: "stripe",
        providerRef: "pi_1",
      }),
    ).resolves.toEqual({ ok: false, error: "payment_not_proven" });
  });

  it("starts a counter top-up on the same edge with the agreed terms version", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        ok: true,
        kind: "requires_payment_sheet",
        contract_id: "c",
        terms_version: 2,
        rail: "stripe",
        client_secret: "s",
        provider_ref: "pi",
        quote: { currency: "USD" },
      },
      error: null,
    });
    const result = await startGigTopup({ contractId: "c", termsVersion: 2 });
    expect(result.ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("gig-hire", {
      body: {
        action: "topup",
        contract_id: "c",
        terms_version: 2,
        return_url: null,
      },
    });
  });

  it("answers a counter through gig_counter_respond and keeps ok:false a failure", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, error: "counter_not_open" },
      error: null,
    });
    await expect(
      creatorGigsService.counterRespond("p1", true),
    ).resolves.toEqual({ ok: false, error: "counter_not_open" });
    expect(mockRpc).toHaveBeenCalledWith("gig_counter_respond", {
      p_proposal_id: "p1",
      p_accept: true,
    });
  });

  it("lists the hire terms as checkboxes", () => {
    expect(hireTerms("Amara", 90)).toContain(
      "After the full Creator fee is released, you and Mingla may reuse, edit and advertise with the approved video worldwide, forever, without another usage fee",
    );
    expect(hireTerms("Amara", 365)).toContain(
      "Ads run directly from the Creator's social account still need the separate permission required by that platform",
    );
  });
});

describe("host contract", () => {
  it("finds the open creator counter-offer", () => {
    expect(
      openCounter({
        proposals: [
          {
            id: "p1",
            from_version: 1,
            proposed_by: "creator",
            changes: { fee_minor: 35000 },
            reason: "counter",
            note: "Two locations",
            status: "open",
            expires_at: "2026-10-28T00:00:00Z",
          },
        ],
      }),
    ).toEqual({
      id: "p1",
      fee_minor: 35000,
      note: "Two locations",
      expires_at: "2026-10-28T00:00:00Z",
    });
    expect(
      openCounter({
        proposals: [
          {
            id: "p2",
            from_version: 1,
            proposed_by: "creator",
            changes: { post_by: "2026-12-01" },
            reason: "dates",
            note: null,
            status: "open",
            expires_at: "",
          },
        ],
      }),
    ).toBeNull();
    expect(
      openCounter({
        proposals: [],
        counters: [{ id: "k1", fee_minor: 20000, status: "open" }],
      }),
    ).toMatchObject({ id: "k1", fee_minor: 20000 });
  });

  it("shows the script the host is asked to approve", () => {
    const script = latestScript({
      scripts: [
        {
          version: 1,
          body: { sections: [] },
          sent_at: null,
          locked_at: null,
          locked_by: null,
        },
        {
          version: 2,
          body: {
            sections: [
              {
                label: "Hook",
                start_s: 0,
                end_s: 3,
                voiceover: "POV: the best view in Raleigh",
                on_screen: "POV: the best view in Raleigh",
                shot_notes: "Wide shot on arrival",
              },
            ],
            disclosure: "#ad",
            estimated_seconds: 30,
          },
          sent_at: "x",
          locked_at: null,
          locked_by: null,
        },
      ],
    });
    expect(script?.version).toBe(2);
    const section = script!.body.sections![0];
    expect(sectionLabel(section, 0)).toBe("0–3s · Hook");
    expect(sectionLines(section)).toEqual([
      { label: "Says", text: "POV: the best view in Raleigh" },
      { label: "Shot", text: "Wide shot on arrival" },
    ]);
    expect(scriptChecks(script)).toEqual({ disclosure: true, seconds: 30 });
  });

  it("counts fix rounds and builds shoot times", () => {
    expect(fixesLeft(0)).toBe(2);
    expect(fixesLeft(2)).toBe(0);
    expect(new Date(shootInstant("2026-11-20", 18)).getHours()).toBe(18);
  });
});

describe("server contract updates (coordinator, 26 Oct)", () => {
  it("shows an unpaid offer as Payment not completed, never as a live offer or a Needs-you item", () => {
    const home = normalizeHostHome({
      gigs: [],
      contracts: [
        {
          id: "c1",
          gig_id: "g1",
          state: "offered",
          title: "Rooftop",
          creator: "Ada",
          payment_pending: true,
          fee_minor: 30000,
          currency: "USD",
        },
      ],
    });
    const [row] = home.contracts;
    expect(row).toMatchObject({
      payment_pending: true,
      fee_minor: 30000,
      currency: "USD",
    });
    // Round 2: list pills use short words; the row subtitle says
    // "Payment not completed".
    expect(hostContractPill(row)).toEqual({ label: "Unpaid", tone: "problem" });
    expect(contractNeedsHost({ ...row, needs_host: true })).toBe(false);
  });

  it("reads a pending top-up from the workspace", () => {
    expect(
      pendingTopup({ pending_topup: { terms_version: 2, topup_minor: 5000 } }),
    ).toEqual({ termsVersion: 2, topupMinor: 5000 });
    expect(pendingTopup({ pending_topup: null })).toBeNull();
  });

  it("no longer sends refund_bps to gig-refund", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await creatorGigsService.refund("c1", "host_before_accept");
    expect(mockInvoke).toHaveBeenCalledWith("gig-refund", {
      body: { contract_id: "c1", branch: "host_before_accept" },
    });
  });

  it("returns [] when gig_applicants returns [] for a gig with no interest", async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(creatorGigsService.applicants("g1")).resolves.toEqual([]);
  });
});
