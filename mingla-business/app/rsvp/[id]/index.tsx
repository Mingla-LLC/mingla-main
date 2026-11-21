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
  color,
  space,
  type,
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

import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import {
  OfferingHomeHeader,
  useOfferingPromote,
} from "../../../src/components/offering/OfferingHome";
import { DesktopColumns } from "../../../src/components/ui/DesktopCanvas";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { ShareModal, offeringShareability } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
import { TopBar } from "../../../src/components/ui/TopBar";

import { ActionTile } from "../../../src/components/event/ActionTile";
import { EventDetailHeroStatusPill } from "../../../src/components/event/EventDetailHeroStatusPill";
import { useManagedEventRoute } from "../../../src/hooks/useManagedEventRoute";
// issue #3237 — the one-shot "Published. It's live." banner after a publish.
import { useJustPublishedArrival } from "../../../src/hooks/useJustPublishedArrival";
import { LazyPublishedBanner } from "../../../src/components/offering/LazyPublishedBanner";
import { useBusinessEventsForBrand } from "../../../src/hooks/useBusinessEvents";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useSuccessfulBusinessRecentOpen } from "../../../src/hooks/useBusinessRecent";
import { isScannerOnlyRank } from "../../../src/utils/navTabGate";
// #3645 — a published RSVP can be returned to draft or cancelled. The dialogs
// (and everything they need) load only when the host first opens one.
import { LazyRsvpLifecycleDialogs } from "../../../src/components/rsvp/LazyRsvpLifecycleDialogs";
import { canPerformAction } from "../../../src/utils/permissionGates";

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

// #4514 — the "Guest questions" tile, its data hook and the attach sheet load
// on demand through the one forms owner, so none of it is in the eager Host
// web bundle. While the chunk loads, the cell shows the labelled, disabled tile
// (a moment, never a dead tap).
const GuestQuestionsTile = React.lazy(() =>
  import("../../../src/components/forms/formsOwner").then((m) => ({
    default: m.GuestQuestionsTile,
  })),
);
const guestQuestionsTileLoading = (
  <ActionTile fill disabled icon="list" label="Guest questions" sub="Loading…" onPress={() => undefined} />
);

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
  // #4514 — marketing manager and up; scanners never see "Guest questions".
  const showGuestQuestions =
    brand !== null &&
    !currentBrandRole.isLoading &&
    !currentBrandRole.isError &&
    currentBrandRole.role !== null &&
    canPerformAction(currentBrandRole.rank, "READ_FORM_RESPONSES");

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
  // issue #3237 — true once, straight after this RSVP was published.
  // #3645 — and no longer once it is returned to draft or cancelled.
  const publishedArrival = useJustPublishedArrival(
    id,
    resolvedLiveEvent?.status,
  );
  // Stable across renders, so the Share handler keeps one identity.
  const isPublishArrivalPress = publishedArrival.isArrivalPress;
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  // #3645 — which lifecycle dialog is open, and whether either has ever been
  // opened (the lazy dialogs mount on first use and then stay mounted).
  const [lifecycleDialog, setLifecycleDialog] = useState<
    "return-to-draft" | "cancel" | null
  >(null);
  const [lifecycleDialogsLoaded, setLifecycleDialogsLoaded] = useState(false);
  const openLifecycleDialog = useCallback(
    (which: "return-to-draft" | "cancel"): void => {
      setLifecycleDialogsLoaded(true);
      setLifecycleDialog(which);
    },
    [],
  );
  const closeLifecycleDialog = useCallback((): void => {
    setLifecycleDialog(null);
  }, []);
  const handleReturnedToDraft = useCallback(
    (message: string): void => {
      setLifecycleDialog(null);
      setToast({ visible: true, message });
      // Let the dialog finish closing before the screen changes (the same
      // short wait the experience dashboard uses after a cancel).
      if (id !== null) {
        setTimeout(() => router.replace(`/rsvp/${id}/edit` as never), 300);
      }
    },
    [id, router],
  );
  // No navigation after a cancel: the screen re-renders in place with the
  // cancelled status, exactly as the event dashboard does.
  const handleRsvpCancelled = useCallback((message: string): void => {
    setLifecycleDialog(null);
    setToast({ visible: true, message });
  }, []);
  const { isWideDesktop } = useResponsiveLayout();
  // #4420 (TILE_MATRIX P10) — the Promote tile, gated like the event home's.
  const promote = useOfferingPromote(
    brand?.id ?? null,
    resolvedLiveEvent?.serverEventId ?? resolvedLiveEvent?.id ?? null,
    currentBrandRole.rank,
  );
  const canManageLifecycle = canPerformAction(
    currentBrandRole.rank,
    "EDIT_EVENT",
  );

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
    // #3645 — publishing never opens the share sheet by itself.
    if (isPublishArrivalPress()) return;
    if (!shareability.shareable) {
      setToast({ visible: true, message: shareability.reason });
      return;
    }
    setShareModalVisible(true);
  }, [shareability, isPublishArrivalPress]);

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
              paddingTop: insets.top + (Platform.OS === "web" ? space[2] : 0),
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
              paddingTop: insets.top + (Platform.OS === "web" ? space[2] : 0),
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

  // Headcount card — replaces the ticketed revenue card.
  const goingCard = (
        <GlassCard variant="base" radius="md" padding={space[4]}>
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
  );

  return (
    <View style={styles.host}>
      {/* Header */}
      <View
        style={[
          styles.headerWrap,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? space[2] : 0),
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
          { paddingBottom: insets.bottom + space[7] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* #4420 — desktop uses the 8/4 template (as the event home): the RSVP
            and its tiles in the main column, the headcount in the aside. */}
        <DesktopColumns
          main={
            <View style={styles.colStack}>
        {/* issue #3237 — publish confirmation. Share and View public page are
            this screen's own handlers. A private RSVP has no page the public
            can open and its Share is refused, so it gets the confirmation with
            neither button. */}
        {publishedArrival.justPublished ? (
          <LazyPublishedBanner
            kind="rsvp"
            onShare={shareability.shareable ? handleShareOpen : undefined}
            onViewPublic={
              shareability.shareable ? handleViewPublic : undefined
            }
            onDismiss={publishedArrival.dismiss}
            testID="rsvp-published-banner"
          />
        ) : null}
        {/* #4420 (TILE_MATRIX P10) — the compact identity card (thumb, status,
            name, date + venue) that replaced the 200pt photo hero, the same
            as the event home. */}
        <OfferingHomeHeader
          hue={event.coverHue}
          mediaUrl={event.coverMediaUrl}
          mediaType={event.coverMediaType}
          pill={
            <EventDetailHeroStatusPill
              status={status}
              cancelled={event.status === "cancelled"}
            />
          }
          title={event.name.trim().length > 0 ? event.name : "Untitled RSVP"}
          subline={`${dateLine}${
            event.venueName !== null && event.venueName.length > 0
              ? ` · ${event.venueName}`
              : ""
          }`}
        />

        {isWideDesktop ? null : goingCard}
        {/* #4420 (TILE_MATRIX P10) — the shared tile page, in rows of three
            equal cells. Founder-locked RSVP door order inside it: Scan guests
            → Guests → Scanners. RSVPs are free: no Orders or Reconcile. */}
        <View style={styles.tileRows}>
          <View style={styles.tileRow}>
            <ActionTile fill icon="edit" label="Edit" onPress={handleEdit} />
            <ActionTile
              fill
              icon="qr"
              label="Scan guests"
              onPress={handleScanGuests}
            />
            <ActionTile
              fill
              icon="user"
              label="Guests"
              sub={guestsSub}
              onPress={handleGuests}
            />
          </View>
          <View style={styles.tileRow}>
            <ActionTile
              fill
              icon="users"
              label="Scanners"
              onPress={handleScanners}
            />
            {/* ORCH-1150 (D-8) — Group chat + Blasts are comms (not money):
                re-added after D-4 dropped them. They reuse the event-scoped
                comms screens (see handleGroupChat / handleBlasts). */}
            <ActionTile
              fill
              icon="chat"
              label="Group chat"
              onPress={handleGroupChat}
            />
            <ActionTile
              fill
              icon="send"
              label="Blast"
              accessibilityLabel="Message going guests"
              onPress={handleBlasts}
            />
          </View>
          {showGuestQuestions || promote.enabled || canShowListingInsights ? (
          <View style={styles.tileRow}>
            {/* #4514 — third row, first cell: after Blast, before Promote. It
                fills the row's empty cell, so the first row keeps the locked
                door order. */}
            {showGuestQuestions && brand !== null ? (
              <React.Suspense fallback={guestQuestionsTileLoading}>
                <GuestQuestionsTile
                  eventId={event.serverEventId ?? event.id}
                  brandId={brand.id}
                  kind="rsvp"
                  testID="rsvp-tile-guest-questions"
                />
              </React.Suspense>
            ) : null}
            {promote.enabled ? (
              <ActionTile
                fill
                icon="megaphone"
                label="Promote"
                sub={promote.status}
                accessibilityLabel={`Promote ${event.name}`}
                onPress={promote.open}
                testID="rsvp-tile-promote"
              />
            ) : null}
            {canShowListingInsights ? (
              <ActionTile
                fill
                icon="chart"
                label="Insights"
                sub="Visits, actions and bookings"
                accessibilityLabel={`Open Insights for ${event.name}`}
                onPress={() =>
                  router.push(`/insights/${event.id}?entry=detail_action` as never)
                }
              />
            ) : null}
            {Array.from(
              {
                length:
                  3 -
                  (showGuestQuestions ? 1 : 0) -
                  (promote.enabled ? 1 : 0) -
                  (canShowListingInsights ? 1 : 0),
              },
              (_, pad) => (
                <View key={`pad-${pad}`} style={styles.tilePad} />
              ),
            )}
          </View>
          ) : null}
          <Text style={styles.sectionLabel}>MORE FOR THIS RSVP</Text>
          <View style={styles.tileRow}>
            <ActionTile
              fill
              icon="eye"
              label="Public page"
              onPress={handleViewPublic}
            />
            {brand !== null ? (
              <ActionTile
                fill
                icon="home"
                label="Brand page"
                onPress={handleBrandPage}
              />
            ) : (
              <View style={styles.tilePad} />
            )}
            <View style={styles.tilePad} />
          </View>
        </View>

            </View>
          }
          aside={isWideDesktop ? <View style={styles.colStack}>{goingCard}</View> : undefined}
        />

        {/* #3645 — same two controls, in the same place, as the experience
            dashboard. Return to draft is offered before the RSVP starts;
            Cancel while it is upcoming or live. Event managers and above. */}
        {status === "upcoming" &&
        event.status !== "cancelled" &&
        canManageLifecycle ? (
          <View style={styles.lifecycleCtaWrap}>
            <Button
              label="Return RSVP to draft"
              variant="ghost"
              size="md"
              onPress={() => openLifecycleDialog("return-to-draft")}
              fullWidth
              testID="rsvp-dashboard-unpublish-cta"
            />
          </View>
        ) : null}
        {(status === "live" || status === "upcoming") &&
        event.status !== "cancelled" &&
        canManageLifecycle ? (
          <View style={styles.lifecycleCtaWrap}>
            <Button
              label="Cancel RSVP"
              variant="ghost"
              size="md"
              onPress={() => openLifecycleDialog("cancel")}
              fullWidth
              testID="rsvp-dashboard-cancel-cta"
            />
          </View>
        ) : null}
      </ScrollView>

      {lifecycleDialogsLoaded ? (
        <LazyRsvpLifecycleDialogs
          eventId={event.serverEventId ?? event.id}
          brandId={event.brandId}
          confirmText={
            event.name.trim().length > 0 ? event.name : event.eventSlug
          }
          open={lifecycleDialog}
          onClose={closeLifecycleDialog}
          onReturnedToDraft={handleReturnedToDraft}
          onCancelled={handleRsvpCancelled}
        />
      ) : null}

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
    backgroundColor: color.canvas,
  },
  headerWrap: {
    paddingHorizontal: space[4],
  },
  headerRightRow: {
    flexDirection: "row",
    gap: space[1],
    alignItems: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
    gap: space[4],
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: space[6],
  },
  loadingText: {
    fontSize: 14,
    color: color.text3,
    textAlign: "center",
  },
  goingLabel: {
    ...type.h1,
    color: color.text1,
  },
  goingSub: {
    ...type.caption,
    color: color.text3,
    marginTop: 2,
  },
  colStack: {
    gap: space[4],
  },
  tileRows: {
    gap: space[3],
  },
  tileRow: {
    flexDirection: "row",
    gap: space[3],
  },
  tilePad: {
    flexBasis: 0,
    flexGrow: 1,
  },
  sectionLabel: {
    ...type.label,
    textTransform: "uppercase",
    color: color.text3,
    marginTop: space[2],
  },
  lifecycleCtaWrap: {
    marginTop: space[1],
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
