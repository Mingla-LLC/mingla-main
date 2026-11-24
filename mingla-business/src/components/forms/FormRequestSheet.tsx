/**
 * #4514 wave 4 — the send sheet behind "Ask guests to answer", "Remind" and the
 * "Ask earlier guests?" prompt (§4.6, §4.7). Audience, channels (#4541 R3:
 * Push, free, only to people whose app can open the form and only while the
 * server's switch is on, else "Push: not available yet"; Text; Email, free),
 * the message, the reach line and the cost line (real text parts, quiet
 * hours) come before a confirm step; then a toast. #4541 R5.5: texts share
 * Blast's monthly allowance; over it or today's 300, Text is off for that
 * send with the reason shown and email and push still go (never blocked).
 * Texts with no price need the host's explicit tick. Remind reaches only people who have not
 * answered; Ask for named guests reaches them even if they answered (Ask
 * again). Each guest gets their own form link; a request never creates an
 * invite or grants page access (decision 17). The server throttles each person
 * per form for 24 hours, queues the sends and re-checks the role (event
 * manager and up, C5).
 *
 * Loaded only through the lazy forms owner (never from an eager module).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useFormRequestPreview, useSendFormRequest, useSetFormAutoRemind } from "../../hooks/useBrandForms";
import {
  shouldRefetchPreviewAfter,
  type FormRequestAudience,
  type FormRequestChannel,
  type FormRequestInput,
  type FormRequestKind,
  type FormRequestSubject,
} from "../../services/brandFormRequestService";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { Switch } from "../ui/Switch";
import {
  allowanceLines,
  autoRemindChannels,
  canSendRequest,
  costLine,
  initialAudience,
  requestChannels,
} from "../../utils/formRequestCost";
import { FORM_REQUEST_COPY as COPY } from "./brandFormsCopy";
import { errorSentence } from "./useFormsToast";

export type FormRequestSheetMode = "ask" | "remind" | "earlier";

export interface FormRequestSheetProps {
  visible: boolean;
  onClose: () => void;
  formId: string;
  eventId: string;
  mode: FormRequestSheetMode;
  /** Named guests (the answers drawer). */
  subjects?: FormRequestSubject[];
  /** The prompt's count ("Ask earlier guests?"). */
  earlierCount?: number;
  /** With an attachment, the sheet shows the automatic reminder switch, its stored state and channels. */
  autoRemind?: { attachmentId: string; on: boolean; channels?: FormRequestChannel[] } | null;
  brandName?: string | null;
  eventTitle?: string | null;
  notify: (kind: "success" | "error", message: string) => void;
}

const PAID_AND_EMAIL: ReadonlyArray<{ key: FormRequestChannel; label: string }> = [
  { key: "sms", label: COPY.sms },
  { key: "email", label: COPY.email },
];

export const FormRequestSheet: React.FC<FormRequestSheetProps> = ({
  visible,
  onClose,
  formId,
  eventId,
  mode,
  subjects,
  earlierCount,
  autoRemind,
  brandName,
  eventTitle,
  notify,
}) => {
  const kind: FormRequestKind = mode === "remind" ? "remind" : "ask";
  const named = subjects !== undefined && subjects.length > 0;
  // Ask for named guests reaches them even if they already answered (Ask again).
  const [audience, setAudience] = useState<FormRequestAudience>(initialAudience(mode, named));
  const [channels, setChannels] = useState<FormRequestChannel[]>(["sms", "email"]);
  const [confirming, setConfirming] = useState(false);
  const [confirmUnpriced, setConfirmUnpriced] = useState(false);
  const [remindOn, setRemindOn] = useState(autoRemind?.on ?? false);
  const [remindChannels, setRemindChannels] = useState<FormRequestChannel[]>(autoRemind?.channels ?? []);
  const send = useSendFormRequest();
  const setAuto = useSetFormAutoRemind();

  const input: FormRequestInput | null = useMemo(
    () =>
      channels.length === 0
        ? null
        : { formId, eventId, kind, audience: kind === "remind" ? "unanswered" : audience, channels, subjects },
    [formId, eventId, kind, audience, channels, subjects],
  );
  const preview = useFormRequestPreview(visible ? input : null);
  const refetchPreview = preview.refetch;

  // #4541 R3.1: Push follows the server's switch, learnt from the preview.
  // The first time it is on, Push is ticked (it is free); off, it is never sent.
  const [pushAvailable, setPushAvailable] = useState<boolean | null>(null);
  const pushDecided = useRef(false);
  const previewPush = preview.data?.pushAvailable;
  useEffect(() => {
    if (previewPush === undefined) return;
    setPushAvailable(previewPush);
    if (!previewPush) {
      setChannels((prev) => (prev.includes("push") ? prev.filter((c) => c !== "push") : prev));
      return;
    }
    if (!pushDecided.current) {
      pushDecided.current = true;
      setChannels((prev) => (prev.includes("push") ? prev : ["push", ...prev]));
    }
  }, [previewPush]);

  const toggleChannel = useCallback((key: FormRequestChannel): void => {
    setConfirming(false);
    setConfirmUnpriced(false);
    if (key === "push") pushDecided.current = true;
    setChannels((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  }, []);

  const handleSend = useCallback((): void => {
    if (input === null || preview.data === undefined || send.isPending) return;
    const sendChannels = requestChannels(input.channels, preview.data.pushAvailable);
    if (sendChannels.length === 0) return;
    send.mutate(
      {
        ...input,
        channels: sendChannels,
        expectedCostMinor: preview.data.estimatedCostMinor,
        currency: preview.data.currency,
        confirmUnpriced,
      },
      {
        onSuccess: (r) => {
          if (r.queued === 0 && r.sent === 0) notify("error", r.unreachable > 0 ? COPY.unreachableToast(r.unreachable) : COPY.noneSentToast);
          else if (r.waitingForMorning > 0) notify("success", COPY.waitingToast(r.waitingForMorning));
          else if (r.pending > 0) notify("success", COPY.queuedToast(r.queued, r.sent));
          else if (r.failed > 0) notify("success", COPY.partialToast(r.sent, r.failed));
          else notify("success", r.textsOff !== null ? COPY.sentNoTextsToast(r.sent) : COPY.sentToast(r.sent));
          onClose();
        },
        onError: (error) => {
          setConfirming(false);
          notify("error", errorSentence(error, COPY.sendFailed));
          // #4573 §5: something changed since the preview; show the new reason and numbers.
          if (shouldRefetchPreviewAfter(error)) void refetchPreview();
        },
      },
    );
  }, [input, preview.data, refetchPreview, send, notify, onClose, confirmUnpriced]);

  const handleAutoRemind = useCallback(
    (on: boolean): void => {
      if (autoRemind === undefined || autoRemind === null || setAuto.isPending) return;
      const previous = remindOn;
      setRemindOn(on);
      setAuto.mutate(
        { attachmentId: autoRemind.attachmentId, on, channels: autoRemindChannels(channels) },
        {
          onSuccess: (r) => {
            setRemindChannels(r.channels);
            notify("success", r.autoRemind ? COPY.autoRemindOnToast : COPY.autoRemindOffToast);
          },
          onError: (error) => {
            setRemindOn(previous);
            notify("error", errorSentence(error, COPY.autoRemindFailed));
          },
        },
      );
    },
    [autoRemind, setAuto, remindOn, channels, notify],
  );

  const title = mode === "earlier" ? COPY.earlierTitle : mode === "remind" ? COPY.remindTitle : COPY.askTitle;
  const p = preview.data;
  const unpriced = p !== undefined && p.smsCount > 0 && p.estimatedCostMinor === null;
  const canSend =
    input !== null &&
    p !== undefined &&
    requestChannels(input.channels, p.pushAvailable).length > 0 &&
    canSendRequest(p, confirmUnpriced) &&
    !send.isPending &&
    !preview.isFetching &&
    !preview.isError;
  const remindCost =
    p === undefined ? null : channels.includes("sms") && p.smsCount > 0 ? COPY.autoRemindCost(costLine(p)) : COPY.autoRemindFree;
  const storedChannels = remindChannels.map((c) => (c === "sms" ? COPY.sms : c === "push" ? COPY.push : COPY.email)).join(", ");
  const textPicked = channels.includes("sms");
  const allowance = p === undefined ? null : allowanceLines(p, textPicked);

  let reachBlock: React.ReactNode;
  if (input === null) reachBlock = <Text style={styles.warn}>{COPY.pickChannel}</Text>;
  else if (preview.isLoading) reachBlock = <Text style={styles.muted}>{COPY.loading}</Text>;
  else if (preview.isError || p === undefined) {
    reachBlock = (
      <View style={styles.block} accessibilityRole="alert">
        <Text style={styles.warn}>{errorSentence(preview.error, COPY.previewFailed)}</Text>
        <Button label={COPY.retry} variant="secondary" size="sm" onPress={() => void preview.refetch()} />
      </View>
    );
  } else {
    reachBlock = (
      <View style={styles.block} testID="form-request-reach">
        <Text style={styles.line}>{COPY.reachLine(p.reachableCount, p.smsOptedOutCount, p.unreachableCount)}</Text>
        {p.throttledCount > 0 ? <Text style={styles.muted}>{COPY.throttledLine(p.throttledCount)}</Text> : null}
        {allowance !== null && textPicked ? (
          <View style={styles.allowance} testID="form-request-allowance">
            {allowance.monthly !== null ? <Text style={styles.strong}>{allowance.monthly}</Text> : null}
            {allowance.shared !== null ? <Text style={styles.muted}>{allowance.shared}</Text> : null}
            {allowance.uses !== null ? <Text style={styles.line}>{allowance.uses}</Text> : null}
            {allowance.today !== null ? <Text style={styles.muted}>{allowance.today}</Text> : null}
            {allowance.textsOff !== null ? (
              <Text style={styles.warn} accessibilityRole="alert" testID="form-request-texts-off">
                {allowance.textsOff}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text style={styles.line}>{costLine(p)}</Text>
        {p.smsCount > 0 && p.smsSegments > 1 ? <Text style={styles.muted}>{COPY.segmentsLine(p.smsSegments)}</Text> : null}
        {p.textsWaitUntil !== null ? (
          <Text style={styles.muted}>
            {COPY.waitLine(new Date(p.textsWaitUntil).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}
          </Text>
        ) : null}
        {unpriced ? (
          <View style={styles.switchRow}>
            <Text style={[styles.muted, styles.switchText]}>{COPY.unpricedConfirm}</Text>
            <Switch
              value={confirmUnpriced}
              onValueChange={setConfirmUnpriced}
              accessibilityLabel={COPY.unpricedConfirm}
              testID="form-request-confirm-unpriced"
            />
          </View>
        ) : null}
        {p.reachableCount === 0 ? <Text style={styles.warn}>{COPY.nobody}</Text> : null}
      </View>
    );
  }

  const footer = confirming && p !== undefined ? (
    <View style={styles.footerStack}>
      <Text style={styles.line}>{COPY.confirmLine(p.reachableCount)}</Text>
      <View style={styles.footer}>
        <View style={styles.cell}>
          <Button label={COPY.back} variant="secondary" size="md" fullWidth disabled={send.isPending} onPress={() => setConfirming(false)} />
        </View>
        <View style={styles.cell}>
          <Button
            label={send.isPending ? COPY.sending : COPY.confirm}
            variant="primary"
            size="md"
            fullWidth
            loading={send.isPending}
            disabled={!canSend}
            onPress={handleSend}
            testID="form-request-confirm"
          />
        </View>
      </View>
    </View>
  ) : (
    <View style={styles.footer}>
      <View style={styles.cell}>
        <Button label={COPY.notNow} variant="secondary" size="md" fullWidth onPress={onClose} testID="form-request-not-now" />
      </View>
      <View style={styles.cell}>
        <Button
          label={mode === "remind" ? COPY.sendReminder : COPY.askNow}
          variant="primary"
          size="md"
          fullWidth
          disabled={!canSend}
          onPress={() => setConfirming(true)}
          testID="form-request-send"
        />
      </View>
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <SheetScrollLayout footer={footer} testID="form-request-sheet">
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {mode === "earlier" && earlierCount !== undefined ? <Text style={styles.line}>{COPY.earlierLine(earlierCount)}</Text> : null}

        {kind === "ask" && !named && mode !== "earlier" ? (
          <View style={styles.block}>
            <Text style={styles.cap}>{COPY.audienceLabel}</Text>
            <View style={styles.chips}>
              <Chip label={COPY.audienceUnanswered} selected={audience === "unanswered"} onPress={() => setAudience("unanswered")} />
              <Chip label={COPY.audienceEveryone} selected={audience === "everyone"} onPress={() => setAudience("everyone")} />
            </View>
          </View>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.cap}>{COPY.channelsLabel}</Text>
          <View style={styles.chips}>
            {pushAvailable === true ? (
              <Chip
                label={COPY.push}
                selected={channels.includes("push")}
                onPress={() => toggleChannel("push")}
                testID="form-request-channel-push"
              />
            ) : pushAvailable === false ? (
              <Chip label={COPY.pushUnavailable} disabled testID="form-request-channel-push-unavailable" />
            ) : null}
            {PAID_AND_EMAIL.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                selected={channels.includes(c.key)}
                onPress={() => toggleChannel(c.key)}
                testID={`form-request-channel-${c.key}`}
              />
            ))}
          </View>
          {pushAvailable === true ? <Text style={styles.muted}>{COPY.pushLine}</Text> : null}
          <Text style={styles.muted}>{COPY.channelsNote}</Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.cap}>{COPY.messageLabel}</Text>
          <View style={styles.message}>
            <Text style={styles.line}>
              {COPY.message(
                brandName !== undefined && brandName !== null && brandName.length > 0 ? brandName : COPY.messageBrandFallback,
                eventTitle !== undefined && eventTitle !== null && eventTitle.length > 0 ? eventTitle : COPY.messageEventFallback,
              )}
            </Text>
          </View>
          <Text style={styles.muted}>{COPY.linkNote}</Text>
        </View>

        {reachBlock}

        {autoRemind !== undefined && autoRemind !== null ? (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.line}>{COPY.autoRemindTitle}</Text>
              <Text style={styles.muted}>
                {COPY.autoRemindLine(
                  eventTitle !== undefined && eventTitle !== null && eventTitle.length > 0 ? eventTitle : COPY.messageEventFallback,
                  null,
                )}
              </Text>
              {remindOn && storedChannels.length > 0 ? (
                <Text style={styles.muted} testID="form-request-auto-remind-channels">{COPY.autoRemindChannels(storedChannels)}</Text>
              ) : null}
              {remindCost !== null ? <Text style={styles.muted}>{remindCost}</Text> : null}
            </View>
            <Switch
              value={remindOn}
              onValueChange={handleAutoRemind}
              disabled={setAuto.isPending}
              accessibilityLabel={COPY.autoRemindTitle}
              testID="form-request-auto-remind"
            />
          </View>
        ) : null}
      </SheetScrollLayout>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  title: { ...type.title, color: color.text1, marginBottom: space[3] },
  block: { gap: space[2], marginTop: space[4] },
  cap: { ...type.caption, color: color.text3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  line: { ...type.body, color: color.text1 },
  muted: { ...type.small, color: color.text3 },
  strong: { ...type.row, color: color.text1 },
  allowance: {
    gap: 2,
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  warn: { ...type.small, color: color.warningText },
  message: { padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.tile },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], marginTop: space[4] },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  footer: { flexDirection: "row", gap: space[3] },
  footerStack: { gap: space[2] },
  cell: { flex: 1 },
});

export default FormRequestSheet;
