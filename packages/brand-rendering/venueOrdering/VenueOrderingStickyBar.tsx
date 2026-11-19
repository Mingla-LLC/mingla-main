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
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";

import { formatMenuPrice } from "../PublicMenuSections";
// issue #4420 — the order bar is the shared glass bar: "2 items" (and the
// SERVER total once priced, never a guess) on the left, "View order" on the
// right. Same count, same total rule, same onPress.
import { OfferingGlassBar } from "@mingla/offering-rendering/OfferingGlassBar";

/**
 * issue #4420 D-V2 — where the bar sits. "screen": web docks it to the bottom
 * of the viewport (the reading column's foot on phone, the flyer column on
 * desktop), the way every offering page's glass bar sits. "inline": in the
 * pane's flow (native, where the pane is inside a scroll view and cannot pin).
 */
export type VenueOrderingBarPlacement = "screen" | "inline";

export interface VenueOrderingStickyBarProps {
  count: number;
  /** The SERVER's total for exactly this basket, or null while it is unpriced. */
  totalCents: number | null;
  currency: string | null;
  palette: ThemePalette;
  onPress: () => void;
  /** "Table 12": the scanned spot, when there is one. */
  spotLabel?: string | null;
  placement?: VenueOrderingBarPlacement;
  /** Desktop web (≥1024): the dock moves into the flyer column. */
  isDesktop?: boolean;
  /** The safe-area bottom inset, so the docked bar clears the home bar. */
  bottomInset?: number;
}

/** #4490 fix 2 (N91): one wording for ordering with no table (chip and bar). */
export const VENUE_ORDER_COUNTER_TITLE = "Order here, collect at the counter";

/** The bar's two lines, as data (pure; the render test reads the same). */
export function venueOrderingBarCopy(input: {
  count: number;
  totalCents: number | null;
  currency: string | null;
  spotLabel?: string | null;
}): { title: string; subtitle: string; ctaLabel: string | null; spoken: string | null } {
  const spot =
    input.spotLabel !== null && input.spotLabel !== undefined && input.spotLabel.trim().length > 0
      ? input.spotLabel.trim()
      : null;
  if (input.count === 0) {
    return {
      title: spot === null ? VENUE_ORDER_COUNTER_TITLE : "Order from your table",
      subtitle: "Add something to start",
      ctaLabel: null,
      spoken: null,
    };
  }
  const total =
    input.totalCents === null || input.currency === null
      ? null
      : formatMenuPrice(input.totalCents, input.currency);
  const items = `${input.count} item${input.count === 1 ? "" : "s"}`;
  return {
    title: total === null ? items : `${items} · ${total}`,
    // issue #4420 wave 2 (D-V2) — the bar says where and how the order is paid.
    subtitle: spot === null ? "Pay on your phone" : `${spot} · pay on your phone`,
    ctaLabel: "View order",
    spoken:
      total === null
        ? `See your order · ${input.count}`
        : `See your order · ${input.count} · ${total}`,
  };
}

export const VenueOrderingStickyBar: React.FC<VenueOrderingStickyBarProps> = ({
  count,
  totalCents,
  currency,
  palette,
  onPress,
  spotLabel = null,
  placement = "inline",
  isDesktop = false,
  bottomInset = 0,
}) => {
  const copy = venueOrderingBarCopy({ count, totalCents, currency, spotLabel });
  const docked = placement === "screen" && Platform.OS === "web";
  // #4490 fix 2 (N93): on desktop the bar stays in the menu's own column,
  // held at the bottom of the screen while the menu scrolls (sticky). A
  // `position: fixed` dock sat inside the page's transformed scroller, so it
  // scrolled with the page and ended up across the cover photo (the H1 bug).
  const wrapStyle: StyleProp<ViewStyle> = docked
    ? isDesktop
      ? desktopStickyStyle(22 + bottomInset)
      : phoneDockStyle(12 + bottomInset)
    : styles.wrap;
  return (
    <View style={wrapStyle} pointerEvents="box-none" testID="issue-4420-venue-order-bar-dock">
      <OfferingGlassBar
        palette={palette}
        title={copy.title}
        subtitle={copy.subtitle}
        ctaLabel={copy.ctaLabel}
        onPress={copy.ctaLabel === null ? undefined : onPress}
        ctaAccessibilityLabel={copy.spoken ?? undefined}
        testID="issue-4420-venue-order-bar"
      />
    </View>
  );
};

// react-native-web passes `position: fixed` through; RN's ViewStyle has no name
// for it, so the web-only shape is typed here and widened once (the same
// pattern as offeringFrameMetrics' `premiumDesktopBarDockStyle`).
// The union keeps RN's own positions so the widening cast below is a legal
// comparison (react-native-web passes `fixed`; RN's type has no name for it).
interface PhoneBarDockStyle {
  position: ViewStyle["position"] | "fixed";
  left: number;
  right: number;
  bottom: number;
  zIndex: number;
}
interface DesktopStickyStyle {
  position: ViewStyle["position"] | "sticky";
  bottom: number;
  zIndex: number;
  marginTop: number;
}
const desktopStickyStyle = (bottom: number): StyleProp<ViewStyle> => {
  const dock: DesktopStickyStyle = { position: "sticky", bottom, zIndex: 6, marginTop: 16 };
  return dock as StyleProp<ViewStyle>;
};
const phoneDockStyle = (bottom: number): StyleProp<ViewStyle> => {
  const dock: PhoneBarDockStyle = { position: "fixed", left: 12, right: 12, bottom, zIndex: 6 };
  return dock as StyleProp<ViewStyle>;
};

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8 },
});
