/**
 * ORCH-1150 — RSVP host dashboard (D-4 retest fix).
 *
 * Route: /rsvp/{id} (id = LiveEvent.id `le_<ts36>` or the server events.id).
 *
 * Without this file, routeForEventRow.ts's `/rsvp/{id}` target (returned for a
 * non-draft RSVP row) falls through to +not-found.tsx — the enlarged-logo
 * white screen Seth hit when tapping a live RSVP event. DO NOT delete.
 *
 * This is a SUBTRACTIVE clone of `app/event/[id]/index.tsx` tailored to RSVP:
 * KEEPS the hero (cover + status pill + title + date·venue), the "N going"
 * headcount, a Guests console link, Edit, Share, and the public-page link.
 * DROPS every paid-ticket/money concept (revenue card, ticket types, orders,
 * door sales, reconciliation, activity feed, end-sales/cancel, and the
 * ticket-centric manage menu). RSVP admission keeps its own scan controls.
 *
 * Going-count data-hook (SPEC finding F-2): `fetchBusinessEventById` (behind
 * useManagedEventRoute) zeroes `rsvpGoingCount` and coerces `event_type` to
 * 'event', so the headcount is read from the Hub LIST query
 * (`useBusinessEventsForBrand`) found-by-id — the same source the Hub card
 * uses, so the count matches what the host just saw. useManagedEventRoute is
 * still used for cover/title/status/date/venue/slugs/capacity/approvalMode.
 *
 * Per INVESTIGATE_ORCH-1150_RSVP_DETAIL_PAGE.md PART 2 (SPEC §5 KEEP/DROP).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import {
  useLiveEventStore,
  type LiveEvent,
} from "../../../src/store/liveEventStore";
import { useDraftById } from "../../../src/store/draftEventStore";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";
import { deriveLiveStatus } from "../../../src/utils/eventLifecycle";
import { computeMasterStartAtUtc } from "../../../src/utils/eventDateMath";
import { eventPublicUrl } from "../../../src/constants/publicUrls";
import { formatRsvpGoingLabel } from "../../../src/utils/rsvpHubMetrics";

import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { ShareModal, offeringShareability } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
import { TopBar } from "../../../src/components/ui/TopBar";

import { ActionTile } from "../../../src/components/event/ActionTile";
import { EventDetailHeroStatusPill } from "../../../src/components/event/EventDetailHeroStatusPill";
import { useManagedEventRoute } from "../../../src/hooks/useManagedEventRoute";
import { useBusinessEventsForBrand } from "../../../src/hooks/useBusinessEvents";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useSuccessfulBusinessRecentOpen } from "../../../src/hooks/useBusinessRecent";
import { isScannerOnlyRank } from "../../../src/utils/navTabGate";

// ----- Status derivation (mirrors event/[id]/index.tsx) ---------------
type EventStatus = "live" | "upcoming" | "past";

const deriveScreenStatus = (event: LiveEvent): EventStatus => {
  // ORCH-0828: pass timezone-aware UTC instant (not date-only string).
  const lifecycle = deriveLiveStatus(event, computeMasterStartAtUtc(event));
  return lifecycle === "cancelled" ? "past" : lifecycle;
};

// Map the 3-state screen status to the formatRsvpGoingLabel "kind" (the Hub
// metric helper only knows draft/live/past). upcoming (scheduled, not yet
// started) is still published → guests can RSVP → treat as "live" for the
// headcount label (NOT "draft", which would read "Not published").
const goingKindForStatus = (status: EventStatus): "live" | "past" =>
  status === "past" ? "past" : "live";

export default function RsvpDetailScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id) && typeof params.id[0] === "string"
        ? params.id[0]
        : null;

  // ----- Resolve event (cover/title/status/date/venue/slugs/capacity) ---
  const routeEvent = useManagedEventRoute(id);
  const resolvedLiveEvent = routeEvent.event;
  const draftEvent = useDraftById(id);
  const brand = routeEvent.brand;
  const currentBrandRole = useCurrentBrandRole(brand?.id ?? null);
  const canShowListingInsights =
    !currentBrandRole.isLoading &&
    !currentBrandRole.isError &&
    currentBrandRole.role !== null &&
    !isScannerOnlyRank(currentBrandRole.rank);

  // ----- Going-count source (SPEC F-2) -------------------------------
  // useManagedEventRoute → fetchBusinessEventById returns rsvpGoingCount: 0,
  // so source the headcount from the Hub LIST query found-by-id (the same
  // cache the Hub card reads). brand?.id may be null until the detail resolves
  // — the hook returns [] when disabled, and we fall back to the (possibly 0)
  // event.rsvpGoingCount, which is acceptable: the count is non-blocking and
  // self-corrects once the list resolves.
  const brandEventsQuery = useBusinessEventsForBrand(brand?.id ?? null);
  const goingCount = useMemo<number>(() => {
    const rows = brandEventsQuery.data ?? [];
    const match = rows.find(
      (e) => e.id === id || e.serverEventId === id,
    );
    return match?.rsvpGoingCount ?? resolvedLiveEvent?.rsvpGoingCount ?? 0;
  }, [brandEventsQuery.data, id, resolvedLiveEvent?.rsvpGoingCount]);

  // ----- Defensive: draft → redirect to RSVP edit --------------------
  useEffect(() => {
    if (id === null) return;
    if (routeEvent.replacementEventId !== null) {
      router.replace(`/rsvp/${routeEvent.replacementEventId}` as never);
      return;
    }
    if (resolvedLiveEvent === null && draftEvent !== null) {
      router.replace(`/rsvp/${id}/edit` as never);
    }
  }, [id, routeEvent.replacementEventId, resolvedLiveEvent, draftEvent, router]);

  // ----- State -------------------------------------------------------
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const event = resolvedLiveEvent;
  useSuccessfulBusinessRecentOpen({
    brandId: brand?.id ?? event?.brandId ?? null,
    entityType: "rsvp", entityId: event?.serverEventId ?? id,
    ready: event !== null && draftEvent === null && routeEvent.replacementEventId === null,
    title: event?.name, coverUrl: event?.coverMediaUrl,
    coverPosterUrl: event?.coverMediaPosterUrl, coverType: event?.coverMediaType,
    status: event?.status,
  });

  // ----- Handlers ----------------------------------------------------
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/hub/events" as never);
    }
  }, [router]);

  // #2589 — Share is offered only for an RSVP the public can actually resolve.
  // Creating a share for a private or unpublished one 404s, and that 404 reached
  // the sheet as a generic failure beside a Retry that could never work.
  const shareability = useMemo(
    () => offeringShareability({
      visibility: resolvedLiveEvent?.visibility ?? null,
      publishedAt: resolvedLiveEvent?.publishedAt ?? null,
      status: resolvedLiveEvent?.status ?? null,
    }),
    [resolvedLiveEvent?.visibility, resolvedLiveEvent?.publishedAt, resolvedLiveEvent?.status],
  );

  const handleShareOpen = useCallback((): void => {
    if (!shareability.shareable) {
      setToast({ visible: true, message: shareability.reason });
      return;
    }
    setShareModalVisible(true);
  }, [shareability]);

  const handleEdit = useCallback((): void => {
    if (id !== null) {
      // ORCH-1150-R2 (D-9b) — this detail page is ONLY ever shown for a
      // PUBLISHED/live RSVP (the draft case is redirected away earlier in the
      // "Defensive: draft → redirect" effect). So Edit must enter the edit
      // screen on its edit-published path. Without ?mode=edit-published the
      // edit screen runs its DRAFT-resolution path (useDraftById) — a published
      // RSVP has no draft → it never resolves and bounces to the events list
      // (safeEventsExitRoute). The Hub manage-menu Edit appends this same param
      // for non-draft rows; the detail-page Edit must match that.
      router.push(`/rsvp/${id}/edit?mode=edit-published` as never);
    }
  }, [id, router]);

  const handleGuests = useCallback((): void => {
    if (id !== null) {
      router.push(`/rsvp/${id}/guests` as never);
    }
  }, [id, router]);

  const handleScanGuests = useCallback((): void => {
    if (id !== null) router.push(`/rsvp/${id}/scanner` as never);
  }, [id, router]);

  const handleScanners = useCallback((): void => {
    if (id !== null) router.push(`/rsvp/${id}/scanners` as never);
  }, [id, router]);

  // ORCH-1150 (D-8) — Group chat + Blasts are COMMS, not money: D-4 wrongly
  // dropped them. Both reuse the event-scoped comms screens (group-chat is
  // event_type-agnostic; the Blasts audience is extended to event_rsvps
  // going-guests via resolveRsvpGuests + the useEventBuyers type-probe).
  const handleGroupChat = useCallback((): void => {
    if (id !== null) {
      // orch-strict-grep-allow route-by-event-type — RSVP reuses the event-scoped group-chat/blasts screens (comms, not ticketed)
      router.push(`/event/${id}/group-chat` as never);
    }
  }, [id, router]);

  const handleBlasts = useCallback((): void => {
    if (id !== null) {
      // orch-strict-grep-allow route-by-event-type — RSVP reuses the event-scoped group-chat/blasts screens (comms, not ticketed)
      router.push(`/event/${id}/blasts` as never);
    }
  }, [id, router]);

  const handleViewPublic = useCallback((): void => {
    if (resolvedLiveEvent !== null) {
      router.push(
        `/e/${resolvedLiveEvent.brandSlug}/${resolvedLiveEvent.eventSlug}` as never,
      );
    }
  }, [resolvedLiveEvent, router]);

  const handleBrandPage = useCallback((): void => {
    if (brand !== null) {
      router.push(`/brand/${brand.id}` as never);
    }
  }, [brand, router]);

  // ----- Render not-found shell --------------------------------------
  if (
    id === null ||
    (event === null && draftEvent === null && !routeEvent.isLoading)
  ) {
    return (
      <View style={styles.host}>
        <View
          style={[
            styles.headerWrap,
            {
              paddingTop: insets.top + (Platform.OS === "web" ? spacing.sm : 0),
            },
          ]}
        >
          <TopBar leftKind="back" onBack={handleBack} title="RSVP" />
        </View>
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="users"
            title="RSVP event not found"
            description="This RSVP event may have been deleted or moved."
            cta={{ label: "Back to events", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  // Drafts → redirected via useEffect; render skeleton shell briefly (NOT a
  // white screen — a proper page shell with the header + loading copy).
  if (event === null) {
    return (
      <View style={styles.host}>
        <View
          style={[
            styles.headerWrap,
            {
              paddingTop: insets.top + (Platform.OS === "web" ? spacing.sm : 0),
            },
          ]}
        >
          <TopBar leftKind="back" onBack={handleBack} title="RSVP" />
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.loadingText}>Loading RSVP…</Text>
        </View>
      </View>
    );
  }

  const status = deriveScreenStatus(event);
  const dateLine = formatDraftDateLine(event);
  const goingLabel = formatRsvpGoingLabel({
    kind: goingKindForStatus(status),
    goingCount,
    capacity: event.rsvpCapacity ?? null,
  });
  const isManualApproval = event.rsvpApprovalMode === "manual";
  const guestsSub = isManualApproval ? "Approve / deny" : goingLabel;

  return (
    <View style={styles.host}>
      {/* Header */}
      <View
        style={[
          styles.headerWrap,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? spacing.sm : 0),
          },
        ]}
      >
        <TopBar
          leftKind="back"
          onBack={handleBack}
          title="RSVP"
          rightSlot={
            <View style={styles.headerRightRow}>
              <IconChrome
                icon="share"
                size={36}
                onPress={handleShareOpen}
                accessibilityLabel="Share RSVP event"
              />
            </View>
          }
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — cover band + status pill + name + date+venue */}
        <View style={styles.hero}>
          <View style={styles.heroCoverWrap}>
            <EventCoverMedia
              hue={event.coverHue}
              mediaUrl={event.coverMediaUrl}
              mediaType={event.coverMediaType}
              radius={24}
              label=""
              height={200}
            />
          </View>
          <View style={styles.heroOverlay} pointerEvents="none">
            <View style={styles.heroPillRow}>
              <EventDetailHeroStatusPill status={status} />
            </View>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {event.name.trim().length > 0 ? event.name : "Untitled RSVP"}
            </Text>
            <Text style={styles.heroSubline} numberOfLines={1}>
              {dateLine}
              {event.venueName !== null && event.venueName.length > 0
                ? ` · ${event.venueName}`
                : ""}
            </Text>
          </View>
        </View>

        {/* Headcount card — replaces the ticketed revenue card */}
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          <Text style={styles.goingLabel}>
            {goingCount === 0 && status !== "past"
              ? "No one's responded yet"
              : goingLabel}
          </Text>
          <Text style={styles.goingSub}>
            {goingCount === 0 && status !== "past"
              ? "0 going"
              : "confirmed attending"}
          </Text>
        </GlassCard>

        {/* Founder-locked RSVP door order: Scan guests → Guests → Scanners. */}
        <View style={styles.actionGrid}>
          <ActionTile
            icon="qr"
            label="Scan guests"
            primary
            onPress={handleScanGuests}
          />
          <ActionTile
            icon="users"
            label="Guests"
            sub={guestsSub}
            onPress={handleGuests}
          />
          <ActionTile
            icon="users"
            label="Scanners"
            onPress={handleScanners}
          />
          {canShowListingInsights ? (
            <ActionTile
              icon="chart"
              label="Insights"
              sub="Customers Mingla drove"
              accessibilityLabel={`Open Insights for ${event.name}`}
              onPress={() =>
                router.push(`/insights/${event.id}?entry=detail_action` as never)
              }
            />
          ) : null}
          <ActionTile icon="edit" label="Edit" onPress={handleEdit} />
          {/* ORCH-1150 (D-8) — Group chat + Blasts are comms (not money):
              re-added after D-4 dropped them. They reuse the event-scoped
              comms screens (see handleGroupChat / handleBlasts). */}
          <ActionTile
            icon="send"
            label="Blasts"
            sub="Message going guests"
            onPress={handleBlasts}
          />
          <ActionTile
            icon="chat"
            label="Group chat"
            sub="Read + reply + moderate"
            onPress={handleGroupChat}
          />
          <ActionTile
            icon="eye"
            label="Public page"
            onPress={handleViewPublic}
          />
          {brand !== null ? (
            <ActionTile
              icon="user"
              label="Brand page"
              onPress={handleBrandPage}
            />
          ) : null}
        </View>
      </ScrollView>

      {/* Share modal — #2589: mounted only when the offering is publicly
          resolvable, so the sheet is never offered for something that provably
          cannot be shared. `contentKind` is already correct on this route. */}
      {shareability.shareable ? (
        <ShareModal
          preloadContent
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={eventPublicUrl({
            brandSlug: event.brandSlug,
            eventSlug: event.eventSlug,
          })}
          title={`${event.name} on Mingla`}
          description={event.description.slice(0, 200) || event.name}
          contentKind="rsvp_event"
        />
      ) : null}

      {/* Toast wrap — top-anchored per memory rule */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

// ---- Page styles ---------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  headerWrap: {
    paddingHorizontal: spacing.md,
  },
  headerRightRow: {
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    fontSize: 14,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  hero: {
    position: "relative",
    height: 200,
    borderRadius: radiusTokens.xl,
    overflow: "hidden",
  },
  heroCoverWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroOverlay: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  heroPillRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: "#ffffff",
    ...(Platform.OS === "web"
      ? { textShadow: "0 2px 12px rgba(0, 0, 0, 0.4)" }
      : {
          textShadowColor: "rgba(0, 0, 0, 0.4)",
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 12,
        }),
    marginBottom: 4,
  },
  heroSubline: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
  },
  goingLabel: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
  },
  goingSub: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
