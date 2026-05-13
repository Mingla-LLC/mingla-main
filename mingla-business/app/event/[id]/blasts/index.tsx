/**
 * /event/[id]/blasts — Event Blasts tab (ORCH-0815-A2-ui, renamed
 * "Buyers" → "Blasts" 2026-05-12 for bottom-nav consistency).
 *
 * Surface §2 of the dual-surface Marketing Hub (DEC-149). Same row layout
 * as Brand Blasts tab (BuyerRow is the single-source component per
 * I-PROPOSED-BT), scoped to one event's ticket buyers. Sticky "Blast these
 * N buyers →" CTA pre-fills the composer audience.
 *
 * Note on naming: tab label says "Blasts" (destination/action). Count
 * label inside still describes the data accurately as "buyers" — the
 * data IS buyers; Blasts is the verb. e.g. "247 buyers · 231 reachable"
 * + "Blast these 231 buyers".
 *
 * Phase A: composer route doesn't exist yet (sub-ORCH-B) — CTA shows
 * "Composer ships next" toast on press.
 *
 * SPEC reference: SPEC §5.8. DESIGN reference: §7.8.
 */

import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BlastCustomersCta } from "../../../../src/components/marketing/BlastCustomersCta";
import { BuyerRow } from "../../../../src/components/marketing/BuyerRow";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import { TopBar } from "../../../../src/components/ui/TopBar";
import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useEventBuyers } from "../../../../src/hooks/marketing/useEventBuyers";
import type { BlastAudienceKind } from "../../../../src/components/marketing/BlastCustomersCta";

export default function EventBlastsRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const eventId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const buyersQuery = useEventBuyers(eventId);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else if (eventId !== null) router.replace(`/event/${eventId}` as never);
  }, [router, eventId]);

  const handleBlast = useCallback(
    (kind: BlastAudienceKind, targetId: string): void => {
      // ORCH-0815-B Phase 2 — composer route is live. Navigate with the
      // audience pre-fill query param shape `{kind}:{id}` (I-PROPOSED-BU).
      router.push(
        `/marketing/campaigns/compose?audience=${kind}:${targetId}` as never,
      );
    },
    [router],
  );

  const buyers = buyersQuery.data;
  const headerCounts = useMemo(() => {
    if (buyers === undefined) return null;
    const { total, reachable_email } = buyers.reach;
    return `${total} ${total === 1 ? "buyer" : "buyers"} · ${reachable_email} reachable`;
  }, [buyers]);

  if (buyersQuery.isLoading && buyers === undefined) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Blasts"
            onBack={handleBack}
            rightSlot={null}
          />
        </View>
        <View style={styles.centerHost}>
          <ActivityIndicator size="small" color={textTokens.secondary} />
        </View>
      </View>
    );
  }

  if (buyersQuery.isError) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Blasts"
            onBack={handleBack}
            rightSlot={null}
          />
        </View>
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load buyers"
            description="Pull to retry, or come back in a moment."
          />
        </View>
      </View>
    );
  }

  if (buyers !== undefined && buyers.rows.length === 0) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Blasts"
            onBack={handleBack}
            rightSlot={null}
          />
        </View>
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="No buyers yet."
            description="When tickets sell, buyers show up here."
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title="Blasts"
          onBack={handleBack}
          rightSlot={null}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard variant="base" padding={0}>
          {headerCounts !== null ? (
            <>
              <View style={styles.cardHeader}>
                <Text style={styles.cardHeaderLabel}>BUYERS</Text>
                <Text style={styles.cardHeaderCounts}>{headerCounts}</Text>
              </View>
              <View style={styles.cardDivider} />
            </>
          ) : null}
          {buyers !== undefined
            ? buyers.rows.map((buyer) => (
                <BuyerRow key={buyer.contact_key} buyer={buyer} />
              ))
            : null}
        </GlassCard>
      </ScrollView>

      {buyers !== undefined ? (
        <View style={styles.ctaWrap}>
          <BlastCustomersCta
            audienceKind="event"
            audienceTargetId={eventId ?? ""}
            reachableCount={buyers.reach.reachable_email}
            onPress={handleBlast}
          />
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  // Matches the home/events/account barWrap pattern so the TopBar glass
  // capsule sits inset from screen edges with breathing space above + below
  // (NOT flush — flush reads as "zoomed-in" per operator visual review).
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  // Card header inside the GlassCard wrapping the buyer list. Replaces
  // the old "bare bodyLg text floating on canvas" pattern that read as
  // orphaned per operator visual review 2026-05-12.
  cardHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardHeaderLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  cardHeaderCounts: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  scrollContent: {
    paddingHorizontal: spacing.md, // page margin around the GlassCard
    paddingTop: spacing.sm,
    paddingBottom: 140, // breathe room for sticky CTA (60pt + 8pt + safe-area + buffer)
  },
  ctaWrap: {
    // CTA is glass — DO NOT set an opaque backgroundColor here. The glass
    // chrome's backdrop blur handles content-behind-glass legibility; an
    // opaque wrap would defeat the aesthetic. Safe-area inset is owned by
    // the BlastCustomersCta component itself (see its useSafeAreaInsets).
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
