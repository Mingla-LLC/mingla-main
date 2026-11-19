/**
 * QuantityRow — mingla-business thin wrapper around
 * `@mingla/offering-rendering`'s shared QuantityRow.
 *
 * Per ORCH-0847 Phase A2 — the implementation moved to a shared package so
 * the consumer-app `TicketCartSheet` (Phase C) can render the same UX inside
 * `ExpandedBusinessEventSheet`. This wrapper preserves the original
 * mingla-business API verbatim (`{ ticket, quantity, onQuantityChange }`) so
 * the single call site at `app/checkout/[eventId]/index.tsx:264-278` is
 * unchanged.
 */

import React, { useCallback, useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import {
  QuantityRow as PackageQuantityRow,
  type QuantityRowTheme,
} from "@mingla/offering-rendering";

import { space } from "../../constants/designSystem";
import { checkoutValue, color, materials } from "./checkoutTheme";
import type { TicketStub } from "../../store/draftEventStore";
import { formatCurrency } from "../../utils/currency";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

export interface QuantityRowProps {
  ticket: TicketStub & { dayScopeLabel?: string | null };
  /** Currently selected quantity for this ticket type (0 = none). */
  quantity: number;
  /** Caller dispatches; this component is fully controlled. */
  onQuantityChange: (next: number) => void;
  onJoinWaitlist?: (ticketId: string) => void;
  /**
   * ORCH-1181 — a ready-formatted per-package installment sub-line (e.g.
   * "From $125.00 today · pay over time"). Forwarded verbatim to the shared
   * QuantityRow. The checkout screen passes it ONLY for a trip tier on a payment
   * plan when pay-over-time is the active cart choice (null otherwise → events /
   * no-plan / pay-in-full render nothing).
   */
  installmentNote?: string | null;
  /**
   * issue #3314 — true ⇒ no "N left" caption (the organiser's "Hide remaining
   * count"). Forwarded verbatim. Absent ⇒ unchanged for trip/experience carts.
   */
  hideRemainingCount?: boolean;
}

const businessTheme = checkoutValue((): QuantityRowTheme => ({
  accent: color.accent,
  textPrimary: color.text1,
  textSecondary: color.text2,
  textTertiary: color.text3,
  textQuaternary: color.text4,
  stepperBg: materials.control.solidFill,
  stepperBorder: color.lineStrong,
  semanticWarning: color.warning,
  semanticError: color.danger,
  saleBannerBg: color.warningTint,
  saleBannerBorder: color.warning,
  soldOutBg: color.errorTint,
  soldOutBorder: color.errorLine,
}));

interface BusinessCardWrapProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const BusinessCardWrap: React.FC<BusinessCardWrapProps> = ({
  children,
  style,
}) => (
  <GlassCard variant="base" radius="lg" padding={space[4]} style={style}>
    {children}
  </GlassCard>
);

export const QuantityRow: React.FC<QuantityRowProps> = ({
  ticket,
  quantity,
  onQuantityChange,
  onJoinWaitlist,
  installmentNote,
  hideRemainingCount,
}) => {
  const renderPlusIcon = useCallback(
    (iconProps: { size: number; color: string }) => (
      <Icon name="plus" size={iconProps.size} color={iconProps.color} />
    ),
    [],
  );

  const ticketForPackage = useMemo(
    () => ({
      id: ticket.id,
      name: ticket.name,
      description: ticket.description ?? null,
      priceGbp: ticket.priceGbp,
      // ORCH-1147R2 — forward the server fee-grossed all-in so the shared row
      // leads with the per-tier all-in + "incl. VAT & fees" caption, matching
      // the public page. Falls back to base when null (free / RPC miss — never
      // fabricated). I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.
      priceAllInGbp: ticket.priceAllInGbp ?? null,
      currency: ticket.currency,
      capacity: ticket.capacity,
      isFree: ticket.isFree,
      isUnlimited: ticket.isUnlimited,
      visibility: ticket.visibility,
      minPurchaseQty: ticket.minPurchaseQty ?? null,
      maxPurchaseQty: ticket.maxPurchaseQty ?? null,
      saleStartAt: ticket.saleStartAt ?? null,
      saleEndAt: ticket.saleEndAt ?? null,
      waitlistEnabled: ticket.waitlistEnabled,
      dayScopeLabel: ticket.dayScopeLabel ?? null,
    }),
    [ticket],
  );

  return (
    <PackageQuantityRow
      ticket={ticketForPackage}
      quantity={quantity}
      onQuantityChange={onQuantityChange}
      CardComponent={BusinessCardWrap}
      renderPlusIcon={renderPlusIcon}
      formatCurrency={formatCurrency}
      theme={businessTheme()}
      onJoinWaitlist={onJoinWaitlist}
      installmentNote={installmentNote}
      hideRemainingCount={hideRemainingCount}
    />
  );
};

export default QuantityRow;
