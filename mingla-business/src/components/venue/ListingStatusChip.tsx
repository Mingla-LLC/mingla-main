/**
 * ListingStatusChip (META-ORCH-1255, DESIGN §3) — the shared venue listing
 * status pill. Component EXTRACTION of the proven badge in
 * `VenueListingContent.tsx` (badge/dot/badgeText styles + TONE_COLOR/TONE_TINT
 * maps) — ZERO restyle. Fed by `listingStatusView()` (single source of truth
 * for label + tone; ORCH-1040).
 *
 * Status is text + color, never color alone (WCAG 1.4.1). The chip itself is
 * not focusable; its label joins the host card/header accessibility label.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { ListingStatusView, ListingTone } from "../../utils/listingStatus";

const TONE_COLOR: Record<ListingTone, string> = {
  neutral: textTokens.secondary,
  info: semantic.info,
  warning: semantic.warning,
  success: semantic.success,
};
const TONE_TINT: Record<ListingTone, string> = {
  neutral: "rgba(255,255,255,0.10)",
  info: semantic.infoTint,
  warning: semantic.warningTint,
  success: semantic.successTint,
};

export interface ListingStatusChipProps {
  status: Pick<ListingStatusView, "label" | "tone">;
  testID?: string;
}

export function ListingStatusChip({
  status,
  testID,
}: ListingStatusChipProps): React.ReactElement {
  return (
    <View
      style={[styles.badge, { backgroundColor: TONE_TINT[status.tone] }]}
      testID={testID}
    >
      <View style={[styles.dot, { backgroundColor: TONE_COLOR[status.tone] }]} />
      <Text
        style={[styles.badgeText, { color: TONE_COLOR[status.tone] }]}
        numberOfLines={1}
      >
        {status.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: typography.bodySm.fontSize, fontWeight: "700" },
});

export default ListingStatusChip;
