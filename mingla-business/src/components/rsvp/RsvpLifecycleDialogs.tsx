/**
 * RsvpLifecycleDialogs — #3645: "Return RSVP to draft" and "Cancel RSVP" for
 * a published RSVP. Same confirmation pattern as the experience dashboard.
 *
 * Loaded lazily (see `LazyRsvpLifecycleDialogs`): a host opens these rarely,
 * and the RSVP dashboard is a screen every guest link passes near.
 *
 * WHAT THE HOST IS TOLD is only what the code does:
 *   - Return to draft: the server refuses when anyone has responded or paid a
 *     chip-in; the host is then pointed at Cancel.
 *   - Cancel: guests can no longer respond. Paid chip-ins are queued for a
 *     full refund and wait for Mingla's review; nothing is refunded at cancel
 *     time. Whether any exist is READ while the dialog is open; until that
 *     read answers (or if it fails) the copy says "any chip-ins", never
 *     "nothing to refund".
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ConfirmDialog } from "../ui/ConfirmDialog";
import { brandKeys } from "../../hooks/brandKeys";
import {
  businessEventKeys,
  useCancelBusinessEvent,
} from "../../hooks/useBusinessEvents";
import { eventDraftKeys } from "../../hooks/useServerDraftEvents";
import { cancelDoneToast, cancelRsvpDescription } from "../../utils/cancelEventCopy";

// Loaded on demand, here and in Hub's "Unpublish to draft": a module that two
// separately loaded screens import statically is moved by the bundler into the
// start-up chunk every visitor downloads. Imported this way from both, the
// lifecycle service and its failure copy stay out of it.
const loadRsvpLifecycleService = (): Promise<
  typeof import("../../services/rsvpLifecycleService")
> => import("../../services/rsvpLifecycleService");
const loadRsvpUnpublishFailureCopy = (): Promise<
  typeof import("../../utils/rsvpUnpublishFailureCopy")
> => import("../../utils/rsvpUnpublishFailureCopy");

export const RSVP_RETURN_TO_DRAFT_COPY = {
  title: "Return this RSVP to draft?",
  description:
    "Its public page and guest sign-ups will close. Your details, cover and settings stay for editing.",
  confirmLabel: "Return to draft",
  cancelLabel: "Keep it published",
  done: "RSVP returned to draft.",
} as const;

export const RSVP_CANCEL_COPY = {
  title: "Cancel this RSVP?",
  confirmLabel: "Cancel RSVP",
  cancelLabel: "Keep it live",
  failed: "Couldn't cancel this RSVP. Try again.",
} as const;

export interface RsvpLifecycleDialogsProps {
  /** The server event id of the RSVP. */
  eventId: string;
  brandId: string;
  /** What the host types to confirm a cancel. */
  confirmText: string;
  open: "return-to-draft" | "cancel" | null;
  onClose: () => void;
  /** The RSVP is a draft again. */
  onReturnedToDraft: (message: string) => void;
  /** The RSVP is cancelled. */
  onCancelled: (message: string) => void;
}

export const RsvpLifecycleDialogs: React.FC<RsvpLifecycleDialogsProps> = ({
  eventId,
  brandId,
  confirmText,
  open,
  onClose,
  onReturnedToDraft,
  onCancelled,
}) => {
  const cancelMutation = useCancelBusinessEvent();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // null = not known. Read each time the cancel dialog opens.
  const [paidChipIns, setPaidChipIns] = useState<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => (): void => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    setErrorMessage(null);
    if (open !== "cancel") return;
    let current = true;
    setPaidChipIns(null);
    loadRsvpLifecycleService()
      .then(({ countPaidRsvpChipIns }) => countPaidRsvpChipIns(eventId))
      .then((count) => {
        if (current) setPaidChipIns(count);
      })
      .catch(() => {
        // Not known: the copy stays on "any chip-ins".
        if (current) setPaidChipIns(null);
      });
    return (): void => {
      current = false;
    };
  }, [eventId, open]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  const handleReturnToDraft = useCallback(async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const { unpublishRsvpToDraft } = await loadRsvpLifecycleService();
      await unpublishRsvpToDraft(eventId);
      // The RSVP is a draft now: Hub's lists and tab counts are re-read, and
      // the cached published copy is marked stale (not refetched under this
      // screen, which is about to be left).
      void queryClient.invalidateQueries({
        queryKey: businessEventKeys.list(brandId),
      });
      void queryClient.invalidateQueries({
        queryKey: eventDraftKeys.list(brandId),
      });
      // A "no such draft" answer cached while it was published must not be
      // what the editor opens on.
      queryClient.removeQueries({ queryKey: eventDraftKeys.detail(eventId) });
      void queryClient.invalidateQueries({
        queryKey: brandKeys.offeringCounts(brandId),
      });
      void queryClient.invalidateQueries({
        queryKey: businessEventKeys.detail(eventId),
        refetchType: "none",
      });
      if (!mountedRef.current) return;
      onReturnedToDraft(RSVP_RETURN_TO_DRAFT_COPY.done);
    } catch (error) {
      const { rsvpUnpublishFailureCopy } = await loadRsvpUnpublishFailureCopy();
      if (mountedRef.current) setErrorMessage(rsvpUnpublishFailureCopy(error));
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }, [brandId, eventId, onReturnedToDraft, queryClient, submitting]);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await cancelMutation.cancelEvent({ eventId, brandId });
      if (!mountedRef.current) return;
      onCancelled(cancelDoneToast(paidChipIns, "RSVP"));
    } catch {
      if (mountedRef.current) setErrorMessage(RSVP_CANCEL_COPY.failed);
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }, [brandId, cancelMutation, eventId, onCancelled, paidChipIns, submitting]);

  return (
    <>
      <ConfirmDialog
        visible={open === "return-to-draft"}
        onClose={handleClose}
        onConfirm={handleReturnToDraft}
        title={RSVP_RETURN_TO_DRAFT_COPY.title}
        description={RSVP_RETURN_TO_DRAFT_COPY.description}
        confirmLabel={RSVP_RETURN_TO_DRAFT_COPY.confirmLabel}
        cancelLabel={RSVP_RETURN_TO_DRAFT_COPY.cancelLabel}
        confirmLoading={submitting}
        confirmDisabled={submitting}
        closeDisabled={submitting}
        errorMessage={open === "return-to-draft" ? errorMessage : null}
        errorTestID="rsvp-dashboard-unpublish-error"
        testID="rsvp-dashboard-unpublish-dialog"
      />
      <ConfirmDialog
        visible={open === "cancel"}
        onClose={handleClose}
        onConfirm={handleCancel}
        title={RSVP_CANCEL_COPY.title}
        description={cancelRsvpDescription(paidChipIns)}
        variant="typeToConfirm"
        confirmText={confirmText}
        confirmLabel={RSVP_CANCEL_COPY.confirmLabel}
        cancelLabel={RSVP_CANCEL_COPY.cancelLabel}
        confirmLoading={submitting}
        confirmDisabled={submitting}
        closeDisabled={submitting}
        errorMessage={open === "cancel" ? errorMessage : null}
        errorTestID="rsvp-dashboard-cancel-error"
        destructive
        testID="rsvp-dashboard-cancel-dialog"
      />
    </>
  );
};
