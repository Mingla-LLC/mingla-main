/**
 * #4541 R2.10 (design v10 D) — "Questions from {brand}" inside the dark cart
 * sheet, after "Contact for this booking" and before the payment plan and the
 * totals. Events and experiences only (trip forms are after-purchase only).
 *
 * It reports what the cart's button and request need (`onStateChange`):
 *   - the capability marker `brandFormStep: 1` once the read has succeeded
 *     (including "no form"), so this build's orders stop landing "to answer";
 *   - `brandForm` only for a live on-page form with answers that is not
 *     already answered for this event (R1.1 answeredHere);
 *   - whether "Continue to Payment" may go on: a required form holds it until
 *     the required visible questions are answered; a failed read holds it with
 *     Try again (Q1).
 * Typed answers survive a re-quote, a remount and a "questions changed"
 * refusal (kept by question id). Every refusal in the R2.10 table is explained
 * here, and nothing is ever charged on one.
 */
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  answerDisplayText,
  BrandFormRenderer,
  BrandHeader,
  brandHeaderFromServer,
  missingRequiredIds,
  visibleAnswers,
  visibleQuestions,
  type BrandAnswers,
  type BrandFormDefinitionShape,
} from "@mingla/form-rendering";

import { useCheckoutForm } from "../../hooks/useBrandForm";
import type { CheckoutBrandForm } from "../../services/brandFormService";
import {
  readCheckoutFormRefusal,
  subscribeCheckoutFormRefusal,
  type CheckoutFormRefusalCode,
} from "./checkoutFormRefusal";
import { remapAnswersById } from "./formRoute";
import { FORM_DARK, useFormPrimitives } from "./useFormPrimitives";

export interface CheckoutQuestionsState {
  /** False holds "Continue to Payment". */
  ready: boolean;
  /** Why it is held (shown under the button), or null. */
  hint: string | null;
  /** The capability marker: sent once the read succeeded. */
  brandFormStep?: 1;
  /** The answers to send, when there are any to send. */
  brandForm?: { formId: string; versionId: string; answers: BrandAnswers };
}

/** Typed answers per event, kept while the cart remounts (memory only). */
const typedByEvent = new Map<string, { formId: string; answers: BrandAnswers }>();

/** Clear what was typed for an event (after a booking, and in tests). */
export function forgetCheckoutAnswers(eventId?: string): void {
  if (eventId === undefined) typedByEvent.clear();
  else typedByEvent.delete(eventId);
}

/** What the cart needs from the read and the answers. Pure; exported for tests. */
export function checkoutQuestionsState(input: {
  status: "pending" | "error" | "success";
  form: CheckoutBrandForm | null | undefined;
  answers: BrandAnswers;
  hints: { loading: string; load: string; answer: string };
  blockedByRefusal?: boolean;
}): CheckoutQuestionsState {
  const { status, form } = input;
  if (status === "pending" && form === undefined) return { ready: false, hint: input.hints.loading };
  if (status === "error" && form === undefined) return { ready: false, hint: input.hints.load };
  if (input.blockedByRefusal === true) return { ready: false, hint: input.hints.load, brandFormStep: 1 };
  if (form === null || form === undefined || form.mode === "after_purchase" || form.answeredHere) {
    return { ready: true, hint: null, brandFormStep: 1 };
  }
  const def = form.definition as BrandFormDefinitionShape;
  const answers = visibleAnswers(def, input.answers);
  const missing = missingRequiredIds(def, input.answers).length > 0;
  const brandForm = Object.keys(answers).length > 0
    ? { formId: form.formId, versionId: form.versionId, answers }
    : undefined;
  if (form.mode === "required_step" && missing) {
    return { ready: false, hint: input.hints.answer, brandFormStep: 1, ...(brandForm ? { brandForm } : {}) };
  }
  return { ready: true, hint: null, brandFormStep: 1, ...(brandForm ? { brandForm } : {}) };
}

const REFUSAL_KEY: Record<CheckoutFormRefusalCode, string> = {
  form_answers_required: "refusedRequired",
  form_answers_invalid: "refusedInvalid",
  form_changed: "refusedChanged",
  brand_form_check_failed: "refusedCheckFailed",
  brand_form_stash_failed: "refusedStashFailed",
  brand_form_step_invalid: "refusedStepInvalid",
};

export interface CheckoutQuestionsBlockProps {
  eventId: string;
  /** Off for trips and while the cart is closed or signed out. */
  enabled: boolean;
  disabled: boolean;
  /** The buyer pressed the button while only the questions were left. */
  highlight: boolean;
  onStateChange: (state: CheckoutQuestionsState) => void;
  /** After a failed Try again (no retry loop): leave the cart. */
  onBackToEvent: () => void;
}

export function CheckoutQuestionsBlock({
  eventId,
  enabled,
  disabled,
  highlight,
  onStateChange,
  onBackToEvent,
}: CheckoutQuestionsBlockProps): React.ReactElement | null {
  const { t } = useTranslation("forms");
  const primitives = useFormPrimitives();
  const query = useCheckoutForm(eventId, enabled);
  const form = query.data;
  const [answers, setAnswersState] = useState<BrandAnswers>(() => typedByEvent.get(eventId)?.answers ?? {});
  const [failedRetries, setFailedRetries] = useState(0);
  const refusal = useSyncExternalStore(
    subscribeCheckoutFormRefusal,
    () => readCheckoutFormRefusal(eventId),
    () => null,
  );

  const setAnswers = useCallback((next: BrandAnswers) => {
    setAnswersState(next);
    if (form) typedByEvent.set(eventId, { formId: form.formId, answers: next });
  }, [eventId, form]);

  // A new read: keep typed answers by question id; else start from the
  // buyer's own earlier answer (prefill from another event, editable).
  useEffect(() => {
    if (!form || form.answeredHere) return;
    setAnswersState((prev) => {
      const typed = typedByEvent.get(eventId);
      const base = typed !== undefined && typed.formId === form.formId ? typed.answers : prev;
      const kept = remapAnswersById(base, form.definition as BrandFormDefinitionShape);
      if (Object.keys(kept).length > 0) return kept;
      return remapAnswersById(form.prefill ?? {}, form.definition as BrandFormDefinitionShape);
    });
  }, [form, eventId]);

  // A "questions changed" or "couldn't check" refusal reloads the form.
  const refusalSeq = refusal?.seq ?? 0;
  const refusalCode = refusal?.code ?? null;
  const refetch = query.refetch;
  const [reloadedSeq, setReloadedSeq] = useState(0);
  useEffect(() => {
    if (refusalCode !== "form_changed" && refusalCode !== "brand_form_check_failed") return;
    void refetch().then((r) => {
      if (r.status === "success") setReloadedSeq(refusalSeq);
    });
  }, [refusalSeq, refusalCode, refetch]);

  // "Questions couldn't load": the button stays off until a reload succeeds.
  const blockedByRefusal = refusalCode === "brand_form_check_failed" && reloadedSeq !== refusalSeq;
  const state = useMemo(() => checkoutQuestionsState({
    status: query.status,
    form,
    answers,
    hints: {
      loading: t("checkoutLoading"),
      load: failedRetries > 0 ? t("checkoutStillFailed") : t("checkoutLoadToContinue"),
      answer: t("needsAnswers"),
    },
    blockedByRefusal,
  }), [query.status, form, answers, t, failedRetries, blockedByRefusal]);
  const stateKey = JSON.stringify(state);
  useEffect(() => {
    onStateChange(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reported when its content changes
  }, [stateKey]);

  const fieldErrors = useMemo(() => {
    if (refusal?.code !== "form_answers_invalid") return undefined;
    const out: Record<string, string> = {};
    for (const [id, code] of Object.entries(refusal.errors)) {
      out[id] = code === "required" ? t("fieldRequired")
        : code === "option" ? t("fieldOption")
        : code === "too_long" ? t("fieldTooLong")
        : t("fieldType");
    }
    return out;
  }, [refusal, t]);

  if (!enabled) return null;

  if (query.status === "pending" && form === undefined) {
    return (
      <View style={styles.card} testID="checkout-questions-loading">
        <ActivityIndicator color={FORM_DARK.text3} />
        <Text style={styles.note}>{t("checkoutLoading")}</Text>
      </View>
    );
  }
  if (query.status === "error" && form === undefined) {
    const retry = (): void => {
      void query.refetch().then((r) => {
        if (r.status === "error") setFailedRetries((n) => n + 1);
      });
    };
    return (
      <View style={styles.card} accessibilityRole="alert" testID="checkout-questions-failed">
        <Text style={styles.noteStrong}>{failedRetries > 0 ? t("checkoutStillFailed") : t("checkoutLoadToContinue")}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={failedRetries > 0 ? onBackToEvent : retry}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          testID="checkout-questions-retry"
        >
          <Text style={styles.secondaryText}>{failedRetries > 0 ? t("backToEvent") : t("tryAgain")}</Text>
        </Pressable>
      </View>
    );
  }
  if (form === null || form === undefined || form.mode === "after_purchase") return null;

  const def = form.definition as BrandFormDefinitionShape;
  const brand = typeof form.brand.displayName === "string" && form.brand.displayName.trim().length > 0
    ? form.brand.displayName.trim()
    : t("theHost");
  const refusalLine = refusal !== null ? t(REFUSAL_KEY[refusal.code]) : null;
  const required = form.mode === "required_step";
  const missing = missingRequiredIds(def, answers).length > 0;

  return (
    <View style={styles.card} testID="checkout-questions">
      <BrandHeader
        brand={brandHeaderFromServer(form.brand)}
        primitives={primitives}
        compact
        caption={t("checkoutTitle", { brand })}
      />
      {!required && !form.answeredHere ? <Text style={styles.note}>{t("checkoutOptional")}</Text> : null}
      {refusalLine !== null ? (
        <Text accessibilityRole="alert" style={styles.refusal} testID="checkout-questions-refusal">{refusalLine}</Text>
      ) : null}
      {form.answeredHere ? (
        <View style={styles.answered} testID="checkout-questions-answered">
          <Text style={styles.noteStrong}>{t("checkoutAnsweredHere")}</Text>
          {visibleQuestions(def, form.prefill ?? {}).map((q) => (
            <View key={q.id} style={styles.answerRow}>
              <Text style={styles.answerLabel}>{q.label}</Text>
              <Text style={styles.answerValue}>{answerDisplayText(q, (form.prefill ?? {})[q.id]) ?? t("notAnswered")}</Text>
            </View>
          ))}
        </View>
      ) : (
        <BrandFormRenderer
          definition={def}
          answers={answers}
          onAnswersChange={setAnswers}
          primitives={primitives}
          doorFullAnswers={form.doorFullAnswers}
          validationErrors={fieldErrors}
          disabled={disabled}
        />
      )}
      {required && missing && !form.answeredHere && highlight ? (
        <Text accessibilityRole="alert" style={styles.refusal}>{t("needsAnswers")}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FORM_DARK.line,
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 14,
    gap: 12,
    overflow: "hidden",
  },
  note: { color: FORM_DARK.text2, fontSize: 13, lineHeight: 18, textAlign: "left" },
  noteStrong: { color: FORM_DARK.text1, fontSize: 14, lineHeight: 20, fontWeight: "600", textAlign: "left" },
  refusal: {
    color: FORM_DARK.text1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: FORM_DARK.danger,
    padding: 10,
    textAlign: "left",
  },
  answered: { gap: 10 },
  answerRow: { gap: 2 },
  answerLabel: { color: FORM_DARK.text3, fontSize: 13, lineHeight: 18, textAlign: "left" },
  answerValue: { color: FORM_DARK.text1, fontSize: 15, lineHeight: 21, textAlign: "left" },
  secondary: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FORM_DARK.line,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryText: { color: FORM_DARK.text1, fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.72 },
});

export default CheckoutQuestionsBlock;
