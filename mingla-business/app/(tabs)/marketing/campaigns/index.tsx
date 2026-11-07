/**
 * Marketing → Campaigns (ORCH-0815-B Phase 2 — replaces the placeholder).
 *
 * Lists every campaign the account has authored, descending by created_at,
 * with a filter pill row (All · Scheduled · Sent · Drafts · Failed) + an
 * FAB to open the composer.
 *
 * #4273 — every method of a blast is one card (grouped by
 * COALESCE(campaign_group_id, id)); the status filter applies after grouping,
 * so a blast shows when any of its methods matches. Tapping a card opens the
 * campaign screen (`/marketing/campaigns/[id].tsx`) on its first method.
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
  deleteCampaign,
} from "../../../../src/services/marketing/marketingCampaignService";
import {
  filterCampaignGroups,
  groupCampaignRows,
} from "../../../../src/features/marketing/campaignListGroups";
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

  // #4273 — every status is fetched; the filter applies after grouping, so a
  // blast with a sent email and a failed SMS shows under Sent and Failed.
  const campaignsQuery = useCampaigns({ brand_id: brandId });

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
      const message = (err as { message?: unknown } | null)?.message;
      // #4273 extra (a): a send that is due or has started is read-only.
      Alert.alert(
        "Couldn't cancel",
        typeof message === "string" && message.includes("campaign_locked")
          ? "This send has already started, so it can't be cancelled now."
          : err instanceof Error ? err.message : "Try again in a moment.",
      );
    }
  }, [campaignsQuery]);

  const handleDelete = useCallback(async (ids: string[]) => {
    try {
      // #4273 extra (b) — a failed or cancelled method, not a draft.
      for (const id of ids) await deleteCampaign(id);
      await campaignsQuery.refetch();
    } catch (err) {
      Alert.alert(
        "Couldn't delete",
        err instanceof Error ? err.message : "Try again in a moment.",
      );
    }
  }, [campaignsQuery]);

  const groups = useMemo(
    () => filterCampaignGroups(groupCampaignRows(campaignsQuery.data ?? []), statusFilter),
    [campaignsQuery.data, statusFilter],
  );

  return (
    <View style={styles.host}>
      {filter !== "all" && groups.length === 0 ? (
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
      ) : groups.length === 0 ? (
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
            {groups.map((group) => (
              <View key={group.groupId} style={isWideDesktop ? styles.campaignCellWide : styles.campaignCell}>
                <CampaignCard
                  group={group}
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
