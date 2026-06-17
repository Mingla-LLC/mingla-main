/**
 * /event/[id]/edit — wizard resume entry (J-E4).
 *
 * Reads dynamic `id` segment + optional `?step=N` query param. Resolves
 * draft via useDraftEventStore.getDraft(id). When draft exists →
 * renders EventCreatorWizard at the requested step (or
 * draft.lastStepReached if no step query). When draft NOT found →
 * bounces to /(tabs)/home.
 *
 * Format-agnostic ID resolver per Cycle 2 invariant I-11.
 * Host-bg cascade per Cycle 2 invariant I-12 (the wizard sets it
 * itself, but the redirect-state View also honours it).
 *
 * Per Cycle 3 spec §3.5 route 2.
 */

import React, { useEffect, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { Spinner } from "../../../src/components/ui/Spinner";
import { Toast } from "../../../src/components/ui/Toast";
import { Button } from "../../../src/components/ui/Button";
import {
  EventCreatorWizard,
  type WizardExitMode,
} from "../../../src/components/event/EventCreatorWizard";
import { EditPublishedScreen } from "../../../src/components/event/EditPublishedScreen";
import { useBrandList } from "../../../src/store/currentBrandStore";
import {
  useDraftById,
  useDraftEventStore,
  type DraftEvent,
} from "../../../src/store/draftEventStore";
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import {
  eventDraftKeys,
  useDiscardServerDraft,
  useServerDraftAutosave,
  useServerDraftById,
} from "../../../src/hooks/useServerDraftEvents";
import {
  useBusinessEventById,
  usePublishBusinessEventDraft,
} from "../../../src/hooks/useBusinessEvents";
import { createServerDraft } from "../../../src/services/eventDrafts";
import { useAuth } from "../../../src/context/AuthContext";
import { isBusinessAuthNotReadyError } from "../../../src/utils/authReadiness";
// ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave]:
// the migration from a client `d_<ts36>` id to a server-issued id is now
// triggered by the first dirty autosave, not on route mount. Pure helper.
import { isDraftDirty } from "../../../src/utils/draftDirtyCheck";

const isLocalOnlyDraft = (draft: DraftEvent): boolean =>
  draft.id.startsWith("d_") || draft.serverSlug === null;

const safeEventsExitRoute = (): "/home#hub-events" | "/(tabs)/hub/events" =>
  Platform.OS === "web" ? "/home#hub-events" : "/(tabs)/hub/events";

const MISSING_DRAFT_TIMEOUT_MS = 6000;

export default function EventEditRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    id: string | string[];
    step?: string | string[];
    mode?: string | string[];
  }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const stepParam = Array.isArray(params.step) ? params.step[0] : params.step;
  const modeParam = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  // Cycle 9b-2: when ?mode=edit-published, render the focused
  // EditPublishedScreen instead of the create wizard. The id refers to
  // a LIVE event, not a draft.
  const isEditPublished = modeParam === "edit-published";
  const isLegacyLocalDraftId =
    typeof idParam === "string" && idParam.startsWith("d_");
  const { isAuthReady } = useAuth();

  const initialStep = useMemo<number | undefined>(() => {
    if (stepParam === undefined || stepParam.length === 0) return undefined;
    const n = parseInt(stepParam, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [stepParam]);

  // Edit-published path: resolve LiveEvent.
  const liveEvent = useLiveEventStore((s) => {
    if (!isEditPublished) return null;
    if (typeof idParam !== "string" || idParam.length === 0) return null;
    return s.events.find((e) => e.id === idParam) ?? null;
  });
  // Create/draft path: resolve DraftEvent.
  const draft = useDraftById(
    !isEditPublished && typeof idParam === "string" ? idParam : null,
  );
  const serverDraftQuery = useServerDraftById(
    !isEditPublished && typeof idParam === "string" && !isLegacyLocalDraftId
      ? idParam
      : null,
  );
  const serverDraftSettled =
    isAuthReady &&
    !isLegacyLocalDraftId &&
    !serverDraftQuery.isLoading &&
    !serverDraftQuery.isFetching &&
    !serverDraftQuery.isError;
  const staleServerDraft =
    !isEditPublished &&
    draft !== null &&
    !draft.id.startsWith("d_") &&
    serverDraftSettled &&
    serverDraftQuery.data === null;
  const businessEventQuery = useBusinessEventById(
    typeof idParam === "string" && (isEditPublished || staleServerDraft)
      ? idParam
      : null,
  );
  const serverLiveEvent = businessEventQuery.data?.event ?? null;
  const resolvedLiveEvent = serverLiveEvent ?? liveEvent;
  const autosave = useServerDraftAutosave();
  const discardServerDraft = useDiscardServerDraft();
  const publishServerDraft = usePublishBusinessEventDraft();
  const replaceDraft = useDraftEventStore((s) => s.replaceDraft);
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const migratingLegacyIdRef = React.useRef<string | null>(null);
  const staleRecoveryDraftIdRef = React.useRef<string | null>(null);
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (isEditPublished) {
      if (businessEventQuery.data?.brand !== undefined) {
        return businessEventQuery.data.brand;
      }
      if (resolvedLiveEvent === null) return null;
      return brands.find((b) => b.id === resolvedLiveEvent.brandId) ?? null;
    }
    if (draft === null) return null;
    return brands.find((b) => b.id === draft.brandId) ?? null;
  }, [isEditPublished, businessEventQuery.data?.brand, resolvedLiveEvent, draft, brands]);

  const [toast, setToast] = React.useState<{ visible: boolean; message: string }>(
    { visible: false, message: "" },
  );
  const [missingDraftTimedOut, setMissingDraftTimedOut] = React.useState(false);

  useEffect(() => {
    if (isEditPublished || draft !== null) {
      setMissingDraftTimedOut(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setMissingDraftTimedOut(true);
      console.warn("[event/edit] missing-draft-timeout", { idParam });
    }, MISSING_DRAFT_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, [draft, idParam, isEditPublished]);

  useEffect(() => {
    // ORCH-0893: the previous eager `d_<ts36>` → server-draft migration on
    // mount has moved into the autosave wrapper below (gated on
    // `isDraftDirty`). Untouched client-only drafts no longer insert a
    // ghost row on mount.
    if (typeof idParam !== "string" || idParam.length === 0) {
      router.replace(safeEventsExitRoute() as never);
      return;
    }
    if (isEditPublished) {
      if (
        liveEvent !== null &&
        liveEvent.id.startsWith("le_") &&
        liveEvent.serverEventId !== null
      ) {
        router.replace(
          `/event/${liveEvent.serverEventId}/edit?mode=edit-published` as never,
        );
        return undefined;
      }
      if (resolvedLiveEvent === null && !businessEventQuery.isLoading) {
        // Published event not found — bounce to events tab.
        const t = setTimeout(() => {
          router.replace(safeEventsExitRoute() as never);
        }, 0);
        return (): void => clearTimeout(t);
      }
      return undefined;
    }
    if (staleServerDraft) {
      if (businessEventQuery.isLoading || businessEventQuery.isFetching) {
        return undefined;
      }
      if (staleRecoveryDraftIdRef.current === draft.id) {
        return undefined;
      }
      staleRecoveryDraftIdRef.current = draft.id;
      const recoveryRoute =
        businessEventQuery.data?.event !== undefined
          ? `/event/${draft.id}/edit?mode=edit-published`
          : safeEventsExitRoute();
      deleteDraft(draft.id);
      queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) });
      queryClient.setQueryData<DraftEvent[]>(
        eventDraftKeys.list(draft.brandId),
        (prev) => (prev ?? []).filter((d) => d.id !== draft.id),
      );
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
      setToast({
        visible: true,
        message: "This draft is no longer editable.",
      });
      router.replace(recoveryRoute as never);
      return undefined;
    }
    if (staleRecoveryDraftIdRef.current === idParam) {
      return undefined;
    }
    if (!isAuthReady) {
      return undefined;
    }
    if (
      draft === null &&
      !serverDraftQuery.isLoading &&
      !serverDraftQuery.isFetching
    ) {
      // ORCH-0893 cycle 2 safety belt — before bouncing home for a
      // missing d_<ts36> id, check if any cached brand-drafts list
      // contains a server draft whose `legacyLocalDraftId === idParam`.
      // This catches the case where some other migration path (the
      // legacy loop in useServerDraftEvents.ts:86-142, or a parallel
      // tab) swapped d_* → server uuid out from under us. Without this
      // safety belt, the user sees "wizard shows up then immediately
      // closes" instead of landing on their server-backed draft.
      if (isLegacyLocalDraftId && typeof idParam === "string") {
        const allDraftLists = queryClient.getQueriesData<DraftEvent[]>({
          queryKey: eventDraftKeys.lists(),
        });
        for (const [, drafts] of allDraftLists) {
          if (!Array.isArray(drafts)) continue;
          const swapped = drafts.find(
            (d) =>
              (d as DraftEvent & { legacyLocalDraftId?: string })
                .legacyLocalDraftId === idParam,
          );
          if (swapped !== undefined) {
            router.replace(
              `/event/${swapped.id}/edit?step=${initialStep ?? 0}` as never,
            );
            return undefined;
          }
        }
      }
      // Draft not found — use the same static-safe recovery surface as the
      // timed-out branch on web, rather than routing phone browsers into the
      // full tabs Home route.
      const t = setTimeout(() => {
        if (Platform.OS === "web") {
          setMissingDraftTimedOut(true);
          return;
        }
        router.replace(safeEventsExitRoute() as never);
      }, 0);
      return (): void => clearTimeout(t);
    }
    return undefined;
  }, [
    idParam,
    isEditPublished,
    isLegacyLocalDraftId,
    isAuthReady,
    initialStep,
    draft,
    liveEvent,
    resolvedLiveEvent,
    businessEventQuery.isLoading,
    businessEventQuery.isFetching,
    businessEventQuery.data?.event,
    router,
    deleteDraft,
    queryClient,
    serverDraftQuery.isFetching,
    serverDraftQuery.isError,
    serverDraftQuery.isLoading,
    serverDraftQuery.data,
    staleServerDraft,
  ]);

  const isCreateMode = useMemo<boolean>(() => {
    if (draft === null) return false;
    // First-time edit: lastStepReached is 0 AND name is empty AND no fields filled.
    return draft.lastStepReached === 0 && draft.name.length === 0;
  }, [draft]);

  // ORCH-1150 — inverse wrong-wizard guard (SPEC §4.6). Mirrors the RSVP route's
  // guard (app/rsvp/[id]/edit.tsx): an /event/[id]/edit URL pointed at an RSVP
  // draft (isRsvp=true) redirects to the RSVP wizard. Belt-and-suspenders for a
  // stale/hand-typed URL or a routing miss — the route IS the discriminator.
  useEffect(() => {
    if (isEditPublished || draft === null) return;
    if (draft.isRsvp === true) {
      router.replace(
        `/rsvp/${draft.id}/edit?step=${initialStep ?? 0}` as never,
      );
    }
  }, [draft, isEditPublished, initialStep, router]);

  const handleExit = React.useCallback(
    (
      mode: WizardExitMode,
      ctx?: {
        name?: string;
        slug?: { brandSlug: string; eventSlug: string };
      },
    ): void => {
      if (mode === "published") {
        const name = ctx?.name ?? "Event";
        setToast({ visible: true, message: `${name} is live.` });
        // Cycle 6 — route to the new public event page when slug is
        // provided. Falls back to home tab when slug missing (e.g.
        // pre-Cycle-6 draft or publish-failed-but-flagged-published).
        if (ctx?.slug !== undefined) {
          router.replace(
            `/e/${ctx.slug.brandSlug}/${ctx.slug.eventSlug}` as never,
          );
        } else {
          router.replace(safeEventsExitRoute() as never);
        }
      } else {
        // Discarded / abandoned (chrome X close) — route to Events tab
        // so the founder lands where they can see drafts + start a new
        // event easily, per founder UX directive.
        if (mode === "discarded") {
          setToast({ visible: true, message: "Draft discarded." });
        }
        router.replace(safeEventsExitRoute() as never);
      }
    },
    [router],
  );

  const handleOpenPreview = React.useCallback((): void => {
    if (draft === null) return;
    router.push(`/event/${draft.id}/preview` as never);
  }, [draft, router]);

  const handleOpenStripe = React.useCallback((): void => {
    if (draft === null) return;
    router.push(`/brand/${draft.brandId}/payments/onboard` as never);
  }, [draft, router]);

  const handleDiscardDraft = React.useCallback(
    async (draftToDiscard: DraftEvent): Promise<void> => {
      if (isLocalOnlyDraft(draftToDiscard)) {
        deleteDraft(draftToDiscard.id);
        return;
      }
      await discardServerDraft.discardDraft(draftToDiscard);
    },
    [deleteDraft, discardServerDraft],
  );

  // ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave]:
  // route-owned autosave wrapper. Three branches:
  //   (a) `d_<ts36>` id + dirty → lazy-insert server draft via
  //       `createServerDraft`, then `replaceDraft` swaps the client id
  //       for the server id in Zustand, then `router.replace` updates
  //       the URL without unmounting the wizard.
  //   (b) `d_<ts36>` id + NOT dirty → no save. Prevents ghost-draft row
  //       accumulation when the user backs out before typing.
  //   (c) server id → existing `autosave.saveDraft` path.
  //
  // `migratingLegacyIdRef` dedupes concurrent migration attempts during
  // the 800ms debounce window — only one `createServerDraft` is in flight
  // for a given `d_*` id.
  const handleAutosaveDraft = React.useCallback(
    (incoming: DraftEvent): void => {
      if (!incoming.id.startsWith("d_")) {
        autosave.saveDraft(incoming);
        return;
      }
      if (!isDraftDirty(incoming)) return;
      if (migratingLegacyIdRef.current === incoming.id) return;
      if (!isAuthReady) return;
      migratingLegacyIdRef.current = incoming.id;
      void createServerDraft(incoming.brandId, incoming)
        .then((serverDraft) => {
          // ORCH-0893 REWORK Part B — live-state merge race-guard.
          // Between the createServerDraft call (which echoes the
          // queue-time snapshot of `incoming`) and this resolve,
          // the user may have continued typing into the d_<ts36>
          // draft. Those keystrokes landed in Zustand against the
          // OLD d_* id. A naive replaceDraft(d_id, serverDraft)
          // would overwrite them with the queue-time snapshot.
          //
          // Fix: re-read the live draft from Zustand at resolve
          // time and merge user-meaningful fields from the live
          // state into the serverDraft payload before the swap.
          // Server-issued fields (id, slug, created_by, server
          // timestamps) stay from serverDraft; user fields stay
          // from the live snapshot.
          const liveDraft = useDraftEventStore
            .getState()
            .getDraft(incoming.id);
          const mergedServerDraft = liveDraft
            ? {
                ...serverDraft,
                name: liveDraft.name,
                description: liveDraft.description,
                coverMediaUrl: liveDraft.coverMediaUrl,
                coverMediaType: liveDraft.coverMediaType,
                coverMediaProvider: liveDraft.coverMediaProvider,
                coverMediaSourceUrl: liveDraft.coverMediaSourceUrl,
                coverMediaCredit: liveDraft.coverMediaCredit,
                coverMediaCreditUrl: liveDraft.coverMediaCreditUrl,
                coverMediaAlt: liveDraft.coverMediaAlt,
                coverHue: liveDraft.coverHue,
                format: liveDraft.format,
                tickets: liveDraft.tickets,
                date: liveDraft.date,
                doorsOpen: liveDraft.doorsOpen,
                endsAt: liveDraft.endsAt,
                endsAtUtc: liveDraft.endsAtUtc,
                venueName: liveDraft.venueName,
                address: liveDraft.address,
                city: liveDraft.city,
                locationGeo: liveDraft.locationGeo,
                onlineUrl: liveDraft.onlineUrl,
                hideAddressUntilTicket: liveDraft.hideAddressUntilTicket,
                lastStepReached: Math.max(
                  liveDraft.lastStepReached,
                  serverDraft.lastStepReached,
                ),
                partyTypes: liveDraft.partyTypes,
                vibeTags: liveDraft.vibeTags,
                musicGenres: liveDraft.musicGenres,
                whenMode: liveDraft.whenMode,
                multiDates: liveDraft.multiDates,
                recurrenceRule: liveDraft.recurrenceRule,
                timezone: liveDraft.timezone,
              }
            : serverDraft;
          replaceDraft(incoming.id, mergedServerDraft);
          queryClient.setQueryData(
            eventDraftKeys.detail(mergedServerDraft.id),
            mergedServerDraft,
          );
          router.replace(
            `/event/${mergedServerDraft.id}/edit?step=${initialStep ?? 0}` as never,
          );
        })
        .catch((error) => {
          migratingLegacyIdRef.current = null;
          if (isBusinessAuthNotReadyError(error)) {
            // Will retry on next dirty save once auth lands.
            return;
          }
          setToast({
            visible: true,
            message: "Couldn't save this draft. Tap Save again or check your connection.",
          });
        });
    },
    [
      autosave,
      isAuthReady,
      initialStep,
      queryClient,
      replaceDraft,
      router,
    ],
  );

  // Cycle 9b-2 edit-published branch — render the focused edit screen
  // when ?mode=edit-published. Loading shell while liveEvent resolves.
  if (isEditPublished) {
    if (resolvedLiveEvent === null) {
      return (
        <View
          style={[
            styles.host,
            { paddingTop: insets.top, backgroundColor: canvas.discover },
          ]}
        >
          <View style={styles.center}>
            <Spinner size={36} />
            <Text style={styles.label}>Loading…</Text>
          </View>
        </View>
      );
    }
    return (
      <EditPublishedScreen
        liveEvent={resolvedLiveEvent}
        disableLocalSaveReason={
          liveEvent === null
            ? "Server-loaded events are readable here. Full published-event editing needs the server edit mutation before saves are enabled."
            : undefined
        }
      />
    );
  }

  if (draft === null && missingDraftTimedOut) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.recoveryCard}>
          <Text style={styles.recoveryTitle}>We could not load this draft.</Text>
          <Text style={styles.recoveryBody}>
            Refresh, return to Home, or use desktop/the app if this phone browser cannot restore the draft.
          </Text>
          <Button
            label="Back to Home"
            onPress={() => router.replace(safeEventsExitRoute() as never)}
            fullWidth
            size="md"
            shape="square"
          />
        </View>
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast((p) => ({ ...p, visible: false }))}
        />
      </View>
    );
  }

  if (draft === null) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.center}>
          <Spinner size={36} />
          <Text style={styles.label}>Loading…</Text>
        </View>
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast((p) => ({ ...p, visible: false }))}
        />
      </View>
    );
  }

  if (staleServerDraft) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.center}>
          <Spinner size={36} />
          <Text style={styles.label}>Recovering event…</Text>
        </View>
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast((p) => ({ ...p, visible: false }))}
        />
      </View>
    );
  }

  return (
    <EventCreatorWizard
      draft={draft}
      brand={brand}
      initialStep={initialStep}
      isCreateMode={isCreateMode}
      onExit={handleExit}
      onOpenPreview={handleOpenPreview}
      onOpenStripeOnboard={handleOpenStripe}
      onAutosaveDraft={handleAutosaveDraft}
      onDiscardServerDraft={handleDiscardDraft}
      onPublishDraft={async (draftToPublish) => {
        const published = await publishServerDraft.publishDraft(draftToPublish);
        return {
          brandSlug: published.brand.slug,
          eventSlug: published.event.eventSlug,
        };
      }}
      serverSaveState={{
        isSaving:
          autosave.isSaving ||
          discardServerDraft.isPending ||
          publishServerDraft.isPending,
        hasError: autosave.hasError || serverDraftQuery.isError,
        lastSavedAt: autosave.lastSavedAt,
      }}
    />
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  label: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  recoveryCard: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  recoveryTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  recoveryBody: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
});
