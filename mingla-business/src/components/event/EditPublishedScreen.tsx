/**
 * EditPublishedScreen — sectioned full edit-after-publish surface (ORCH-0704 v2).
 *
 * Replaces the narrow Cycle 9b-2 single-screen (description + coverHue
 * only) with a 6-section accordion that reuses the existing wizard step
 * body components via local edit state + the `StepBodyProps` contract.
 *
 * Sections (one expanded at a time):
 *   1. Basics    → CreatorStep1Basics
 *   2. When      → CreatorStep2When
 *   3. Where     → CreatorStep3Where
 *   4. Cover     → CreatorStep4Cover
 *   5. Tickets   → CreatorStep5Tickets (with editMode.soldCountByTier)
 *   6. Settings  → CreatorStep6Settings
 *   (Step 7 Preview is OMITTED — operator uses Cycle 9a Preview button.)
 *
 * Save flow:
 *   1. Validate every section (validateStep per CreatorStepN)
 *   2. Compute patch via editableDraftToPatch
 *   3. Empty patch → toast "No changes to save."
 *   4. Otherwise → ChangeSummaryModal opens with diffs + ticket diffs +
 *      severity + required reason input
 *   5. Modal Confirm → handleConfirmSave(reason) → 800ms processing →
 *      updateLiveEventFields(id, patch, soldCountCtx, reason)
 *   6. ok=true → toast "Saved. Live now." → router.back
 *   7. ok=false → reject dialog "Refund first" with "Open Orders" CTA
 *      (stub: routes Cycle-9c-toast until 9c builds Orders ledger)
 *
 * Keyboard handling: full Cycle 3 wizard pattern (Keyboard listeners +
 * dynamic paddingBottom + scrollToEnd via requestAnimationFrame).
 *
 * Per ORCH-0704 v2 spec §3.4.5 + §3.4.6.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Keyboard listener
// + state + auto-insets DELETED. useKeyboardIsVisible() preserves dock-hide.
// Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  useLiveEventStore,
  type EditableLiveEventFields,
  type LiveEvent,
  type UpdateLiveEventResult,
} from "../../store/liveEventStore";
import { buildSoldCountContextFromOrders } from "../../services/eventOrdersService";
import { refundAllEventOrders } from "../../services/orderRefundService";
import {
  computeRichFieldDiffs,
  computeTicketDiffs,
  classifySeverity,
  editableDraftToPatch,
  liveEventToEditableDraft,
  type FieldDiff,
  type TicketDiff,
} from "../../utils/liveEventAdapter";
import { validateLiveEventFieldUpdate } from "../../utils/publishedEventEditGuards";
import type { EditSeverity } from "../../store/eventEditLogStore";
import {
  validateStep,
  type ValidationError,
} from "../../utils/draftEventValidation";
import type { DraftEvent } from "../../store/draftEventStore";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Toast } from "../ui/Toast";

import { ChangeSummaryModal } from "./ChangeSummaryModal";
import { CreatorStep1Basics } from "./CreatorStep1Basics";
import { CreatorStep2When } from "./CreatorStep2When";
import { CreatorStep3Where } from "./CreatorStep3Where";
import { CreatorStep4Cover } from "./CreatorStep4Cover";
import { CreatorStep5Tickets } from "./CreatorStep5Tickets";
import { CreatorStep6Settings } from "./CreatorStep6Settings";
import { EditAfterPublishBanner } from "./EditAfterPublishBanner";

import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { canPerformAction } from "../../utils/permissionGates";
import {
  clearEventCover,
  EventCoverMediaError,
  setEventCover,
} from "../../services/eventCoverMediaService";
// ORCH-0824 hotfix (Option B): post-publish RPC for the 5 new taxonomy
// + city fields. Bridges the local-only EditPublishedScreen save flow to
// the events DB row so legacy events become Discover-eligible after edit.
import {
  patchPublishedEventPricingSwitches,
  patchPublishedEventTaxonomy,
  patchPublishedEventTheme,
  patchPublishedEventWhen,
} from "../../services/businessEvents";
import { businessEventKeys } from "../../hooks/useBusinessEvents";
import { publicEventKeys } from "../../hooks/usePublicEvents";
import {
  useEventHasWebPurchases,
  useEventReconciliation,
} from "../../hooks/useEventOrders";
import { ThemeEditorSection } from "../theme/ThemeEditorSection";

// ---- Section configuration -----------------------------------------

type SectionKey =
  | "basics"
  | "when"
  | "where"
  | "cover"
  | "visual"
  | "tickets"
  | "settings";

interface SectionConfig {
  key: SectionKey;
  label: string;
  /** Step index for `validateStep(N, draft)`. */
  stepIndex: number | null;
}

const SECTIONS: readonly SectionConfig[] = [
  { key: "basics", label: "Basics", stepIndex: 0 },
  { key: "when", label: "When", stepIndex: 1 },
  { key: "where", label: "Where", stepIndex: 2 },
  { key: "cover", label: "Cover", stepIndex: 3 },
  { key: "visual", label: "Visual", stepIndex: null },
  { key: "tickets", label: "Tickets", stepIndex: 4 },
  { key: "settings", label: "Settings", stepIndex: 5 },
];

const SAVE_PROCESSING_MS = 800;
const TOAST_NAV_DELAY_MS = 600;
// ORCH-1047 — iOS cannot present a second native Modal while the reason sheet
// (ChangeSummaryModal → Sheet → RN Modal) is still dismissing; the OS silently
// drops it. We therefore close the reason sheet, wait for its dismiss animation
// to finish, THEN present the "Refund first" reject dialog (ConfirmDialog → RN
// Modal) so it reliably appears instead of vanishing into a silent no-op.
const REJECT_DIALOG_HANDOFF_MS = 450;
const COVER_MEDIA_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "coverMediaUrl",
  "coverMediaType",
  "coverMediaProvider",
  "coverMediaSourceUrl",
  "coverMediaCredit",
  "coverMediaCreditUrl",
  "coverMediaAlt",
]);

// ORCH-0824 hotfix (Option B): keys whose patches now have a server-side
// mutation path via `business_patch_event_taxonomy` RPC. When the patch
// touches ONLY these (or these + cover media), the
// disableLocalSaveReason gate is lifted because the server side IS
// reachable. Any other field still triggers the gate because no server
// mutation exists for it.
const ORCH_0824_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "partyTypes",
  "vibeTags",
  "musicGenres",
  "city",
  "locationGeo",
  // ORCH-0824 hotfix-5: address re-picks via Google Places autocomplete
  // set address + city + locationGeo together. The patch RPC accepts a
  // p_location_text parameter that updates events.location_text.
  "address",
]);

// ORCH-0877 Path B: keys whose patches now have a server-side mutation
// path via the new `business_patch_event_when(uuid, jsonb, text, integer)`
// RPC. When the patch touches ONLY these (or these + cover media + ORCH-0824
// fields), the `disableLocalSaveReason` gate is lifted because the server
// side IS reachable. Closes the ORCH-0704 v2 Zustand-only save gap that
// silently kept post-publish When edits off buyers' phones.
const ORCH_0877_WHEN_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "whenMode",
  "date",
  "doorsOpen",
  "endsAt",
  "timezone",
  "recurrenceRule",
  "multiDates",
]);

const ORCH_0964_THEME_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "themeOverrides",
]);

// ORCH-1006: pricing switches have a server mutation path via
// patchPublishedEventPricingSwitches (direct events.pass_* write). Lifts the
// disableLocalSaveReason gate so a switch-only edit can save.
const ORCH_1006_PRICING_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "pricingSwitches",
]);

const SERVER_EDITABLE_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  ...COVER_MEDIA_PATCH_KEYS,
  ...ORCH_0824_PATCH_KEYS,
  ...ORCH_0877_WHEN_PATCH_KEYS,
  ...ORCH_0964_THEME_PATCH_KEYS,
  ...ORCH_1006_PRICING_PATCH_KEYS,
]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isCoverMediaOnlyPatch = (
  patch: Partial<EditableLiveEventFields>,
): boolean => {
  const keys = Object.keys(patch) as (keyof EditableLiveEventFields)[];
  return (
    keys.length > 0 &&
    keys.every((key) => COVER_MEDIA_PATCH_KEYS.has(key))
  );
};

// ORCH-0824 hotfix: patch contains only fields that have a server
// mutation path (cover media + ORCH-0824 taxonomy/city). Used to lift
// the disableLocalSaveReason gate for server-editable patches.
const isServerEditableOnlyPatch = (
  patch: Partial<EditableLiveEventFields>,
): boolean => {
  const keys = Object.keys(patch) as (keyof EditableLiveEventFields)[];
  return (
    keys.length > 0 &&
    keys.every((key) => SERVER_EDITABLE_PATCH_KEYS.has(key))
  );
};

// ---- Component ------------------------------------------------------

export interface EditPublishedScreenProps {
  liveEvent: LiveEvent;
  disableLocalSaveReason?: string;
}

interface ToastState {
  visible: boolean;
  message: string;
}

interface ModalState {
  visible: boolean;
  fieldDiffs: FieldDiff[];
  ticketDiffs?: TicketDiff[];
  severity: EditSeverity;
}

interface RejectDialogContent {
  title: string;
  body: string;
  primaryLabel: string;
  primaryAction: () => void;
  /** ORCH-1047 — schedule-with-sales reject uses a hold-to-confirm destructive
   * variant so "Refund all & change" can't be fat-fingered. Other rejects stay
   * the simple "Open Orders" dialog. */
  variant?: "simple" | "holdToConfirm";
  destructive?: boolean;
}

export const EditPublishedScreen: React.FC<EditPublishedScreenProps> = ({
  liveEvent,
  disableLocalSaveReason,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const updateLiveEventFields = useLiveEventStore(
    (s) => s.updateLiveEventFields,
  );

  // ---- Local edit state (transient — never persisted to draftEventStore) ----
  const initialEditState = useMemo<DraftEvent>(
    () => liveEventToEditableDraft(liveEvent),
    [liveEvent],
  );
  const [editState, setEditState] = useState<DraftEvent>(initialEditState);

  // Currently expanded section (accordion — only one at a time)
  const [openSection, setOpenSection] = useState<SectionKey | null>("basics");
  const [showErrors, setShowErrors] = useState<boolean>(false);

  // Modal state — driven by save flow
  const [modal, setModal] = useState<ModalState>({
    visible: false,
    fieldDiffs: [],
    ticketDiffs: undefined,
    severity: "additive",
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [coverVideoProcessing, setCoverVideoProcessing] = useState<boolean>(false);

  // Reject dialog — driven by guard-rail rejections
  const [rejectDialog, setRejectDialog] = useState<RejectDialogContent | null>(
    null,
  );

  // Toast
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: "",
  });
  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  // ORCH-0892-B v2: keyboard listener + state DELETED. KAS via
  // SmartScrollView handles focused-input scroll. dock-hide preserved
  // via useKeyboardIsVisible(). scrollToBottom retained as passthrough
  // for child-callback compatibility (KAS refines focus-scroll on top).
  const keyboardVisible = useKeyboardIsVisible();
  const scrollViewRef = useRef<ScrollView | null>(null);

  const scrollToBottom = useCallback((): void => {
    requestAnimationFrame((): void => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  // ---- Sold-count context (server-backed) ----------------------------------
  // Was an ORCH-0704 stub that read the empty client order store and returned
  // zeros for server-loaded events, leaving the buyer-protection edit guards
  // blind (they let date moves / tier changes on sold events reach the server,
  // which then rejected with a bare toast). Now sourced from the live event
  // orders so validateLiveEventFieldUpdate reliably fires the "Refund first"
  // dialog. serverEventId === null → query disabled → empty (the server RPC
  // still backstops every structural change).
  const serverOrders = useEventReconciliation(liveEvent.serverEventId);
  const soldCountCtx = useMemo(
    () => buildSoldCountContextFromOrders(serverOrders),
    [serverOrders],
  );

  // Cycle 13a J-T6 G2: ticket price editability gated on EDIT_TICKET_PRICE
  // (finance_manager+). Hook ordering: runs every render before any early
  // return shell (ORCH-0710 lesson).
  const { rank: currentRank } = useCurrentBrandRole(liveEvent?.brandId ?? null);
  const canEditTicketPrice = canPerformAction(currentRank, "EDIT_TICKET_PRICE");

  // ---- Update handler — local state only ----
  const handleUpdateDraft = useCallback(
    (
      patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>,
    ): void => {
      setEditState((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  // ---- Per-section errors ----
  const sectionErrors = useMemo<Record<SectionKey, ValidationError[]>>(() => {
    const out: Record<SectionKey, ValidationError[]> = {
      basics: [],
      when: [],
      where: [],
      cover: [],
      visual: [],
      tickets: [],
      settings: [],
    };
    for (const sec of SECTIONS) {
      out[sec.key] =
        sec.stepIndex === null ? [] : validateStep(sec.stepIndex, editState);
    }
    return out;
  }, [editState]);

  // ---- Toggle section ----
  const handleToggleSection = useCallback(
    (key: SectionKey): void => {
      setOpenSection((prev) => (prev === key ? null : key));
    },
    [],
  );

  // ---- Diff computation ----
  const fieldDiffs = useMemo<FieldDiff[]>(
    () => computeRichFieldDiffs(liveEvent, editState),
    [liveEvent, editState],
  );
  const currentPatch = useMemo(
    () => editableDraftToPatch(liveEvent, editState),
    [liveEvent, editState],
  );
  // ORCH-0824 hotfix: allow Save through when the disable gate is set
  // AND the patch contains ONLY server-editable fields (cover media OR
  // ORCH-0824 taxonomy/city). Pre-ORCH-0824 this only allowed cover-only
  // patches; the new name reflects the broadened set.
  const canSaveServerCoverMediaOnly =
    disableLocalSaveReason !== undefined &&
    isServerEditableOnlyPatch(currentPatch);

  // ---- Save flow ----
  const handleSavePress = useCallback((): void => {
    if (coverVideoProcessing) {
      showToast("Wait for the cover video to finish processing first.");
      return;
    }
    // 1. Validate sections
    const hasErrors = SECTIONS.some(
      (sec) => sectionErrors[sec.key].length > 0,
    );
    if (hasErrors) {
      setShowErrors(true);
      // Open the first errored section so user sees inline errors
      const firstErrored = SECTIONS.find(
        (sec) => sectionErrors[sec.key].length > 0,
      );
      if (firstErrored !== undefined) {
        setOpenSection(firstErrored.key);
      }
      showToast("Fix the highlighted issues first.");
      return;
    }
    // 2. Compute patch
    const patch = currentPatch;
    if (Object.keys(patch).length === 0) {
      showToast("No changes to save.");
      return;
    }
    if (
      disableLocalSaveReason !== undefined &&
      !isServerEditableOnlyPatch(patch)
    ) {
      // ORCH-0824 hotfix: only block when the patch contains a field
      // with no server mutation path. Cover media OR ORCH-0824
      // taxonomy/city are now both routable through their respective
      // server endpoints, so they pass the gate.
      showToast(disableLocalSaveReason);
      return;
    }
    // 3. Compute ticket diffs (only if patch.tickets changed)
    const ticketDiffs =
      patch.tickets !== undefined
        ? computeTicketDiffs(liveEvent.tickets, editState.tickets)
        : undefined;
    // 4. Severity
    const severity = classifySeverity(
      Object.keys(patch) as Parameters<typeof classifySeverity>[0],
    );
    // 5. Open modal
    setModal({
      visible: true,
      fieldDiffs,
      ticketDiffs,
      severity,
    });
  }, [
    currentPatch,
    coverVideoProcessing,
    disableLocalSaveReason,
    editState,
    fieldDiffs,
    liveEvent.tickets,
    sectionErrors,
    showToast,
  ]);

  const invalidateServerEventCaches = useCallback((): void => {
    queryClient.invalidateQueries({
      queryKey: businessEventKeys.detail(liveEvent.id),
    });
    queryClient.invalidateQueries({
      queryKey: businessEventKeys.list(liveEvent.brandId),
    });
    queryClient.invalidateQueries({
      queryKey: publicEventKeys.detailById(liveEvent.id),
    });
    queryClient.invalidateQueries({
      queryKey: publicEventKeys.detailBySlug(
        liveEvent.brandSlug,
        liveEvent.eventSlug,
      ),
    });
    queryClient.invalidateQueries({
      queryKey: publicEventKeys.brandBySlug(liveEvent.brandSlug),
    });
  }, [
    liveEvent.brandId,
    liveEvent.brandSlug,
    liveEvent.eventSlug,
    liveEvent.id,
    queryClient,
  ]);

  // ORCH-1047 — captured reason for the "Refund all & proceed" path (the
  // reject dialog is presented after the reason sheet closes, so the reason
  // text must be stashed when the save is blocked).
  const reasonRef = useRef<string>("");

  // ORCH-1047 — "Refund all & proceed": refund every buyer for this event in
  // full, then re-apply the schedule change with the server's
  // acknowledge_sold_impact bypass. Operator-chosen partial-failure policy:
  // change anyway, and surface any buyer whose refund failed so they can be
  // refunded manually in Orders. This fires REAL refunds — it is only reachable
  // behind the hold-to-confirm destructive dialog.
  const runRefundAllAndProceed = useCallback(
    async (reason: string): Promise<void> => {
      setRejectDialog(null);
      if (liveEvent.serverEventId === null) {
        showToast("Can't change — this event is missing its server id.");
        return;
      }
      setSubmitting(true);
      const patch = currentPatch;
      try {
        const refund = await refundAllEventOrders(serverOrders, reason);
        // All-or-nothing (buyer protection): if ANY refund failed, do NOT change
        // the schedule — moving the event would strand the un-refunded buyers.
        // Abort, leave the schedule untouched, and report who still needs a
        // refund + the actual Stripe reason so the operator can act.
        if (refund.failed.length > 0) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          const names = refund.failed.map((f) => f.buyerName).join(", ");
          const why = refund.failed[0]?.error ?? "";
          showToast(
            `Refunds incomplete — ${refund.failed.length} failed (${names}). Schedule NOT changed. ${why}`.trim(),
          );
          return;
        }
        // Every buyer refunded → now it's safe to apply the schedule change.
        await patchPublishedEventWhen({
          eventId: liveEvent.serverEventId,
          whenPayload: {
            whenMode: patch.whenMode ?? liveEvent.whenMode,
            timezone: patch.timezone ?? liveEvent.timezone,
            when: {
              date: patch.date !== undefined ? patch.date : liveEvent.date,
              doorsOpen:
                patch.doorsOpen !== undefined
                  ? patch.doorsOpen
                  : liveEvent.doorsOpen,
              endsAt:
                patch.endsAt !== undefined ? patch.endsAt : liveEvent.endsAt,
            },
            multiDates:
              patch.multiDates !== undefined
                ? patch.multiDates
                : liveEvent.multiDates,
            recurrenceRule:
              patch.recurrenceRule !== undefined
                ? patch.recurrenceRule
                : liveEvent.recurrenceRule,
          },
          reason,
          clientRevision: null,
          acknowledgeSoldImpact: true,
        });
        invalidateServerEventCaches();
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        const okCount = refund.refundedOrderIds.length;
        showToast(
          `Refunded all ${okCount} buyer${okCount === 1 ? "" : "s"}. Schedule updated.`,
        );
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            // orch-strict-grep-allow route-by-event-type — events-only screen
            router.replace(`/event/${liveEvent.id}` as never);
          }
        }, TOAST_NAV_DELAY_MS);
      } catch (error) {
        setSubmitting(false);
        const code = error instanceof Error ? error.message : "save_failed";
        showToast(
          `Refunds attempted but the schedule change failed (${code}). Check Orders.`,
        );
      }
    },
    [
      currentPatch,
      invalidateServerEventCaches,
      liveEvent,
      router,
      serverOrders,
      showToast,
    ],
  );

  // ---- Map rejection result to dialog content ----
  const buildRejectDialog = useCallback(
    (result: Extract<UpdateLiveEventResult, { ok: false }>): RejectDialogContent => {
      const closeAndOpenOrders = (): void => {
        setRejectDialog(null);
        // Cycle 9c — Orders ledger now exists; navigate to it.
        // orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)
        router.push(`/event/${liveEvent.id}/orders` as never);
      };

      const closeOnly = (): void => setRejectDialog(null);

      // ORCH-1047 — schedule-with-sales: offer "Refund all & change" as a
      // hold-to-confirm destructive action. Per-order manual refunds remain
      // reachable from the event's Orders screen.
      const refundAllAndChange = (
        n: number,
        whatChanges: string,
      ): RejectDialogContent => ({
        title: "Refund all & change?",
        body: `${n} ${n === 1 ? "buyer has" : "buyers have"} tickets for this event. To ${whatChanges}, all ${n} ${n === 1 ? "buyer" : "buyers"} are refunded in full first — this is permanent. If any refund fails, nothing changes and you'll see who still needs refunding. Hold to confirm.`,
        primaryLabel: "Refund all & change",
        variant: "holdToConfirm",
        destructive: true,
        primaryAction: () => {
          void runRefundAllAndProceed(reasonRef.current);
        },
      });

      switch (result.reason) {
        case "event_not_found":
          return {
            title: "Couldn't find this event",
            body: "It may have been deleted. Tap back to return.",
            primaryLabel: "Back",
            primaryAction: () => {
              setRejectDialog(null);
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace(`/(tabs)/events` as never);
              }
            },
          };
        case "missing_edit_reason":
        case "invalid_edit_reason":
          return {
            title: "Reason needed",
            body: "Please enter a reason between 10 and 200 characters.",
            primaryLabel: "Got it",
            primaryAction: closeOnly,
          };
        case "capacity_below_sold": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `${n} ticket${n === 1 ? "" : "s"} sold for this tier. To drop capacity below ${n}, refund existing buyers first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "tier_delete_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `${n} ticket${n === 1 ? "" : "s"} sold for this tier. Refund all ${n} buyers before deleting.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "tier_price_change_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `Existing buyers are protected at the price they paid. Refund all ${n} buyers, then change the price (or add a new tier at the new price).`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "tier_free_toggle_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `Toggling free/paid for a sold tier requires refunding all ${n} existing buyers first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "multi_date_remove_with_sales":
          return refundAllAndChange(
            result.affectedOrderCount ?? 0,
            "change the dates",
          );
        case "time_change_with_sales":
          return refundAllAndChange(
            result.affectedOrderCount ?? 0,
            "change the time",
          );
        case "when_mode_drops_active_date":
          return refundAllAndChange(
            result.affectedOrderCount ?? 0,
            "change the schedule",
          );
        case "recurrence_drops_occurrence":
          return refundAllAndChange(
            result.affectedOrderCount ?? 0,
            "change the recurrence",
          );
        default: {
          const _exhaust: never = result.reason;
          return _exhaust;
        }
      }
    },
    [liveEvent.id, router, runRefundAllAndProceed],
  );

  const handleConfirmSave = useCallback(
    async (reason: string): Promise<void> => {
      if (submitting) return;
      // ORCH-1047 — stash the reason so "Refund all & proceed" (fired from the
      // deferred reject dialog) can reuse it for the refunds + re-save.
      reasonRef.current = reason;
      setSubmitting(true);
      await sleep(SAVE_PROCESSING_MS);
      const patch = currentPatch;
      const validation = validateLiveEventFieldUpdate(
        liveEvent,
        patch,
        soldCountCtx,
        reason,
      );
      if (!validation.ok) {
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        // Defer so the reject dialog isn't dropped while the reason sheet is
        // still dismissing on iOS (see REJECT_DIALOG_HANDOFF_MS).
        const pendingReject = buildRejectDialog(validation);
        setTimeout(() => setRejectDialog(pendingReject), REJECT_DIALOG_HANDOFF_MS);
        return;
      }
      const explicitCoverSet =
        patch.coverMediaUrl !== undefined && patch.coverMediaUrl !== null;
      const explicitCoverClear = patch.coverMediaUrl === null;
      const metadataOnlyPatch =
        patch.coverMediaUrl === undefined &&
        (patch.coverMediaType !== undefined ||
          patch.coverMediaProvider !== undefined ||
          patch.coverMediaSourceUrl !== undefined ||
          patch.coverMediaCredit !== undefined ||
          patch.coverMediaCreditUrl !== undefined ||
          patch.coverMediaAlt !== undefined);
      if (explicitCoverSet || explicitCoverClear) {
        if (liveEvent.serverEventId === null) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast("Save failed because this event is missing its server id.");
          return;
        }
        try {
          if (explicitCoverClear) {
            await clearEventCover(liveEvent.serverEventId);
          } else {
            const mediaUrl = patch.coverMediaUrl as string;
            const mediaType = patch.coverMediaType ?? liveEvent.coverMediaType;
            if (mediaType === null || mediaType === undefined) {
              throw new EventCoverMediaError(
                "upload_failed",
                "Cover save failed: media type is missing.",
              );
            }
            await setEventCover(liveEvent.serverEventId, mediaUrl, mediaType, {
              provider:
                patch.coverMediaProvider !== undefined
                  ? patch.coverMediaProvider
                  : liveEvent.coverMediaProvider ?? null,
              sourceUrl:
                patch.coverMediaSourceUrl !== undefined
                  ? patch.coverMediaSourceUrl
                  : liveEvent.coverMediaSourceUrl ?? null,
              credit:
                patch.coverMediaCredit !== undefined
                  ? patch.coverMediaCredit
                  : liveEvent.coverMediaCredit ?? null,
              creditUrl:
                patch.coverMediaCreditUrl !== undefined
                  ? patch.coverMediaCreditUrl
                  : liveEvent.coverMediaCreditUrl ?? null,
              alt:
                patch.coverMediaAlt !== undefined
                  ? patch.coverMediaAlt
                  : liveEvent.coverMediaAlt ?? null,
            });
          }
        } catch (error) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          if (error instanceof EventCoverMediaError) {
            if (error.code === "persist_mismatch") {
              showToast(
                "Save succeeded but the cover did not persist. Refresh and try again.",
              );
            } else {
              showToast("Cover upload failed. Try again.");
            }
          } else {
            showToast("Could not save cover media. Try again.");
          }
          return;
        }
      } else if (metadataOnlyPatch) {
        console.warn(
          "[ORCH-0978]",
          "metadata-only cover patch skipped (no coverMediaUrl change)",
          {
            patchKeys: Object.keys(patch).filter((key) =>
              key.startsWith("coverMedia"),
            ),
          },
        );
      }
      // ORCH-0824 hotfix (Option B): if the patch touches any of the 5
      // ORCH-0824 fields, push them to the events row via the post-publish
      // RPC BEFORE the unified server-editable early-return. Server
      // failure aborts; local stays in sync with the DB. This is the only
      // field-set in EditPublishedScreen (besides cover media) that has a
      // server-side propagation path.
      const taxonomyPatchPresent =
        patch.city !== undefined ||
        patch.partyTypes !== undefined ||
        patch.vibeTags !== undefined ||
        patch.musicGenres !== undefined ||
        patch.locationGeo !== undefined ||
        // ORCH-0824 hotfix-5: address re-picks (via Google Places) flow
        // through the same patch RPC.
        patch.address !== undefined;
      if (taxonomyPatchPresent) {
        if (liveEvent.serverEventId === null) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast(
            "Save failed because this event is missing its server id.",
          );
          return;
        }
        // Compose final values: patch keys win, else fall through to the
        // original LiveEvent values. `!== undefined` (not nullish) so an
        // explicit null clear (e.g. user clears autocomplete) is honored.
        const finalCity =
          patch.city !== undefined ? patch.city : liveEvent.city ?? null;
        const finalPartyTypes =
          patch.partyTypes ?? liveEvent.partyTypes ?? [];
        const finalVibeTags =
          patch.vibeTags ?? liveEvent.vibeTags ?? [];
        const finalMusicGenres =
          patch.musicGenres ?? liveEvent.musicGenres ?? [];
        const finalLocationGeo =
          patch.locationGeo !== undefined
            ? patch.locationGeo
            : liveEvent.locationGeo ?? null;
        // ORCH-0824 hotfix-5: send formatted address only when it
        // changed. Null tells the RPC "leave location_text alone."
        const finalLocationText =
          patch.address !== undefined ? patch.address : null;

        try {
          await patchPublishedEventTaxonomy({
            eventId: liveEvent.serverEventId,
            city: finalCity ?? "",
            partyTypes: finalPartyTypes,
            vibeTags: finalVibeTags,
            musicGenres: finalMusicGenres,
            locationGeo: finalLocationGeo,
            locationText: finalLocationText,
          });
          // Invalidate any cached business-event reads so a re-open of
          // this event sees the freshly-written DB row.
          invalidateServerEventCaches();
        } catch (error) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          const code =
            error instanceof Error ? error.message : "patch_failed";
          // Map RPC error codes to user-friendly copy. Unknown codes fall
          // back to a generic retry message — never blame the user.
          const message =
            code === "city_required"
              ? "Pick the venue address from the suggestions so we have a city."
              : code === "party_types_required"
                ? "Pick at least one party type before saving."
                : code === "party_types_not_canonical" ||
                    code === "vibe_tags_not_canonical" ||
                    code === "music_genres_not_canonical"
                  ? "One of the selected tags is no longer supported. Pick again."
                  : code === "insufficient_event_permission"
                    ? "You don't have permission to edit this event."
                    : code === "event_not_editable_status"
                      ? "This event can't be edited (it may be ended or cancelled)."
                      : "Couldn't save your changes. Tap to try again.";
          showToast(message);
          return;
        }
      }

      // ORCH-0877 (Path B) — When-section edits route through the new
      // `business_patch_event_when` RPC BEFORE both the unified server-
      // editable early-return AND the local Zustand mutation, so the
      // server-side event_dates row is rewritten and buyers see the
      // corrected times. Mirrors the placement of cover-media + ORCH-0824
      // taxonomy blocks above. Closes the ORCH-0704 v2 Zustand-only gap.
      // Server-success-then-local pattern: RPC failure aborts; local
      // updateLiveEventFields runs only after the server commit succeeds
      // so the audit log + notification stack stay in sync with the DB.
      const whenPatchPresent =
        patch.whenMode !== undefined ||
        patch.date !== undefined ||
        patch.doorsOpen !== undefined ||
        patch.endsAt !== undefined ||
        patch.timezone !== undefined ||
        patch.recurrenceRule !== undefined ||
        patch.multiDates !== undefined;
      if (whenPatchPresent) {
        if (liveEvent.serverEventId === null) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast(
            "Save failed because this event is missing its server id.",
          );
          return;
        }
        // Build the When payload by composing patch keys over the live
        // event values. Patch wins on every When field; falls through to
        // live values for fields the operator didn't touch.
        const finalWhenMode = patch.whenMode ?? liveEvent.whenMode;
        const finalTimezone = patch.timezone ?? liveEvent.timezone;
        const finalDate = patch.date !== undefined ? patch.date : liveEvent.date;
        const finalDoorsOpen =
          patch.doorsOpen !== undefined ? patch.doorsOpen : liveEvent.doorsOpen;
        const finalEndsAt =
          patch.endsAt !== undefined ? patch.endsAt : liveEvent.endsAt;
        const finalRecurrenceRule =
          patch.recurrenceRule !== undefined
            ? patch.recurrenceRule
            : liveEvent.recurrenceRule;
        const finalMultiDates =
          patch.multiDates !== undefined
            ? patch.multiDates
            : liveEvent.multiDates;

        try {
          await patchPublishedEventWhen({
            eventId: liveEvent.serverEventId,
            whenPayload: {
              whenMode: finalWhenMode,
              timezone: finalTimezone,
              when: {
                date: finalDate,
                doorsOpen: finalDoorsOpen,
                endsAt: finalEndsAt,
              },
              multiDates: finalMultiDates,
              recurrenceRule: finalRecurrenceRule,
            },
            reason: validation.trimmedReason,
            clientRevision: null,
          });
          invalidateServerEventCaches();
        } catch (error) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          const code =
            error instanceof Error ? error.message : "patch_event_when_failed";
          const message =
            code === "missing_edit_reason" || code === "invalid_edit_reason"
              ? "Add a brief reason (10–200 characters) for this change."
              : code === "insufficient_event_permission"
                ? "You don't have permission to edit this event."
                : code === "event_not_editable_status"
                  ? "This event can't be edited — it may be ended or cancelled."
                  : code === "event_deleted"
                    ? "This event was deleted."
                    : code === "event_date_required"
                      ? "Set the event date before saving."
                      : code === "event_end_must_differ_from_start"
                        ? "End time must differ from start time."
                        : code === "when_mode_drops_active_date" ||
                            code === "recurrence_drops_occurrence" ||
                            code === "multi_date_remove_with_sales"
                          ? "This change would drop a date with active tickets. Cancel or refund those tickets first."
                          : code === "schedule_change_with_sales"
                            ? "This event has sold tickets. Refund those buyers before changing its time."
                          : code === "stale_client_revision" ||
                              code === "event_not_editable_race"
                            ? "Someone else updated this event. Tap to reload."
                            : "Couldn't save your changes. Tap to try again.";
          showToast(message);
          return;
        }
      }

      const themePatchPresent = patch.themeOverrides !== undefined;
      if (themePatchPresent) {
        if (liveEvent.serverEventId === null) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast(
            "Save failed because this event is missing its server id.",
          );
          return;
        }
        try {
          await patchPublishedEventTheme({
            eventId: liveEvent.serverEventId,
            themeOverrides: patch.themeOverrides ?? null,
          });
          invalidateServerEventCaches();
        } catch {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast("Couldn't save the public theme. Tap to try again.");
          return;
        }
      }

      // ORCH-1006 — "Who covers the costs?" switches route through a direct
      // events.pass_* write (patchPublishedEventPricingSwitches), like the
      // theme block above. Server-success-then-local so caches + audit stay in
      // sync. The section is read-only once sold, so this only runs unsold.
      if (patch.pricingSwitches !== undefined) {
        if (liveEvent.serverEventId === null) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast(
            "Save failed because this event is missing its server id.",
          );
          return;
        }
        try {
          await patchPublishedEventPricingSwitches(
            liveEvent.serverEventId,
            patch.pricingSwitches,
          );
          invalidateServerEventCaches();
        } catch {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast("Couldn't save who covers costs. Tap to try again.");
          return;
        }
      }

      // ORCH-0824 hotfix: unified early-return for server-editable-only
      // patches when the local Zustand event isn't available
      // (disableLocalSaveReason is set when liveEvent === null at the
      // route layer, i.e., the user is editing a server-loaded event).
      // Cover-media, ORCH-0824 taxonomy/city, AND ORCH-0877 Path B When-
      // section RPC have all completed server-side at this point; the
      // local updateLiveEventFields would fail with `event_not_found`
      // because there's no Zustand row to mutate. Skip it cleanly with a
      // success toast + navigate.
      if (
        disableLocalSaveReason !== undefined &&
        isServerEditableOnlyPatch(patch)
      ) {
        invalidateServerEventCaches();
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        showToast("Saved. Live now.");
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            // orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)
            router.replace(`/event/${liveEvent.id}` as never);
          }
        }, TOAST_NAV_DELAY_MS);
        return;
      }

      const result = updateLiveEventFields(
        liveEvent.id,
        patch,
        soldCountCtx,
        validation.trimmedReason,
      );
      setSubmitting(false);
      setModal((prev) => ({ ...prev, visible: false }));
      if (result.ok) {
        showToast("Saved. Live now.");
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            // orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)
            router.replace(`/event/${liveEvent.id}` as never);
          }
        }, TOAST_NAV_DELAY_MS);
        return;
      }
      // Guard-rail rejection — open dialog (deferred so it isn't dropped while
      // the reason sheet dismisses on iOS; see REJECT_DIALOG_HANDOFF_MS).
      const pendingReject = buildRejectDialog(result);
      setTimeout(() => setRejectDialog(pendingReject), REJECT_DIALOG_HANDOFF_MS);
    },
    [
      submitting,
      liveEvent,
      currentPatch,
      soldCountCtx,
      updateLiveEventFields,
      router,
      showToast,
      buildRejectDialog,
      disableLocalSaveReason,
      invalidateServerEventCaches,
    ],
  );

  const handleModalClose = useCallback((): void => {
    if (submitting) return;
    setModal((prev) => ({ ...prev, visible: false }));
  }, [submitting]);

  // ---- Back/discard ----
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)
      router.replace(`/event/${liveEvent.id}` as never);
    }
  }, [router, liveEvent.id]);

  // ---- Section body renderer ----
  const renderSectionBody = useCallback(
    (key: SectionKey): React.ReactNode => {
      const stepBodyProps = {
        draft: editState,
        updateDraft: handleUpdateDraft,
        errors: sectionErrors[key],
        showErrors,
        onShowToast: showToast,
        scrollToBottom,
        editMode: { soldCountByTier: soldCountCtx.soldCountByTier },
        canEditTicketPrice,
        coverMediaEventId: liveEvent.serverEventId,
        brandDefaultCurrency: liveEvent.currency ?? null,
        coverMediaApplyMode: "published_manual" as const,
        onCoverVideoProcessingChange: setCoverVideoProcessing,
        // ORCH-0892-A: legacy CoverPicker scroll-ref prop removed.
        // CoverPicker now uses the keyboard-controller library's KAV wrap.
        // scrollViewRef remains for the Cycle 3 wizard root pattern.
      };
      switch (key) {
        case "basics":
          return <CreatorStep1Basics {...stepBodyProps} />;
        case "when":
          return <CreatorStep2When {...stepBodyProps} />;
        case "where":
          return <CreatorStep3Where {...stepBodyProps} />;
        case "cover":
          return <CreatorStep4Cover {...stepBodyProps} />;
        case "visual":
          return (
            <ThemeEditorSection
              value={editState.themeOverrides}
              onChange={(themeOverrides) => handleUpdateDraft({ themeOverrides })}
              resetLabel="Use brand default"
            />
          );
        case "tickets":
          return <CreatorStep5Tickets {...stepBodyProps} />;
        case "settings":
          return <CreatorStep6Settings {...stepBodyProps} />;
        default: {
          const _exhaust: never = key;
          return _exhaust;
        }
      }
    },
    [
      editState,
      handleUpdateDraft,
      sectionErrors,
      showErrors,
      showToast,
      scrollToBottom,
      soldCountCtx.soldCountByTier,
      canEditTicketPrice,
      liveEvent.serverEventId,
      liveEvent.currency,
    ],
  );

  // ---- Section "edited" indicator ----
  const editedSectionKeys = useMemo<Set<SectionKey>>(() => {
    const out = new Set<SectionKey>();
    if (fieldDiffs.length === 0) return out;
    const changedKeys = new Set(fieldDiffs.map((d) => d.fieldKey));
    for (const sec of SECTIONS) {
      if (
        (sec.key === "basics" &&
          (changedKeys.has("name") ||
            changedKeys.has("description") ||
            changedKeys.has("format") ||
            changedKeys.has("category"))) ||
        (sec.key === "when" &&
          (changedKeys.has("whenMode") ||
            changedKeys.has("date") ||
            changedKeys.has("doorsOpen") ||
            changedKeys.has("endsAt") ||
            changedKeys.has("timezone") ||
            changedKeys.has("recurrenceRule") ||
            changedKeys.has("multiDates"))) ||
        (sec.key === "where" &&
          (changedKeys.has("venueName") ||
            changedKeys.has("address") ||
            changedKeys.has("onlineUrl") ||
            changedKeys.has("hideAddressUntilTicket"))) ||
        (sec.key === "cover" &&
          (changedKeys.has("coverHue") ||
            changedKeys.has("coverMediaUrl") ||
            changedKeys.has("coverMediaType") ||
            changedKeys.has("coverMediaProvider") ||
            changedKeys.has("coverMediaSourceUrl") ||
            changedKeys.has("coverMediaCredit") ||
            changedKeys.has("coverMediaCreditUrl") ||
            changedKeys.has("coverMediaAlt"))) ||
        (sec.key === "visual" && changedKeys.has("themeOverrides")) ||
        (sec.key === "tickets" && changedKeys.has("tickets")) ||
        (sec.key === "settings" &&
          (changedKeys.has("visibility") ||
            changedKeys.has("requireApproval") ||
            changedKeys.has("allowTransfers") ||
            changedKeys.has("hideRemainingCount") ||
            changedKeys.has("passwordProtected") ||
            // Cycle 12 — in-person payments toggle is a Settings field.
            changedKeys.has("inPersonPaymentsEnabled")))
      ) {
        out.add(sec.key);
      }
    }
    return out;
  }, [fieldDiffs]);

  // ---- webPurchasePresent ----
  const webPurchasePresent = useEventHasWebPurchases(liveEvent.id);

  // ---- Render ----
  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Close edit"
        />
        <Text style={styles.chromeTitle}>Edit event</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <EditAfterPublishBanner />

        {SECTIONS.map((sec) => {
          const isOpen = openSection === sec.key;
          const isEdited = editedSectionKeys.has(sec.key);
          const hasErrors =
            showErrors && sectionErrors[sec.key].length > 0;
          return (
            <View key={sec.key} style={styles.sectionCard}>
              <Pressable
                onPress={() => handleToggleSection(sec.key)}
                accessibilityRole="button"
                accessibilityLabel={`${sec.label} section${isOpen ? " (expanded)" : " (collapsed)"}`}
                style={({ pressed }) => [
                  styles.sectionHeader,
                  pressed && styles.sectionHeaderPressed,
                ]}
              >
                <View style={styles.sectionHeaderLeft}>
                  <Text style={styles.sectionLabel}>{sec.label}</Text>
                  {isEdited ? (
                    <View style={styles.editedBadge}>
                      <Text style={styles.editedBadgeText}>Edited</Text>
                    </View>
                  ) : null}
                  {hasErrors ? (
                    <View style={styles.errorBadge}>
                      <Text style={styles.errorBadgeText}>Fix</Text>
                    </View>
                  ) : null}
                </View>
                <Icon
                  name={isOpen ? "chevU" : "chevD"}
                  size={16}
                  color={textTokens.tertiary}
                />
              </Pressable>
              {isOpen ? (
                <View style={styles.sectionBody}>{renderSectionBody(sec.key)}</View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      {/* Sticky bottom Save dock — hidden when keyboard up */}
      {!keyboardVisible ? (
        <View
          style={[
            styles.dock,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <Button
            label="Save changes"
            onPress={handleSavePress}
            variant="primary"
            size="lg"
            fullWidth
            disabled={
              submitting ||
              coverVideoProcessing ||
              (disableLocalSaveReason !== undefined &&
                !canSaveServerCoverMediaOnly)
            }
            accessibilityLabel="Save changes"
          />
        </View>
      ) : null}

      {/* Review modal */}
      <ChangeSummaryModal
        visible={modal.visible}
        diffs={modal.fieldDiffs}
        ticketDiffs={modal.ticketDiffs}
        severity={modal.severity}
        webPurchasePresent={webPurchasePresent}
        onClose={handleModalClose}
        onConfirm={handleConfirmSave}
        submitting={submitting}
      />

      {/* Refund-first reject dialog */}
      <ConfirmDialog
        visible={rejectDialog !== null}
        onClose={() => setRejectDialog(null)}
        onConfirm={() => {
          if (rejectDialog !== null) {
            rejectDialog.primaryAction();
          }
        }}
        title={rejectDialog?.title ?? ""}
        description={rejectDialog?.body ?? ""}
        confirmLabel={rejectDialog?.primaryLabel ?? "OK"}
        cancelLabel="Close"
        variant={rejectDialog?.variant ?? "simple"}
        destructive={rejectDialog?.destructive ?? false}
      />

      {/* Toast (self-positioning portal) */}
      <Toast
        visible={toast.visible}
        kind="info"
        message={toast.message}
        onDismiss={() => setToast({ visible: false, message: "" })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md + 8,
    paddingTop: spacing.md,
  },
  sectionCard: {
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  sectionHeaderPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  editedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radiusTokens.full,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  editedBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: accent.warm,
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  errorBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 59, 48, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 59, 48, 0.45)",
  },
  errorBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ff3b30",
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  sectionBody: {
    paddingHorizontal: spacing.md,
    paddingTop: 0,
    paddingBottom: spacing.md,
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(12, 14, 18, 0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
});

export default EditPublishedScreen;
