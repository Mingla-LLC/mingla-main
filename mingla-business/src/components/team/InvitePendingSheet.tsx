/**
 * InvitePendingSheet — invitee-side Accept / Decline for a pending brand
 * invitation (ORCH-1108).
 *
 * Opened from the "You've been invited to {brand}" smart To-Do row. Both
 * actions are login-email-trusted, tokenless service calls:
 *   - Accept  → useAcceptMyInvitation (reuses the accept RPC via the edge fn's
 *               { invitationId } branch — membership created / ownership
 *               transferred).
 *   - Decline → useDeclineMyInvitation (status='declined', terminal).
 *
 * The row + bell notification vanish automatically once the mutation
 * invalidates useMyPendingInvites (no per-row local state). A 410
 * invite_not_actionable (race / double-tap) is treated as resolved.
 *
 * Status: ACTIVE post-ORCH-1108.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import {
  useAcceptMyInvitation,
  useDeclineMyInvitation,
} from "../../hooks/useBrandInvitations";
import { BrandInvitationServiceError } from "../../services/brandInvitationsService";
import { HapticFeedback } from "../../utils/hapticFeedback";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";

export interface InvitePendingSheetProps {
  invitationId: string;
  brandName: string;
  visible: boolean;
  onClose: () => void;
  /**
   * Fires after the invite resolves (accepted or declined) so the host can
   * surface a toast + close. The `kind` lets the host pick the copy.
   */
  onResolved?: (kind: "accepted" | "declined", brandName: string) => void;
}

interface ToastState {
  kind: "error" | "success";
  message: string;
}

export const InvitePendingSheet: React.FC<InvitePendingSheetProps> = ({
  invitationId,
  brandName,
  visible,
  onClose,
  onResolved,
}) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { mutateAsync: acceptAsync, isPending: accepting } =
    useAcceptMyInvitation(userId);
  const { mutateAsync: declineAsync, isPending: declining } =
    useDeclineMyInvitation(userId);
  const [toast, setToast] = useState<ToastState | null>(null);

  const busy = accepting || declining;

  const handleAccept = useCallback(async (): Promise<void> => {
    if (busy) return;
    setToast(null);
    try {
      await acceptAsync(invitationId);
      HapticFeedback.success();
      onResolved?.("accepted", brandName);
      onClose();
    } catch (err) {
      setToast({ kind: "error", message: acceptErrorMessageFor(err) });
    }
  }, [busy, acceptAsync, invitationId, brandName, onResolved, onClose]);

  const handleDecline = useCallback(async (): Promise<void> => {
    if (busy) return;
    setToast(null);
    try {
      // declineBrandInvitation treats 410 not_actionable as resolved, so this
      // only throws on a genuine error (403 email-mismatch / 500 / network).
      await declineAsync(invitationId);
      HapticFeedback.buttonPress();
      onResolved?.("declined", brandName);
      onClose();
    } catch (err) {
      setToast({ kind: "error", message: declineErrorMessageFor(err) });
    }
  }, [busy, declineAsync, invitationId, brandName, onResolved, onClose]);

  const handleClose = useCallback((): void => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="half">
      <View style={styles.body}>
        <Text style={styles.title}>You&apos;ve been invited to {brandName}</Text>
        <Text style={styles.subhead}>
          Accept to join {brandName}, or decline if this wasn&apos;t meant for
          you.
        </Text>

        <View style={styles.actions}>
          <Button
            label={accepting ? "Accepting..." : "Accept"}
            onPress={handleAccept}
            variant="primary"
            size="lg"
            fullWidth
            loading={accepting}
            disabled={busy}
            accessibilityLabel={`Accept invitation to ${brandName}`}
          />
          <View style={styles.actionSpacer} />
          <Button
            label={declining ? "Declining..." : "Decline"}
            onPress={handleDecline}
            variant="ghost"
            size="md"
            fullWidth
            loading={declining}
            disabled={busy}
            accessibilityLabel={`Decline invitation to ${brandName}`}
          />
        </View>
      </View>

      {toast !== null ? (
        <View style={styles.toastWrap} pointerEvents="box-none">
          <Toast
            visible
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </View>
      ) : null}
    </Sheet>
  );
};

function acceptErrorMessageFor(err: unknown): string {
  if (err instanceof BrandInvitationServiceError) {
    switch (err.code) {
      case "invite_email_mismatch":
        return "This invite isn't for this account.";
      case "invite_not_actionable":
      case "invite_declined":
      case "invite_already_used":
      case "invite_revoked":
      case "invite_expired":
      case "invite_not_found":
        return "This invite is no longer available.";
      case "invite_currency_mismatch":
        return "Connect your bank to accept this brand.";
      default:
        return "Couldn't reach Mingla — please try again.";
    }
  }
  return "Couldn't reach Mingla — please try again.";
}

function declineErrorMessageFor(err: unknown): string {
  if (err instanceof BrandInvitationServiceError) {
    if (err.code === "invite_email_mismatch") {
      return "This invite isn't for this account.";
    }
  }
  return "Couldn't reach Mingla — please try again.";
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  subhead: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  actions: {
    marginTop: "auto",
    paddingTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
  toastWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    alignItems: "center",
    padding: spacing.lg,
  },
});

export default InvitePendingSheet;
