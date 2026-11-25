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
 *
 * #4596: the header count, card label and button count come from the server's
 * one event audience owner (useEventAudienceCount): paid buyers plus going RSVP
 * guests. The roster below lists names only. An RSVP event says GUESTS, a paid
 * event BUYERS, an event with both PEOPLE.
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
  color,
  space,
  type,
} from "../../../../src/constants/designSystem";
import { useEventAudienceCount } from "../../../../src/hooks/marketing/useEventAudienceCount";
import {
  eventCardLabel,
  eventHeaderCounts,
  eventZeroReachCaption,
  pendingReviewNote,
} from "../../../../src/features/marketing/eventAudienceCopy";
import type { BlastAudienceKind } from "../../../../src/components/marketing/BlastCustomersCta";

export default function EventBlastsRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const eventId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const countQuery = useEventAudienceCount(eventId);

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

  const count = countQuery.data;
  // Fix pass 3: the roster is the count's own list (same owner, same de-dup).
  const roster = count?.roster;
  const isRsvpEvent = countQuery.eventType === "rsvp";
  const headerCounts = useMemo(() => {
    if (count === undefined) return null;
    return eventHeaderCounts(count.shape, count.peopleCount, count.reachableEmail);
  }, [count]);
  const pendingNote = count === undefined ? null : pendingReviewNote(count.pendingReviewCount);
  const zeroCaption =
    count !== undefined && count.reachableEmail === 0 && count.peopleCount > 0
      ? eventZeroReachCaption(count.shape)
      : null;

  if (
    countQuery.isLoading && count === undefined && !countQuery.isError
  ) {
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
          <ActivityIndicator size="small" color={color.text2} />
        </View>
      </View>
    );
  }

  if (countQuery.isError) {
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
            title={isRsvpEvent ? "Couldn't load guests." : "Couldn't load buyers"}
            description="Pull to retry, or come back in a moment."
          />
        </View>
      </View>
    );
  }

  if (
    roster !== undefined &&
    roster.length === 0 &&
    (count === undefined || count.peopleCount === 0)
  ) {
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
            title={isRsvpEvent ? "No guests yet." : "No buyers yet."}
            description={
              isRsvpEvent
                ? "When people RSVP, they show up here."
                : "When tickets sell, buyers show up here."
            }
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
        contentContainerStyle={[
          styles.scrollContent,
          zeroCaption !== null ? styles.scrollContentWithCaption : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard variant="base" padding={0}>
          {headerCounts !== null ? (
            <>
              <View style={styles.cardHeader}>
                <Text style={styles.cardHeaderLabel}>
                  {count !== undefined ? eventCardLabel(count.shape) : "BUYERS"}
                </Text>
                <Text style={styles.cardHeaderCounts}>{headerCounts}</Text>
              </View>
              <View style={styles.cardDivider} />
            </>
          ) : null}
          {roster !== undefined
            ? roster.map((buyer) => (
                <BuyerRow key={buyer.contact_key} buyer={buyer} />
              ))
            : null}
          {pendingNote !== null ? (
            <>
              <View style={styles.cardDivider} />
              <Text style={styles.pendingNote} testID="event-blasts-pending-review">
                {pendingNote}
              </Text>
            </>
          ) : null}
        </GlassCard>
      </ScrollView>

      {count !== undefined ? (
        <View style={styles.ctaWrap}>
          <BlastCustomersCta
            audienceKind="event"
            audienceTargetId={eventId ?? ""}
            reachableCount={count.reachableEmail}
            onPress={handleBlast}
            caption={zeroCaption}
            testID="event-blasts-cta"
          />
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  // Matches the home/events/account barWrap pattern so the TopBar glass
  // capsule sits inset from screen edges with breathing space above + below
  // (NOT flush — flush reads as "zoomed-in" per operator visual review).
  barWrap: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[6],
  },
  // Card header inside the GlassCard wrapping the buyer list. Replaces
  // the old "bare bodyLg text floating on canvas" pattern that read as
  // orphaned per operator visual review 2026-05-12.
  cardHeader: {
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[2],
  },
  cardHeaderLabel: {
    ...type.label,
    color: color.text3,
  },
  cardHeaderCounts: {
    ...type.small,
    color: color.text2,
  },
  pendingNote: {
    ...type.small,
    color: color.text3,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.fill.pressed,
  },
  scrollContent: {
    paddingHorizontal: space[4], // page margin around the GlassCard
    paddingTop: space[2],
    paddingBottom: 140, // breathe room for sticky CTA (60pt + 8pt + safe-area + buffer)
  },
  // #4596 — room for the one caption line under a disabled button.
  scrollContentWithCaption: {
    paddingBottom: 172,
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
