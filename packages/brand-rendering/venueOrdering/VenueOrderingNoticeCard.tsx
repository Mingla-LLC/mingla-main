// ===========================================================================
// Issue #1793 — the honest state, and the spot chip.
//
// SET-B: may sell, may never touch money. This file renders no money at all.
//
// THE AMENDMENT this exists for (registered against #1793 on #1789): a guest at
// a venue whose ordering is switched off — or paused by the venue itself — must
// see a card that says so in plain words. Not a spinner that never resolves, not
// an error, not an empty pane with a dead button on it. The failure this
// prevents is a guest standing at a table with a scanned code, looking at a
// screen that appears to be broken, and concluding that Mingla is broken.
// ===========================================================================

// The package-local React bridge (see PublicVenueTabs.tsx): files under
// packages/ cannot discover the app's React peer, so importing "react"
// directly here would emit unresolved-peer diagnostics in both apps'
// isolated typecheck sandboxes. One bridge, reused by every shared renderer.
import { BrandRenderingReact as React } from "../PublicVenueTabs";
import { StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ThemePalette,
} from "@mingla/offering-rendering";

import type { VenueOrderingNotice } from "./venueOrderingRules";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export const VenueOrderingNoticeCard: React.FC<{
  notice: VenueOrderingNotice;
  palette: ThemePalette;
  surface: Surface;
}> = ({ notice, palette, surface }) => (
  <View
    accessibilityRole="summary"
    accessibilityLabel={
      notice.body === null ? notice.title : `${notice.title} ${notice.body}`
    }
    style={[
      styles.card,
      surface.card,
      notice.tone === "info"
        ? { borderLeftWidth: 3, borderLeftColor: palette.accent }
        : null,
    ]}
  >
    <Text style={[styles.title, { color: palette.primaryText }]}>
      {notice.title}
    </Text>
    {notice.body === null ? null : (
      <Text style={[styles.body, { color: palette.secondaryText }]}>
        {notice.body}
      </Text>
    )}
  </View>
);

/**
 * The one-line chip that states, before anything is paid for, WHERE this order
 * is going — the table it was scanned at, or the counter it will be collected
 * from. Never a guess: it reads the resolved spot, and says "counter" whenever
 * there isn't one (D-3a).
 */
export const VenueOrderingSpotChip: React.FC<{
  label: string;
  palette: ThemePalette;
}> = ({ label, palette }) => (
  <View
    style={[styles.chip, { backgroundColor: palette.accent }]}
    accessibilityRole="text"
    accessibilityLabel={label}
  >
    <Text style={[styles.chipLabel, { color: palette.accentText }]}>
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  title: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  chip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipLabel: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
  },
});
