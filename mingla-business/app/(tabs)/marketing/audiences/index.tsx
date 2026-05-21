/**
 * Marketing → Audiences (ORCH-0863 Phase B).
 *
 * Lists every brand-rollup + per-event audience the operator is entitled
 * to see (one card per brand with paid orders + one card per event with
 * paid orders), merging real `marketing_audiences` rows with virtual
 * entries discoverable on first paint. Tap navigates to the composer with
 * audience pre-fill; virtual entries are lazy-materialized first.
 *
 * SPEC §6.2 + DESIGN §4. No FAB — saved-query audiences are out of scope
 * for Phase B (NG-13).
 */

import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Toast } from "../../../../src/components/ui/Toast";
import { AudienceCard } from "../../../../src/components/marketing/AudienceCard";
import {
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useAuth } from "../../../../src/context/AuthContext";
import { useAudienceList } from "../../../../src/hooks/marketing/useAudienceList";
import {
  ensureBrandBuyersAudience,
  ensureEventBuyersAudience,
} from "../../../../src/services/marketing/marketingCampaignService";
import type { AudienceListEntry } from "../../../../src/types/marketing";

export default function MarketingAudiencesRoute(): React.ReactElement {
  const router = useRouter();
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const listState = useAudienceList(accountId);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const handleTap = useCallback(
    async (entry: AudienceListEntry) => {
      // Real row: navigate immediately with the composer's audience-param shape.
      if (entry.audience_id !== null) {
        const kind = entry.kind === "brand_buyers" ? "brand" : "event";
        const targetId = entry.kind === "brand_buyers" ? entry.brand_id : entry.event_id;
        if (targetId === null) return;
        router.push(`/marketing/campaigns/compose?audience=${kind}:${targetId}` as never);
        return;
      }
      // Virtual row: materialize first so subsequent navigation is fast and
      // doesn't race with the composer's own pre-fill effect.
      if (accountId === null) return;
      setCreatingKey(entry.client_key);
      try {
        if (entry.kind === "brand_buyers") {
          await ensureBrandBuyersAudience({
            account_id: accountId,
            brand_id: entry.brand_id,
          });
          router.push(`/marketing/campaigns/compose?audience=brand:${entry.brand_id}` as never);
        } else {
          if (entry.event_id === null) return;
          await ensureEventBuyersAudience({
            account_id: accountId,
            brand_id: entry.brand_id,
            event_id: entry.event_id,
          });
          router.push(`/marketing/campaigns/compose?audience=event:${entry.event_id}` as never);
        }
      } catch (_err) {
        // Per SPEC §6.2.7: failure rolls back the spinner AND surfaces a
        // user-facing toast (Constitution #3 — no silent failures).
        setErrorToast("Couldn't open this audience. Try again in a moment.");
      } finally {
        setCreatingKey(null);
      }
    },
    [accountId, router],
  );

  // ORCH-0889: disabled-query (auth-bootstrap) and first-fetch states
  // both render the skeleton. The old guard `isLoading && entries.length
  // === 0` mis-fired during the web auth-bootstrap window (React Query
  // reports `isLoading: false` when `enabled: false`) and fell through to
  // the "No buyers yet." empty-state — falsely communicating a terminal
  // state. Per I-DISABLED-QUERY-IS-LOADING.
  if (!listState.hasResolved && !listState.isError) {
    return (
      <View style={styles.host} testID="audiences-skeleton">
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.sectionLabel}>YOUR AUDIENCES</Text>
          <Text style={styles.sectionCaption}>Auto-updated as people buy tickets.</Text>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.cardSkeleton} />
          ))}
        </ScrollView>
      </View>
    );
  }

  if (listState.isError) {
    return (
      <View style={styles.host}>
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load audiences"
            description="Pull to retry, or come back in a moment."
          />
        </View>
      </View>
    );
  }

  if (listState.entries.length === 0) {
    return (
      <View style={styles.host}>
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="No buyers yet."
            description="Audiences fill in automatically as people buy tickets from your events."
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>YOUR AUDIENCES</Text>
        <Text style={styles.sectionCaption}>Auto-updated as people buy tickets.</Text>
        {listState.entries.map((entry) => {
          const reachValue = listState.reach.get(entry.client_key);
          // reachLoading + key not yet present in reach map → still loading.
          const reach = listState.reach.has(entry.client_key) ? reachValue : undefined;
          return (
            <AudienceCard
              key={entry.client_key}
              entry={entry}
              reach={reach}
              onPress={handleTap}
              isCreating={creatingKey === entry.client_key}
            />
          );
        })}
      </ScrollView>
      {/* Toast must be wrapped in an absolute-positioned View per
          feedback_toast_needs_absolute_wrap.md — the Toast primitive itself
          has no layout, so a bare render would collapse to zero height. */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={errorToast !== null}
          kind="error"
          message={errorToast ?? ""}
          onDismiss={() => setErrorToast(null)}
        />
      </View>
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
    gap: spacing.sm,
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  sectionLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  sectionCaption: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
  },
  cardSkeleton: {
    height: 76,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  toastWrap: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    zIndex: 100,
  },
});
