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
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { CampaignCard } from "../../../../src/components/marketing/CampaignCard";
import {
  CampaignFilterPills,
  type CampaignFilter,
} from "../../../../src/components/marketing/CampaignFilterPills";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import {
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useCampaigns } from "../../../../src/hooks/marketing/useCampaigns";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";
import {
  cancelScheduled,
  deleteDraft,
} from "../../../../src/services/marketing/marketingCampaignService";
import type { CampaignStatus } from "../../../../src/types/marketing";

export default function MarketingCampaignsRoute(): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  // #2514 — the list is scoped to the brand you are standing in, not to your
  // account. Keyed by account it mixed brands together and hid teammates.
  const currentBrand = useCurrentBrand();
  const brandId = currentBrand?.id ?? null;
  const [filter, setFilter] = useState<CampaignFilter>("all");

  const statusFilter = useMemo<CampaignStatus | undefined>(() => {
    if (filter === "all") return undefined;
    return filter;
  }, [filter]);

  const campaignsQuery = useCampaigns({
    brand_id: brandId,
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

  const campaigns = campaignsQuery.data ?? [];

  return (
    <View style={styles.host}>
      {filter !== "all" && campaigns.length === 0 ? (
        <CampaignFilterPills active={filter} onChange={setFilter} />
      ) : null}
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
          <CampaignFilterPills active={filter} onChange={setFilter} />
          <View style={[styles.campaignGrid, isWideDesktop && styles.campaignGridWide]}>
            {campaigns.map((campaign) => (
              <View key={campaign.id} style={isWideDesktop ? styles.campaignCellWide : styles.campaignCell}>
                <CampaignCard
                  campaign={campaign}
                  onResume={handleResume}
                  onCancel={handleCancel}
                  onDelete={handleDelete}
                  onOpenReport={handleOpenReport}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
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
  campaignGrid: { gap: spacing.sm },
  campaignGridWide: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  campaignCell: { width: "100%" },
  campaignCellWide: { flexBasis: "48%", flexGrow: 1, minWidth: 360 },
});
