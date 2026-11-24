/**
 * issue #3281 S6 — the add-ons a guest can pick with their RSVP, inside the
 * RSVP form (the decision box and the details sheet), above Going / Maybe.
 *
 * Props only, shared by Host web / buyer web (loaded on use) and Explorer. The
 * caller owns the picks (it sends them as `rsvpAddOns` with a Going reply) and
 * passes the party size the RSVP body gives its `addOnsNode` slot. Only free
 * add-ons are offered (paid RSVP add-ons wait on a product decision), so every
 * row reads "Free". Each row has a − / + stepper with labels; a sold-out
 * add-on reads "Sold out" instead of a dead "+".
 *
 * A pick whose add-on is no longer offered is dropped (as the ticket cart
 * does). When the party shrinks below what was picked, nothing is dropped:
 * the line below asks the guest to pick fewer, and `onReadyChange(false)` keeps
 * Going / Maybe from sending until they do.
 *
 * It shares no module with the ticket cart's picker on purpose (see
 * rsvpAddOnPicks.ts): on Host web its chunk stays out of the boot payload.
 * Imported by its deep path, never through the package barrel.
 */

import React, { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  freeRsvpAddOns,
  rsvpAddOnCap,
  rsvpAddOnPicksFit,
  withRsvpAddOnQuantity,
  type RsvpAddOnPick,
} from "./rsvpAddOnPicks";
import type { ThemePalette } from "./themePalette";

export interface RsvpAddOnsPickerProps {
  /** The RSVP reader's raw `rsvpAddOns`. */
  addOns: unknown;
  /** The guest plus their plus-ones. */
  partySize: number;
  picks: readonly RsvpAddOnPick[];
  onPicksChange: (next: RsvpAddOnPick[]) => void;
  /** False while a pick is above what the party may take. */
  onReadyChange?: (ready: boolean) => void;
  palette: ThemePalette;
  disabled?: boolean;
}

export const RSVP_ADD_ONS_OVER_LIMIT_COPY =
  "You've picked more of an add-on than your party allows. Pick fewer to continue.";

export const RsvpAddOnsPicker: React.FC<RsvpAddOnsPickerProps> = ({
  addOns,
  partySize,
  picks,
  onPicksChange,
  onReadyChange,
  palette,
  disabled = false,
}) => {
  const items = useMemo(() => freeRsvpAddOns(addOns), [addOns]);
  // A pick whose add-on is no longer offered (stopped selling, or now paid)
  // can't be shown or sent, so it is dropped, as the ticket cart does.
  const offered = picks.filter((pick) => items.some((item) => item.id === pick.addOnId));
  const dropped = offered.length !== picks.length;
  useEffect(() => {
    if (dropped) onPicksChange(offered);
  }, [dropped, offered, onPicksChange]);
  const fits = !dropped && rsvpAddOnPicksFit(picks, items, partySize);
  useEffect(() => {
    onReadyChange?.(fits);
  }, [fits, onReadyChange]);
  if (items.length === 0) return null;
  return (
    <View style={[styles.panel, { borderLeftColor: palette.accent }]} testID="issue-3281-rsvp-add-ons">
      <Text style={[styles.heading, { color: palette.tertiaryText }]}>Add-ons</Text>
      {items.map((item) => {
        const quantity = picks.find((pick) => pick.addOnId === item.id)?.quantity ?? 0;
        const cap = rsvpAddOnCap(item, partySize);
        const canAdd = !disabled && quantity < cap;
        const canRemove = !disabled && quantity > 0;
        const step = (next: number): void => onPicksChange(withRsvpAddOnQuantity(picks, item.id, next));
        return (
          <View
            key={item.id}
            style={[styles.row, { borderTopColor: palette.panelBorder }]}
            testID={`issue-3281-rsvp-add-on-${item.id}`}
          >
            <View style={styles.copy}>
              <Text style={[styles.name, { color: palette.primaryText }]}>{item.name}</Text>
              {item.description !== null ? (
                <Text style={[styles.meta, { color: palette.tertiaryText }]} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.price, { color: palette.primaryText }]}>Free</Text>
            {cap === 0 && quantity === 0 ? (
              <Text style={[styles.meta, { color: palette.tertiaryText }]}>Sold out</Text>
            ) : (
              <View style={styles.stepper}>
                <Pressable
                  onPress={canRemove ? () => step(quantity - 1) : undefined}
                  disabled={!canRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove one ${item.name} from your RSVP`}
                  accessibilityState={{ disabled: !canRemove }}
                  style={[styles.step, { borderColor: palette.panelBorder }]}
                  hitSlop={6}
                >
                  <Text style={[styles.glyph, { color: canRemove ? palette.accent : palette.tertiaryText }]}>
                    {"−"}
                  </Text>
                </Pressable>
                <Text
                  style={[styles.qty, { color: palette.primaryText }]}
                  accessibilityLabel={`${quantity} ${item.name}`}
                  accessibilityLiveRegion="polite"
                >
                  {quantity}
                </Text>
                <Pressable
                  onPress={canAdd ? () => step(quantity + 1) : undefined}
                  disabled={!canAdd}
                  accessibilityRole="button"
                  accessibilityLabel={`Add one ${item.name} to your RSVP`}
                  accessibilityState={{ disabled: !canAdd }}
                  style={[styles.step, { borderColor: palette.panelBorder }]}
                  hitSlop={6}
                >
                  <Text style={[styles.glyph, { color: canAdd ? palette.accent : palette.tertiaryText }]}>+</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      {fits ? null : (
        <Text
          style={[styles.overLimit, { color: palette.primaryText }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          testID="issue-3281-rsvp-add-ons-over-limit"
        >
          {RSVP_ADD_ONS_OVER_LIMIT_COPY}
        </Text>
      )}
    </View>
  );
};

export default RsvpAddOnsPicker;

const styles = StyleSheet.create({
  panel: { marginTop: 16, paddingLeft: 12, borderLeftWidth: 2 },
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
  price: { fontSize: 15 },
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
  qty: { minWidth: 20, textAlign: "center", fontSize: 15, fontWeight: "600" },
  overLimit: { fontSize: 13, lineHeight: 18, marginTop: 4 },
});
