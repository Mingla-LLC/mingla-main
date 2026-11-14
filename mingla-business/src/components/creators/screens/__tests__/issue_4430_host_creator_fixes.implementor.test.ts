// MINGLA-INVARIANT: I-4430-A | issue #4430 | a host never passes on an applicant in one tap: "Not now" opens a confirm and only its Pass button calls decideInterest("passed")
// MINGLA-INVARIANT: I-4430-C | issue #4430 | "Retry payment" reopens the Hire sheet for the same offer (same creator interest, agreed fee); it never just routes to the applicants list
/**
 * #4430 — Host creator fixes from the #4420 recapture.
 *
 * H-A fails-on-revert: wiring "Not now" back to notNow() directly removes the
 *   confirm and the source assertions fail.
 * H-B fails-on-revert: restoring the flat `paddingBottom: 120` on embedded
 *   program screens leaves the last button under the floating "Hire a
 *   creator" button on iOS (130pt offset + 48pt button) and the clearance
 *   assertions fail.
 * H-C fails-on-revert: restoring router.push(`.../interest`) for Retry
 *   payment (contract page or Creators home) fails the source assertions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn(), from: jest.fn() },
}));

import { passConfirmCopy } from "../../../../utils/creatorProgramFormat";
import { retryHireMode } from "../../../programs/contractCopy";
import {
  HOST_AD_FLOATING_ACTION_CLEARANCE,
  hostAdScrollBottomPadding,
} from "../../../marketing/ads/hostAdBuilderRules";
import type { GigApplicant } from "../../../../services/creatorGigsService";

const SRC = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

describe("#4430 H-A: Not now asks before passing", () => {
  const screen = read("components/creators/screens/PrehireCreatorProfileScreen.tsx");

  it("Not now opens the confirm instead of passing", () => {
    const notNowButton = screen.slice(
      screen.indexOf("accessibilityLabel={`Not now: pass on ${name}`}") - 400,
      screen.indexOf("accessibilityLabel={`Not now: pass on ${name}`}"),
    );
    expect(notNowButton).toContain("onPress={() => setConfirmingPass(true)}");
    expect(notNowButton).not.toContain("notNow()");
  });

  it("only the dialog's Pass button calls decideInterest", () => {
    expect(screen).toContain('from "../../../components/ui/SimpleConfirmDialog"');
    const dialog = screen.slice(screen.indexOf("<SimpleConfirmDialog"));
    expect(dialog).toContain("visible={confirmingPass}");
    expect(dialog).toContain("onClose={() => setConfirmingPass(false)}");
    expect(dialog).toContain("onConfirm={() => void notNow()}");
    expect(dialog).toContain("destructive");
    expect(screen.match(/notNow\(\)/g)?.length).toBe(1);
  });

  it("says who and what, with Pass and Keep", () => {
    expect(passConfirmCopy("Ada")).toEqual({
      title: "Pass on Ada?",
      description:
        "You won't be able to send them an offer for this gig from this list.",
      confirmLabel: "Pass",
      cancelLabel: "Keep",
    });
    expect(passConfirmCopy("  ").title).toBe("Pass on this creator?");
  });

  it("the shared confirm closes on a tap outside", () => {
    const dialog = read("components/ui/SimpleConfirmDialog.tsx");
    expect(dialog).toMatch(/style=\{styles\.backdrop\}\s*onPress=\{onClose\}/);
  });
});

describe("#4430 H-B: embedded creator screens clear the floating button", () => {
  const kit = read("components/programs/ProgramKit.tsx");
  const FAB_HEIGHT = 48;

  it("reserves the sticky-footer offset plus the floating action clearance", () => {
    expect(kit).toContain("scrollPaddingClearOfFloatingAction(useStickyFooterOffset())");
    // Eager screens must not import ad rules (bundle-baseline-movement gate).
    expect(kit).not.toContain("marketing/ads/hostAdBuilderRules");
    expect(kit).toContain("embedded ? { paddingBottom: embeddedBottom } : null");
    const embeddedStyle = kit.slice(
      kit.indexOf("contentEmbedded: {"),
      kit.indexOf("}", kit.indexOf("contentEmbedded: {")),
    );
    expect(embeddedStyle).not.toContain("paddingBottom");
  });

  it("the reserve is taller than the floating button's top edge on iPhone and web", () => {
    for (const insetBottom of [0, 21, 34]) {
      const fabBottom = insetBottom + 96; // useStickyFooterOffset on phones
      expect(hostAdScrollBottomPadding(fabBottom)).toBeGreaterThan(
        fabBottom + FAB_HEIGHT,
      );
    }
    expect(HOST_AD_FLOATING_ACTION_CLEARANCE).toBeGreaterThan(FAB_HEIGHT);
  });
});

describe("#4430 H-C: Retry payment reopens the Hire sheet for that offer", () => {
  const applicant = (over: Partial<GigApplicant>): GigApplicant => ({
    interest_id: "i-1",
    creator_id: "c-1",
    display_name: "Ada",
    niches: [],
    follower_bands: [],
    rating: null,
    completed: 0,
    reliability: null,
    quote_minor: 500000,
    currency: "NGN",
    package_id: null,
    note: null,
    status: "offered",
    ...over,
  });

  it("finds the same creator's interest and keeps the agreed fee", () => {
    const applicants = [
      applicant({ interest_id: "i-0", creator_id: "c-0" }),
      applicant({}),
    ];
    expect(
      retryHireMode({ applicants, creatorAccountId: "c-1", feeMinor: 750000 }),
    ).toEqual({ kind: "hire", interestId: "i-1", quoteMinor: 750000 });
    expect(
      retryHireMode({ applicants, creatorAccountId: "c-1", feeMinor: null }),
    ).toEqual({ kind: "hire", interestId: "i-1", quoteMinor: 500000 });
  });

  it("returns null when the interest is gone (the page shows an error)", () => {
    expect(
      retryHireMode({ applicants: [applicant({})], creatorAccountId: "c-9", feeMinor: 1 }),
    ).toBeNull();
    expect(
      retryHireMode({ applicants: [applicant({})], creatorAccountId: undefined, feeMinor: 1 }),
    ).toBeNull();
  });

  it("the contract page opens the existing HireSheet, not the applicants list", () => {
    const screen = read("components/creators/screens/HostGigContractScreen.tsx");
    expect(screen).not.toContain("creators/${gigIdForRetry}/interest");
    expect(screen).toContain("void openRetryHire();");
    expect(screen).toContain("retryHireMode({");
    expect(screen).toContain("mode={retryHire}");
    expect(screen.match(/<HireSheet\s/g)?.length).toBe(2);
  });

  it("Creators home sends an unpaid offer to its contract page", () => {
    const home = read("components/creators/CreatorsHomeView.tsx");
    expect(home).not.toMatch(/payment_pending\s*\?\s*router\.push\(`\/brand\/\$\{brandId\}\/creators\/\$\{contract\.gig_id\}\/interest`/);
    expect(home).toContain("onPress={() => openContract(contract.id)}");
  });
});
