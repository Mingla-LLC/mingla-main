import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { BaseBottomSheet, BottomSheetTextInput } from "../ui/BaseBottomSheet";
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
const E164_SHAPE = /^\+[1-9]\d{7,14}$/;

export function SendTicketSheet({
  ticket,
  total,
  visible,
  onClose,
  onSent,
}: Props): React.ReactElement {
  const { t } = useTranslation("purchases");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedContact = useMemo(
    () =>
      contact.includes("@")
        ? contact.trim().toLowerCase()
        : contact.replace(/[\s()-]/g, ""),
    [contact],
  );
  const channel = contact.includes("@") ? "email" : "phone";

  useEffect(() => {
    if (visible) return;
    setName("");
    setContact("");
    setBusy(false);
    setError(null);
  }, [visible]);

  const submit = async (): Promise<void> => {
    const trimmedName = name.trim();
    const validContact =
      channel === "email"
        ? EMAIL_SHAPE.test(normalizedContact)
        : E164_SHAPE.test(normalizedContact);
    if (
      !ticket ||
      trimmedName.length < 1 ||
      trimmedName.length > 60 ||
      !validContact
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
        contact: normalizedContact,
      });
      postHogService.capture("ticket_sent", { channel });
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
          placeholder={t("send.namePlaceholder")}
          placeholderTextColor="#8b8f96"
          style={styles.input}
          value={name}
        />
        <BottomSheetTextInput
          accessibilityLabel={t("send.contactPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          keyboardType="email-address"
          onChangeText={setContact}
          placeholder={t("send.contactPlaceholder")}
          placeholderTextColor="#8b8f96"
          style={styles.input}
          value={contact}
        />
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
