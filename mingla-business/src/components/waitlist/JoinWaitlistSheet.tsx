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
  radius as radiusTokens,
  space,
  color,
  type,
  materials,
} from "../../constants/designSystem";
import { useJoinWaitlistMutation } from "../../hooks/useJoinWaitlistMutation";
import { phoneStartCountryForCurrency } from "../../utils/phoneStartCountryForCurrency";
import { Button } from "../ui/Button";
import { PhoneField, usePhoneEntry } from "../ui/PhoneField";
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
  /**
   * issue #3380 — the event's currency, so the phone picker starts on the
   * event's country (a naira event opens on +234).
   */
  currency?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const JoinWaitlistSheet: React.FC<JoinWaitlistSheetProps> = ({
  visible,
  eventId,
  ticket,
  onClose,
  currency = null,
}) => {
  const mutation = useJoinWaitlistMutation();
  const [email, setEmail] = useState<string>("");
  // issue #3380 — was a free-text box ("+1 555 0100") stored exactly as typed.
  const phone = usePhoneEntry({
    startCountries: [phoneStartCountryForCurrency(currency)],
  });
  const resetPhone = phone.reset;
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
  const cleanPhone = phone.isEmpty ? "" : (phone.e164 ?? "");
  const phoneValid = phone.isEmpty || phone.e164 !== null;
  const hasContact = cleanEmail.length > 0 || cleanPhone.length > 0;
  const emailValid = cleanEmail.length === 0 || EMAIL_RE.test(cleanEmail);
  const canSubmit =
    ticket !== null &&
    hasContact &&
    emailValid &&
    phoneValid &&
    consent &&
    !mutation.isPending;

  useEffect(() => {
    if (!visible) return;
    setEmail("");
    resetPhone();
    setName("");
    setQty(1);
    setConsent(false);
    setToast({ visible: false, message: "", kind: "success" });
  }, [visible, ticket?.id, resetPhone]);

  useEffect(() => {
    // orch-strict-grep-allow orch-0892 — SPEC §8.3 mandated Cycle 3 wizard pattern (Keyboard.addListener + dynamic paddingBottom) per memory rule feedback_keyboard_never_blocks_input.md; SmartScrollView migration belongs in a follow-up ORCH covering all bespoke-keyboard sites uniformly.
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardPadding(event.endCoordinates.height);
    });
    // orch-strict-grep-allow orch-0892 — SPEC §8.3 mandated Cycle 3 wizard pattern (Keyboard.addListener + dynamic paddingBottom) per memory rule feedback_keyboard_never_blocks_input.md; SmartScrollView migration belongs in a follow-up ORCH covering all bespoke-keyboard sites uniformly.
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
        style={[
          styles.body,
          {
            // ORCH-1165: +42pt (KEYBOARD_TOOLBAR_HEIGHT) only with the keyboard
            // open, so the Done bar never covers the last field. This sheet is
            // inside a Modal host → also gets the §4.3 in-Modal toolbar.
            paddingBottom:
              keyboardPadding + space[6] + (keyboardPadding > 0 ? 42 : 0),
          },
        ]}
      >
        <Text style={styles.title}>Join waitlist</Text>
        <Text style={styles.subtitle}>{ticket?.name ?? "Ticket"}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={color.text4}
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
          <PhoneField
            entry={phone}
            placeholder="Mobile number"
            accessibilityLabel="Waitlist phone"
            testID="waitlist-join-phone"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Optional"
            placeholderTextColor={color.text4}
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
    paddingHorizontal: space[6],
    paddingTop: space[6],
    gap: space[2],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  subtitle: {
    fontSize: type.small.fontSize,
    color: color.text2,
    marginBottom: space[4],
  },
  field: {
    gap: space[1],
  },
  label: {
    fontSize: type.caption.fontSize,
    color: color.text2,
    fontWeight: "600",
  },
  input: {
    minHeight: 46,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    color: color.text1,
    paddingHorizontal: space[4],
    fontSize: type.body.fontSize,
  },
  inputError: {
    borderColor: color.danger,
  },
  errorText: {
    color: color.danger,
    fontSize: type.caption.fontSize,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space[1],
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  stepperBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: materials.chrome.glassFill,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  stepperText: {
    color: color.accent,
    fontSize: 20,
    fontWeight: "700",
  },
  qtyText: {
    minWidth: 28,
    textAlign: "center",
    color: color.text1,
    fontSize: 17,
    fontWeight: "700",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    marginVertical: space[2],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: materials.chrome.glassFill,
    marginTop: 1,
  },
  checkboxOn: {
    borderColor: color.accent,
    backgroundColor: color.accent,
  },
  checkmark: {
    color: color.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  consentText: {
    flex: 1,
    color: color.text2,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space[4],
    paddingBottom: space[6],
    zIndex: 10,
  },
});
