import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useJoinWaitlistMutation } from "../../hooks/useJoinWaitlistMutation";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";

export interface JoinWaitlistTicket {
  id: string;
  name: string;
  maxPurchaseQty?: number | null;
}

interface JoinWaitlistSheetProps {
  visible: boolean;
  eventId: string;
  ticket: JoinWaitlistTicket | null;
  onClose: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const JoinWaitlistSheet: React.FC<JoinWaitlistSheetProps> = ({
  visible,
  eventId,
  ticket,
  onClose,
}) => {
  const mutation = useJoinWaitlistMutation();
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [consent, setConsent] = useState<boolean>(false);
  const [keyboardPadding, setKeyboardPadding] = useState<number>(0);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    kind: "success" | "info" | "error";
  }>({
    visible: false,
    message: "",
    kind: "success",
  });

  const maxQty = useMemo(
    () => Math.max(1, Math.min(ticket?.maxPurchaseQty ?? 6, 6)),
    [ticket?.maxPurchaseQty],
  );
  const cleanEmail = email.trim().toLowerCase();
  const cleanPhone = phone.trim();
  const hasContact = cleanEmail.length > 0 || cleanPhone.length > 0;
  const emailValid = cleanEmail.length === 0 || EMAIL_RE.test(cleanEmail);
  const canSubmit =
    ticket !== null &&
    hasContact &&
    emailValid &&
    consent &&
    !mutation.isPending;

  useEffect(() => {
    if (!visible) return;
    setEmail("");
    setPhone("");
    setName("");
    setQty(1);
    setConsent(false);
    setToast({ visible: false, message: "", kind: "success" });
  }, [visible, ticket?.id]);

  useEffect(() => {
    // orch-strict-grep-allow orch-0892 — SPEC §8.3 mandated Cycle 3 wizard pattern (Keyboard.addListener + dynamic paddingBottom) per memory rule feedback_keyboard_never_blocks_input.md; SmartScrollView migration belongs in a follow-up ORCH covering all bespoke-keyboard sites uniformly.
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardPadding(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardPadding(0);
    });
    return (): void => {
      show.remove();
      hide.remove();
    };
  }, []);

  const showToast = useCallback(
    (message: string, kind: "success" | "info" | "error"): void => {
      setToast({ visible: true, message, kind });
    },
    [],
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit || ticket === null) return;
    try {
      const result = await mutation.mutateAsync({
        eventId,
        ticketTypeId: ticket.id,
        email: cleanEmail.length > 0 ? cleanEmail : undefined,
        phone: cleanPhone.length > 0 ? cleanPhone : undefined,
        name: name.trim().length > 0 ? name.trim() : undefined,
        qtyRequested: qty,
        consent: true,
      });
      showToast(
        result.status === "already_waiting"
          ? "You're already on the waitlist."
          : "You're on the waitlist.",
        result.status === "already_waiting" ? "info" : "success",
      );
      onClose();
    } catch {
      showToast("Couldn't add you to the waitlist. Try again.", "error");
    }
  }, [
    canSubmit,
    ticket,
    mutation,
    eventId,
    cleanEmail,
    cleanPhone,
    name,
    qty,
    showToast,
    onClose,
  ]);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <View
        style={[styles.body, { paddingBottom: keyboardPadding + spacing.lg }]}
      >
        <Text style={styles.title}>Join waitlist</Text>
        <Text style={styles.subtitle}>{ticket?.name ?? "Ticket"}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={textTokens.quaternary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, !emailValid && styles.inputError]}
            accessibilityLabel="Waitlist email"
          />
          {!emailValid ? (
            <Text style={styles.errorText}>Enter a valid email.</Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Phone</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 0100"
            placeholderTextColor={textTokens.quaternary}
            keyboardType="phone-pad"
            style={styles.input}
            accessibilityLabel="Waitlist phone"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Optional"
            placeholderTextColor={textTokens.quaternary}
            style={styles.input}
            accessibilityLabel="Waitlist name"
          />
        </View>

        <View style={styles.qtyRow}>
          <Text style={styles.label}>Quantity</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setQty((prev) => Math.max(1, prev - 1))}
              accessibilityRole="button"
              accessibilityLabel="Decrease waitlist quantity"
              style={styles.stepperBtn}
            >
              <Text style={styles.stepperText}>-</Text>
            </Pressable>
            <Text style={styles.qtyText}>{qty}</Text>
            <Pressable
              onPress={() => setQty((prev) => Math.min(maxQty, prev + 1))}
              accessibilityRole="button"
              accessibilityLabel="Increase waitlist quantity"
              style={styles.stepperBtn}
            >
              <Text style={styles.stepperText}>+</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={() => setConsent((prev) => !prev)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consent }}
          accessibilityLabel="Consent to waitlist messages"
          style={styles.consentRow}
        >
          <View style={[styles.checkbox, consent && styles.checkboxOn]}>
            {consent ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          <Text style={styles.consentText}>
            I'm OK with Mingla emailing or texting me only about this event's
            waitlist.
          </Text>
        </Pressable>

        {!hasContact ? (
          <Text style={styles.errorText}>Add an email or phone number.</Text>
        ) : null}

        <Button
          label={mutation.isPending ? "Joining..." : "Join waitlist"}
          onPress={handleSubmit}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          accessibilityLabel="Submit waitlist signup"
        />
      </View>

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind={toast.kind}
          message={toast.message}
          onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
        />
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  subtitle: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  input: {
    minHeight: 46,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    paddingHorizontal: spacing.md,
    fontSize: typography.body.fontSize,
  },
  inputError: {
    borderColor: semantic.error,
  },
  errorText: {
    color: semantic.error,
    fontSize: typography.caption.fontSize,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  stepperText: {
    color: accent.warm,
    fontSize: 20,
    fontWeight: "700",
  },
  qtyText: {
    minWidth: 28,
    textAlign: "center",
    color: textTokens.primary,
    fontSize: 17,
    fontWeight: "700",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: glass.border.chrome,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.chrome.idle,
    marginTop: 1,
  },
  checkboxOn: {
    borderColor: accent.warm,
    backgroundColor: accent.warm,
  },
  checkmark: {
    color: "#0c0e12",
    fontSize: 14,
    fontWeight: "800",
  },
  consentText: {
    flex: 1,
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    zIndex: 10,
  },
});
