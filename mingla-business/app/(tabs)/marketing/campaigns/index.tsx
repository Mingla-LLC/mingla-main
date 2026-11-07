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
import { cancelScheduled } from "../../../../src/services/marketing/marketingCampaignService";
import { deleteCampaign } from "../../../../src/services/marketing/campaignDeleteService";
import { ConfirmDialog } from "../../../../src/components/ui/ConfirmDialog";
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

  const groups = useMemo(
    () => filterCampaignGroups(groupCampaignRows(campaignsQuery.data ?? []), statusFilter),
    [campaignsQuery.data, statusFilter],
  );

  // #4273 — Delete asks first: it names the campaign and says it can't be undone.
  const [pendingDelete, setPendingDelete] = useState<{ ids: string[]; name: string; cancelled: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback((ids: string[]) => {
    const group = groups.find((row) => row.members.some((member) => ids.includes(member.id)));
    setDeleteError(null);
    const cancelled = group !== undefined &&
      group.members.filter((member) => ids.includes(member.id)).every((member) => member.status === "cancelled");
    setPendingDelete({ ids, name: group?.primary.name ?? "This campaign", cancelled });
  }, [groups]);

  const closeDelete = useCallback(() => {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // #4273 extra (b) — a failed or cancelled method, not a draft.
      for (const id of pendingDelete.ids) await deleteCampaign(id);
      setPendingDelete(null);
      await campaignsQuery.refetch();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete. Try again in a moment.");
    } finally {
      setDeleting(false);
    }
  }, [campaignsQuery, pendingDelete]);

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
      <ConfirmDialog
        visible={pendingDelete !== null}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Delete this campaign?"
        description={
          pendingDelete !== null
            ? `"${pendingDelete.name}" ${pendingDelete.cancelled ? "was cancelled before it went out" : "didn't finish sending"}. Deleting removes it from Campaigns. This can't be undone.`
            : ""
        }
        variant="simple"
        confirmLabel="Delete"
        cancelLabel="Keep it"
        confirmLoading={deleting}
        confirmDisabled={deleting}
        closeDisabled={deleting}
        errorMessage={deleteError}
        testID="delete-campaign-confirm"
        confirmTestID="delete-campaign-confirm-button"
        cancelTestID="delete-campaign-cancel-button"
        destructive
      />
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
