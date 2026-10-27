import fs from "node:fs";
import path from "node:path";

const mockInvoke = jest.fn();
const mockCapture = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: jest.fn(), functions: { invoke: mockInvoke } },
}));
jest.mock("../postHogService", () => ({
  postHogService: { capture: mockCapture },
}));

import { creatorGigsService } from "../creatorGigsService";

// [TEST-MOD-APPROVED #3872] Source contracts keep the Creator and Host gig
// journeys wired to the reviewed RPC and Edge boundaries on every platform.
const root = process.cwd();
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

const serviceSource = read("src/services/creatorGigsService.ts");
// Whitespace-normalised so formatting never breaks these copy contracts.
const host = read("src/components/creators/screens/HostGigContractScreen.tsx").replace(/\s+/g, " ").replace(/\( /g, "(").replace(/,? \)/g, ")");
const applicants = read("src/components/creators/screens/GigApplicantsScreen.tsx");
const prehire = read("src/components/creators/screens/PrehireCreatorProfileScreen.tsx");
const hireSheet = read("src/components/gigs/HireSheet.tsx");

describe("issue #3872 — Creator gig contract journeys", () => {
  test("both sides resolve structured settlement offers through the guarded Edge boundary", () => {
    expect(serviceSource).toMatch(
      /supabase\.functions\.invoke\(\s*"gig-dispute-resolve"/,
    );
    expect(serviceSource).toMatch(
      /offerDispute: \(\s*disputeId: string,\s*refundBps: number/,
    );
    expect(host).toContain("Accept settlement");
    expect(host).toContain("Make counteroffer");
    expect(host).toContain("respondToDisputeOffer(openOffer.id, false)");
  });

  test("pre-lock cancellations use the party-specific reviewed refund branches", () => {
    expect(host).toContain(
      'creatorGigsService.refund(contractId, "host_before_accept")',
    );
    expect(host).toContain(
      'creatorGigsService.refund(contractId, "host_after_accept_before_lock")',
    );
    expect(host).toContain(
      "Provider fees follow the payment provider’s refund rules",
    );
  });

  test("the UI labels refund shares from the Host perspective", () => {
    expect(host).toContain("% refund to you");
    expect(host).toContain("keeps the remainder of the contract fee");
  });

  test("the Host can fund the quoted fee or offer a different fee before hiring", () => {
    // Round 2 (approved M-gig / M-prehire): hiring, including a different fee,
    // starts from the creator's profile; the Interested rows only open it.
    expect(prehire).toContain("allowCounter: true");
    expect(applicants).not.toContain('label="Counter"');
    expect(hireSheet).toContain("Offer a different fee");
    expect(hireSheet).toContain("Agree and pay");
    expect(hireSheet).toContain("Mingla booking fee (15%)");
  });

  test("settlement acceptance executes the guarded resolution boundary", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { status: "accepted" },
      error: null,
    });
    await expect(
      creatorGigsService.respondToDisputeOffer("offer-1", true),
    ).resolves.toEqual({ status: "accepted" });
    expect(mockInvoke).toHaveBeenCalledWith("gig-dispute-resolve", {
      body: { offer_id: "offer-1", accept: true },
    });
  });
});
