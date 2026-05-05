/**
 * accountDeletionPreview — Pure aggregator joining 6 client stores into
 * AccountDeletionPreview for J-A4 cascade preview screen (Cycle 14).
 *
 * Per DEC-096 D-14-10: itemized full counts (brands owned + brands team-of +
 * live events + sold orders £total + comps + scanner invites + team invites).
 *
 * Per DEC-096 D-14-14: hasActiveOrUpcomingEvents flag for warn-don't-block
 * branch in delete.tsx Step 2.
 *
 * Selector contract: caller passes RAW arrays (raw entries + useMemo at the
 * route layer per Cycle 9c v2 + Cycle 12 lesson). NEVER subscribe to
 * fresh-array selectors directly.
 *
 * Pure: no side effects, no console.log, no async.
 *
 * **scannerInvitationsCount note:** scoped to 0 for Cycle 14 simplicity
 * (D-CYCLE14-SPEC-1 in IMPL dispatch). If operator surfaces "scanner invites
 * should appear in cascade preview", future extension adds
 * `scannerInvitations: ScannerInvitation[]` to inputs + count derivation
 * (~5 LOC).
 *
 * Per Cycle 14 SPEC §4.6.1.
 */

import type { BrandTeamEntry } from "../store/brandTeamStore";
import type { Brand } from "../store/currentBrandStore";
import type { CompGuestEntry } from "../store/guestStore";
import type { DoorSaleRecord } from "../store/doorSalesStore";
import type { LiveEvent } from "../store/liveEventStore";
import type { OrderRecord } from "../store/orderStore";
import type { ScanRecord } from "../store/scanStore";
import { deriveLiveStatus } from "./eventLifecycle";

export interface AccountDeletionPreview {
  brandsOwnedCount: number;
  brandsTeamMemberCount: number;
  liveEventsCount: number;
  pastEventsCount: number;
  soldOrdersCount: number;
  totalRevenueGbp: number;
  doorSalesCount: number;
  compsCount: number;
  scannerInvitationsCount: number;
  teamInvitationsCount: number;
  /** True if any event is "live" or "upcoming" status — used for D-14-14 warn block. */
  hasActiveOrUpcomingEvents: boolean;
}

export interface AccountDeletionPreviewInputs {
  userId: string;
  brands: Brand[];
  brandTeamEntries: BrandTeamEntry[];
  liveEvents: LiveEvent[];
  orderEntries: OrderRecord[];
  doorSalesEntries: DoorSaleRecord[];
  compEntries: CompGuestEntry[];
  scanEntries: ScanRecord[];
}

export const EMPTY_PREVIEW: AccountDeletionPreview = {
  brandsOwnedCount: 0,
  brandsTeamMemberCount: 0,
  liveEventsCount: 0,
  pastEventsCount: 0,
  soldOrdersCount: 0,
  totalRevenueGbp: 0,
  doorSalesCount: 0,
  compsCount: 0,
  scannerInvitationsCount: 0,
  teamInvitationsCount: 0,
  hasActiveOrUpcomingEvents: false,
};

/**
 * Deterministic, side-effect-free aggregator. Same inputs → identical output.
 *
 * **Note:** brandsOwnedCount is approximate from local Zustand cache. Stub-mode
 * brands (brandList.STUB_BRANDS) all count as "owned" via Brand.role === "owner"
 * inspection. Real backend ownership distinction lands B-cycle.
 */
export const computeAccountDeletionPreview = (
  inputs: AccountDeletionPreviewInputs,
): AccountDeletionPreview => {
  const {
    userId,
    brands,
    brandTeamEntries,
    liveEvents,
    orderEntries,
    doorSalesEntries,
    compEntries,
    scanEntries,
  } = inputs;

  // Brands owned (Brand.role === "owner" — stub-mode synthesis path)
  const ownedBrands = brands.filter((b) => b.role === "owner");
  const brandsOwnedCount = ownedBrands.length;
  const ownedBrandIds = new Set(ownedBrands.map((b) => b.id));

  // Team member of brands (excluding owned brands — only count brands where
  // user is admin/manager but NOT owner). brandTeamEntries are TRANSITIONAL
  // UI-only invitations per I-31; status === "accepted" is the closest to
  // "actual team membership" we have without B-cycle backend.
  const brandsTeamMemberCount = brandTeamEntries.filter(
    (e) =>
      e.status === "accepted" &&
      e.inviteeEmail.length > 0 &&
      !ownedBrandIds.has(e.brandId),
  ).length;

  // Events split by lifecycle status
  let liveEventsCount = 0;
  let pastEventsCount = 0;
  let hasActiveOrUpcomingEvents = false;
  for (const ev of liveEvents) {
    const status = deriveLiveStatus(ev);
    if (status === "live" || status === "upcoming") {
      liveEventsCount += 1;
      hasActiveOrUpcomingEvents = true;
    } else {
      pastEventsCount += 1;
    }
  }

  // Orders + revenue (live amount = total - refunded across paid + refunded_partial)
  const liveOrders = orderEntries.filter(
    (o) => o.status === "paid" || o.status === "refunded_partial",
  );
  const soldOrdersCount = liveOrders.length;
  const totalRevenueGbp = liveOrders.reduce(
    (sum, o) => sum + Math.max(0, o.totalGbpAtPurchase - o.refundedAmountGbp),
    0,
  );

  // Door sales count (each row is one sale; door buyers may be multi-line)
  const doorSalesCount = doorSalesEntries.length;

  // Comps
  const compsCount = compEntries.length;

  // Scanner invitations sent by this user — Cycle 14 simplification (D-CYCLE14-SPEC-1):
  // useScannerInvitationsStore is NOT in inputs to keep aggregator scoped.
  // Future extension adds scannerInvitations: ScannerInvitation[] to inputs.
  const scannerInvitationsCount = 0;

  // Team invitations sent (brand_team_members entries where this user invited)
  const teamInvitationsCount = brandTeamEntries.filter(
    (e) => e.invitedBy === userId,
  ).length;

  // Mark scanEntries as intentionally unused (kept in inputs for symmetry with
  // reconciliation aggregator pattern; future GDPR scan-history disclosure may
  // surface a count).
  void scanEntries;

  return {
    brandsOwnedCount,
    brandsTeamMemberCount,
    liveEventsCount,
    pastEventsCount,
    soldOrdersCount,
    totalRevenueGbp: Math.round(totalRevenueGbp * 100) / 100,
    doorSalesCount,
    compsCount,
    scannerInvitationsCount,
    teamInvitationsCount,
    hasActiveOrUpcomingEvents,
  };
};
