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
 *   - A read that fails while the step is shown is a connection problem: it
 *     shows the one buyer connection notice (#4518 BuyerConnectionNotice),
 *     whose Try again re-reads the form; Continue stays on.
 *   - Answers are kept on screen through a refusal; a newer version of the
 *     form drops only the answers of questions that no longer exist.
 *
 * #4541 R1.1: a buyer who already answered for THIS event (`answeredHere`)
 * sees those answers read-only under "You've answered these. You can change
 * them from your ticket.", Continue is on, and no answers are sent (the marker
 * still is). Checkout never edits an earlier answer.
 *
 * PurchaseFormHandoff (confirm screens): asks for the buyer's own form link
 * and opens `/form/{formId}` (web: the token goes through sessionStorage, read
 * once by the link page; native: the web link). Never an invite.
 * #4541 R1.3: a pre-minted mode (`handoff` + `strip: "rsvp"`) for the RSVP
 * success popup: the server already minted the link, so it skips the mint and
 * shows "You're in. One more thing from {brand}." with Answer now and Later.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { BrandAnswers, BrandFormDefinitionShape } from "@mingla/form-rendering";
import {
  answerDisplayText,
  BrandFormRenderer,
  BrandHeader,
  visibleQuestions,
} from "@mingla/form-rendering";

import { space, type } from "../../../constants/designSystem";
import { checkoutFormKeys } from "./checkoutFormKeys";
import {
  checkoutFormReadFailure,
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
import { BuyerConnectionNotice } from "../../buyer/BuyerConnectionNotice";
import { isConnectionFailure } from "../../../services/connectionFailure";

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

/**
 * Keep the answers of questions that still exist in this version. With nothing
 * typed yet for this form, a returning buyer's own earlier answers (OP-5
 * prefill) fill the step. Pure; exported for tests.
 */
export function answersForForm(
  form: CheckoutForm,
  value: CheckoutBrandFormAnswers | null,
): BrandAnswers {
  if (form.definition === null) return {};
  const source =
    value !== null && value.formId === form.formId ? value.answers : (form.prefill?.answers ?? null);
  if (source === null) return {};
  const ids = new Set(form.definition.questions.map((q) => q.id));
  const out: BrandAnswers = {};
  for (const [id, answer] of Object.entries(source)) {
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
  // #4541 R1.1: answered for this event already: nothing to type here.
  if (input.form.answeredHere) return true;
  return input.form.mode !== "required_step" || !input.missing;
}

/**
 * #4541 R1.1: the read-only rows for an answer this buyer already gave for this
 * event (visible questions with an answer, in order). Pure; exported for tests.
 */
export function answeredHereRows(
  definition: BrandFormDefinitionShape,
  answers: BrandAnswers,
): Array<{ id: string; label: string; value: string }> {
  const rows: Array<{ id: string; label: string; value: string }> = [];
  for (const q of visibleQuestions(definition, answers)) {
    const value = answerDisplayText(q, answers[q.id]);
    if (value !== null) rows.push({ id: q.id, label: q.label, value });
  }
  return rows;
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
  /** P3-C: after one failed Try again the step offers this instead (no retry loop). */
  onBackToEvent?: () => void;
}

/**
 * P3-C: what the step offers when it has no form to show. First Try again;
 * once a Try again has itself failed, Back to event (never a loop). Pure;
 * exported for tests.
 */
export function recoveryAction(input: {
  failing: boolean;
  loading: boolean;
  failedRetries: number;
  canGoBack: boolean;
}): "none" | "try_again" | "back_to_event" {
  if (!input.failing || input.loading) return "none";
  return input.failedRetries >= 1 && input.canGoBack ? "back_to_event" : "try_again";
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
  onBackToEvent,
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

  // P3-C: a Try again that itself fails is counted; one is enough to offer the way out.
  const [failedRetries, setFailedRetries] = useState<number>(0);
  const retry = useCallback((): void => {
    void refetch().then((result) => {
      if (result.status === "error" || result.data === null || result.data === undefined) {
        setFailedRetries((n) => n + 1);
      }
    });
  }, [refetch]);
  // #4518: the connection notice owns its own retry state; it only needs the re-read.
  const retryConnection = useCallback((): Promise<unknown> => refetch(), [refetch]);

  const [missing, setMissing] = useState<boolean>(true);
  const handleMissing = useCallback((ids: string[]): void => setMissing(ids.length > 0), []);
  const answers = useMemo(() => (form ? answersForForm(form, value) : {}), [form, value]);
  const answeredHere = form?.answeredHere === true;
  const answeredRows = useMemo(
    () =>
      form !== null && form.answeredHere && form.definition !== null
        ? answeredHereRows(form.definition, answersForForm(form, null))
        : [],
    [form],
  );
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
  const recovery = recoveryAction({
    failing: !loadFailed && refusedWithoutForm,
    loading,
    failedRetries,
    canGoBack: onBackToEvent !== undefined,
  });
  // After a failed Try again the copy stops asking for another one.
  const retryExhausted = recovery === "back_to_event";
  const reason = !loadFailed && required && missing && !answeredHere ? CHECKOUT_FORM_COPY.needsAnswers : null;
  const refusalLine = loadFailed
    ? null
    : refusedWithoutForm
      ? retryExhausted
        ? CHECKOUT_FORM_COPY.retryFailed
        : CHECKOUT_FORM_COPY.noFormRefused
      : checkoutFormRefusalCopy(refusal);
  // #4541 R1.1: answered here sends no answers (the server ignores them anyway).
  const payload = (): CheckoutBrandFormAnswers | null =>
    form !== null && form.versionId !== null && !form.answeredHere
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
      {loadFailed ? (
        <BuyerConnectionNotice
          variant={isConnectionFailure(checkoutFormReadFailure(query.error)) ? "connection" : "server"}
          layout="inline"
          onRetry={retryConnection}
          onBack={onBackToEvent}
          testID="checkout-questions-connection"
          retryTestID="checkout-questions-retry"
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
      {loading && !loadFailed ? <Text style={styles.note}>{CHECKOUT_FORM_COPY.loading}</Text> : null}
      {recovery === "try_again" ? (
        <Button
          label={CHECKOUT_FORM_COPY.tryAgain}
          variant="secondary"
          size="md"
          onPress={retry}
          testID="checkout-questions-retry"
        />
      ) : null}
      {recovery === "back_to_event" && onBackToEvent !== undefined ? (
        <Button
          label={CHECKOUT_FORM_COPY.backToEvent}
          variant="secondary"
          size="md"
          onPress={onBackToEvent}
          testID="checkout-questions-back-to-event"
        />
      ) : null}
      {form !== null && form.definition !== null && answeredHere ? (
        <View style={styles.answered} testID="checkout-questions-answered-here">
          <Text style={styles.title} numberOfLines={2}>
            {form.name}
          </Text>
          <Text style={styles.note}>{CHECKOUT_FORM_COPY.answeredHere}</Text>
          {answeredRows.map((row) => (
            <View key={row.id} style={styles.answeredRow}>
              <Text style={styles.answeredLabel}>{row.label}</Text>
              <Text style={styles.answeredValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {form !== null && form.definition !== null && !answeredHere ? (
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
        {!required && form !== null && !answeredHere ? (
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

/**
 * Checkout mode (confirm screens): mint the buyer's link from the session.
 * Pre-minted mode (#4541 R1.3, the RSVP success popup): the server already
 * returned `{formId, token}` with the RSVP, so nothing is minted here.
 */
export type PurchaseFormHandoffProps =
  | {
      checkoutSessionId: string | null;
      buyerStatusToken: string | null;
      handoff?: undefined;
    }
  | {
      handoff: { formId: string; token: string };
      strip: "rsvp";
      /** The brand on the page, for "One more thing from {brand}." */
      brandName: string | null;
      /** #4541 A3 — the RSVP success popup's close: "Later" closes the popup. */
      onClose?: () => void;
    };

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
export const PurchaseFormHandoff: React.FC<PurchaseFormHandoffProps> = (props) =>
  props.handoff !== undefined ? (
    <PreMintedFormHandoff handoff={props.handoff} brandName={props.brandName} onClose={props.onClose} />
  ) : (
    <CheckoutFormHandoff
      checkoutSessionId={props.checkoutSessionId}
      buyerStatusToken={props.buyerStatusToken}
    />
  );

/** The guest's own form link (`#t=` is read by the link page and never sent to a server). */
export const formLinkPath = (formId: string, token: string): string =>
  `/form/${encodeURIComponent(formId)}#t=${encodeURIComponent(token)}`;

/**
 * #4541 R1.3: "You're in. One more thing from {brand}." with Answer now and
 * Later. Answer now keeps the RSVP confirmation on screen: on web the form opens
 * in a new tab; on a phone it opens the web link. Later closes the popup when
 * it handed its close in (#4541 A3). After either, the block goes away.
 */
const PreMintedFormHandoff: React.FC<{
  handoff: { formId: string; token: string };
  brandName: string | null;
  onClose?: () => void;
}> = ({ handoff, brandName, onClose }) => {
  const [settled, setSettled] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  if (settled) return null;
  const path = formLinkPath(handoff.formId, handoff.token);
  const answerNow = (): void => {
    if (Platform.OS === "web") {
      const opened = globalThis.open?.(path, "_blank", "noopener");
      if (opened === null || opened === undefined) {
        // A blocked new tab: open it here instead (the RSVP is already saved).
        try {
          globalThis.location?.assign(path);
        } catch (error) {
          console.error("[rsvp-form-handoff] could not open the form", error);
          setFailed(true);
          return;
        }
      }
      setSettled(true);
      return;
    }
    Linking.openURL(`https://host.usemingla.com${path}`)
      .then(() => setSettled(true))
      .catch((error: unknown) => {
        console.error("[rsvp-form-handoff] could not open the form", error);
        setFailed(true);
      });
  };
  return (
    <View style={styles.handoff} testID="rsvp-form-handoff">
      <Text style={styles.handoffStrip} accessibilityRole="header">
        {CHECKOUT_FORM_COPY.rsvpHandoffStrip(brandName)}
      </Text>
      {failed ? (
        <Text style={styles.note} accessibilityRole="alert" testID="rsvp-form-handoff-failed">
          {CHECKOUT_FORM_COPY.purchaseLinkFailed}
        </Text>
      ) : null}
      <View style={styles.handoffActions}>
        <Button
          label={CHECKOUT_FORM_COPY.answerNow}
          variant="primary"
          size="md"
          onPress={answerNow}
          testID="rsvp-form-handoff-answer"
        />
        <Button
          label={CHECKOUT_FORM_COPY.later}
          variant="ghost"
          size="md"
          onPress={() => {
            setSettled(true);
            onClose?.();
          }}
          testID="rsvp-form-handoff-later"
        />
      </View>
    </View>
  );
};

const CheckoutFormHandoff: React.FC<{
  checkoutSessionId: string | null;
  buyerStatusToken: string | null;
}> = ({
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
    answered: { gap: space[2] },
    answeredRow: { gap: 2 },
    answeredLabel: { ...type.small, color: color.text2 },
    answeredValue: { ...type.body, color: color.text1 },
    handoff: { gap: space[2] },
    handoffStrip: { ...type.body, color: color.text1, fontWeight: "600" },
    handoffActions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  }),
);
