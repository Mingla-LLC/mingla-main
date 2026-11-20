/**
 * #4514 wave 4 — the send sheet behind "Ask guests to answer", "Remind" and the
 * "Ask earlier guests?" prompt (§4.6, §4.7). Audience, channels (Push free,
 * Text, Email free), the message, the reach line and the cost line come before
 * a confirm step; then a toast. Remind reaches only people who have not
 * answered. Each guest gets their own form link; a request never creates an
 * invite or grants page access (decision 17). The server throttles each guest
 * per form for 24 hours and re-checks the role (event manager and up, C5).
 *
 * Loaded only through the lazy forms owner (never from an eager module).
 */

import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useFormRequestPreview, useSendFormRequest, useSetFormAutoRemind } from "../../hooks/useBrandForms";
import type {
  FormRequestAudience,
  FormRequestChannel,
  FormRequestInput,
  FormRequestKind,
  FormRequestSubject,
} from "../../services/brandFormRequestService";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { Switch } from "../ui/Switch";
import { costLine } from "../../utils/formRequestCost";
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
  /** With an attachment, the sheet shows the automatic reminder switch. */
  autoRemind?: { attachmentId: string; on: boolean } | null;
  brandName?: string | null;
  eventTitle?: string | null;
  notify: (kind: "success" | "error", message: string) => void;
}

const CHANNELS: ReadonlyArray<{ key: FormRequestChannel; label: string }> = [
  { key: "push", label: COPY.push },
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
  const [audience, setAudience] = useState<FormRequestAudience>("unanswered");
  const [channels, setChannels] = useState<FormRequestChannel[]>(["push", "email"]);
  const [confirming, setConfirming] = useState(false);
  const [remindOn, setRemindOn] = useState(autoRemind?.on ?? false);
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

  const toggleChannel = useCallback((key: FormRequestChannel): void => {
    setConfirming(false);
    setChannels((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  }, []);

  const handleSend = useCallback((): void => {
    if (input === null || preview.data === undefined || send.isPending) return;
    send.mutate(
      { ...input, expectedCostMinor: preview.data.estimatedCostMinor, currency: preview.data.currency },
      {
        onSuccess: (r) => {
          if (r.sent === 0) notify("error", COPY.noneSentToast);
          else if (r.failed > 0) notify("success", COPY.partialToast(r.sent, r.failed));
          else notify("success", COPY.sentToast(r.sent));
          onClose();
        },
        onError: (error) => {
          setConfirming(false);
          notify("error", errorSentence(error, COPY.sendFailed));
        },
      },
    );
  }, [input, preview.data, send, notify, onClose]);

  const handleAutoRemind = useCallback(
    (on: boolean): void => {
      if (autoRemind === undefined || autoRemind === null || setAuto.isPending) return;
      const previous = remindOn;
      setRemindOn(on);
      setAuto.mutate(
        { attachmentId: autoRemind.attachmentId, on, channels: channels.length > 0 ? channels : ["push"] },
        {
          onSuccess: (r) => notify("success", r.autoRemind ? COPY.autoRemindOnToast : COPY.autoRemindOffToast),
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
  const canSend = input !== null && p !== undefined && p.reachableCount > 0 && !send.isPending && !preview.isFetching;

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
        <Text style={styles.line}>{costLine(p)}</Text>
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

        {kind === "ask" && (subjects === undefined || subjects.length === 0) && mode !== "earlier" ? (
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
            {CHANNELS.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                selected={channels.includes(c.key)}
                onPress={() => toggleChannel(c.key)}
                testID={`form-request-channel-${c.key}`}
              />
            ))}
          </View>
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
  warn: { ...type.small, color: color.warningText },
  message: { padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.tile },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], marginTop: space[4] },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  footer: { flexDirection: "row", gap: space[3] },
  footerStack: { gap: space[2] },
  cell: { flex: 1 },
});

export default FormRequestSheet;
