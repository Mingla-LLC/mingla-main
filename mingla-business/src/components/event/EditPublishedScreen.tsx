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
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

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
  type LiveEvent,
  type UpdateLiveEventResult,
} from "../../store/liveEventStore";
import { getSoldCountContextForEvent } from "../../store/orderStoreHelpers";
import { useOrderStore } from "../../store/orderStore";
import {
  computeRichFieldDiffs,
  computeTicketDiffs,
  classifySeverity,
  editableDraftToPatch,
  liveEventToEditableDraft,
  type FieldDiff,
  type TicketDiff,
} from "../../utils/liveEventAdapter";
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

// ---- Section configuration -----------------------------------------

type SectionKey = "basics" | "when" | "where" | "cover" | "tickets" | "settings";

interface SectionConfig {
  key: SectionKey;
  label: string;
  /** Step index for `validateStep(N, draft)`. */
  stepIndex: number;
}

const SECTIONS: ReadonlyArray<SectionConfig> = [
  { key: "basics", label: "Basics", stepIndex: 0 },
  { key: "when", label: "When", stepIndex: 1 },
  { key: "where", label: "Where", stepIndex: 2 },
  { key: "cover", label: "Cover", stepIndex: 3 },
  { key: "tickets", label: "Tickets", stepIndex: 4 },
  { key: "settings", label: "Settings", stepIndex: 5 },
];

const SAVE_PROCESSING_MS = 800;
const TOAST_NAV_DELAY_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---- Component ------------------------------------------------------

export interface EditPublishedScreenProps {
  liveEvent: LiveEvent;
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
}

export const EditPublishedScreen: React.FC<EditPublishedScreenProps> = ({
  liveEvent,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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

  // ---- Keyboard handling (Cycle 3 wizard root pattern) ----
  const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const pendingScrollToBottomRef = useRef<boolean>(false);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(
      showEvent,
      (e: KeyboardEvent): void => {
        setKeyboardVisible(true);
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const scrollToBottom = useCallback((): void => {
    pendingScrollToBottomRef.current = true;
    if (keyboardHeight > 0) {
      requestAnimationFrame((): void => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [keyboardHeight]);

  useEffect(() => {
    if (keyboardHeight > 0 && pendingScrollToBottomRef.current) {
      requestAnimationFrame((): void => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      });
    }
    if (keyboardHeight === 0) {
      pendingScrollToBottomRef.current = false;
    }
  }, [keyboardHeight]);

  // ---- Sold-count context (ORCH-0704: stub returns zeros; 9c flips live) ----
  const soldCountCtx = useMemo(
    () => getSoldCountContextForEvent(liveEvent),
    [liveEvent],
  );

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
      tickets: [],
      settings: [],
    };
    for (const sec of SECTIONS) {
      out[sec.key] = validateStep(sec.stepIndex, editState);
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

  // ---- Save flow ----
  const handleSavePress = useCallback((): void => {
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
    const patch = editableDraftToPatch(liveEvent, editState);
    if (Object.keys(patch).length === 0) {
      showToast("No changes to save.");
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
  }, [editState, fieldDiffs, liveEvent, sectionErrors, showToast]);

  // ---- Map rejection result to dialog content ----
  const buildRejectDialog = useCallback(
    (result: Extract<UpdateLiveEventResult, { ok: false }>): RejectDialogContent => {
      const closeAndOpenOrders = (): void => {
        setRejectDialog(null);
        // Cycle 9c — Orders ledger now exists; navigate to it.
        router.push(`/event/${liveEvent.id}/orders` as never);
      };

      const closeOnly = (): void => setRejectDialog(null);

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
        case "multi_date_remove_with_sales": {
          const dropped = result.droppedDates ?? [];
          const n = result.affectedOrderCount ?? 0;
          const dateText =
            dropped.length === 1
              ? `the date ${dropped[0]}`
              : `${dropped.length} dates`;
          return {
            title: "Refund first",
            body: `Tickets sold for this event grant access to all dates. Refund ${n} order${n === 1 ? "" : "s"} before removing ${dateText}.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "when_mode_drops_active_date": {
          const dropped = result.droppedDates ?? [];
          const n = result.affectedOrderCount ?? 0;
          const dateText =
            dropped.length === 1
              ? `the date ${dropped[0]}`
              : `${dropped.length} dates`;
          return {
            title: "Refund first",
            body: `Switching mode would drop ${dateText} from your schedule. ${n} buyer${n === 1 ? "" : "s"} paid for this event — refund them before switching.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "recurrence_drops_occurrence": {
          const dropped = result.droppedDates ?? [];
          const n = result.affectedOrderCount ?? 0;
          const dateText =
            dropped.length === 1
              ? `the date ${dropped[0]}`
              : `${dropped.length} occurrence${dropped.length === 1 ? "" : "s"}`;
          return {
            title: "Refund first",
            body: `Your new recurrence rule drops ${dateText}. ${n} buyer${n === 1 ? "" : "s"} paid for this event — refund them first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        default: {
          const _exhaust: never = result.reason;
          return _exhaust;
        }
      }
    },
    [router, showToast],
  );

  const handleConfirmSave = useCallback(
    async (reason: string): Promise<void> => {
      if (submitting) return;
      setSubmitting(true);
      await sleep(SAVE_PROCESSING_MS);
      const patch = editableDraftToPatch(liveEvent, editState);
      const result = updateLiveEventFields(
        liveEvent.id,
        patch,
        soldCountCtx,
        reason,
      );
      setSubmitting(false);
      setModal((prev) => ({ ...prev, visible: false }));
      if (result.ok) {
        showToast("Saved. Live now.");
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace(`/event/${liveEvent.id}` as never);
          }
        }, TOAST_NAV_DELAY_MS);
        return;
      }
      // Guard-rail rejection — open dialog
      setRejectDialog(buildRejectDialog(result));
    },
    [
      submitting,
      liveEvent,
      editState,
      soldCountCtx,
      updateLiveEventFields,
      router,
      showToast,
      buildRejectDialog,
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
        (sec.key === "cover" && changedKeys.has("coverHue")) ||
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
  // Cycle 9c — populate from useOrderStore + paymentMethod filter.
  const webPurchasePresent = useMemo(
    () =>
      useOrderStore
        .getState()
        .getOrdersForEvent(liveEvent.id)
        .some(
          (o) =>
            o.paymentMethod === "card" ||
            o.paymentMethod === "apple_pay" ||
            o.paymentMethod === "google_pay",
        ),
    [liveEvent.id],
  );

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
          {
            paddingBottom:
              keyboardHeight > 0
                ? keyboardHeight + 120
                : insets.bottom + 120,
          },
        ]}
        keyboardShouldPersistTaps="handled"
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
            disabled={submitting}
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
        variant="simple"
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
