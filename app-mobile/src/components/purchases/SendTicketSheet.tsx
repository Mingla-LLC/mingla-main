import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import {
  PURCHASE_SHEET_BACKGROUND,
  PURCHASE_SHEET_COLORS as C,
  PURCHASE_SHEET_HANDLE,
  PURCHASE_SHEET_PHONE_THEME,
} from "./purchaseSheetTheme";
import {
  PURCHASE_SHEET_KEYBOARD_TOOLBAR,
  SheetKeyboardDoneBar,
  sheetDoneBarId,
} from "./SheetKeyboardDoneBar";

const NAME_DONE_BAR_ID = sheetDoneBarId("send-name");
const EMAIL_DONE_BAR_ID = sheetDoneBarId("send-email");

type Props = {
  ticket: PurchaseTicket | null;
  total: number;
  visible: boolean;
  onClose: () => void;
  onSent: () => Promise<void> | void;
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
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

  /**
   * #4473 D7 — the sheet lifts with the keyboard (its Done bars are part of
   * the keyboard), and focusing the mobile number scrolls the form to its end
   * once the keyboard has settled, so the field and Send ticket sit above it
   * on an iPhone SE. Runs on the field's own focus; no keyboard listener.
   */
  const revealOnFocus = useCallback((where: "top" | "end"): void => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (where === "top") {
      scrollFormTo(0);
      return;
    }
    revealTimer.current = setTimeout(() => {
      formScrollRef.current?.scrollToEnd({ animated: true });
    }, 280);
  }, [scrollFormTo]);

  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
  }, []);

  useEffect(() => {
    if (visible) return;
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
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      keyboardToolbar={PURCHASE_SHEET_KEYBOARD_TOOLBAR}
      android_keyboardInputMode="adjustResize"
      snapPoints={["68%"]}
      topInset={insets.top}
      theme="dark"
      backgroundStyle={PURCHASE_SHEET_BACKGROUND}
      handleStyle={PURCHASE_SHEET_HANDLE}
      visible={visible}
      wrapInRNModal
    >
      <View style={styles.body}>
        <Text style={styles.title}>
          {t("send.sheetTitle", { index: ticket?.ticketIndex ?? 1 })}
        </Text>
        <Text style={styles.label}>{t("send.nameLabel")}</Text>
        <BottomSheetTextInput
          accessibilityLabel={t("send.nameLabel")}
          inputAccessoryViewID={NAME_DONE_BAR_ID}
          autoCapitalize="words"
          editable={!busy}
          maxLength={60}
          onChangeText={setName}
          onFocus={() => revealOnFocus("top")}
          placeholder={t("send.namePlaceholder")}
          placeholderTextColor={C.placeholder}
          style={styles.input}
          testID="send-ticket-name"
          value={name}
        />
        <SheetKeyboardDoneBar nativeID={NAME_DONE_BAR_ID} />
        <Text style={styles.label}>{t("send.emailLabel")}</Text>
        <BottomSheetTextInput
          accessibilityLabel={t("send.emailLabel")}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!busy}
          inputAccessoryViewID={EMAIL_DONE_BAR_ID}
          keyboardType="email-address"
          onChangeText={setEmail}
          onFocus={() => revealOnFocus("top")}
          placeholder={t("send.emailPlaceholder")}
          placeholderTextColor={C.placeholder}
          style={styles.input}
          testID="send-ticket-email"
          textContentType="emailAddress"
          value={email}
        />
        <SheetKeyboardDoneBar nativeID={EMAIL_DONE_BAR_ID} />
        <Text style={styles.label}>{t("send.phoneLabel")}</Text>
        <View style={styles.phoneField}>
          <PhoneInput
            countryCode={countryCode}
            disabled={busy}
            error={phoneProblem}
            inputComponent={BottomSheetTextInput}
            onBlur={() => setPhoneTouched(true)}
            onChangeCountry={setCountryCode}
            onChangePhone={setPhoneInput}
            onFocus={() => revealOnFocus("end")}
            phoneInputAccessibilityLabel={t("send.phoneLabel")}
            required
            smartEntry
            testID="send-ticket-phone"
            theme={PURCHASE_SHEET_PHONE_THEME}
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
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36 },
  title: {
    color: C.text,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 20,
  },
  input: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.borderStrong,
    backgroundColor: C.field,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  label: {
    color: C.textLabel,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 7,
  },
  phoneField: { marginBottom: 10 },
  deliveryNote: { color: C.textMeta, fontSize: 12, lineHeight: 18 },
  explainer: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.field,
    overflow: "hidden",
  },
  error: { color: C.error, fontSize: 13, lineHeight: 18, marginTop: 13 },
  submit: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  position: {
    color: C.textMeta,
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
  },
  pressed: { opacity: 0.65 },
});
