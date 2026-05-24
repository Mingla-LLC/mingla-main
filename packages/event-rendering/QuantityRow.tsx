/**
 * QuantityRow — per-ticket-type stepper row for ticket cart UIs.
 *
 * Per ORCH-0847 Phase A2 — extracted from
 * `mingla-business/src/components/checkout/QuantityRow.tsx` so the consumer
 * app's `TicketCartSheet` (Phase C) can render the same UX inside
 * `ExpandedBusinessEventSheet`. Mirrors public-page J-C1 stepper exactly.
 *
 * Ports-and-adapters design — host app supplies:
 *   - `CardComponent` — the surrounding card wrapper (mingla-business: GlassCard;
 *     consumer app: equivalent in its own design system)
 *   - `renderPlusIcon` — host's "+" glyph (the "−" minus is rendered inline as
 *     Unicode U+2212 by this package, matching the original mingla-business
 *     behavior where the Icon set lacked a "minus" glyph)
 *   - `formatCurrency` — host's locale-aware money formatter
 *   - `theme` — color tokens, with sensible mingla-business defaults so callers
 *     can pass `{}` to inherit the original visual
 *
 * Logic preserved verbatim from the original (354 lines):
 *   - sale-window state (saleNotOpen / saleEnded / isDisabled)
 *   - capacity clamps (min, effectiveMax = min(remainingCapacity, maxPurchaseQty))
 *   - "X left" caption when capacity ≤ 5 AND !isUnlimited
 *   - sold-out badge when capacity === 0
 *   - first-add jumps to minPurchaseQty; subsequent adds increment by 1
 *   - decrement to 0 always allowed (deselect)
 *   - haptics.selectionAsync on every stepper tap (silent-fail on Android emulators)
 */

import React, { useCallback, useMemo } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";

const STEPPER_BTN = 44;
const PLUS_ICON_SIZE = 18;

/**
 * Minimal ticket shape consumed by QuantityRow. Mingla-business's `TicketStub`
 * and the consumer app's ticket DTO are both structurally assignable.
 *
 * `visibility` accepts any string; only the literal `"disabled"` is checked
 * to render the "Sales paused" banner + hide the stepper. Mingla-business
 * uses `"public" | "hidden" | "disabled"`; the event-rendering package's
 * other types use `"visible" | "hidden" | "disabled"` — both are accepted
 * because the relevant check is `=== "disabled"`.
 */
export interface QuantityRowTicket {
  id: string;
  name: string;
  description?: string | null;
  /** Major-unit price (e.g., 12.50 for £12.50). Null when isFree. */
  priceGbp: number | null;
  /** ISO 4217 code. Falls back to caller-supplied default. */
  currency?: string;
  /** Remaining capacity. NaN/null treated as "no capacity info". */
  capacity: number | null;
  isFree: boolean;
  isUnlimited: boolean;
  visibility: string;
  minPurchaseQty?: number | null;
  maxPurchaseQty?: number | null;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
  waitlistEnabled?: boolean;
}

/**
 * Color tokens with mingla-business defaults so callers passing `{}` get the
 * original visual exactly. Consumer app can override individual keys.
 */
export interface QuantityRowTheme {
  accent?: string;
  textPrimary?: string;
  textSecondary?: string;
  textTertiary?: string;
  textQuaternary?: string;
  stepperBg?: string;
  stepperBorder?: string;
  semanticWarning?: string;
  semanticError?: string;
  saleBannerBg?: string;
  saleBannerBorder?: string;
  soldOutBg?: string;
  soldOutBorder?: string;
}

const DEFAULT_THEME: Required<QuantityRowTheme> = {
  accent: "#eb7825",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textSecondary: "rgba(255, 255, 255, 0.78)",
  textTertiary: "rgba(255, 255, 255, 0.58)",
  textQuaternary: "rgba(255, 255, 255, 0.38)",
  stepperBg: "rgba(255, 255, 255, 0.06)",
  stepperBorder: "rgba(255, 255, 255, 0.12)",
  semanticWarning: "#f59e0b",
  semanticError: "#ef4444",
  saleBannerBg: "rgba(245, 158, 11, 0.12)",
  saleBannerBorder: "rgba(245, 158, 11, 0.32)",
  soldOutBg: "rgba(239, 68, 68, 0.16)",
  soldOutBorder: "rgba(239, 68, 68, 0.32)",
};

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
  ticket: QuantityRowTicket;
  /** Currently selected quantity for this ticket type (0 = none). */
  quantity: number;
  /** Caller dispatches; this component is fully controlled. */
  onQuantityChange: (next: number) => void;
  /** Host card wrapper. Receives `children` and `style`. */
  CardComponent: React.ComponentType<{
    children?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
  }>;
  /** Host's "+" icon renderer. The minus glyph is U+2212 (no icon needed). */
  renderPlusIcon: (props: {
    size: number;
    color: string;
  }) => React.ReactElement;
  /** Host's locale-aware money formatter (value in major units, ISO 4217 code). */
  formatCurrency: (value: number, currency: string) => string;
  /** Color tokens. Defaults mirror the mingla-business public buyer page. */
  theme?: QuantityRowTheme;
  /** Optional fallback when `ticket.currency` is undefined. Default "GBP". */
  fallbackCurrency?: string;
  /** Called when a sold-out waitlist-enabled row is tapped. */
  onJoinWaitlist?: (ticketId: string) => void;
}

export const QuantityRow: React.FC<QuantityRowProps> = ({
  ticket,
  quantity,
  onQuantityChange,
  CardComponent,
  renderPlusIcon,
  formatCurrency,
  theme,
  fallbackCurrency = "GBP",
  onJoinWaitlist,
}) => {
  const t: Required<QuantityRowTheme> = useMemo(
    () => ({ ...DEFAULT_THEME, ...(theme ?? {}) }),
    [theme],
  );

  // Sale-window state -------------------------------------------------------
  const saleNotOpen = useMemo<boolean>(() => {
    if (!ticket.saleStartAt) return false;
    const start = new Date(ticket.saleStartAt).getTime();
    return Number.isFinite(start) && start > Date.now();
  }, [ticket.saleStartAt]);

  const saleEnded = useMemo<boolean>(() => {
    if (!ticket.saleEndAt) return false;
    const end = new Date(ticket.saleEndAt).getTime();
    return Number.isFinite(end) && end < Date.now();
  }, [ticket.saleEndAt]);

  const isDisabled =
    saleNotOpen || saleEnded || ticket.visibility === "disabled";

  // Quantity clamps ---------------------------------------------------------
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
  const canJoinWaitlist =
    isSoldOut &&
    ticket.waitlistEnabled === true &&
    onJoinWaitlist !== undefined;

  const canDecrement = quantity > 0 && !isDisabled;
  const canIncrement = quantity < effectiveMax && !isDisabled && !isSoldOut;

  // Handlers ----------------------------------------------------------------
  const triggerHaptic = useCallback((): void => {
    if (Platform.OS === "web") return;
    Haptics.selectionAsync().catch(() => {
      // selection haptics throw on Android emulators without hardware
      // haptics — silently swallow
    });
  }, []);

  const handleDecrement = useCallback((): void => {
    if (!canDecrement) return;
    triggerHaptic();
    onQuantityChange(quantity - 1);
  }, [canDecrement, quantity, onQuantityChange, triggerHaptic]);

  const handleIncrement = useCallback((): void => {
    if (!canIncrement) return;
    triggerHaptic();
    const next = quantity === 0 ? Math.max(1, min) : quantity + 1;
    onQuantityChange(Math.min(next, effectiveMax));
  }, [
    canIncrement,
    quantity,
    min,
    effectiveMax,
    onQuantityChange,
    triggerHaptic,
  ]);

  const handleJoinWaitlist = useCallback((): void => {
    if (!canJoinWaitlist || onJoinWaitlist === undefined) return;
    triggerHaptic();
    onJoinWaitlist(ticket.id);
  }, [canJoinWaitlist, onJoinWaitlist, ticket.id, triggerHaptic]);

  // Render ------------------------------------------------------------------
  const priceText = ticket.isFree
    ? "Free"
    : formatCurrency(ticket.priceGbp ?? 0, ticket.currency ?? fallbackCurrency);

  const nameStyle: TextStyle = { ...styles.name, color: t.textPrimary };
  const qtyStyle: TextStyle = { ...styles.qty, color: t.textPrimary };
  const stepperBtnStyle: ViewStyle = {
    ...styles.stepperBtn,
    backgroundColor: t.stepperBg,
    borderColor: t.stepperBorder,
  };
  const stepperGlyphStyle: TextStyle = {
    ...styles.stepperGlyph,
    color: t.accent,
  };
  const stepperGlyphDisabledStyle: TextStyle = { color: t.textQuaternary };
  const priceTextStyle: TextStyle = {
    ...styles.priceText,
    color: t.textSecondary,
  };
  const xLeftStyle: TextStyle = {
    ...styles.xLeftText,
    color: t.semanticWarning,
  };
  const descriptionStyle: TextStyle = {
    ...styles.description,
    color: t.textTertiary,
  };
  const saleBannerStyle: ViewStyle = {
    ...styles.saleBanner,
    backgroundColor: t.saleBannerBg,
    borderColor: t.saleBannerBorder,
  };
  const saleBannerTextStyle: TextStyle = {
    ...styles.saleBannerText,
    color: t.semanticWarning,
  };
  const soldOutBadgeStyle: ViewStyle = {
    ...styles.soldOutBadge,
    backgroundColor: t.soldOutBg,
    borderColor: t.soldOutBorder,
  };
  const soldOutTextStyle: TextStyle = {
    ...styles.soldOutText,
    color: t.semanticError,
  };

  return (
    <CardComponent style={[styles.host, isDisabled && styles.hostDisabled]}>
      <View style={styles.headerRow}>
        <View style={styles.nameCol}>
          <Text style={nameStyle} numberOfLines={2}>
            {ticket.name}
          </Text>
        </View>
        {isSoldOut ? (
          canJoinWaitlist ? (
            <Pressable
              onPress={handleJoinWaitlist}
              accessibilityRole="button"
              accessibilityLabel={`Join waitlist for ${ticket.name}`}
              style={({ pressed }) => [
                soldOutBadgeStyle,
                styles.waitlistBadge,
                pressed && styles.waitlistBadgePressed,
              ]}
              hitSlop={4}
            >
              <Text style={[soldOutTextStyle, { color: t.accent }]}>
                Join waitlist
              </Text>
            </Pressable>
          ) : (
            <View style={soldOutBadgeStyle}>
              <Text style={soldOutTextStyle}>Sold out</Text>
            </View>
          )
        ) : isDisabled ? null : (
          <View style={styles.stepperRow}>
            <Pressable
              onPress={handleDecrement}
              disabled={!canDecrement}
              accessibilityRole="button"
              accessibilityLabel={`Decrease ${ticket.name} quantity`}
              accessibilityState={{ disabled: !canDecrement }}
              style={({ pressed }) => [
                stepperBtnStyle,
                !canDecrement && styles.stepperBtnDisabled,
                pressed && canDecrement && styles.stepperBtnPressed,
              ]}
              hitSlop={4}
            >
              <Text
                style={[
                  stepperGlyphStyle,
                  !canDecrement && stepperGlyphDisabledStyle,
                ]}
                accessible={false}
              >
                {/* U+2212 minus sign — the mingla-business Icon set lacked a "minus" glyph */}
                {"−"}
              </Text>
            </Pressable>
            <Text
              style={qtyStyle}
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
                stepperBtnStyle,
                !canIncrement && styles.stepperBtnDisabled,
                pressed && canIncrement && styles.stepperBtnPressed,
              ]}
              hitSlop={4}
            >
              {renderPlusIcon({
                size: PLUS_ICON_SIZE,
                color: canIncrement ? t.accent : t.textQuaternary,
              })}
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.priceRow}>
        <Text style={priceTextStyle}>{priceText}</Text>
        {showXLeft ? (
          <Text style={xLeftStyle}>
            {" · "}
            {remainingCapacity} left
          </Text>
        ) : null}
      </View>

      {ticket.description && ticket.description.trim().length > 0 ? (
        <Text style={descriptionStyle} numberOfLines={2}>
          {ticket.description}
        </Text>
      ) : null}

      {saleNotOpen && ticket.saleStartAt ? (
        <View style={saleBannerStyle}>
          <Text style={saleBannerTextStyle}>
            Sales open {formatSaleDate(ticket.saleStartAt)}
          </Text>
        </View>
      ) : null}
      {saleEnded ? (
        <View style={saleBannerStyle}>
          <Text style={saleBannerTextStyle}>Sales ended</Text>
        </View>
      ) : null}
      {ticket.visibility === "disabled" ? (
        <View style={saleBannerStyle}>
          <Text style={saleBannerTextStyle}>Sales paused</Text>
        </View>
      ) : null}
    </CardComponent>
  );
};

const styles = StyleSheet.create({
  host: {
    marginBottom: 8,
  },
  hostDisabled: {
    opacity: 0.55,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  nameCol: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
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
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
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
    marginTop: -2, // optical centre — minus sign sits low at this size
  },
  qty: {
    minWidth: 32,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 4,
  },
  priceText: {
    fontSize: 14,
    fontWeight: "500",
  },
  xLeftText: {
    fontSize: 13,
    fontWeight: "500",
  },
  description: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  saleBanner: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  saleBannerText: {
    fontSize: 12,
    fontWeight: "500",
  },
  soldOutBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  soldOutText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  waitlistBadge: {
    backgroundColor: "rgba(235, 120, 37, 0.14)",
    borderColor: "rgba(235, 120, 37, 0.36)",
  },
  waitlistBadgePressed: {
    opacity: 0.72,
  },
});

export default QuantityRow;
