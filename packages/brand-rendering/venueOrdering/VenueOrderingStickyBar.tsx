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
import { StyleSheet, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";

import { formatMenuPrice } from "../PublicMenuSections";
// issue #4420 — the order bar is the shared glass bar: "2 items" (and the
// SERVER total once priced, never a guess) on the left, "View order" on the
// right. Same count, same total rule, same onPress.
import { OfferingGlassBar } from "@mingla/offering-rendering/OfferingGlassBar";

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
  const items = `${count} item${count === 1 ? "" : "s"}`;
  return (
    <View style={styles.wrap}>
      <OfferingGlassBar
        palette={palette}
        title={total === null ? items : `${items} · ${total}`}
        subtitle={null}
        ctaLabel="View order"
        onPress={onPress}
        ctaAccessibilityLabel={label}
        testID="issue-4420-venue-order-bar"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8 },
});
