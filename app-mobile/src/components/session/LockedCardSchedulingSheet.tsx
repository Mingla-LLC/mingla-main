// ORCH-0908 (rework 2026-05-21): two-step lock-and-schedule sheet.
//
// Flow:
//   1. User (creator/admin) taps "Lock it in" on a matched card in
//      SwipeableSessionCards. SwipeableSessionCards opens this sheet
//      WITHOUT firing any RPC yet.
//   2. Step 1: date/time picker (ProposeDateTimeModal). User picks a date.
//   3. Step 2: summary review screen — shows locker's name + card title +
//      picked date/time + Confirm + "Pick a different time" buttons.
//   4. On Confirm: BoardSessionService.lockAndScheduleCard fires the
//      atomic RPC. On success: sheet dismisses, deck refreshes (cache
//      invalidation), chat message appears (server-inserted), banner
//      shows, push notification fires to other participants, and
//      useCollaborationCalendar auto-adds to local device calendar
//      on realtime receipt.
//   5. On "Pick a different time": back to step 1.
//
// Replaces the earlier "lock first, then maybe schedule" two-RPC flow.

import { useState, useCallback } from "react";
import {
  Alert,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { BoardSessionService } from "../../services/boardSessionService";
import { supabase } from "../../services/supabase";
import { useAppStore } from "../../store/appStore";
import ProposeDateTimeModal from "../activity/ProposeDateTimeModal";

interface LockedCardSchedulingSheetProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  savedCardId: string;
  cardData: Record<string, any> | null;
  currentUserId: string | undefined;
  onLockedAndScheduled?: (result: {
    scheduledAt: string;
    newDeckVersion: number;
  }) => void;
}

const DEFAULT_DURATION_MINUTES = 120;

type Step = "pick" | "summary";

function formatPickedDateTime(date: Date): string {
  try {
    return date.toLocaleString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString();
  }
}

export default function LockedCardSchedulingSheet({
  visible,
  onClose,
  sessionId,
  savedCardId,
  cardData,
  currentUserId,
  onLockedAndScheduled,
}: LockedCardSchedulingSheetProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const { profile } = useAppStore();
  const [step, setStep] = useState<Step>("pick");
  const [pickedDate, setPickedDate] = useState<Date | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const lockerName = profile?.display_name || profile?.username || "You";
  const cardTitle =
    cardData && typeof cardData.title === "string"
      ? cardData.title
      : "this card";

  const resetAndClose = useCallback(() => {
    setStep("pick");
    setPickedDate(null);
    setIsSubmitting(false);
    onClose();
  }, [onClose]);

  const handleDatePicked = useCallback((date: Date) => {
    // Don't fire the RPC yet — transition to summary step for confirmation.
    setPickedDate(date);
    setStep("summary");
  }, []);

  const handleBackToPicker = useCallback(() => {
    setStep("pick");
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pickedDate || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // ── Atomic lock + schedule via the combined RPC ──────────────────
      const result = await BoardSessionService.lockAndScheduleCard(
        sessionId,
        savedCardId,
        pickedDate,
        DEFAULT_DURATION_MINUTES,
      );

      // ── Fire-and-forget push notification to other participants ──────
      supabase.functions
        .invoke("notify-session-lock", {
          body: {
            sessionId,
            savedCardId,
            event: "plan_scheduled",
            scheduledAtIso: pickedDate.toISOString(),
          },
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[ORCH-0908] notify-session-lock failed:", msg);
        });

      // ── Invalidate React Query caches so deck + chat + calendar refresh ──
      // The locker's own device-calendar add is handled by the realtime hook
      // (useCollaborationCalendar) just like every other participant. No
      // asymmetric local-only write here.
      queryClient.invalidateQueries({ queryKey: ["deck-cards", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      queryClient.invalidateQueries({
        queryKey: ["calendarEntries", currentUserId],
      });
      queryClient.invalidateQueries({ queryKey: ["savedCards", sessionId] });
      queryClient.invalidateQueries({
        queryKey: ["savedSessionCards", sessionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["scheduledCards", sessionId],
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      onLockedAndScheduled?.({
        scheduledAt: result.scheduled_at,
        newDeckVersion: result.new_deck_version,
      });

      resetAndClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ORCH-0908] lockAndScheduleCard failed:", message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Couldn't lock in the plan",
        message || "Please try again in a moment.",
        [{ text: "OK" }],
      );
      setIsSubmitting(false);
    }
  }, [
    pickedDate,
    isSubmitting,
    sessionId,
    savedCardId,
    currentUserId,
    queryClient,
    onLockedAndScheduled,
    resetAndClose,
  ]);

  if (!visible || !cardData) {
    return null;
  }

  // Step 1 — date/time picker (reuses the existing ProposeDateTimeModal)
  if (step === "pick") {
    const cardForModal = {
      id: savedCardId,
      title: cardTitle,
      ...cardData,
    };
    return (
      <ProposeDateTimeModal
        visible={visible}
        onClose={resetAndClose}
        card={cardForModal}
        onProposeDateTime={handleDatePicked}
        isCurated={
          Array.isArray((cardData as any)?.stops) &&
          (cardData as any).stops.length > 0
        }
      />
    );
  }

  // Step 2 — summary + confirm.
  // META-ORCH-0991 Wave B Batch 5: this is an irreversible commit confirm
  // ("once you confirm … a new round of swiping starts") presented as a
  // centered card with Confirm / Pick-a-different-time / Cancel actions →
  // variant="center-dialog" (non-swipe, can't be flicked away by accident,
  // operator rule §1). The local scrim/card chrome is stripped; the dialog
  // supplies scrim + card + radius + padding from glass.centerDialog. The
  // inner container is a transparent passthrough so chrome doesn't double up.
  return (
    <BaseBottomSheet
      variant="center-dialog"
      visible={visible}
      onClose={resetAndClose}
      accessibilityLabel="Lock in this plan"
    >
      <View style={styles.dialogBody}>
          <Text style={styles.title}>Lock in this plan?</Text>
          <Text style={styles.subtitle}>
            Once you confirm, everyone in the session will see this card as the
            locked-in plan in chat and on their calendar. A new round of swiping
            starts.
          </Text>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Plan</Text>
            <Text style={styles.summaryValue} numberOfLines={2}>
              {cardTitle}
            </Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>When</Text>
            <Text style={styles.summaryValue}>
              {pickedDate ? formatPickedDateTime(pickedDate) : ""}
            </Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Locked in by</Text>
            <Text style={styles.summaryValue}>{lockerName}</Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.confirmButton,
              (pressed || isSubmitting) && styles.confirmButtonPressed,
            ]}
            onPress={handleConfirm}
            disabled={isSubmitting}
            accessibilityLabel="Confirm lock in"
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.confirmButtonText}>Confirm lock in</Text>
            )}
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={handleBackToPicker}
            disabled={isSubmitting}
            accessibilityLabel="Pick a different time"
          >
            <Text style={styles.secondaryButtonText}>
              Pick a different time
            </Text>
          </Pressable>

          <Pressable
            style={styles.cancelButton}
            onPress={resetAndClose}
            disabled={isSubmitting}
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  // META-ORCH-0991 Wave B Batch 5: transparent passthrough — the
  // center-dialog supplies scrim/card/radius/padding from glass.centerDialog.
  dialogBody: {
    width: "100%",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: "400",
    color: "#475569",
    marginBottom: 20,
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748B",
    width: 100,
  },
  summaryValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  confirmButton: {
    marginTop: 20,
    backgroundColor: "#F59E0B",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmButtonPressed: {
    backgroundColor: "#D97706",
    opacity: 0.9,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0F172A",
  },
  cancelButton: {
    marginTop: 4,
    paddingVertical: 10,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "400",
    color: "#94A3B8",
  },
});
