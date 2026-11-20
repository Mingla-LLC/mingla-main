/**
 * #4514 wave 5 — the buyer checkout's Questions step (BUILD CONTRACT v2 §5.4)
 * and the "After they purchase" hand-off (§5.5), for tickets and experiences.
 *
 * Reached ONLY through the forms lazy owner (`./formRenderingPrimitives`), so
 * this file, its service and the renderers load in the one forms chunk and
 * never in the eager bundle. It loads nothing lazily of its own (a nested lazy
 * load between forms modules cost +49 KB once). Anonymous-tolerant: no auth hook.
 *
 * CheckoutQuestionsStep
 *   - Always mounted on the Details step; while `visible` is false it renders
 *     nothing and only reports what the page needs (`onProbe`): no step, an
 *     optional step or a required step. A read that fails reports "error" and
 *     the Details step carries on without the step: the server is the authority
 *     and answers `form_answers_required`, which reopens the step (a weak
 *     connection never locks buying, #4518).
 *   - Visible: the compact brand strip, the form, and its own footer. Required:
 *     Continue stays off with "Answer the required questions to continue".
 *     Optional: Continue or Skip.
 *   - No form to show (form === null: a failed read, or the server refused a
 *     form this read cannot see) is NEVER a dead end (review fix 2): Continue
 *     stays on, the server stays the authority, and a refusal with no form
 *     shows a plain line and a Try again that re-reads the form.
 *   - Answers are kept on screen through a refusal; a newer version of the
 *     form drops only the answers of questions that no longer exist.
 *
 * PurchaseFormHandoff (confirm screens): asks for the buyer's own form link
 * and opens `/form/{formId}` (web: the token goes through sessionStorage, read
 * once by the link page; native: the web link). Never an invite.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { BrandAnswers } from "@mingla/form-rendering";
import { BrandFormRenderer, BrandHeader } from "@mingla/form-rendering";

import { space, type } from "../../../constants/designSystem";
import { checkoutFormKeys } from "./checkoutFormKeys";
import {
  fetchCheckoutForm,
  purchaseHandedOffStorageKey,
  purchaseTokenStorageKey,
  requestPurchaseFormLink,
  type CheckoutForm,
} from "../../../services/checkoutBrandFormService";
import { CHECKOUT_FORM_COPY, checkoutFormRefusalCopy } from "./checkoutFormCopy";
import { Button } from "../../ui/Button";
import { checkoutStyles, color } from "../checkoutTheme";
import type { CheckoutBrandFormAnswers } from "../CartContext";
import { businessFormPrimitives } from "./businessFormPrimitives";

export type CheckoutFormProbe = "loading" | "none" | "required" | "optional" | "error";

/** What the page's form asks of checkout. Pure; exported for tests. */
export function probeOf(
  status: "pending" | "error" | "success",
  form: CheckoutForm | null | undefined,
): CheckoutFormProbe {
  if (status === "pending") return "loading";
  if (status === "error") return "error";
  if (!form) return "none";
  if (form.mode === "required_step") return "required";
  if (form.mode === "optional_on_page") return "optional";
  return "none";
}

/** Keep the answers of questions that still exist in this version. Pure; exported for tests. */
export function answersForForm(
  form: CheckoutForm,
  value: CheckoutBrandFormAnswers | null,
): BrandAnswers {
  if (value === null || value.formId !== form.formId || form.definition === null) return {};
  const ids = new Set(form.definition.questions.map((q) => q.id));
  const out: BrandAnswers = {};
  for (const [id, answer] of Object.entries(value.answers)) {
    if (!ids.has(id)) continue;
    out[id] = typeof answer === "number" ? String(answer) : answer;
  }
  return out;
}

export const checkoutFormQueryOptions = (eventId: string, ticketLinkToken: string | null = null) => ({
  queryKey: checkoutFormKeys.forEvent(eventId, ticketLinkToken !== null),
  queryFn: () => fetchCheckoutForm(eventId, ticketLinkToken),
  staleTime: 30_000,
  retry: 1,
});

/**
 * Review fix 2: whether Continue is on. A form on screen gates on its required
 * answers; NO form on screen never disables Continue (the server decides).
 * Pure; exported for tests.
 */
export function canContinueStep(input: {
  submitting: boolean;
  loading: boolean;
  form: CheckoutForm | null;
  missing: boolean;
}): boolean {
  if (input.submitting || input.loading) return false;
  if (input.form === null) return true;
  return input.form.mode !== "required_step" || !input.missing;
}

export interface CheckoutQuestionsStepProps {
  eventId: string;
  /** The private ticket link the buyer checks out with (#3827), if any. */
  ticketLinkToken?: string | null;
  /** false on the Details step: render nothing, only report the probe. */
  visible: boolean;
  value: CheckoutBrandFormAnswers | null;
  onChange: (next: CheckoutBrandFormAnswers | null) => void;
  onProbe: (probe: CheckoutFormProbe) => void;
  /** A refusal code from the create call; reloads the form and is explained on top. */
  refusal: string | null;
  /** Continue with these answers (null: skipped or nothing to answer). */
  onContinue: (answers: CheckoutBrandFormAnswers | null) => void;
  continueLabel: string;
  submitting: boolean;
  /** A create error the details screen would show (kept visible on this step). */
  submitError?: string | null;
}

export const CheckoutQuestionsStep: React.FC<CheckoutQuestionsStepProps> = ({
  eventId,
  ticketLinkToken = null,
  visible,
  value,
  onChange,
  onProbe,
  refusal,
  onContinue,
  continueLabel,
  submitting,
  submitError = null,
}) => {
  const query = useQuery(checkoutFormQueryOptions(eventId, ticketLinkToken));
  const form = query.data ?? null;
  const probe = probeOf(query.status, form);
  useEffect(() => {
    onProbe(probe);
  }, [probe, onProbe]);

  // A refusal means the server saw a different form than this screen: reload it.
  const refetch = query.refetch;
  useEffect(() => {
    if (refusal !== null) void refetch();
  }, [refusal, refetch]);

  const [missing, setMissing] = useState<boolean>(true);
  const handleMissing = useCallback((ids: string[]): void => setMissing(ids.length > 0), []);
  const answers = useMemo(() => (form ? answersForForm(form, value) : {}), [form, value]);
  const formRef = useRef(form);
  formRef.current = form;
  const handleAnswers = useCallback(
    (next: BrandAnswers): void => {
      const f = formRef.current;
      if (f === null || f.versionId === null) return;
      onChange({ formId: f.formId, versionId: f.versionId, answers: next });
    },
    [onChange],
  );

  if (!visible) return null;

  const required = form?.mode === "required_step";
  const loadFailed = query.status === "error";
  const loading = query.status === "pending" || (query.isFetching && form === null);
  const canContinue = canContinueStep({ submitting, loading, form, missing });
  // The server asked for answers this screen has no form for: say so plainly
  // and offer Try again; Continue stays on (never a disabled dead end).
  const refusedWithoutForm = form === null && refusal !== null && !loading;
  const reason = loadFailed
    ? CHECKOUT_FORM_COPY.loadFailed
    : required && missing
      ? CHECKOUT_FORM_COPY.needsAnswers
      : null;
  const refusalLine = refusedWithoutForm
    ? CHECKOUT_FORM_COPY.noFormRefused
    : checkoutFormRefusalCopy(refusal);
  const payload = (): CheckoutBrandFormAnswers | null =>
    form !== null && form.versionId !== null
      ? { formId: form.formId, versionId: form.versionId, answers }
      : null;

  return (
    <View style={styles.host} testID="checkout-questions-step" accessibilityLiveRegion="polite">
      {form !== null ? (
        <BrandHeader
          brand={form.brand}
          primitives={businessFormPrimitives}
          compact
          caption={CHECKOUT_FORM_COPY.caption(form.brand.displayName)}
        />
      ) : null}
      {refusalLine !== null ? (
        <Text style={styles.refusal} accessibilityRole="alert" testID="checkout-questions-refusal">
          {refusalLine}
        </Text>
      ) : null}
      {submitError !== null ? (
        <Text style={styles.refusal} accessibilityRole="alert">
          {submitError}
        </Text>
      ) : null}
      {loading ? <Text style={styles.note}>{CHECKOUT_FORM_COPY.loading}</Text> : null}
      {loadFailed || refusedWithoutForm ? (
        <Button
          label={CHECKOUT_FORM_COPY.tryAgain}
          variant="secondary"
          size="md"
          onPress={() => void refetch()}
          testID="checkout-questions-retry"
        />
      ) : null}
      {form !== null && form.definition !== null ? (
        <>
          <Text style={styles.title} numberOfLines={2}>
            {form.name}
          </Text>
          {!required ? <Text style={styles.note}>{CHECKOUT_FORM_COPY.optionalNote}</Text> : null}
          <BrandFormRenderer
            definition={form.definition}
            answers={answers}
            onAnswersChange={handleAnswers}
            onMissingChange={handleMissing}
            primitives={businessFormPrimitives}
            doorFullAnswers={form.doorFullAnswers}
            disabled={submitting}
          />
        </>
      ) : null}
      <View style={styles.footer}>
        <Button
          label={continueLabel}
          variant="primary"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!canContinue}
          onPress={() => onContinue(payload())}
          testID="checkout-questions-continue"
        />
        {reason !== null ? (
          <Text style={styles.note} testID="checkout-questions-reason">
            {reason}
          </Text>
        ) : null}
        {!required && form !== null ? (
          <Button
            label={CHECKOUT_FORM_COPY.skip}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            onPress={() => {
              onChange(null);
              onContinue(null);
            }}
            testID="checkout-questions-skip"
          />
        ) : null}
      </View>
    </View>
  );
};

export interface PurchaseFormHandoffProps {
  checkoutSessionId: string | null;
  buyerStatusToken: string | null;
}

/** Review fix 4: handed-off sessions this app run (native, or no storage). */
const handedOff = new Set<string>();

/** Has this checkout session already been sent to its form? Web keeps it per tab session. */
export function purchaseHandedOff(checkoutSessionId: string): boolean {
  if (handedOff.has(checkoutSessionId)) return true;
  try {
    return globalThis.sessionStorage?.getItem(purchaseHandedOffStorageKey(checkoutSessionId)) === "1";
  } catch {
    return false;
  }
}

/** Record the hand-off BEFORE redirecting, so "Later" and a reload stay on the success screen. */
export function markPurchaseHandedOff(checkoutSessionId: string): void {
  handedOff.add(checkoutSessionId);
  try {
    globalThis.sessionStorage?.setItem(purchaseHandedOffStorageKey(checkoutSessionId), "1");
  } catch (error) {
    console.error("[checkout-after-purchase] hand-off flag not saved", error);
  }
}

/**
 * "After they purchase": once per checkout session, ask for the buyer's form
 * link and open it. Renders a one-line fallback only when the link could not be had.
 */
export const PurchaseFormHandoff: React.FC<PurchaseFormHandoffProps> = ({
  checkoutSessionId,
  buyerStatusToken,
}) => {
  const router = useRouter();
  const asked = useRef<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  useEffect(() => {
    if (checkoutSessionId === null || buyerStatusToken === null || buyerStatusToken.length < 32) return;
    if (asked.current === checkoutSessionId || purchaseHandedOff(checkoutSessionId)) return;
    asked.current = checkoutSessionId;
    let live = true;
    requestPurchaseFormLink({ checkoutSessionId, buyerStatusToken })
      .then((result) => {
        if (!live || result.outcome !== "link") return;
        if (Platform.OS === "web") {
          try {
            globalThis.sessionStorage?.setItem(purchaseTokenStorageKey(result.formId), result.token);
          } catch (error) {
            console.error("[checkout-after-purchase] token handoff failed", error);
            setFailed(true);
            return;
          }
          markPurchaseHandedOff(checkoutSessionId);
          router.push(`/form/${result.formId}?from=purchase` as never);
          return;
        }
        markPurchaseHandedOff(checkoutSessionId);
        void Linking.openURL(`https://host.usemingla.com/form/${result.formId}#t=${result.token}`);
      })
      .catch((error: unknown) => {
        console.error("[checkout-after-purchase] link request failed", error);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [checkoutSessionId, buyerStatusToken, router]);
  if (!failed) return null;
  return (
    <Text style={styles.note} testID="checkout-after-purchase-failed">
      {CHECKOUT_FORM_COPY.purchaseLinkFailed}
    </Text>
  );
};

const styles = checkoutStyles(() =>
  StyleSheet.create({
    host: { gap: space[4] },
    title: { ...type.title, color: color.text1 },
    note: { ...type.small, color: color.text2 },
    refusal: { ...type.small, color: color.errorText },
    footer: { gap: space[2], marginTop: space[2] },
  }),
);
