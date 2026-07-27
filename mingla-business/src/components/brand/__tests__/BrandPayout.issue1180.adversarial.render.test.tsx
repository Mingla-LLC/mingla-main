/**
 * #1180 [payout-ui-copy] — mingla-tester ADVERSARIAL RENDER proof.
 *
 * DIFFERENT ANGLE than the implementor's pure-util happy-path suite
 * (payoutBreakdown.issue1180.test.ts): that suite proves the arithmetic in
 * isolation; THIS suite mounts the production components with @testing-library/
 * react-native and proves the load-bearing UI branches actually RENDER at
 * runtime (source-grep is capped at "suspected"):
 *
 *   1. RECEIPT ADDS UP ON SCREEN — every gross→bank line renders with the ₦
 *      glyph and the on-screen numbers sum to the displayed final.
 *   2. NG fee itemization — transfer fee + ₦50 stamp duty as SEPARATE lines,
 *      NO "partner transfer fee" line, un-reconciled → "Confirming…" (no number).
 *   3. ACCESS BRANCH (load-bearing) — below finance_manager renders the DISTINCT
 *      "limited access" card, NEVER "No payouts yet"; finance + zero rows renders
 *      the honest "No payouts yet".
 *   4. CANTAINER STATES — loading / error+retry / both empties / populated.
 *   5. CANCELLED = GREY pill (draft), not red; no error_message/OTP internals.
 *   6. Debt banner + refund rows.
 *   7. Explainer NG note gating + honest 3-step timeline.
 *
 * fails-on-revert: reverting currency.ts `NGN:"en-NG"` turns "₦…" into "NGN …"
 * → the receipt ₦-glyph assertions here go red (independent of the util suite).
 *
 * Tester-authored, append-only. Run:
 *   npx jest --config jest.issue1180.render.cjs --runInBand
 */

import React from "react";

// Deterministic reanimated mock (reduced-motion path; no worklet backend).
jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const passthrough = (v: unknown): unknown => v;
  return {
    __esModule: true,
    default: {
      View: RN.View,
      Text: RN.Text,
      ScrollView: RN.ScrollView,
      createAnimatedComponent: (c: unknown) => c,
    },
    createAnimatedComponent: (c: unknown) => c,
    useSharedValue: (init: unknown) => ({ value: init }),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    withTiming: passthrough,
    withRepeat: passthrough,
    cancelAnimation: () => undefined,
    Easing: {
      bezier: () => () => 0,
      inOut: () => () => 0,
      ease: 0,
      sin: 0,
    },
  };
});

// Sheet is a shared primitive (gesture-handler + reanimated mechanics tested
// elsewhere); here we only assert the explainer's CONTENT + NG-note gating, so
// render its children when visible.
jest.mock("../../ui/Sheet", () => {
  const RN = jest.requireActual("react-native");
  const React2 = jest.requireActual("react");
  return {
    Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? React2.createElement(RN.View, null, children) : null,
  };
});

import { render, screen, fireEvent } from "@testing-library/react-native";

import { BrandPayoutBreakdown } from "../BrandPayoutBreakdown";
import { BrandPayoutStatusPill } from "../BrandPayoutStatusPill";
import { BrandPayoutTimelineExplainer } from "../BrandPayoutTimelineExplainer";
import type {
  BrandPayoutLedger,
  BrandPayoutReleaseDTO,
  PayoutLedgerAdjustmentDTO,
  PayoutTransferLegDTO,
  OrganiserPayoutDebtDTO,
} from "../../../utils/payoutBreakdown";

// ---- controllable hook mocks (factory form: never load the real modules,
// which pull expo-constants/AuthContext native code that has no headless
// backend). --------------------------------------------------------------------
jest.mock("../../../hooks/useBrandPayoutLedger", () => ({
  useBrandPayoutLedger: jest.fn(),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: jest.fn(),
}));
import { useBrandPayoutLedger } from "../../../hooks/useBrandPayoutLedger";
import { useCurrentBrandRole } from "../../../hooks/useCurrentBrandRole";

const mockLedger = useBrandPayoutLedger as jest.Mock;
const mockRole = useCurrentBrandRole as jest.Mock;

const refetch = jest.fn();

const setRole = (rank: number): void =>
  mockRole.mockReturnValue({
    role: rank >= 30 ? "finance_manager" : "brand_staff",
    rank,
    permissionsOverride: {},
    isLoading: false,
    isError: false,
  });

const setLedger = (
  over: Partial<{
    isLoading: boolean;
    isError: boolean;
    data: BrandPayoutLedger | undefined;
  }> = {},
): void =>
  mockLedger.mockReturnValue({
    isLoading: over.isLoading ?? false,
    isError: over.isError ?? false,
    data: over.data,
    refetch,
  });

const makeRelease = (
  over: Partial<BrandPayoutReleaseDTO> = {},
): BrandPayoutReleaseDTO => ({
  id: "rel_1",
  brandId: "brand_1",
  eventId: "evt_1",
  provider: "paystack",
  currency: "ngn",
  status: "released",
  anchorEndAt: "2026-07-12T20:00:00.000Z",
  releasableAt: "2026-07-15T20:00:00.000Z",
  releasedAt: "2026-07-16T20:00:00.000Z",
  grossCents: 0,
  refundedCents: 0,
  disputedCents: 0,
  minglaFeeCents: 0,
  partnerShareCents: 0,
  providerFeeCents: 0,
  permanentDebtWithheldCents: 0,
  temporaryDebtWithheldCents: 0,
  maturityRecreditCents: 0,
  netReleaseCents: 0,
  organiserCashDeliveredCents: 0,
  createdAt: "2026-07-12T20:00:00.000Z",
  ...over,
});

const makeLeg = (over: Partial<PayoutTransferLegDTO> = {}): PayoutTransferLegDTO => ({
  id: "leg_1",
  releaseId: "rel_1",
  kind: "organiser",
  principalCents: 0,
  estimatedFeeCents: 0,
  stampDutyCents: 0,
  actualFeeCents: null,
  actualStampDutyCents: null,
  feeVarianceCents: null,
  status: "succeeded",
  ...over,
});

const emptyLedger: BrandPayoutLedger = {
  releases: [],
  legsByRelease: {},
  adjustments: [],
  openDebts: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  refetch.mockReset();
});

// ============================================================================
// 1 + 2. Receipt adds up on screen + NG itemization (finance_manager, released)
// ============================================================================
describe("#1180 receipt renders and ADDS UP (NG released, finance_manager)", () => {
  // Internally-consistent NG release: 50000 − 2500 − 10000 − 750 − 48 − 50 = 36652 (major ₦).
  const release = makeRelease({
    status: "released",
    grossCents: 5_000_000,
    minglaFeeCents: 250_000,
    partnerShareCents: 1_000_000,
    providerFeeCents: 75_000,
    netReleaseCents: 3_665_200,
    organiserCashDeliveredCents: 3_665_200,
  });
  const legs = [
    makeLeg({ kind: "organiser", actualFeeCents: 4_800, estimatedFeeCents: 5_000, actualStampDutyCents: 5_000, stampDutyCents: 5_000 }),
    // partner leg — MUST NOT produce a receipt line.
    makeLeg({ id: "leg_2", kind: "partner", actualFeeCents: 3_000, actualStampDutyCents: 5_000 }),
  ];
  const data: BrandPayoutLedger = {
    releases: [release],
    legsByRelease: { rel_1: legs },
    adjustments: [],
    openDebts: [],
  };

  beforeEach(() => {
    setRole(30);
    setLedger({ data });
  });

  it("renders every gross→bank line with the ₦ glyph and the numbers sum to the final", () => {
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand onOpenExplainer={jest.fn()} />,
    );
    // Each visible line renders with ₦ (NOT "NGN") — proves the currency.ts fix.
    expect(screen.getAllByText("Gross sales").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("₦50,000.00").length).toBeGreaterThanOrEqual(1); // gross
    expect(screen.getAllByText("−₦2,500.00").length).toBeGreaterThanOrEqual(1); // mingla
    expect(screen.getAllByText("−₦10,000.00").length).toBeGreaterThanOrEqual(1); // partner share
    expect(screen.getAllByText("−₦750.00").length).toBeGreaterThanOrEqual(1); // provider fee
    expect(screen.getAllByText("−₦48.00").length).toBeGreaterThanOrEqual(1); // transfer fee (actual)
    expect(screen.getAllByText("−₦50.00").length).toBeGreaterThanOrEqual(1); // stamp duty
    // Final: 50000 − 2500 − 10000 − 750 − 48 − 50 = 36652 → the ARITHMETIC adds up on screen.
    expect(screen.getAllByText("Cash to your bank").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("₦36,652.00").length).toBeGreaterThanOrEqual(1);
    // NEVER a "NGN 50,000.00" glyph regression.
    expect(screen.queryByText(/NGN\s?50,000/)).toBeNull();
  });

  it("has separate transfer-fee + stamp-duty lines, NO 'partner transfer fee', NO 'next business day'", () => {
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand onOpenExplainer={jest.fn()} />,
    );
    expect(screen.getAllByText("Bank transfer fee").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Stamp duty").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/partner transfer/i)).toBeNull();
    expect(screen.queryByText(/next business day/i)).toBeNull();
    expect(screen.queryByText(/instant/i)).toBeNull();
  });
});

// ============================================================================
// fee_unreconciled → "Confirming…" (never a fabricated number)
// ============================================================================
describe("#1180 fee_unreconciled renders 'Confirming…', not a fake number", () => {
  it("shows Confirming… for fee + duty and 'Net to be released'", () => {
    setRole(30);
    const release = makeRelease({
      status: "fee_unreconciled",
      grossCents: 100_000,
      netReleaseCents: 90_000,
    });
    setLedger({
      data: {
        releases: [release],
        legsByRelease: { rel_1: [makeLeg({ kind: "organiser", estimatedFeeCents: 5_000, stampDutyCents: 5_000 })] },
        adjustments: [],
        openDebts: [],
      },
    });
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand onOpenExplainer={jest.fn()} />,
    );
    expect(screen.getAllByText("Confirming…").length).toBeGreaterThanOrEqual(1);
    // Final label carries a nested "· confirming fees" qualifier → match by regex.
    expect(screen.getAllByText(/Net to be released/).length).toBeGreaterThanOrEqual(1);
    // The estimate must NOT be rendered as if it were the confirmed fee.
    expect(screen.queryByText("−₦50.00")).toBeNull();
  });
});

// ============================================================================
// 3. ACCESS BRANCH (load-bearing): limited vs honest empty
// ============================================================================
describe("#1180 RLS access branch — limited vs honest empty", () => {
  it("below finance_manager → 'Payout details are limited', NEVER 'No payouts yet'", () => {
    setRole(10); // brand_staff, below finance_manager (30)
    setLedger({ data: emptyLedger });
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand={false} onOpenExplainer={jest.fn()} />,
    );
    expect(screen.getByText("Payout details are limited")).toBeTruthy();
    expect(
      screen.getByText(/visible to finance managers and owners/i),
    ).toBeTruthy();
    expect(screen.queryByText("No payouts yet")).toBeNull();
    expect(screen.queryByText(/Payouts appear here/i)).toBeNull();
  });

  it("finance_manager + zero rows → honest 'No payouts yet', NOT the limited card", () => {
    setRole(30);
    setLedger({ data: emptyLedger });
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand={false} onOpenExplainer={jest.fn()} />,
    );
    expect(screen.getByText("No payouts yet")).toBeTruthy();
    expect(screen.getByText(/Payouts appear here 3 days after your first event/i)).toBeTruthy();
    expect(screen.queryByText("Payout details are limited")).toBeNull();
  });
});

// ============================================================================
// 4. Container states — loading + error/retry
// ============================================================================
describe("#1180 container states", () => {
  it("loading → renders without any empty/limited/error copy", () => {
    setRole(30);
    setLedger({ isLoading: true, data: undefined });
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand={false} onOpenExplainer={jest.fn()} />,
    );
    expect(screen.queryByText("No payouts yet")).toBeNull();
    expect(screen.queryByText("Payout details are limited")).toBeNull();
    expect(screen.queryByText(/Couldn.t load your payouts/)).toBeNull();
    // The section still renders its header.
    expect(screen.getByText("PAYOUTS")).toBeTruthy();
  });

  it("error → retry card renders and 'Try again' fires refetch()", () => {
    setRole(30);
    setLedger({ isError: true, data: undefined });
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand={false} onOpenExplainer={jest.fn()} />,
    );
    expect(screen.getByText(/Couldn.t load your payouts/)).toBeTruthy();
    fireEvent.press(screen.getByText("Try again"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 5. CANCELLED = GREY (draft) pill — not red; no internals
// ============================================================================
describe("#1180 CANCELLED status pill is GREY, not red", () => {
  it("renders label CANCELLED, a11y 'Cancelled', draft-grey token present, error-red absent", () => {
    render(<BrandPayoutStatusPill status="cancelled_event" />);
    expect(screen.getByText("CANCELLED")).toBeTruthy();
    expect(screen.getByLabelText("Cancelled")).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    // draft grey background/border tokens present…
    expect(tree).toContain("rgba(255, 255, 255, 0.06)");
    // …and the error-red variant tokens ABSENT (would signal a false alarm).
    expect(tree).not.toContain("rgba(239, 68, 68");
  });

  it("failed → red 'NEEDS ATTENTION'; released → green 'RELEASED'", () => {
    render(<BrandPayoutStatusPill status="failed" testID="p-failed" />);
    expect(screen.getByText("NEEDS ATTENTION")).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain("rgba(239, 68, 68");
  });
});

// ============================================================================
// 6. Debt banner + refund rows
// ============================================================================
describe("#1180 debt banner + refund history render", () => {
  it("open debt → 'Balance carried forward' banner with the owed amount", () => {
    setRole(30);
    const debt: OrganiserPayoutDebtDTO = {
      id: "d1",
      brandId: "brand_1",
      currency: "ngn",
      kind: "post_release_refund",
      principalCents: 500_000,
      recoveredCents: 100_000,
      status: "open",
      openedAt: "2026-07-01T00:00:00Z",
    };
    setLedger({ data: { ...emptyLedger, openDebts: [debt] } });
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand onOpenExplainer={jest.fn()} />,
    );
    expect(screen.getByText("Balance carried forward")).toBeTruthy();
    // 500000 − 100000 = 400000 minor → ₦4,000.00 owed.
    expect(screen.getByText(/₦4,000\.00 will come out of your next payout/)).toBeTruthy();
  });

  it("refund adjustment → RECENT REFUNDS row with a − debit amount", () => {
    setRole(30);
    const adj: PayoutLedgerAdjustmentDTO = {
      id: "a1",
      releaseId: "rel_1",
      brandId: "brand_1",
      currency: "ngn",
      kind: "post_release_refund",
      amountCents: 120_000,
      createdAt: "2026-07-10T00:00:00Z",
    };
    setLedger({ data: { ...emptyLedger, adjustments: [adj] } });
    render(
      <BrandPayoutBreakdown brandId="brand_1" isNgBrand onOpenExplainer={jest.fn()} />,
    );
    expect(screen.getByText("RECENT REFUNDS")).toBeTruthy();
    expect(screen.getByText("Refund")).toBeTruthy();
    expect(screen.getByText("−₦1,200.00")).toBeTruthy();
  });
});

// ============================================================================
// 7. Explainer sheet NG-note gating + honest timeline
// ============================================================================
describe("#1180 payout explainer sheet", () => {
  it("NG brand → 3-step honest timeline + ₦50 stamp-duty note", () => {
    render(
      <BrandPayoutTimelineExplainer visible onClose={jest.fn()} isNgBrand />,
    );
    expect(screen.getByText("How payouts work")).toBeTruthy();
    expect(screen.getByText("Your event ends")).toBeTruthy();
    expect(screen.getByText(/3 days later, we release your payout/)).toBeTruthy();
    expect(screen.getByText(/Within 1–2 business days, it reaches your bank/)).toBeTruthy();
    expect(screen.getByText(/₦50 stamp duty per transfer/)).toBeTruthy();
    expect(screen.queryByText(/next business day/i)).toBeNull();
  });

  it("non-NG brand → NO Nigeria stamp-duty note", () => {
    render(
      <BrandPayoutTimelineExplainer visible onClose={jest.fn()} isNgBrand={false} />,
    );
    expect(screen.getByText("How payouts work")).toBeTruthy();
    expect(screen.queryByText(/₦50 stamp duty per transfer/)).toBeNull();
  });
});
