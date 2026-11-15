/**
 * InviteScannerSheet — scanner invite UI (ORCH-1051).
 *
 * Sends invites through the `invite-scanner` edge function. The function
 * writes to `public.scanner_invitations` and ships a Resend invite email.
 * The legacy [TRANSITIONAL] zustand-only path is gone (exit condition: ORCH-1051) — invitations are
 * real canonical rows from the moment "Send invitation" returns success.
 *
 * Scope picker: operator chooses "This event only" (default, preserves
 * existing UX) or "Every event in this brand" (new brand-scoped scanner).
 *
 * Status: ACTIVE post-ORCH-1051.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useInviteScanner } from "../../hooks/useScannerInvitations";
import {
  ScannerInvitationServiceError,
  type ScannerInvitationScope,
} from "../../services/scannerInvitationsService";
import type { LiveEvent } from "../../store/liveEventStore";
import { scannerDoorPaymentsCopy } from "../door/scannerDoorPaymentsCopy";

import { Button } from "../ui/Button";
import { Segmented } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";

const NAME_MAX = 100;
const EMAIL_MAX = 200;

const isValidEmail = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 1 && t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};

export interface InviteScannerSheetProps {
  visible: boolean;
  /** Pass when invoking from /event/[id]/scanners; omit for brand-only flow. */
  event: LiveEvent | null;
  brandId: string;
  /** The brand's payment rail: Tap to Pay is not on Paystack. */
  paymentProvider: "stripe" | "paystack" | null;
  /** Retained for prop compatibility; canonical invited_by is auth.uid()
   *  inside the edge fn. */
  operatorAccountId: string;
  /** When true, "Every event" is the only allowed scope (the operator opened
   *  the sheet from a brand-level surface). */
  brandOnly?: boolean;
  onClose: () => void;
  onSuccess: (details: { invitationId: string; scope: ScannerInvitationScope }) => void;
}

interface ToastState {
  kind: "error" | "success";
  message: string;
}

function toastForCode(code: string, status: number): ToastState {
  switch (code) {
    case "validation":
      return { kind: "error", message: "Check the form — some fields are invalid." };
    case "forbidden":
      return {
        kind: "error",
        message: "Only event managers and up can invite scanners.",
      };
    case "brand_not_found":
    case "event_not_found":
      return { kind: "error", message: "That event or brand no longer exists." };
    case "already_invited":
      return {
        kind: "error",
        message: "There's already a pending invite for that email.",
      };
    case "email_send_failed":
      return {
        kind: "error",
        message: "We couldn't send the email. Try again in a moment.",
      };
    case "unauthenticated":
      return { kind: "error", message: "Sign in again to invite scanners." };
    default:
      return {
        kind: "error",
        message: `Something went wrong (status ${status}). Try again.`,
      };
  }
}

export const InviteScannerSheet: React.FC<InviteScannerSheetProps> = ({
  visible,
  event,
  brandId,
  paymentProvider,
  operatorAccountId: _operatorAccountId,
  brandOnly,
  onClose,
  onSuccess,
}) => {
  const defaultScope: ScannerInvitationScope =
    brandOnly === true || event === null ? "brand" : "event";

  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [scope, setScope] = useState<ScannerInvitationScope>(defaultScope);
  const [canAcceptPayments, setCanAcceptPayments] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const { mutateAsync: inviteAsync, isPending: submitting } = useInviteScanner();

  useEffect(() => {
    if (visible) {
      setName("");
      setEmail("");
      setScope(defaultScope);
      setCanAcceptPayments(false);
      setToast(null);
    }
  }, [visible, defaultScope]);

  const trimmedNameLen = name.trim().length;
  const nameValid = trimmedNameLen >= 1 && trimmedNameLen <= NAME_MAX;
  const emailValid = isValidEmail(email);
  const isValid = nameValid && emailValid &&
    (scope === "brand" || (scope === "event" && event !== null));
  const canSubmit = !submitting && isValid;

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    try {
      const result = await inviteAsync({
        brandId,
        eventId: scope === "event" ? event?.id ?? null : null,
        scope,
        inviteeEmail: email,
        inviteeName: name,
        canAcceptPayments,
      });
      onSuccess({ invitationId: result.invitationId, scope });
    } catch (err) {
      if (err instanceof ScannerInvitationServiceError) {
        setToast(toastForCode(err.code, err.status));
      } else {
        setToast({
          kind: "error",
          message: "Something went wrong. Try again.",
        });
      }
    }
  }, [canSubmit, inviteAsync, brandId, scope, event, email, name, canAcceptPayments, onSuccess]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const eventScopeAllowed = event !== null && brandOnly !== true;

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title}>Invite scanner</Text>
        <Text style={styles.subhead}>
          Door staff or backup scanners. They&apos;ll get an email with a one-tap accept link.
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Name <Text style={styles.required}>*</Text>
            </Text>
            <View
              style={[
                styles.inputWrap,
                trimmedNameLen > 0 && !nameValid && styles.inputError,
              ]}
            >
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Tunde Olu"
                placeholderTextColor={color.text4}
                maxLength={NAME_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Scanner name"
              />
            </View>
            {trimmedNameLen > 0 && !nameValid ? (
              <Text style={styles.errorText}>Enter the scanner&apos;s name.</Text>
            ) : null}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Email <Text style={styles.required}>*</Text>
            </Text>
            <View
              style={[
                styles.inputWrap,
                email.length > 0 && !emailValid && styles.inputError,
              ]}
            >
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="tunde@example.com"
                placeholderTextColor={color.text4}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={EMAIL_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Scanner email"
              />
            </View>
            {email.length > 0 && !emailValid ? (
              <Text style={styles.errorText}>Enter a valid email.</Text>
            ) : null}
          </View>

          {/* #4420 (round-3 item 5) — scanner access is a two-tab switcher,
              "This event" | "Brand events", with the consequence on one
              line under it. Brand-only opens show the brand line alone. */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Access</Text>
            {eventScopeAllowed ? (
              <Segmented<ScannerInvitationScope>
                options={[
                  { key: "event", label: "This event", disabled: submitting, testID: "scanner-scope-event" },
                  { key: "brand", label: "Brand events", disabled: submitting, testID: "scanner-scope-brand" },
                ]}
                value={scope}
                onChange={(next) => {
                  if (!submitting) setScope(next);
                }}
                accessibilityLabel="Scanner access"
                testID="scanner-scope"
              />
            ) : null}
            <Text style={styles.scopeSub}>
              {scope === "event"
                ? `They can scan ${event?.name ?? "this event"}.`
                : "They can scan tickets at any of your events — now and later."}
            </Text>
          </View>

          {/* Accept door payments toggle */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleCol}>
              <Text style={styles.toggleLabel}>Take payments at the door</Text>
              <Text style={styles.toggleSubline}>
                {scannerDoorPaymentsCopy(paymentProvider)}
              </Text>
            </View>
            <Pressable
              onPress={() => !submitting && setCanAcceptPayments((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: canAcceptPayments }}
              accessibilityLabel="Take payments at the door"
              disabled={submitting}
              style={[
                styles.toggleTrack,
                canAcceptPayments && styles.toggleTrackOn,
              ]}
            >
              <View
                style={[
                  styles.toggleThumb,
                  canAcceptPayments && styles.toggleThumbOn,
                ]}
              />
            </Pressable>
          </View>
        </ScrollView>

        {/* Sticky bottom CTAs */}
        <View style={styles.actions}>
          <Button
            label={submitting ? "Inviting..." : "Send invitation"}
            onPress={handleConfirm}
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel="Send scanner invitation"
          />
          <View style={styles.actionSpacer} />
          <Button
            label="Cancel"
            onPress={handleClose}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Cancel invite scanner"
          />
        </View>

        {toast !== null ? (
          <Toast
            visible={true}
            kind={toast.kind === "error" ? "error" : "success"}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        ) : null}
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: {
    // #4420: the Sheet owns the 20 side padding.
    paddingTop: space[4],
    paddingBottom: space[7],
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: color.text1,
    letterSpacing: -0.2,
    marginBottom: space[1],
  },
  subhead: {
    fontSize: 14,
    color: color.text2,
    lineHeight: 20,
    marginBottom: space[6],
  },
  scroll: {
    flex: 1,
    marginBottom: space[4],
  },
  scrollContent: {
    paddingBottom: space[2],
  },
  fieldGroup: {
    marginBottom: space[4],
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: color.text2,
    marginBottom: 6,
  },
  required: {
    color: color.text1,
  },
  inputWrap: {
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    paddingHorizontal: space[2] + 2,
    paddingVertical: 4,
  },
  inputError: {
    borderColor: color.lineStrong,
  },
  input: {
    fontSize: 15,
    color: color.text1,
    minHeight: 40,
    paddingVertical: 6,
  },
  errorText: {
    fontSize: 12,
    color: color.text1,
    marginTop: 4,
  },
  scopeSub: {
    ...type.caption,
    color: color.text3,
    marginTop: space[2],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space[2],
    gap: space[4],
    marginBottom: space[1],
  },
  toggleCol: {
    flex: 1,
    minWidth: 0,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: color.text1,
  },
  toggleSubline: {
    fontSize: 12,
    color: color.text3,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: color.fill.step,
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: {
    backgroundColor: color.paper,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: color.text1,
  },
  toggleThumbOn: {
    backgroundColor: color.ink,
    transform: [{ translateX: 18 }],
  },
  actions: {
    paddingTop: space[2],
  },
  actionSpacer: {
    height: space[2],
  },
});

export default InviteScannerSheet;
