/**
 * Marketing → Campaigns (ORCH-0815-B Phase 2 — replaces the placeholder).
 *
 * Lists every campaign the account has authored, descending by created_at,
 * with a filter pill row (All · Scheduled · Sent · Drafts · Failed) + an
 * FAB to open the composer.
 *
 * Per-campaign "View report" is deferred to Sub-ORCH-0815-C (campaign
 * report screen at `/marketing/campaigns/[id].tsx` — Hard Guard §13).
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { CampaignCard } from "../../../../src/components/marketing/CampaignCard";
import {
  CampaignFilterPills,
  type CampaignFilter,
} from "../../../../src/components/marketing/CampaignFilterPills";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Icon } from "../../../../src/components/ui/Icon";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useAuth } from "../../../../src/context/AuthContext";
import { useCampaigns } from "../../../../src/hooks/marketing/useCampaigns";
import { useStickyFooterOffset } from "../../../../src/hooks/useStickyFooterOffset";
import {
  cancelScheduled,
  deleteDraft,
} from "../../../../src/services/marketing/marketingCampaignService";
import type { CampaignStatus } from "../../../../src/types/marketing";

export default function MarketingCampaignsRoute(): React.ReactElement {
  const router = useRouter();
  const fabOffset = useStickyFooterOffset();
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const [filter, setFilter] = useState<CampaignFilter>("all");

  const statusFilter = useMemo<CampaignStatus | undefined>(() => {
    if (filter === "all") return undefined;
    return filter;
  }, [filter]);

  const campaignsQuery = useCampaigns({
    account_id: accountId,
    status: statusFilter,
  });

  const handleResume = useCallback((id: string) => {
    router.push(`/marketing/campaigns/compose?draft=${id}` as never);
  }, [router]);

  const handleOpenReport = useCallback((id: string) => {
    router.push(`/marketing/campaigns/${id}` as never);
  }, [router]);

  const handleCancel = useCallback(async (id: string) => {
    try {
      await cancelScheduled(id);
      await campaignsQuery.refetch();
    } catch (err) {
      Alert.alert(
        "Couldn't cancel",
        err instanceof Error ? err.message : "Try again in a moment.",
      );
    }
  }, [campaignsQuery]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteDraft(id);
      await campaignsQuery.refetch();
    } catch (err) {
      Alert.alert(
        "Couldn't delete",
        err instanceof Error ? err.message : "Try again in a moment.",
      );
    }
  }, [campaignsQuery]);

  const handleNewCampaign = useCallback(() => {
    router.push("/marketing/campaigns/compose" as never);
  }, [router]);

  const campaigns = campaignsQuery.data ?? [];

  return (
    <View style={styles.host}>
      <CampaignFilterPills active={filter} onChange={setFilter} />
      {/* ORCH-0889: disabled-query (auth-bootstrap) and first-fetch both
          render the spinner. The old guard `isLoading && campaigns.length
          === 0` mis-fired during the web auth-bootstrap window and fell
          through to "Your first campaign starts here" — falsely
          communicating a terminal state. Per I-DISABLED-QUERY-IS-LOADING. */}
      {!campaignsQuery.hasResolved && !campaignsQuery.isError ? (
        <View style={styles.centerHost} testID="campaigns-spinner">
          <ActivityIndicator size="small" color={textTokens.secondary} />
        </View>
      ) : campaignsQuery.isError ? (
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load campaigns"
            description="Pull to retry, or come back in a moment."
          />
        </View>
      ) : campaigns.length === 0 ? (
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Your first campaign starts here"
            description="Tap + below to write an email to your buyers."
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onResume={handleResume}
              onCancel={handleCancel}
              onDelete={handleDelete}
              onOpenReport={handleOpenReport}
            />
          ))}
        </ScrollView>
      )}
      <Pressable
        onPress={handleNewCampaign}
        accessibilityRole="button"
        accessibilityLabel="New campaign"
        style={({ pressed }) => [
          styles.fab,
          { bottom: fabOffset },
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
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 120,
    gap: spacing.sm,
  },
  fab: {
    position: "absolute",
    right: spacing.md,
    // `bottom` is set dynamically on the Pressable so it's safe-area aware.
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
