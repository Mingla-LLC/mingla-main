// ===========================================================================
// Issue #1793 — the bottom bar that carries the guest from browsing to paying.
//
// SET-B: may sell, may never touch money. It shows a COUNT, and — only once the
// server has priced the basket — the server's total, verbatim. Before that it
// says "See your order" and no number at all. A bar that guessed a running
// total would be doing money math where it is most visible and least checkable.
// ===========================================================================

// The package-local React bridge (see PublicVenueTabs.tsx): files under
// packages/ cannot discover the app's React peer, so importing "react"
// directly here would emit unresolved-peer diagnostics in both apps'
// isolated typecheck sandboxes. One bridge, reused by every shared renderer.
import { BrandRenderingReact as React } from "../PublicVenueTabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";

import { formatMenuPrice } from "../PublicMenuSections";

export const VenueOrderingStickyBar: React.FC<{
  count: number;
  /** The SERVER's total for exactly this basket, or null while it is unpriced. */
  totalCents: number | null;
  currency: string | null;
  palette: ThemePalette;
  onPress: () => void;
}> = ({ count, totalCents, currency, palette, onPress }) => {
  const total = totalCents === null || currency === null
    ? null
    : formatMenuPrice(totalCents, currency);
  const label = total === null
    ? `See your order · ${count}`
    : `See your order · ${count} · ${total}`;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.bar, { backgroundColor: palette.accent }]}
      >
        <Text style={[styles.label, { color: palette.accentText }]}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  bar: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  label: { fontSize: 16, fontWeight: "900" },
});
