/**
 * #4514 wave 3 — the guest link page, `host.usemingla.com/form/{formId}#t=…`
 * (BUILD CONTRACT v2 §5.7, C2, decision 12; the "Where the link opens" and
 * "What guests get" chapters of the design).
 *
 * ANONYMOUS: NEVER useAuth. The personal token is read from the URL FRAGMENT
 * only (so it never reaches a server log), sent in request bodies only, and
 * never logged. The page draws the brand header and the questions through the
 * one lazy owner of `@mingla/form-rendering`, so nothing here is eager.
 *
 * States (./brandFormLinkModel.ts): loading · open ("Answering as … · Not you?")
 * · saved (with a gentle "Open in the Explorer app", never a gate) · code (an
 * existing answer, a closed form's last answers, or recognition ended: a
 * one-time code; a first answer needs none) · closed · invalid link · paused ·
 * load failed and save failed (each with a retry; answers stay on screen).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { BrandAnswers, BrandHeaderData } from "@mingla/form-rendering";

import { color, radius, space, type } from "../../../constants/designSystem";
import { DOWNLOAD_PAGE_URL } from "../../../constants/storeLinks";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Button } from "../../ui/Button";
import {
  BrandFormLinkError,
  checkLinkCode,
  readLinkForm,
  saveLinkAnswers,
  sendLinkCode,
} from "../../../services/brandFormLinkService";
import { LINK_COPY } from "./brandFormLinkCopy";
import {
  type CodeStep,
  codeAfterSend,
  codeAfterVerify,
  codeStepKeepingAnswers,
  type LinkDraft,
  type LinkPhase,
  phaseAfterRead,
  phaseFromReadError,
  savedPhase,
  submitOutcome,
  takeLinkToken,
} from "./brandFormLinkModel";

const owner = () => import("../../checkout/intake/formRenderingPrimitives");
const BusinessBrandForm = React.lazy(() => owner().then((m) => ({ default: m.BusinessBrandForm })));
const BusinessBrandHeader = React.lazy(() => owner().then((m) => ({ default: m.BusinessBrandHeader })));
const loadHeaderFromServer = () => owner().then((m) => m.brandHeaderFromServer);

const EMPTY_HEADER: BrandHeaderData = { displayName: "", photo: null, coverUrl: null, accent: null, coverHue: 25 };

/**
 * The fragment token on web, read once and then removed from the address bar
 * (kept in memory only); native has no fragment link today (the app route is a
 * later wave).
 */
function readToken(formId: string | null): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const fromLink = takeLinkToken(window);
  if (fromLink !== null || formId === null) return fromLink;
  return takePurchaseToken(formId);
}

/**
 * #4514 wave 5 — "After they purchase": the checkout success screen hands the
 * buyer's own token over in sessionStorage (key pairs with
 * `purchaseTokenStorageKey` in services/checkoutBrandFormService.ts; not
 * imported, so the two lazy chunks share no module). Read once, removed, then
 * held in memory for a re-mount, like the fragment token.
 */
let purchaseHeld: { formId: string; token: string } | null = null;
function takePurchaseToken(formId: string): string | null {
  if (purchaseHeld !== null && purchaseHeld.formId === formId) return purchaseHeld.token;
  try {
    const key = `mingla.formPurchaseToken.${formId}`;
    const token = window.sessionStorage.getItem(key);
    if (token === null || !/^[0-9a-f]{64}$/.test(token)) return null;
    window.sessionStorage.removeItem(key);
    purchaseHeld = { formId, token };
    return token;
  } catch (error) {
    console.error("[brand-form-link] purchase token read failed", error);
    return null;
  }
}

export interface BrandFormLinkScreenProps {
  formId: string | null;
  /** #4514 wave 5 — opened right after a purchase: the strip and a way back. */
  fromPurchase?: boolean;
}

export default function BrandFormLinkScreen({
  formId,
  fromPurchase = false,
}: BrandFormLinkScreenProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const token = useMemo(() => readToken(formId), [formId]);
  const [phase, setPhase] = useState<LinkPhase>({ kind: "loading" });
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [header, setHeader] = useState<BrandHeaderData>(EMPTY_HEADER);
  const [missing, setMissing] = useState<boolean>(false);
  const [codeText, setCodeText] = useState<string>("");
  // Typed answers waiting for a new one-time code (the grant ran out mid-edit).
  const draft = useRef<LinkDraft | null>(null);

  const load = useCallback(
    async (challenge: string | null): Promise<void> => {
      if (formId === null || token === null) {
        setPhase({ kind: "invalid" });
        return;
      }
      setPhase({ kind: "loading" });
      try {
        const read = await readLinkForm({ formId, token, challengeId: challenge });
        const toHeader = await loadHeaderFromServer();
        setHeader(toHeader(read.brand ?? null));
        const next = phaseAfterRead(read, draft.current);
        draft.current = next.draft;
        setPhase(next.phase);
      } catch (e) {
        setPhase(phaseFromReadError(e instanceof BrandFormLinkError ? e.code : null));
      }
    },
    [formId, token],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const onAnswers = useCallback((answers: BrandAnswers): void => {
    setPhase((p) => (p.kind === "open" ? { ...p, answers, saveError: null, fieldErrors: {} } : p));
  }, []);
  const onMissing = useCallback((ids: string[]): void => setMissing(ids.length > 0), []);

  const submit = useCallback(async (): Promise<void> => {
    if (phase.kind !== "open" || token === null || phase.saving) return;
    const current = phase;
    setPhase({ ...current, saving: true, saveError: null });
    let result: Awaited<ReturnType<typeof saveLinkAnswers>>;
    try {
      result = await saveLinkAnswers({
        formId: current.form.formId,
        versionId: current.form.versionId,
        answers: current.answers,
        expectedEditCount: current.editCount,
        token,
        challengeId,
      });
    } catch {
      result = { ok: false, error: "network" };
    }
    const outcome = submitOutcome(result.ok ? null : result.error, result.ok ? undefined : result.errors);
    switch (outcome.next) {
      case "saved":
        setPhase(savedPhase(current.form.formName, current.form.identity));
        return;
      case "reload":
        void load(challengeId);
        return;
      case "code": {
        // The 30-minute grant ran out mid-edit: ask for a new code, keep what was typed.
        const step = codeStepKeepingAnswers(current);
        draft.current = step.draft;
        setPhase(step.phase);
        return;
      }
      case "paused":
        setPhase({ kind: "paused" });
        return;
      case "invalid":
        setPhase({ kind: "invalid" });
        return;
      case "error":
        setPhase({ ...current, saving: false, saveError: outcome.error, fieldErrors: outcome.fieldErrors ?? {} });
        return;
      default: {
        const never: never = outcome;
        void never;
      }
    }
  }, [phase, token, challengeId, load]);

  const setCode = useCallback((code: CodeStep): void => {
    setPhase((p) => (p.kind === "code" ? { ...p, code } : p));
  }, []);

  const sendCode = useCallback(
    async (channel: "email" | "phone" | null): Promise<void> => {
      if (phase.kind !== "code" || formId === null || token === null) return;
      const code = phase.code;
      setCode({ ...code, busy: true, error: null });
      setCodeText("");
      try {
        setCode(codeAfterSend(code, await sendLinkCode({ formId, token, channel })));
      } catch {
        setCode(codeAfterSend(code, { ok: false, error: "send_failed" }));
      }
    },
    [phase, formId, token, setCode],
  );

  const checkCode = useCallback(async (): Promise<void> => {
    if (phase.kind !== "code" || formId === null || token === null || phase.code.challengeId === null) return;
    const code = phase.code;
    const id = code.challengeId as string;
    setCode({ ...code, busy: true, error: null });
    let verdict: ReturnType<typeof codeAfterVerify>;
    try {
      verdict = codeAfterVerify(code, await checkLinkCode({ formId, token, challengeId: id, code: codeText.trim() }));
    } catch {
      verdict = codeAfterVerify(code, { ok: false, error: "failed" });
    }
    if (verdict.ok) {
      setChallengeId(id);
      void load(id);
    } else {
      setCode(verdict.code);
    }
  }, [phase, formId, token, codeText, setCode, load]);

  const notYou = (open: boolean): void => setPhase((p) => (p.kind === "open" ? { ...p, notYouOpen: open } : p));
  const openApp = (): void => {
    Linking.openURL(DOWNLOAD_PAGE_URL).catch(() => undefined);
  };

  return (
    <View style={[styles.page, { paddingBottom: insets.bottom }]} testID="brand-form-link">
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.column}>
          <View style={styles.headerWrap}>
            <React.Suspense fallback={<View style={styles.headerSlot} />}>
              <BusinessBrandHeader brand={header} />
            </React.Suspense>
          </View>
          <View style={styles.body} accessibilityLiveRegion="polite">
            {fromPurchase ? (
              <View style={styles.purchaseStrip} testID="brand-form-link-purchase-strip">
                <Text style={styles.purchaseStripText}>{LINK_COPY.purchaseStrip}</Text>
                <Text style={styles.purchaseOneMore}>{LINK_COPY.purchaseOneMore(header.displayName)}</Text>
                <Button
                  label={LINK_COPY.purchaseContinue}
                  variant="secondary"
                  size="md"
                  onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))}
                  testID="brand-form-link-purchase-continue"
                />
              </View>
            ) : null}
            {renderBody()}
          </View>
        </View>
      </ScrollView>
    </View>
  );

  function renderBody(): React.ReactNode {
    switch (phase.kind) {
      case "loading":
        return <Text style={styles.muted} testID="brand-form-link-loading">{LINK_COPY.loading}</Text>;
      case "invalid":
        return <Notice title={LINK_COPY.invalidTitle} body={LINK_COPY.invalidBody} testID="brand-form-link-invalid" />;
      case "paused":
        return (
          <Notice title={LINK_COPY.pausedTitle} body={LINK_COPY.pausedBody} testID="brand-form-link-paused">
            <Button label={LINK_COPY.retry} variant="secondary" size="md" onPress={() => void load(challengeId)} />
          </Notice>
        );
      case "load_failed":
        return (
          <Notice title={LINK_COPY.loadFailedTitle} body={LINK_COPY.loadFailedBody} testID="brand-form-link-load-failed">
            <Button label={LINK_COPY.retry} variant="secondary" size="md" onPress={() => void load(challengeId)} />
          </Notice>
        );
      case "saved":
        return (
          <View style={styles.stack} testID="brand-form-link-saved">
            <Text style={styles.title}>{LINK_COPY.savedTitle(phase.firstName)}</Text>
            <Text style={styles.text2}>{LINK_COPY.savedBody}</Text>
            <Button label={LINK_COPY.editAnswers} variant="secondary" size="md" onPress={() => void load(challengeId)} />
            <View style={styles.appCard}>
              <Text style={styles.appTitle}>{LINK_COPY.appTitle}</Text>
              <Text style={styles.muted}>{LINK_COPY.appBody}</Text>
              <Pressable onPress={openApp} accessibilityRole="link" accessibilityLabel={LINK_COPY.openInApp} testID="brand-form-link-open-app">
                <Text style={styles.link}>{LINK_COPY.openInApp}</Text>
              </Pressable>
            </View>
          </View>
        );
      case "closed":
        return (
          <View style={styles.stack} testID="brand-form-link-closed">
            <Text style={styles.title}>{phase.formName}</Text>
            {phase.last === null ? (
              <Notice title={LINK_COPY.closedTitle} body={LINK_COPY.closedBody} />
            ) : (
              <>
                <Text style={styles.banner}>{LINK_COPY.closedLast}</Text>
                {[...phase.last.definition.questions].sort((a, b) => a.position - b.position).map((q) => {
                  const v = phase.last?.answers[q.id];
                  const text = v === undefined || v === null
                    ? null
                    : Array.isArray(v)
                    ? v.map((id) => q.options?.find((o) => o.id === id)?.label ?? id).join(", ")
                    : q.type === "single_choice"
                    ? q.options?.find((o) => o.id === v)?.label ?? v
                    : v;
                  return (
                    <View key={q.id} style={styles.readRow}>
                      <Text style={styles.readLabel}>{q.label}</Text>
                      <Text style={text === null || text.length === 0 ? styles.muted : styles.text1}>
                        {text === null || text.length === 0 ? LINK_COPY.notAnswered : text}
                      </Text>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        );
      case "code":
        return renderCode(phase);
      case "open":
        return renderOpen(phase);
      default: {
        const never: never = phase;
        return never;
      }
    }
  }

  function renderCode(p: Extract<LinkPhase, { kind: "code" }>): React.ReactNode {
    const title = p.reason === "closed"
      ? LINK_COPY.codeClosedTitle
      : p.reason === "answered"
      ? LINK_COPY.codeAnsweredTitle
      : LINK_COPY.codeLapsedTitle;
    const body = p.reason === "closed"
      ? LINK_COPY.codeClosedBody
      : p.reason === "answered"
      ? LINK_COPY.codeAnsweredBody
      : LINK_COPY.codeLapsedBody;
    const c = p.code;
    const error = c.error === null
      ? null
      : c.error === "bad_code"
      ? LINK_COPY.codeBad(c.attemptsLeft)
      : c.error === "expired"
      ? LINK_COPY.codeExpired
      : c.error === "locked"
      ? LINK_COPY.codeLocked
      : c.error === "rate_limited"
      ? LINK_COPY.codeRateLimited
      : c.error === "no_contact"
      ? LINK_COPY.codeNoContact
      : c.error === "send_failed"
      ? LINK_COPY.codeSendFailed
      : LINK_COPY.codeFailed;
    return (
      <View style={styles.stack} testID={`brand-form-link-code-${p.reason}`}>
        <Text style={styles.title}>{p.formName}</Text>
        <Text style={styles.subtitle}>{title}</Text>
        {c.step === "ask" ? (
          <>
            <Text style={styles.text2}>{body}</Text>
            {error !== null ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            <Button
              label={c.busy ? LINK_COPY.sending : LINK_COPY.sendCode}
              variant="primary"
              size="md"
              fullWidth
              loading={c.busy}
              disabled={c.busy}
              onPress={() => void sendCode(null)}
              testID="brand-form-link-send-code"
            />
          </>
        ) : (
          <>
            <Text style={styles.text2}>{LINK_COPY.enterCode(c.sentTo ?? "")}</Text>
            <TextInput
              value={codeText}
              onChangeText={(t) => setCodeText(t.replace(/[^0-9]/g, "").slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              accessibilityLabel={LINK_COPY.codeLabel}
              placeholder="123456"
              placeholderTextColor={color.text3}
              maxLength={6}
              style={styles.codeInput}
              testID="brand-form-link-code-input"
            />
            {error !== null ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            <Button
              label={c.busy ? LINK_COPY.checking : LINK_COPY.checkCode}
              variant="primary"
              size="md"
              fullWidth
              loading={c.busy}
              disabled={c.busy || codeText.length !== 6}
              onPress={() => void checkCode()}
              testID="brand-form-link-check-code"
            />
            <Button
              label={LINK_COPY.sendNewCode}
              variant="ghost"
              size="md"
              disabled={c.busy}
              onPress={() => void sendCode(c.channel)}
            />
            {c.otherChannel ? (
              <Button
                label={c.channel === "email" ? LINK_COPY.textInstead : LINK_COPY.emailInstead}
                variant="ghost"
                size="md"
                disabled={c.busy}
                onPress={() => void sendCode(c.channel === "email" ? "phone" : "email")}
              />
            ) : null}
          </>
        )}
      </View>
    );
  }

  function renderOpen(p: Extract<LinkPhase, { kind: "open" }>): React.ReactNode {
    const saveError = p.saveError === null
      ? null
      : p.saveError === "failed"
      ? LINK_COPY.saveFailed
      : p.saveError === "rate_limited"
      ? LINK_COPY.saveRateLimited
      : p.saveError === "stale"
      ? LINK_COPY.saveStale
      : p.saveError === "changed"
      ? LINK_COPY.saveChanged
      : LINK_COPY.saveInvalid;
    const needsReload = p.saveError === "stale" || p.saveError === "changed";
    return (
      <View style={styles.stack} testID="brand-form-link-open">
        <Text style={styles.title}>{p.form.formName}</Text>
        {p.form.identity !== null ? (
          <View style={styles.identityRow}>
            <Text style={styles.muted}>{LINK_COPY.answeringAs(p.form.identity)} · </Text>
            <Pressable onPress={() => notYou(!p.notYouOpen)} accessibilityRole="button" accessibilityLabel={LINK_COPY.notYou} accessibilityState={{ expanded: p.notYouOpen }} testID="brand-form-link-not-you">
              <Text style={styles.link}>{LINK_COPY.notYou}</Text>
            </Pressable>
          </View>
        ) : null}
        {p.notYouOpen && p.form.identity !== null ? (
          <View style={styles.appCard} testID="brand-form-link-not-you-card">
            <Text style={styles.appTitle}>{LINK_COPY.notYouTitle}</Text>
            <Text style={styles.text2}>{LINK_COPY.notYouBody(p.form.identity)}</Text>
            <Button label={LINK_COPY.notYouClose} variant="secondary" size="sm" onPress={() => notYou(false)} />
          </View>
        ) : null}
        {p.form.definition.intro !== undefined && p.form.definition.intro.length > 0 ? (
          <Text style={styles.text2}>{p.form.definition.intro}</Text>
        ) : null}
        <React.Suspense fallback={<Text style={styles.muted}>{LINK_COPY.loading}</Text>}>
          <BusinessBrandForm
            definition={p.form.definition}
            answers={p.answers}
            onAnswersChange={onAnswers}
            onMissingChange={onMissing}
            doorFullAnswers={p.form.doorFullAnswers}
            validationErrors={p.fieldErrors}
            disabled={p.saving}
          />
        </React.Suspense>
        {saveError !== null ? (
          <View style={styles.errorBox} accessibilityRole="alert" testID="brand-form-link-save-error">
            <Text style={styles.error}>{saveError}</Text>
            {p.saveError === "failed" || p.saveError === "rate_limited" ? (
              <Button label={LINK_COPY.retry} variant="secondary" size="sm" onPress={() => void submit()} />
            ) : needsReload ? (
              <Button label={LINK_COPY.reload} variant="secondary" size="sm" onPress={() => void load(challengeId)} />
            ) : null}
          </View>
        ) : null}
        {missing ? <Text style={styles.muted}>{LINK_COPY.needsAnswers}</Text> : null}
        <Button
          label={p.saving ? LINK_COPY.saving : p.editCount === null ? LINK_COPY.send : LINK_COPY.saveChanges}
          variant="primary"
          size="lg"
          fullWidth
          loading={p.saving}
          disabled={p.saving || missing || needsReload}
          onPress={() => void submit()}
          testID="brand-form-link-submit"
        />
      </View>
    );
  }
}

const Notice: React.FC<{ title: string; body: string; testID?: string; children?: React.ReactNode }> = ({
  title,
  body,
  testID,
  children,
}) => (
  <View style={styles.stack} testID={testID}>
    <Text style={styles.subtitle}>{title}</Text>
    <Text style={styles.text2}>{body}</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.canvas },
  purchaseStrip: { gap: space[2] },
  purchaseStripText: { ...type.small, color: color.text2 },
  purchaseOneMore: { ...type.title, color: color.text1 },
  scroll: { flexGrow: 1, alignItems: "center" },
  column: { width: "100%", maxWidth: 560 },
  headerWrap: { overflow: "hidden" },
  headerSlot: { height: 132, backgroundColor: color.fill.inset },
  body: { paddingHorizontal: space[4], paddingVertical: space[5], gap: space[4] },
  stack: { gap: space[3] },
  title: { ...type.title, color: color.text1 },
  subtitle: { ...type.row, color: color.text1 },
  text1: { ...type.body, color: color.text1 },
  text2: { ...type.body, color: color.text2 },
  muted: { ...type.small, color: color.text3 },
  link: { ...type.small, color: color.accentText, textDecorationLine: "underline" },
  identityRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  banner: {
    ...type.small,
    color: color.text2,
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  readRow: { gap: space[1], paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: color.line },
  readLabel: { ...type.caption, color: color.text3 },
  appCard: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  appTitle: { ...type.row, color: color.text1 },
  codeInput: {
    ...type.title,
    color: color.text1,
    letterSpacing: 6,
    textAlign: "center",
    paddingVertical: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  errorBox: { gap: space[2] },
  error: { ...type.small, color: color.danger },
});
