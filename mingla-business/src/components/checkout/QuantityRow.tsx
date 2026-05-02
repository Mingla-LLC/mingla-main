/**
 * QuantityRow — per-ticket-type row on J-C1 Tickets screen.
 *
 * Renders a GlassCard with:
 *   - Ticket name + inline +/- quantity stepper (right-aligned)
 *   - Price line + "X left" caption (when capacity ≤ 5 AND !isUnlimited)
 *   - Optional description (max 2 lines)
 *   - Sale-window banner (saleStartAt > now → row disabled with banner)
 *
 * Quantity stepper is composed inline (NOT the kit's Stepper primitive,
 * which is a wizard step indicator). The minus button uses Unicode
 * "−" (U+2212) wrapped in a Pressable — the Icon set lacks a "minus"
 * glyph (D-IMPL-CYCLE8a-1; future cycles may add to Icon set
 * additively per DEC-082 precedent).
 *
 * Per Cycle 8 spec §4.4.
 */

import React, { useCallback, useMemo } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { TicketStub } from "../../store/draftEventStore";
import { formatGbp } from "../../utils/currency";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

const STEPPER_BTN = 44;
const ICON_SIZE = 18;

const formatSaleDate = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "soon";
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export interface QuantityRowProps {
  ticket: TicketStub;
  /** Currently selected quantity for this ticket type (0 = none). */
  quantity: number;
  /** Caller dispatches; this component is fully controlled. */
  onQuantityChange: (next: number) => void;
}

export const QuantityRow: React.FC<QuantityRowProps> = ({
  ticket,
  quantity,
  onQuantityChange,
}) => {
  // Sale-window state ------------------------------------------------
  const saleNotOpen = useMemo<boolean>(() => {
    if (ticket.saleStartAt === null) return false;
    const start = new Date(ticket.saleStartAt).getTime();
    return Number.isFinite(start) && start > Date.now();
  }, [ticket.saleStartAt]);

  const saleEnded = useMemo<boolean>(() => {
    if (ticket.saleEndAt === null) return false;
    const end = new Date(ticket.saleEndAt).getTime();
    return Number.isFinite(end) && end < Date.now();
  }, [ticket.saleEndAt]);

  const isDisabled = saleNotOpen || saleEnded || ticket.visibility === "disabled";

  // Quantity clamps --------------------------------------------------
  const min = ticket.minPurchaseQty ?? 1;
  const remainingCapacity = ticket.isUnlimited
    ? Number.POSITIVE_INFINITY
    : (ticket.capacity ?? 0);
  const effectiveMax = Math.min(
    remainingCapacity,
    ticket.maxPurchaseQty ?? Number.POSITIVE_INFINITY,
  );
  const showXLeft =
    !ticket.isUnlimited && remainingCapacity > 0 && remainingCapacity <= 5;
  const isSoldOut = !ticket.isUnlimited && remainingCapacity === 0;

  const canDecrement = quantity > 0 && !isDisabled;
  const canIncrement = quantity < effectiveMax && !isDisabled && !isSoldOut;

  // Handlers ---------------------------------------------------------
  const triggerHaptic = useCallback((): void => {
    if (Platform.OS === "web") return;
    Haptics.selectionAsync().catch(() => {
      // selection haptics throw on Android emulators without a
      // hardware-haptic device — silently swallow
    });
  }, []);

  const handleDecrement = useCallback((): void => {
    if (!canDecrement) return;
    triggerHaptic();
    // Allow stepping down to 0 (deselect). minPurchaseQty applies only
    // when adding the FIRST ticket; reducing back to 0 always allowed.
    onQuantityChange(quantity - 1);
  }, [canDecrement, quantity, onQuantityChange, triggerHaptic]);

  const handleIncrement = useCallback((): void => {
    if (!canIncrement) return;
    triggerHaptic();
    // First add jumps to minPurchaseQty (typically 1), subsequent
    // adds increment by 1.
    const next = quantity === 0 ? Math.max(1, min) : quantity + 1;
    onQuantityChange(Math.min(next, effectiveMax));
  }, [canIncrement, quantity, min, effectiveMax, onQuantityChange, triggerHaptic]);

  // Render -----------------------------------------------------------
  const priceText =
    ticket.isFree ? "Free" : formatGbp(ticket.priceGbp ?? 0);

  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={spacing.md}
      style={[styles.host, isDisabled && styles.hostDisabled]}
    >
      <View style={styles.headerRow}>
        <View style={styles.nameCol}>
          <Text style={styles.name} numberOfLines={2}>
            {ticket.name}
          </Text>
        </View>
        {isSoldOut ? (
          <View style={styles.soldOutBadge}>
            <Text style={styles.soldOutText}>Sold out</Text>
          </View>
        ) : isDisabled ? null : (
          <View style={styles.stepperRow}>
            <Pressable
              onPress={handleDecrement}
              disabled={!canDecrement}
              accessibilityRole="button"
              accessibilityLabel={`Decrease ${ticket.name} quantity`}
              accessibilityState={{ disabled: !canDecrement }}
              style={({ pressed }) => [
                styles.stepperBtn,
                !canDecrement && styles.stepperBtnDisabled,
                pressed && canDecrement && styles.stepperBtnPressed,
              ]}
              hitSlop={4}
            >
              <Text
                style={[
                  styles.stepperGlyph,
                  !canDecrement && styles.stepperGlyphDisabled,
                ]}
                accessible={false}
              >
                {/* U+2212 minus sign — the Icon set lacks "minus" glyph */}
                {"−"}
              </Text>
            </Pressable>
            <Text
              style={styles.qty}
              accessibilityLabel={`${quantity} ${ticket.name} selected`}
              accessibilityLiveRegion="polite"
            >
              {quantity}
            </Text>
            <Pressable
              onPress={handleIncrement}
              disabled={!canIncrement}
              accessibilityRole="button"
              accessibilityLabel={`Increase ${ticket.name} quantity`}
              accessibilityState={{ disabled: !canIncrement }}
              style={({ pressed }) => [
                styles.stepperBtn,
                !canIncrement && styles.stepperBtnDisabled,
                pressed && canIncrement && styles.stepperBtnPressed,
              ]}
              hitSlop={4}
            >
              <Icon
                name="plus"
                size={ICON_SIZE}
                color={canIncrement ? accent.warm : textTokens.quaternary}
              />
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.priceRow}>
        <Text style={styles.priceText}>{priceText}</Text>
        {showXLeft ? (
          <Text style={styles.xLeftText}>
            {" · "}
            {remainingCapacity} left
          </Text>
        ) : null}
      </View>

      {ticket.description !== null && ticket.description.trim().length > 0 ? (
        <Text style={styles.description} numberOfLines={2}>
          {ticket.description}
        </Text>
      ) : null}

      {saleNotOpen && ticket.saleStartAt !== null ? (
        <View style={styles.saleBanner}>
          <Text style={styles.saleBannerText}>
            Sales open {formatSaleDate(ticket.saleStartAt)}
          </Text>
        </View>
      ) : null}
      {saleEnded ? (
        <View style={styles.saleBanner}>
          <Text style={styles.saleBannerText}>Sales ended</Text>
        </View>
      ) : null}
      {ticket.visibility === "disabled" ? (
        <View style={styles.saleBanner}>
          <Text style={styles.saleBannerText}>Sales paused</Text>
        </View>
      ) : null}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  host: {
    marginBottom: spacing.sm,
  },
  hostDisabled: {
    opacity: 0.55,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  nameCol: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stepperBtn: {
    width: STEPPER_BTN,
    height: STEPPER_BTN,
    borderRadius: radiusTokens.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  stepperBtnDisabled: {
    opacity: 0.32,
  },
  stepperBtnPressed: {
    opacity: 0.7,
  },
  stepperGlyph: {
    fontSize: 22,
    lineHeight: 22,
    fontWeight: "500",
    color: accent.warm,
    marginTop: -2, // optical centre — minus sign sits low at this size
  },
  stepperGlyphDisabled: {
    color: textTokens.quaternary,
  },
  qty: {
    minWidth: 32,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: spacing.xs,
  },
  priceText: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  xLeftText: {
    fontSize: 13,
    fontWeight: "500",
    color: semantic.warning,
  },
  description: {
    marginTop: spacing.xs,
    fontSize: 13,
    color: textTokens.tertiary,
    lineHeight: 18,
  },
  saleBanner: {
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.32)",
  },
  saleBannerText: {
    fontSize: 12,
    color: semantic.warning,
    fontWeight: "500",
  },
  soldOutBadge: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(239, 68, 68, 0.16)",
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.32)",
  },
  soldOutText: {
    fontSize: 12,
    color: semantic.error,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
});

export default QuantityRow;
