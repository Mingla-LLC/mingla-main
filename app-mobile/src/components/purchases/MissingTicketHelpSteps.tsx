/**
 * #4473 — the two "other ways" steps of the "Missing a ticket?" sheet.
 *
 * ConfirmationLinkStep: the confirmation link is a SHORTCUT, not a key. It opens
 *   Mingla on the ticket, and a code to the purchase email or number still
 *   proves it (claim-link never grants ownership by itself).
 * AskSenderStep: the buyer uses Send to a friend. The share message carries
 *   only this account's confirmed email and mobile, and only in the message the
 *   person chooses to share.
 */
import React, { useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import type { ClaimIdentifier } from "../../services/claimContactService";
import { askMessageContacts } from "./missingTicketModel";
import { PURCHASE_SHEET_COLORS as C } from "./purchaseSheetTheme";

/**
 * Stands in for the bold action name while i18next fills the sentence, so the
 * translated word order is kept and the name can then be drawn bold.
 */
const ACTION_SLOT = "\u2063ACTION\u2063";

/** Renders `template` with its ACTION_SLOT drawn bold. */
function WithBoldAction({
  template,
  action,
  style,
}: {
  template: string;
  action: string;
  style: object;
}): React.ReactElement {
  const parts = template.split(ACTION_SLOT);
  if (parts.length < 2) return <Text style={style}>{template}</Text>;
  const [before, ...rest] = parts;
  const after = rest.join(action);
  return (
    <Text style={style}>
      {before}
      <Text style={styles.bold}>{action}</Text>
      {after}
    </Text>
  );
}

/** Opens the mail app; falls back to a compose window; never throws. */
export async function openMailApp(): Promise<boolean> {
  const candidates = Platform.OS === "ios"
    ? ["message://", "mailto:"]
    : ["mailto:"];
  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Try the next way in.
    }
  }
  return false;
}

export function ConfirmationLinkStep({
  onDone,
}: {
  onDone: () => void;
}): React.ReactElement {
  const { t } = useTranslation("purchases");
  const [mailFailed, setMailFailed] = useState(false);
  const action = t("missing.link.action");
  const raw = (key: string): string => t(key, { action: ACTION_SLOT });
  const steps = [
    raw("missing.link.step1"),
    raw("missing.link.step2"),
    raw("missing.link.step3"),
  ];
  return (
    <View testID="missing-link-step">
      <Text accessibilityRole="header" style={styles.title}>
        {t("missing.link.title")}
      </Text>
      <WithBoldAction
        action={action}
        style={styles.description}
        template={raw("missing.link.body")}
      />
      <View style={styles.steps}>
        {steps.map((line, index) => (
          <View key={index} style={styles.stepRow}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stepDot}>
              <Text style={styles.stepDotText}>{index + 1}</Text>
            </View>
            <WithBoldAction action={action} style={styles.stepText} template={line} />
          </View>
        ))}
      </View>
      <Text style={styles.note}>{t("missing.link.note")}</Text>
      {mailFailed ? (
        <Text accessibilityRole="alert" style={styles.error} testID="missing-link-mail-failed">
          {t("missing.link.openMailFailed")}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [styles.outlineHalf, pressed && styles.pressed]}
          testID="missing-link-done"
        >
          <Text style={styles.outlineText}>{t("missing.link.done")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void openMailApp().then((opened) => setMailFailed(!opened));
          }}
          style={({ pressed }) => [styles.primaryHalf, pressed && styles.pressed]}
          testID="missing-link-open-mail"
        >
          <Text style={styles.primaryText}>{t("missing.link.openMail")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function AskSenderStep({
  identifiers,
}: {
  identifiers: readonly ClaimIdentifier[] | undefined;
}): React.ReactElement {
  const { t } = useTranslation("purchases");
  const [shareFailed, setShareFailed] = useState(false);
  const contacts = useMemo(() => askMessageContacts(identifiers), [identifiers]);
  const message = contacts.length === 0
    ? t("missing.ask.message")
    : t("missing.ask.messageWithContacts", {
      contacts: contacts.length === 2
        ? t("missing.ask.contactsPair", { first: contacts[0], second: contacts[1] })
        : contacts[0],
    });
  const share = async (): Promise<void> => {
    setShareFailed(false);
    try {
      await Share.share({ message });
    } catch {
      setShareFailed(true);
    }
  };
  return (
    <View testID="missing-ask-step">
      <Text accessibilityRole="header" style={styles.title}>
        {t("missing.ask.title")}
      </Text>
      <WithBoldAction
        action={t("missing.ask.action")}
        style={styles.description}
        template={t("missing.ask.body", { action: ACTION_SLOT })}
      />
      <View style={styles.preview}>
        <Text style={styles.previewLabel}>{t("missing.ask.previewLabel")}</Text>
        <Text selectable style={styles.previewText} testID="missing-ask-message">
          {message}
        </Text>
      </View>
      <Text style={styles.note}>{t("missing.ask.privacy")}</Text>
      {shareFailed ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("missing.ask.shareFailed")}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => { void share(); }}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        testID="missing-ask-share"
      >
        <Text style={styles.primaryText}>{t("missing.ask.share")}</Text>
      </Pressable>
      <Text style={styles.centerNote}>{t("missing.ask.shareHint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 24, lineHeight: 30, fontWeight: "800" },
  description: {
    color: C.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  bold: { color: C.text, fontWeight: "700" },
  steps: { gap: 12, marginTop: 16 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotText: { color: C.accent, fontSize: 13, fontWeight: "800" },
  stepText: { flex: 1, color: C.text, fontSize: 15, lineHeight: 21 },
  note: { color: C.textMeta, fontSize: 12, lineHeight: 17, marginTop: 12 },
  centerNote: {
    color: C.textMeta,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    textAlign: "center",
  },
  error: { color: C.error, fontSize: 13, lineHeight: 18, marginTop: 10 },
  row: { flexDirection: "row", gap: 8, marginTop: 16 },
  outlineHalf: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineText: { color: C.text, fontSize: 15, fontWeight: "700" },
  primaryHalf: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  preview: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.field,
  },
  previewLabel: {
    color: C.textMeta,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  previewText: { color: C.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
  pressed: { opacity: 0.7 },
});
