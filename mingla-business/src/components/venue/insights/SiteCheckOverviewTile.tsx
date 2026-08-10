/**
 * Issue #1735 G-14 — the Overview cross-link grade tile (approved decision
 * row 15: Overview carries a CROSS-LINK, not the instrument home).
 *
 * Renders ONLY when a persisted site report exists (`useIntelSubjectLatest`,
 * the SAME subjectRead key as the module — RQ-deduped, zero extra fetch when
 * the module was visited). `status:"none"`, loading, or error ⇒ renders
 * NOTHING — the module + to-do band own acquisition; an empty nudge tile here
 * would double-nag. Additive to VenueIntelligenceModule; no existing tile
 * modified.
 */

import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { useIntelSubjectLatest } from "../../../hooks/useGrowthTools";
import { GlassCard } from "../../ui/GlassCard";
import { GradeBadge } from "./SiteCheckInstrument";
import {
  formatCheckedDate,
  strongestSubScoreReason,
} from "./insightsInstruments";

export interface SiteCheckOverviewTileProps {
  brandId: string | null;
  venueId: string | null;
}

export function SiteCheckOverviewTile({
  brandId,
  venueId,
}: SiteCheckOverviewTileProps): React.ReactElement | null {
  const router = useRouter();
  const latestQuery = useIntelSubjectLatest(
    brandId,
    "venues",
    venueId !== null ? `venue:${venueId}` : null,
  );
  const data = latestQuery.data;
  if (
    venueId === null ||
    data === undefined ||
    data.status !== "report_ready"
  ) {
    // Loading / none / error ⇒ NOTHING (G-14 — deliberately not an error
    // surface; the Insights module owns the honest error state).
    return null;
  }
  const report = data.latest.report;
  const grade = typeof report.scores?.grade === "string"
    ? report.scores.grade
    : null;
  const strength = strongestSubScoreReason(report.scores);
  const checkedDate = formatCheckedDate(data.latest.createdAt);

  return (
    <GlassCard variant="base" padding={spacing.lg} testID="overview-site-check-tile">
      <Pressable
        onPress={() => router.push(`/venue/${venueId}?module=insights` as never)}
        accessibilityRole="button"
        accessibilityLabel={`Site check: grade ${grade ?? "unknown"}.${
          checkedDate !== null ? ` Checked ${checkedDate}.` : ""
        } Opens Insights.`}
        style={styles.press}
        testID="overview-site-check-tile-press"
      >
        <Text style={styles.tileTitle}>Site check</Text>
        <View style={styles.row}>
          <GradeBadge grade={grade} />
          <View style={styles.textWrap}>
            {strength !== null ? (
              <Text style={styles.verdictLine} numberOfLines={2}>
                {strength}
              </Text>
            ) : null}
            {checkedDate !== null ? (
              <Text style={styles.checked}>{`Checked ${checkedDate}`}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  press: {
    gap: spacing.sm,
  },
  tileTitle: {
    ...typography.h3,
    color: textTokens.primary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  verdictLine: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  checked: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
});

export default SiteCheckOverviewTile;
