/**
 * #4541 R2.6 — "Questions from {brand}": one card per order or RSVP, on the
 * purchase page (after "Show at the door") and on the RSVP pass. Design v10 B.
 *
 * One button: tapping anywhere opens the form screen with the full route.
 * Orange-tinted only while something is left to do; answered and closed cards
 * are plain. A sent-ticket holder, an unclaimed plus-one and a refunded or
 * otherwise non-current item get no card (`brand_forms_my_pending` lists
 * none). Nothing about answers is ever drawn on the ticket, QR or PDF.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { pendingFormFor, useMyPendingForms } from "../../hooks/useBrandForm";
import type { PendingBrandForm } from "../../services/brandFormService";
import { eventIsOver, formRoutePath, type FormOpenedFrom } from "./formRoute";
import { FORM_DARK } from "./useFormPrimitives";

export type QuestionsCardState =
  | "toAnswer"
  | "required"
  | "optional"
  | "answered"
  | "answeredAtCheckout"
  | "closed";

/** The card's line for one pending row (R2.6 states). Pure; exported for tests. */
export function questionsCardState(row: PendingBrandForm): QuestionsCardState {
  if (row.formStatus === "closed" || eventIsOver(row.eventStatus)) return "closed";
  if (row.answered) {
    return row.subject.kind === "order" && row.answeredSource === "page" ? "answeredAtCheckout" : "answered";
  }
  if (row.mode === "optional_on_page") return "optional";
  // A required form this guest still owes (an earlier guest, or an older app).
  if (row.required) return "required";
  return "toAnswer";
}

const LINE_KEY: Record<QuestionsCardState, string> = {
  toAnswer: "cardToAnswer",
  required: "cardToAnswer",
  optional: "cardOptional",
  answered: "cardAnswered",
  answeredAtCheckout: "cardAnsweredAtCheckout",
  closed: "cardClosed",
};

export interface QuestionsCardProps {
  /** The held item; anything other than order / rsvp / rsvp_guest draws nothing. */
  subjectKind: string | null;
  subjectId: string | null;
  eventId?: string | null;
  from: Extract<FormOpenedFrom, "ticket" | "pass">;
  /** Approved Maybe passes add "Answering doesn't change your reply." */
  maybe?: boolean;
  /** Runs before the form opens (a sheet closes itself first). */
  onBeforeOpen?: () => void;
}

export function QuestionsCard({
  subjectKind,
  subjectId,
  eventId = null,
  from,
  maybe = false,
  onBeforeOpen,
}: QuestionsCardProps): React.ReactElement | null {
  const { t } = useTranslation("forms");
  const router = useRouter();
  const held = subjectKind === "order" || subjectKind === "rsvp" || subjectKind === "rsvp_guest";
  const pending = useMyPendingForms();
  if (!held || subjectId === null) return null;

  if (pending.isPending && pending.fetchStatus !== "idle") {
    return (
      <View style={[styles.card, styles.plain]} testID="form-card-loading" accessibilityLabel={t("loading")}>
        <ActivityIndicator color={FORM_DARK.text3} />
        <View style={styles.skeletonLine} />
      </View>
    );
  }
  if (pending.isError && pending.data === undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => void pending.refetch()}
        style={({ pressed }) => [styles.card, styles.plain, pressed && styles.pressed]}
        testID="form-card-error"
      >
        <Text style={styles.meta}>{t("cardLoadFailed")}</Text>
      </Pressable>
    );
  }
  const row = pendingFormFor(pending.data, subjectKind, subjectId, eventId);
  if (row === null) return null;

  const state = questionsCardState(row);
  const brand = row.brand?.displayName?.trim() || t("theHost");
  const line = t(LINE_KEY[state]);
  const tinted = state === "toAnswer" || state === "required" || state === "optional";
  const open = (): void => {
    onBeforeOpen?.();
    router.push(formRoutePath({
      formId: row.formId,
      eventId: row.eventId,
      as: row.subject.kind,
      sid: row.subject.id,
      from,
    }) as never);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("cardA11y", { brand, form: row.formName, state: line })}
      onPress={open}
      style={({ pressed }) => [styles.card, tinted ? styles.tinted : styles.plain, pressed && styles.pressed]}
      testID="form-card"
    >
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>{t("cardTitle", { brand })}</Text>
        <Text style={styles.meta} numberOfLines={2}>{row.formName}</Text>
        <View style={styles.lineRow}>
          {state === "required" ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{t("cardRequired")}</Text>
            </View>
          ) : null}
          <Text style={tinted ? styles.lineStrong : styles.meta} testID={`form-card-${state}`}>{line}</Text>
        </View>
        {maybe ? <Text style={styles.meta}>{t("cardMaybe")}</Text> : null}
      </View>
      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  tinted: { backgroundColor: FORM_DARK.accentWash, borderColor: FORM_DARK.accentLine },
  plain: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: FORM_DARK.line },
  copy: { flex: 1, gap: 3 },
  title: { color: FORM_DARK.text1, fontSize: 15, lineHeight: 20, fontWeight: "700", textAlign: "left" },
  meta: { color: FORM_DARK.text2, fontSize: 13, lineHeight: 18, textAlign: "left" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  lineStrong: { color: FORM_DARK.text1, fontSize: 13, lineHeight: 18, fontWeight: "700", textAlign: "left" },
  pill: { borderRadius: 999, backgroundColor: FORM_DARK.text1, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { color: FORM_DARK.page, fontSize: 11, fontWeight: "800" },
  chevron: { color: FORM_DARK.text2, fontSize: 24 },
  skeletonLine: { flex: 1, height: 14, borderRadius: 7, backgroundColor: FORM_DARK.panelStrong },
  pressed: { opacity: 0.72 },
});

export default QuestionsCard;
