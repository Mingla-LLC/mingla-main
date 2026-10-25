import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { PhoneInputTheme } from "@mingla/phone-input";
import { parsePhoneEntry } from "@mingla/phone-input/phoneNumber";

import {
  BaseBottomSheet,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";
import { PhoneInput } from "../onboarding/PhoneInput";
import {
  getCountryByCode,
  getDefaultCountryCode,
} from "../../constants/countries";
import {
  offerTicketToFriend,
  TicketTransferError,
  type PurchaseTicket,
} from "../../services/purchasesService";
import { postHogService } from "../../services/postHogService";

type Props = {
  ticket: PurchaseTicket | null;
  total: number;
  visible: boolean;
  onClose: () => void;
  onSent: () => Promise<void> | void;
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEND_PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: "#fff",
  textPrimary: "#17191e",
  textTertiary: "#8b8f96",
  borderDefault: "#d8dbe0",
  borderFocused: "#eb7825",
  borderError: "#b42318",
  searchBackground: "#f4f5f7",
  rowPressedBackground: "#f4f5f7",
  divider: "#e6e8ec",
  accessoryBackground: "#fff",
  accessoryBorder: "#e6e8ec",
  accent: "#eb7825",
  errorText: "#b42318",
};

export function SendTicketSheet({
  ticket,
  total,
  visible,
  onClose,
  onSent,
}: Props): React.ReactElement {
  const { t } = useTranslation("purchases");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [countryCode, setCountryCode] = useState(getDefaultCountryCode);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formScrollRef = useRef<
    React.ElementRef<typeof BottomSheetScrollView>
  >(null);
  const focusedInputRef = useRef<"phone" | null>(null);
  const keyboardVisibleRef = useRef(false);
  const normalizedEmail = email.trim().toLowerCase();
  const selectedCountry = useMemo(
    () => getCountryByCode(countryCode),
    [countryCode],
  );
  const phoneEntry = useMemo(
    () =>
      parsePhoneEntry(phoneInput, {
        countryIso: countryCode,
        dialCode: selectedCountry?.dialCode ?? null,
        mode: "mobile",
      }),
    [countryCode, phoneInput, selectedCountry?.dialCode],
  );
  const phoneProblem =
    phoneTouched && !phoneEntry.ok ? phoneEntry.message : null;
  const scrollFormTo = useCallback((y: number): void => {
    requestAnimationFrame(() => {
      formScrollRef.current?.scrollTo({ y, animated: true });
    });
  }, []);

  useEffect(() => {
    const keyboardShown = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisibleRef.current = true;
      if (focusedInputRef.current === "phone") scrollFormTo(110);
    });
    const keyboardHidden = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisibleRef.current = false;
      scrollFormTo(0);
    });
    return () => {
      keyboardShown.remove();
      keyboardHidden.remove();
    };
  }, [scrollFormTo]);

  useEffect(() => {
    if (visible) return;
    focusedInputRef.current = null;
    keyboardVisibleRef.current = false;
    setName("");
    setEmail("");
    setPhoneInput("");
    setCountryCode(getDefaultCountryCode());
    setPhoneTouched(false);
    setBusy(false);
    setError(null);
  }, [visible]);

  const submit = async (): Promise<void> => {
    const trimmedName = name.trim();
    setPhoneTouched(true);
    if (
      !ticket ||
      trimmedName.length < 1 ||
      trimmedName.length > 60 ||
      !EMAIL_SHAPE.test(normalizedEmail) ||
      !phoneEntry.ok
    ) {
      setError(t("send.errorInvalid"));
      postHogService.capture("ticket_send_failed", { reason: "invalid" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await offerTicketToFriend({
        ticketId: ticket.id,
        name: trimmedName,
        email: normalizedEmail,
        phoneE164: phoneEntry.e164,
      });
      postHogService.capture("ticket_sent", { channel: "email_sms" });
      // Delivery already committed server-side. A cache refresh failure must not
      // present this as a failed send and invite a duplicate submission.
      try {
        await onSent();
      } catch {
        // The purchase query will retry through its normal cache lifecycle.
      }
      onClose();
    } catch (reason) {
      const code =
        reason instanceof TicketTransferError ? reason.code : "unavailable";
      postHogService.capture("ticket_send_failed", { reason: code });
      setError(
        t(
          code === "self"
            ? "send.errorSelf"
            : code === "invalid"
              ? "send.errorInvalid"
              : "send.errorGeneric",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const firstName = name.trim().split(/\s+/)[0] ?? "";
  return (
    <BaseBottomSheet
      accessibilityLabel={t("send.sheetTitle", {
        index: ticket?.ticketIndex ?? 1,
      })}
      enablePanDownToClose={!busy}
      onClose={onClose}
      scrollMode="scroll"
      scrollProps={{
        ref: formScrollRef,
        keyboardDismissMode: "interactive",
        keyboardShouldPersistTaps: "handled",
      }}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      snapPoints={["68%"]}
      theme="light"
      visible={visible}
      wrapInRNModal
    >
      <View style={styles.body}>
        <Text style={styles.title}>
          {t("send.sheetTitle", { index: ticket?.ticketIndex ?? 1 })}
        </Text>
        <BottomSheetTextInput
          accessibilityLabel={t("send.namePlaceholder")}
          autoCapitalize="words"
          editable={!busy}
          maxLength={60}
          onChangeText={setName}
          onFocus={() => {
            focusedInputRef.current = null;
            scrollFormTo(0);
          }}
          placeholder={t("send.namePlaceholder")}
          placeholderTextColor="#8b8f96"
          style={styles.input}
          value={name}
        />
        <Text style={styles.label}>{t("send.emailLabel")}</Text>
        <BottomSheetTextInput
          accessibilityLabel={t("send.emailLabel")}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!busy}
          keyboardType="email-address"
          onChangeText={setEmail}
          onFocus={() => {
            focusedInputRef.current = null;
            scrollFormTo(0);
          }}
          placeholder={t("send.emailPlaceholder")}
          placeholderTextColor="#8b8f96"
          style={styles.input}
          textContentType="emailAddress"
          value={email}
        />
        <Text style={styles.label}>{t("send.phoneLabel")}</Text>
        <View style={styles.phoneField}>
          <PhoneInput
            countryCode={countryCode}
            disabled={busy}
            error={phoneProblem}
            inputComponent={BottomSheetTextInput}
            onBlur={() => {
              focusedInputRef.current = null;
              setPhoneTouched(true);
            }}
            onChangeCountry={setCountryCode}
            onChangePhone={setPhoneInput}
            onFocus={() => {
              focusedInputRef.current = "phone";
              if (keyboardVisibleRef.current) scrollFormTo(110);
            }}
            phoneInputAccessibilityLabel={t("send.phoneLabel")}
            required
            smartEntry
            testID="send-ticket-phone"
            theme={SEND_PHONE_THEME}
            value={phoneInput}
          />
        </View>
        <Text style={styles.deliveryNote}>{t("send.deliveryNote")}</Text>
        <Text style={styles.explainer}>
          {firstName
            ? t("send.explainer", { name: firstName })
            : t("send.explainerEmpty")}
        </Text>
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            void submit();
          }}
          style={({ pressed }) => [
            styles.submit,
            (pressed || busy) && styles.pressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>{t("send.submit")}</Text>
          )}
        </Pressable>
        <Text style={styles.position}>
          {t("ticket.pageOf", {
            index: ticket?.ticketIndex ?? 1,
            total,
          })}
        </Text>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 36 },
  title: {
    color: "#17191e",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 20,
  },
  input: {
    minHeight: 54,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#d8dbe0",
    backgroundColor: "#fff",
    color: "#17191e",
    fontSize: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  label: {
    color: "#4e535b",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 7,
  },
  phoneField: { marginBottom: 10 },
  deliveryNote: { color: "#4e535b", fontSize: 13, lineHeight: 19 },
  explainer: { color: "#60656e", fontSize: 14, lineHeight: 21, marginTop: 2 },
  error: { color: "#b42318", fontSize: 13, lineHeight: 18, marginTop: 13 },
  submit: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  position: {
    color: "#8b8f96",
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
  },
  pressed: { opacity: 0.65 },
});
