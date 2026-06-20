/**
 * ORCH-1150 — /rsvp/[id]/edit — RSVP wizard resume + edit-published entry.
 *
 * Clone of /event/[id]/edit. Resolves the draft via useDraftById; mounts
 * RsvpCreatorWizard at the requested step. Publish routes through the RSVP
 * publish RPC (NEVER the event publish RPC). A wrong-wizard guard redirects a
 * ticketed (isRsvp=false) draft to /event/[id]/edit (SPEC §4.6).
 *
 * The ?mode=edit-published path mounts the RSVP-aware EditPublishedScreen
 * (rsvpMode), which drops the Tickets section + refund gate (SPEC §12).
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
  RsvpCreatorWizard,
  type WizardExitMode,
} from "../../../src/components/rsvp/RsvpCreatorWizard";
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
import { useBusinessEventById } from "../../../src/hooks/useBusinessEvents";
import { usePublishRsvpDraft } from "../../../src/hooks/useRsvpEvents";
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

export default function RsvpEditRoute(): React.ReactElement {
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
  // ORCH-1172 R4 — has the server-event fetch genuinely SETTLED for this edit
  // session? React-Query reports a DISABLED query (enabled = isAuthReady &&
  // eventId) as isLoading=false, so gate on isAuthReady too. Settled means: auth
  // is ready, and the query is neither in its initial load nor refetching.
  const serverEventSettled =
    isAuthReady &&
    !businessEventQuery.isLoading &&
    !businessEventQuery.isFetching;
  // ORCH-1172 R4 — the live event the editor SEEDS from. For the edit-published
  // path the seed MUST come from the FRESH server event, never the stale zustand
  // mirror: the editor seeds its local editState ONCE on mount, so a stale
  // zustand `liveEvent` (e.g. discoverable=false from a pre-edit snapshot) would
  // be baked into editState and then diff-clobber the true server value on save.
  // Therefore for edit-published: prefer `serverLiveEvent`; fall back to the
  // zustand `liveEvent` ONLY once the server fetch has SETTLED and genuinely
  // returned null (event not found / offline). While the fetch is still in
  // flight the route renders the Loading shell below instead of mounting the
  // editor with the stale fallback. The non-edit-published (draft) path is
  // untouched. The route-level safe-exit guard keeps using `resolvedLiveEvent`.
  const editorLiveEvent = isEditPublished
    ? serverLiveEvent ?? (serverEventSettled ? liveEvent : null)
    : null;
  const resolvedLiveEvent = serverLiveEvent ?? liveEvent;
  const autosave = useServerDraftAutosave();
  const discardServerDraft = useDiscardServerDraft();
  const publishServerDraft = usePublishRsvpDraft();
  const replaceDraft = useDraftEventStore((s) => s.replaceDraft);
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const migratingLegacyIdRef = React.useRef<string | null>(null);
  const staleRecoveryDraftIdRef = React.useRef<string | null>(null);
  // ORCH-1150 (D-1) — retain the last resolved draft so the d_*→server migration
  // swap does NOT flash the `draft===null` Spinner (which remounts the wizard,
  // perceived as a "refresh" while typing the name). During an in-flight
  // migration the resolved `draft` momentarily goes null between
  // replaceDraft(d_*→server) + router.replace(newId) and useDraftById(newId)
  // resolving. We keep rendering the wizard against this retained draft until
  // the new id resolves. RSVP-route-only — the event route is byte-identical.
  const lastResolvedDraftRef = React.useRef<DraftEvent | null>(null);
  if (!isEditPublished && draft !== null) {
    lastResolvedDraftRef.current = draft;
    // The migration has landed once a real (non-d_*) server draft resolves —
    // clear the in-flight marker so the Spinner suppression below stops.
    if (
      !draft.id.startsWith("d_") &&
      migratingLegacyIdRef.current !== null &&
      migratingLegacyIdRef.current.startsWith("d_")
    ) {
      migratingLegacyIdRef.current = null;
    }
  }
  // ORCH-1150 (D-1) — true while the d_*→server promotion is mid-flight. Used to
  // hold the wizard mounted instead of bouncing to the draft-null Spinner.
  const migrationInFlight = migratingLegacyIdRef.current !== null;
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (isEditPublished) {
      if (businessEventQuery.data?.brand !== undefined) {
        return businessEventQuery.data.brand;
      }
      if (resolvedLiveEvent === null) return null;
      return brands.find((b) => b.id === resolvedLiveEvent.brandId) ?? null;
    }
    // ORCH-1150 (D-1) — fall back to the retained draft during the migration
    // swap so the brand stays resolved (brandId is identical across the swap)
    // and the wizard doesn't lose its brand mid-migration.
    const draftForBrand = draft ?? lastResolvedDraftRef.current;
    if (draftForBrand === null) return null;
    return brands.find((b) => b.id === draftForBrand.brandId) ?? null;
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
      console.warn("[rsvp/edit] missing-draft-timeout", { idParam });
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
          `/rsvp/${liveEvent.serverEventId}/edit?mode=edit-published` as never,
        );
        return undefined;
      }
      // ORCH-1150 (D-9) — gate the safe-exit so it fires ONLY when the live-
      // event lookup is genuinely exhausted: auth is ready AND the fetch has
      // settled (not loading, not fetching) AND the event is still null. The
      // bare `!isLoading` guard (mirrored from the ticketed event-edit) fired
      // during the `isAuthReady` flicker — React-Query reports a DISABLED query
      // (enabled = isAuthReady && eventId) as isLoading=false, so a fresh push
      // with an empty useLiveEventStore bounced a published RSVP before the
      // fetch ever ran. Adding isAuthReady + !isFetching makes the exit
      // strictly more conservative than today; it can never bounce earlier.
      // RSVP-route-only — the ticketed app/event/[id]/edit.tsx is NOT touched.
      if (
        isAuthReady &&
        resolvedLiveEvent === null &&
        !businessEventQuery.isLoading &&
        !businessEventQuery.isFetching
      ) {
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
          ? `/rsvp/${draft.id}/edit?mode=edit-published`
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
              `/rsvp/${swapped.id}/edit?step=${initialStep ?? 0}` as never,
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

  // ORCH-1150 (D-1) — the draft used for rendering. During the d_*→server
  // migration `draft` briefly resolves to null (the store entry is swapped from
  // the d_* id to the server id and the URL changes); rather than flash the
  // Spinner and remount the wizard, fall back to the last resolved draft so the
  // wizard stays mounted across the swap. Cover/name/all fields carry across
  // because replaceDraft preserves them (the migration merge in
  // handleAutosaveDraft copies them onto the server draft).
  const renderDraft: DraftEvent | null =
    draft ?? (migrationInFlight ? lastResolvedDraftRef.current : null);

  const isCreateMode = useMemo<boolean>(() => {
    if (renderDraft === null) return false;
    // First-time edit: lastStepReached is 0 AND name is empty AND no fields filled.
    return renderDraft.lastStepReached === 0 && renderDraft.name.length === 0;
  }, [renderDraft]);

  // ORCH-1150 — wrong-wizard guard (SPEC §4.6): an /rsvp/[id]/edit URL pointed
  // at a TICKETED draft (isRsvp=false) redirects to the event wizard, and
  // vice-versa (the event edit route does the inverse). The route IS the
  // discriminator; this is the safety belt for a hand-typed/stale URL.
  useEffect(() => {
    if (isEditPublished || draft === null) return;
    if (draft.isRsvp === false) {
      router.replace(
        `/event/${draft.id}/edit?step=${initialStep ?? 0}` as never,
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
        const name = ctx?.name ?? "Your RSVP";
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
    router.push(`/rsvp/${draft.id}/preview` as never);
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
                // ORCH-1150 — carry RSVP fields through the d_* → server swap so
                // in-flight RSVP-setup edits aren't dropped on the first save.
                isRsvp: liveDraft.isRsvp,
                rsvpCapacity: liveDraft.rsvpCapacity,
                rsvpAllowPlusOnes: liveDraft.rsvpAllowPlusOnes,
                rsvpPlusOnesMax: liveDraft.rsvpPlusOnesMax,
                rsvpWaitlistEnabled: liveDraft.rsvpWaitlistEnabled,
                rsvpApprovalMode: liveDraft.rsvpApprovalMode,
                rsvpDiscoverable: liveDraft.rsvpDiscoverable,
              }
            : serverDraft;
          replaceDraft(incoming.id, mergedServerDraft);
          queryClient.setQueryData(
            eventDraftKeys.detail(mergedServerDraft.id),
            mergedServerDraft,
          );
          router.replace(
            `/rsvp/${mergedServerDraft.id}/edit?step=${initialStep ?? 0}` as never,
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
  // ORCH-1172 R4 — mount the editor against `editorLiveEvent` (seed-from-fresh-
  // server-event), NOT `resolvedLiveEvent`. `editorLiveEvent` is null while the
  // server fetch is still in flight EVEN IF a stale zustand `liveEvent` exists,
  // so the Loading shell holds until the fresh row arrives and the editor never
  // mounts seeded with the stale mirror. Once settled it falls back to the
  // zustand mirror only when the server genuinely returned null (the safe-exit
  // effect then bounces to the events list).
  if (isEditPublished) {
    if (editorLiveEvent === null) {
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
        liveEvent={editorLiveEvent}
        // ORCH-1150 — RSVP edit-published: drop the Tickets section + the
        // sold-ticket refund gate; show the "N guests are going" notice (§12).
        rsvpMode
        // ORCH-1172 R4 — the disable gate keys off whether there is a LOCAL
        // (zustand) mirror to write through. The editor now seeds from the
        // server event, but the local-save gate is still correctly governed by
        // the presence of a zustand `liveEvent` (server-only RSVPs route through
        // biz_update_live_rsvp regardless — see EditPublishedScreen rsvpMode).
        disableLocalSaveReason={
          liveEvent === null
            ? "Server-loaded RSVPs are readable here. Full published editing needs the server edit mutation before saves are enabled."
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

  // ORCH-1150 (D-1) — suppress the draft-null Spinner DURING an in-flight
  // d_*→server migration when we still have the retained draft to render. This
  // is the visible "refresh"/remount Seth hit when typing the name: the swap
  // briefly nulled `draft`, flashed this Spinner, and remounted the wizard.
  // Keep the wizard mounted against `renderDraft` until the new id resolves.
  if (draft === null && !(migrationInFlight && renderDraft !== null)) {
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

  // ORCH-1150 (D-1) — render against `renderDraft` (the live draft, or the
  // retained draft during the migration swap). This is non-null here: the
  // draft-null Spinner branch only falls through when migrationInFlight &&
  // renderDraft !== null. The guard satisfies the type system.
  if (renderDraft === null) {
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
    <RsvpCreatorWizard
      draft={renderDraft}
      brand={brand}
      initialStep={initialStep}
      isCreateMode={isCreateMode}
      onExit={handleExit}
      onOpenPreview={handleOpenPreview}
      onOpenStripeOnboard={handleOpenStripe}
      onAutosaveDraft={handleAutosaveDraft}
      onDiscardServerDraft={handleDiscardDraft}
      onPublishDraft={async (draftToPublish) => {
        const published = await publishServerDraft.mutateAsync({
          draft: draftToPublish,
        });
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
