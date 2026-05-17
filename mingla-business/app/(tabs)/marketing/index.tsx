/**
 * Marketing → Overview (ORCH-0863 Phase B).
 *
 * Renders headline card + 4 funnel metric cards + up to 3 recent
 * campaigns + FAB. Replaces the Phase A placeholder.
 *
 * Constitution #9 enforced via strict-grep gate
 * `orch-0863-marketing-hub-phase-b.mjs` (no currency-symbol literal, no
 * R-word headline, no Opened funnel-card label) — pending UTM-to-campaign
 * attribution (Phase F) + Resend webhook ingest (separate ORCH).
 */

import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "../../../src/components/ui/EmptyState";
import { Icon } from "../../../src/components/ui/Icon";
import { OverviewMetricCard } from "../../../src/components/marketing/OverviewMetricCard";
import { OverviewRecentCampaignRow } from "../../../src/components/marketing/OverviewRecentCampaignRow";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import { useMarketingOverview } from "../../../src/hooks/marketing/useMarketingOverview";

export default function MarketingOverviewRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const overviewQuery = useMarketingOverview(accountId);

  const handleNewCampaign = useCallback(() => {
    router.push("/marketing/campaigns/compose" as never);
  }, [router]);

  const handleOpenCampaign = useCallback(
    (id: string) => {
      router.push(`/marketing/campaigns/${id}` as never);
    },
    [router],
  );

  // Loading first paint (no cache): show skeleton-like layout (metric cards
  // with dim placeholders) instead of a full-screen spinner — preserves
  // the layout so the eye doesn't jump.
  if (overviewQuery.isLoading && overviewQuery.data === undefined) {
    return (
      <View style={styles.host}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headlineCardSkeleton}>
            <ActivityIndicator size="small" color={textTokens.secondary} />
          </View>
          <View style={styles.metricGrid}>
            {[0, 1, 2, 3].map((idx) => (
              <View key={idx} style={styles.metricSkeleton} />
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (overviewQuery.isError || overviewQuery.data === undefined) {
    return (
      <View style={styles.host}>
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load metrics"
            description="Pull to retry, or come back in a moment."
          />
        </View>
      </View>
    );
  }

  const snap = overviewQuery.data;
  const sent = snap.funnel.sent;
  const deliveredPct = sent > 0 ? (snap.funnel.delivered / sent) * 100 : undefined;
  const clickedPct = sent > 0 ? (snap.funnel.clicked / sent) * 100 : undefined;
  const failedPct = sent > 0 ? (snap.funnel.failed / sent) * 100 : undefined;

  const isEmpty = snap.campaigns_sent_count === 0 && snap.recent_campaigns.length === 0;
  const caption = isEmpty
    ? "Your first blast is one tap away. Tap + below."
    : "in the last 30 days";

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headlineCard}>
          <View style={styles.headlineLabelRow}>
            <Icon name="send" size={20} color={textTokens.secondary} />
            <Text style={styles.headlineLabel}>CAMPAIGNS SENT</Text>
          </View>
          <Text style={styles.headlineValue}>
            {snap.campaigns_sent_count.toLocaleString()}
          </Text>
          <Text style={styles.headlineCaption}>{caption}</Text>
        </View>

        <View style={styles.metricGrid}>
          <OverviewMetricCard label="SENT" value={snap.funnel.sent} />
          <OverviewMetricCard
            label="DELIVERED"
            value={snap.funnel.delivered}
            percent={deliveredPct}
          />
          <OverviewMetricCard
            label="CLICKED"
            value={snap.funnel.clicked}
            percent={clickedPct}
          />
          <OverviewMetricCard
            label="FAILED"
            value={snap.funnel.failed}
            percent={failedPct}
            tone="warning"
          />
        </View>

        {snap.recent_campaigns.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>RECENT CAMPAIGNS</Text>
            <View style={styles.recentList}>
              {snap.recent_campaigns.map((c, idx) => (
                <OverviewRecentCampaignRow
                  key={c.id}
                  campaign={c}
                  onPress={handleOpenCampaign}
                  isLast={idx === snap.recent_campaigns.length - 1}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <Pressable
        onPress={handleNewCampaign}
        accessibilityRole="button"
        accessibilityLabel="New campaign"
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 96 },
          pressed ? styles.fabPressed : null,
        ]}
      >
        <Icon name="plus" size={24} color={textTokens.primary} />
        <Text style={styles.fabLabel}>New campaign</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 120,
    gap: spacing.lg,
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  headlineCard: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
    gap: spacing.xs,
  },
  headlineCardSkeleton: {
    height: 120,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  headlineLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headlineLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  headlineValue: {
    ...typography.statValue,
    color: textTokens.primary,
  },
  headlineCaption: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricSkeleton: {
    flexBasis: "47%",
    flexGrow: 1,
    height: 70,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  sectionLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  recentList: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  fab: {
    position: "absolute",
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    borderRadius: radius.full,
    backgroundColor: "rgba(235, 120, 37, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
});
