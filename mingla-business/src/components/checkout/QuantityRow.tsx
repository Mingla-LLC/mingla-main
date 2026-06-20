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

import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { TicketStub } from "../../store/draftEventStore";
import { formatCurrency } from "../../utils/currency";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

export interface QuantityRowProps {
  ticket: TicketStub;
  /** Currently selected quantity for this ticket type (0 = none). */
  quantity: number;
  /** Caller dispatches; this component is fully controlled. */
  onQuantityChange: (next: number) => void;
  onJoinWaitlist?: (ticketId: string) => void;
}

const MINGLA_BUSINESS_THEME: QuantityRowTheme = {
  accent: accent.warm,
  textPrimary: textTokens.primary,
  textSecondary: textTokens.secondary,
  textTertiary: textTokens.tertiary,
  textQuaternary: textTokens.quaternary,
  stepperBg: glass.tint.chrome.idle,
  stepperBorder: glass.border.chrome,
  semanticWarning: semantic.warning,
  semanticError: semantic.error,
  saleBannerBg: "rgba(245, 158, 11, 0.12)",
  saleBannerBorder: "rgba(245, 158, 11, 0.32)",
  soldOutBg: "rgba(239, 68, 68, 0.16)",
  soldOutBorder: "rgba(239, 68, 68, 0.32)",
};

interface BusinessCardWrapProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const BusinessCardWrap: React.FC<BusinessCardWrapProps> = ({
  children,
  style,
}) => (
  <GlassCard variant="base" radius="lg" padding={spacing.md} style={style}>
    {children}
  </GlassCard>
);

export const QuantityRow: React.FC<QuantityRowProps> = ({
  ticket,
  quantity,
  onQuantityChange,
  onJoinWaitlist,
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
      theme={MINGLA_BUSINESS_THEME}
      fallbackCurrency="GBP"
      onJoinWaitlist={onJoinWaitlist}
    />
  );
};

export default QuantityRow;
