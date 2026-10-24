import type { PayoutReleaseStatus } from "./payoutBreakdown";

export type HostPayoutState =
  | "scheduled"
  | "sending_today"
  | "on_its_way"
  | "paid"
  | "waiting_for_bank"
  | "late_on_us"
  | "needs_you"
  | "couldnt_send"
  | "paused"
  | "cancelled";

export interface PayoutSaleDTO {
  sourceType: "order" | "rsvp_contribution" | "venue_reservation";
  sourceId: string;
  grossCents: number;
  discountCents?: number;
  refundedCents: number;
  disputedCents: number;
  minglaFeeCents: number;
  netCents: number;
  paidAt: string;
}

export interface PayoutScreenReleaseDTO {
  id: string;
  eventId: string | null;
  offeringName: string;
  provider: "stripe" | "paystack";
  currency: string;
  ledgerStatus: PayoutReleaseStatus;
  hostState: HostPayoutState;
  dueAt: string;
  releasedAt: string | null;
  grossCents: number;
  discountCents?: number;
  refundedCents: number;
  disputedCents: number;
  minglaFeeCents: number;
  partnerShareCents: number;
  permanentDebtWithheldCents: number;
  temporaryDebtWithheldCents: number;
  maturityRecreditCents: number;
  netReleaseCents: number;
  cashToBankCents: number;
  transferFeeCreditCents: number;
  transferFeeCents: number;
  stampDutyCents: number;
  salesCount: number;
  lastSaleAt: string | null;
  bankMask: string | null;
  olderPricing: boolean;
  items: PayoutSaleDTO[];
}

export interface BrandPayoutScreenDTO {
  currency: string | null;
  payoutsPaused: boolean;
  salesThisWeekCents: number;
  comingToYouCents: number;
  paidThisMonthCents: number;
  releases: PayoutScreenReleaseDTO[];
}

export interface PayoutWaterfallMath {
  computedHostNetCents: number;
  computedCashToBankCents: number;
  hostNetReconciles: boolean;
  cashReconciles: boolean;
}

/**
 * Host-visible arithmetic only. Provider processing is deliberately absent:
 * Mingla pays it, so it can never reduce either total.
 */
export function payoutWaterfallMath(
  release: PayoutScreenReleaseDTO,
): PayoutWaterfallMath {
  const debt = release.permanentDebtWithheldCents + release.temporaryDebtWithheldCents;
  const computedHostNetCents = Math.max(
    0,
    release.grossCents - release.refundedCents - release.disputedCents -
      release.minglaFeeCents - debt + release.maturityRecreditCents,
  );
  const computedCashToBankCents = Math.max(
    0,
    release.netReleaseCents - release.transferFeeCents - release.stampDutyCents,
  );
  return {
    computedHostNetCents,
    computedCashToBankCents,
    hostNetReconciles: computedHostNetCents === release.netReleaseCents,
    cashReconciles: release.hostState !== "paid" ||
      computedCashToBankCents === release.cashToBankCents,
  };
}

const cents = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};
const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const HOST_STATES: ReadonlySet<string> = new Set([
  "scheduled", "sending_today", "on_its_way", "paid", "waiting_for_bank",
  "late_on_us", "needs_you", "couldnt_send", "paused", "cancelled",
]);
// Keep the Home money tile from pulling the full payout-breakdown renderer into
// the eager web bundle. The type-only import above still makes this allowlist
// answer to the canonical ledger union at compile time.
const LEDGER_STATES: ReadonlySet<PayoutReleaseStatus> = new Set([
  "pending",
  "released",
  "in_flight",
  "blocked_kyc",
  "blocked_balance",
  "blocked_otp",
  "blocked_over_cap",
  "fee_unreconciled",
  "blocked_anchor",
  "cancelled_event",
  "reanchored",
  "failed",
]);

export function parseBrandPayoutScreen(raw: unknown): BrandPayoutScreenDTO | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const rawReleases = Array.isArray(input.releases) ? input.releases : [];
  const releases = rawReleases.flatMap((value): PayoutScreenReleaseDTO[] => {
    if (typeof value !== "object" || value === null) return [];
    const row = value as Record<string, unknown>;
    const hostState = stringOrNull(row.host_state);
    const ledgerStatus = stringOrNull(row.ledger_status);
    const provider = stringOrNull(row.provider);
    const id = stringOrNull(row.id);
    const currency = stringOrNull(row.currency);
    const dueAt = stringOrNull(row.due_at);
    if (
      id === null || currency === null || dueAt === null ||
      hostState === null || !HOST_STATES.has(hostState) ||
      (provider !== "stripe" && provider !== "paystack") ||
      ledgerStatus === null || !LEDGER_STATES.has(ledgerStatus as PayoutReleaseStatus)
    ) return [];
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const items = rawItems.flatMap((item): PayoutSaleDTO[] => {
      if (typeof item !== "object" || item === null) return [];
      const sale = item as Record<string, unknown>;
      const sourceId = stringOrNull(sale.source_id);
      const sourceType = stringOrNull(sale.source_type);
      const paidAt = stringOrNull(sale.paid_at);
      if (
        sourceId === null || paidAt === null ||
        !["order", "rsvp_contribution", "venue_reservation"].includes(sourceType ?? "")
      ) return [];
      return [{
        sourceType: sourceType as PayoutSaleDTO["sourceType"],
        sourceId,
        grossCents: cents(sale.gross_cents),
        discountCents: cents(sale.discount_cents),
        refundedCents: cents(sale.refunded_cents),
        disputedCents: cents(sale.disputed_cents),
        minglaFeeCents: cents(sale.mingla_fee_cents),
        netCents: cents(sale.net_cents),
        paidAt,
      }];
    });
    return [{
      id,
      eventId: stringOrNull(row.event_id),
      offeringName: stringOrNull(row.offering_name) ?? "Payout",
      provider,
      currency,
      ledgerStatus: ledgerStatus as PayoutReleaseStatus,
      hostState: hostState as HostPayoutState,
      dueAt,
      releasedAt: stringOrNull(row.released_at),
      grossCents: cents(row.gross_cents),
      discountCents: cents(row.discount_cents),
      refundedCents: cents(row.refunded_cents),
      disputedCents: cents(row.disputed_cents),
      minglaFeeCents: cents(row.mingla_fee_cents),
      partnerShareCents: cents(row.partner_share_cents),
      permanentDebtWithheldCents: cents(row.permanent_debt_withheld_cents),
      temporaryDebtWithheldCents: cents(row.temporary_debt_withheld_cents),
      maturityRecreditCents: cents(row.maturity_recredit_cents),
      netReleaseCents: cents(row.net_release_cents),
      cashToBankCents: cents(row.cash_to_bank_cents),
      transferFeeCreditCents: cents(row.transfer_fee_credit_cents),
      transferFeeCents: cents(row.transfer_fee_cents),
      stampDutyCents: cents(row.stamp_duty_cents),
      salesCount: cents(row.sales_count),
      lastSaleAt: stringOrNull(row.last_sale_at),
      bankMask: stringOrNull(row.bank_mask),
      olderPricing: row.older_pricing === true,
      items,
    }];
  });
  return {
    currency: stringOrNull(input.currency),
    payoutsPaused: input.payouts_paused === true,
    salesThisWeekCents: cents(input.sales_this_week_cents),
    comingToYouCents: cents(input.coming_to_you_cents),
    paidThisMonthCents: cents(input.paid_this_month_cents),
    releases,
  };
}

export const PAYOUT_STATE_COPY: Record<HostPayoutState, {
  label: string;
  detail: string;
  action: "bank" | "verify" | "support" | null;
}> = {
  scheduled: { label: "Scheduled", detail: "We’ll send this about a day after the sale.", action: null },
  sending_today: { label: "Sending today", detail: "This is due today. We’re preparing it now.", action: null },
  on_its_way: { label: "On its way", detail: "It has left Mingla and is heading to your bank.", action: null },
  paid: { label: "Paid", detail: "Sent to your bank.", action: null },
  waiting_for_bank: { label: "Waiting for your bank", detail: "Add a bank and it goes out in the next payout run.", action: "bank" },
  late_on_us: { label: "Late, on us", detail: "Nothing for you to do: the hold-up is on Mingla’s side.", action: "support" },
  needs_you: { label: "Needs you", detail: "Our payment partner needs to confirm your ID before it can pay you.", action: "verify" },
  couldnt_send: { label: "Couldn’t send", detail: "Your bank turned the transfer down. Check your account details and we’ll try again.", action: "bank" },
  paused: { label: "Paused", detail: "Mingla paused payouts on your account. Your sales are safe and keep adding up.", action: "support" },
  cancelled: { label: "Refunded to buyers", detail: "This event was cancelled. Buyers were refunded from this payout.", action: null },
};
