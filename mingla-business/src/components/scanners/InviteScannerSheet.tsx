/**
 * InviteScannerSheet — scanner invite UI (ORCH-1051).
 *
 * Sends invites through the `invite-scanner` edge function. The function
 * writes to `public.scanner_invitations` and ships a Resend invite email.
 * The legacy [TRANSITIONAL] zustand-only path is gone — invitations are
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
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useInviteScanner } from "../../hooks/useScannerInvitations";
import {
  ScannerInvitationServiceError,
  type ScannerInvitationScope,
} from "../../services/scannerInvitationsService";
import type { LiveEvent } from "../../store/liveEventStore";

import { Button } from "../ui/Button";
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
                placeholderTextColor={textTokens.quaternary}
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
                placeholderTextColor={textTokens.quaternary}
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

          {/* Scope picker */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Access</Text>
            {eventScopeAllowed ? (
              <Pressable
                onPress={() => !submitting && setScope("event")}
                accessibilityRole="radio"
                accessibilityState={{ selected: scope === "event" }}
                accessibilityLabel="This event only"
                disabled={submitting}
                style={[
                  styles.scopeOption,
                  scope === "event" && styles.scopeOptionOn,
                ]}
              >
                <View style={styles.scopeBullet}>
                  {scope === "event" ? (
                    <View style={styles.scopeBulletDot} />
                  ) : null}
                </View>
                <View style={styles.scopeBody}>
                  <Text style={styles.scopeLabel}>This event only</Text>
                  <Text style={styles.scopeSub}>
                    They can scan {event?.name ?? "this event"}.
                  </Text>
                </View>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => !submitting && setScope("brand")}
              accessibilityRole="radio"
              accessibilityState={{ selected: scope === "brand" }}
              accessibilityLabel="Every event in this brand"
              disabled={submitting}
              style={[
                styles.scopeOption,
                scope === "brand" && styles.scopeOptionOn,
              ]}
            >
              <View style={styles.scopeBullet}>
                {scope === "brand" ? (
                  <View style={styles.scopeBulletDot} />
                ) : null}
              </View>
              <View style={styles.scopeBody}>
                <Text style={styles.scopeLabel}>Every event in this brand</Text>
                <Text style={styles.scopeSub}>
                  They can scan tickets at any of your events — now and later.
                </Text>
              </View>
            </Pressable>
          </View>

          {/* Accept door payments toggle */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleCol}>
              <Text style={styles.toggleLabel}>Accept payments at the door</Text>
              <Text style={styles.toggleSubline}>
                Cash and manual payments. Card reader and NFC tap-to-pay land in B-cycle.
              </Text>
            </View>
            <Pressable
              onPress={() => !submitting && setCanAcceptPayments((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: canAcceptPayments }}
              accessibilityLabel="Accept payments at the door"
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
  scroll: {
    flex: 1,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 6,
  },
  required: {
    color: accent.warm,
  },
  inputWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  inputError: {
    borderColor: "rgba(235, 120, 37, 0.5)",
  },
  input: {
    fontSize: 15,
    color: textTokens.primary,
    minHeight: 40,
    paddingVertical: 6,
  },
  errorText: {
    fontSize: 12,
    color: accent.warm,
    marginTop: 4,
  },
  scopeOption: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    marginBottom: spacing.xs + 2,
  },
  scopeOptionOn: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235, 120, 37, 0.08)",
  },
  scopeBullet: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  scopeBulletDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: accent.warm,
  },
  scopeBody: {
    flex: 1,
    minWidth: 0,
  },
  scopeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  scopeSub: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  toggleCol: {
    flex: 1,
    minWidth: 0,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  toggleSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#ffffff",
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },
  actions: {
    paddingTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
});

export default InviteScannerSheet;
