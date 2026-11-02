/**
 * issue #3281 — Extras, buyer side: the inline panel under a ticket in the cart.
 *
 * Props only, shared by the Host web cart step and Explorer's ticket cart. A
 * flat list of optional extras, each with its own count (#3283 §2.3): nothing
 * is required, so the panel has no validation state. It is a <View>, never a
 * sheet, so it can't compete with the cart's own sheet on native (§3.3).
 *
 * Every price shown is the server's all-in; every limit comes from `caps`,
 * computed by `extraCap` in ticketExtrasCart.ts. The quote prices the order.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CheckoutAddOnRequest } from "./ticketCheckoutContract";
import type { PublicTicketExtra } from "./ticketExtrasCart";

export interface TicketExtrasPickerTheme {
  accent: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
}

export interface TicketExtrasPickerProps {
  ticketName: string;
  extras: readonly PublicTicketExtra[];
  /** The line's current extras. */
  selected: readonly CheckoutAddOnRequest[] | undefined;
  /** extra id → the most the line may carry; 0 hides an extra the buyer hasn't picked. */
  caps: Readonly<Record<string, number>>;
  onChange: (addOnId: string, quantity: number) => void;
  /** Formats minor units in the event currency. */
  formatMoney: (cents: number) => string;
  /** A date-limited extra's caption, e.g. "Fri 22 Aug only"; null for none. */
  dateCaption?: (extra: PublicTicketExtra) => string | null;
  /** Whether a sold-out extra stays listed (true) or is hidden when unpicked. */
  soldOut?: (extra: PublicTicketExtra) => boolean;
  theme: TicketExtrasPickerTheme;
  testID?: string;
}

export const TicketExtrasPicker: React.FC<TicketExtrasPickerProps> = ({
  ticketName,
  extras,
  selected,
  caps,
  onChange,
  formatMoney,
  dateCaption,
  soldOut,
  theme,
  testID = "issue-3281-ticket-extras",
}) => {
  const rows = extras.filter((extra) => {
    const picked = selected?.find((entry) => entry.addOnId === extra.id);
    return (caps[extra.id] ?? 0) > 0 || picked !== undefined || soldOut?.(extra) === true;
  });
  if (rows.length === 0) return null;
  return (
    <View
      style={[styles.panel, { borderLeftColor: theme.accent }]}
      testID={testID}
    >
      <Text style={[styles.heading, { color: theme.textTertiary }]}>
        Extras
      </Text>
      {rows.map((extra) => {
        const quantity =
          selected?.find((entry) => entry.addOnId === extra.id)?.quantity ?? 0;
        const cap = caps[extra.id] ?? 0;
        const canAdd = quantity < cap;
        const canRemove = quantity > 0;
        const caption = dateCaption?.(extra) ?? null;
        const isSoldOut = cap === 0 && quantity === 0;
        return (
          <View
            key={extra.id}
            style={[styles.row, { borderTopColor: theme.border }]}
            testID={`issue-3281-extra-${extra.id}`}
          >
            <View style={styles.copy}>
              <Text style={[styles.name, { color: theme.textPrimary }]}>
                {extra.name}
              </Text>
              {caption !== null ? (
                <Text style={[styles.meta, { color: theme.textSecondary }]}>
                  {caption}
                </Text>
              ) : null}
              {extra.description !== null ? (
                <Text
                  style={[styles.meta, { color: theme.textTertiary }]}
                  numberOfLines={2}
                >
                  {extra.description}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.price, { color: theme.textPrimary }]}>
              {extra.priceAllInCents === 0
                ? "Free"
                : formatMoney(extra.priceAllInCents)}
            </Text>
            {isSoldOut ? (
              <Text style={[styles.meta, { color: theme.textTertiary }]}>
                Sold out
              </Text>
            ) : (
              <View style={styles.stepper}>
                <Pressable
                  onPress={canRemove ? () => onChange(extra.id, quantity - 1) : undefined}
                  disabled={!canRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove one ${extra.name} from ${ticketName}`}
                  accessibilityState={{ disabled: !canRemove }}
                  style={[styles.step, { borderColor: theme.border }]}
                  hitSlop={4}
                >
                  <Text
                    style={[
                      styles.glyph,
                      { color: canRemove ? theme.accent : theme.textTertiary },
                    ]}
                  >
                    {"−"}
                  </Text>
                </Pressable>
                <Text
                  style={[styles.qty, { color: theme.textPrimary }]}
                  accessibilityLabel={`${quantity} ${extra.name}`}
                  accessibilityLiveRegion="polite"
                >
                  {quantity}
                </Text>
                <Pressable
                  onPress={canAdd ? () => onChange(extra.id, quantity + 1) : undefined}
                  disabled={!canAdd}
                  accessibilityRole="button"
                  accessibilityLabel={`Add one ${extra.name} to ${ticketName}`}
                  accessibilityState={{ disabled: !canAdd }}
                  style={[styles.step, { borderColor: theme.border }]}
                  hitSlop={4}
                >
                  <Text
                    style={[
                      styles.glyph,
                      { color: canAdd ? theme.accent : theme.textTertiary },
                    ]}
                  >
                    +
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    marginTop: 8,
    marginBottom: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
  },
  heading: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 13 },
  price: { fontSize: 15, fontVariant: ["tabular-nums"] },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  step: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: { fontSize: 18, fontWeight: "600" },
  qty: {
    minWidth: 20,
    textAlign: "center",
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
});
