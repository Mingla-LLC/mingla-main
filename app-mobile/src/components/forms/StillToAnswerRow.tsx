/**
 * #4541 R2.6 (design v10 B) — "Still to answer · {n}" at the top of Purchases.
 * Shown only when the signed-in guest has a live, unanswered form in mode
 * required_step or after_purchase. Tapping opens the first one; Back returns
 * to Purchases.
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useMyPendingForms } from "../../hooks/useBrandForm";
import type { PendingBrandForm } from "../../services/brandFormService";
import { eventIsOver, formRoutePath } from "./formRoute";
import { FORM_DARK } from "./useFormPrimitives";

/** The rows the line counts, in the server's order. Pure; exported for tests. */
export function stillToAnswer(rows: readonly PendingBrandForm[] | undefined): PendingBrandForm[] {
  return (rows ?? []).filter((row) =>
    !row.answered && row.formStatus === "live" && !eventIsOver(row.eventStatus) &&
    (row.mode === "required_step" || row.mode === "after_purchase")
  );
}

export function StillToAnswerRow(): React.ReactElement | null {
  const { t } = useTranslation("forms");
  const router = useRouter();
  const pending = useMyPendingForms();
  const rows = stillToAnswer(pending.data);
  const first = rows[0];
  if (first === undefined) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("stillToAnswerA11y", { count: rows.length })}
      onPress={() => router.push(formRoutePath({
        formId: first.formId,
        eventId: first.eventId,
        as: first.subject.kind,
        sid: first.subject.id,
        from: first.subject.kind === "order" ? "ticket" : "pass",
      }) as never)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID="form-still-to-answer"
    >
      <Text style={styles.text}>{t("stillToAnswer", { count: rows.length })}</Text>
      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FORM_DARK.accentLine,
    backgroundColor: FORM_DARK.accentWash,
    paddingHorizontal: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  text: { color: FORM_DARK.text1, fontSize: 15, fontWeight: "700", textAlign: "left", flex: 1 },
  chevron: { color: FORM_DARK.text2, fontSize: 24 },
  pressed: { opacity: 0.72 },
});

export default StillToAnswerRow;
