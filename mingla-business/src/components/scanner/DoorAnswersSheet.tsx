/**
 * #4514 wave 6 — "See all answers" at the door: one scanned guest's full
 * answers for this event, drawn read-only by `@mingla/form-rendering`.
 *
 * Loaded ONLY through the forms renderer's one lazy owner
 * (`checkout/intake/formRenderingPrimitives`), which imports it statically, so
 * it lands in that async chunk and never in the Host web boot chunk. The read
 * goes through `scan-ticket` (`action: "door_full_answers"`), which opens only
 * a ticket this same person scanned at this event in the last 30 minutes; the
 * SQL read then checks door authority, the host switch ("Door staff can open
 * full answers") or manager rank, the guest being current, the rate limit, and
 * logs the read. Nothing here can change the scan result.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { BrandFormRenderer } from "@mingla/form-rendering";

import { color, space } from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { businessFormPrimitives } from "../checkout/intake/businessFormPrimitives";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { readDoorFullAnswers, type DoorFullAnswers } from "./doorFullAnswersModel";

export const DOOR_ANSWERS_COPY = {
  title: "Guest answers",
  loading: "Opening answers…",
  failed: "Couldn't open the answers. Check your connection and try again.",
  retry: "Try again",
  scanRequired: "Answers open only right after you scan this guest. Scan their ticket again to see them.",
  notAnswered: "Questions not answered",
  notAnsweredLine: "They can still come in. Answers are never needed for entry.",
  lineOnly: "The host shows door staff only the marked answers for this form.",
  noForm: "This event has no guest questions.",
  rateLimited: "You've opened a lot of answers in a short time. Try again in a few minutes.",
  earlierVersion: "Answered on an earlier version of the form.",
  close: "Close",
} as const;

type Load =
  | { kind: "loading" }
  | { kind: "error"; scanRequired: boolean }
  | { kind: "ready"; value: DoorFullAnswers };

const httpStatus = (error: unknown): number | null => {
  const ctx = (error as { context?: { status?: unknown } } | null)?.context;
  return typeof ctx?.status === "number" ? ctx.status : null;
};

export interface DoorAnswersSheetProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  /** The scan this person just made (scan_events id). */
  scanId: string;
  guestName: string;
}

const noop = (): void => undefined;

export const DoorAnswersSheet: React.FC<DoorAnswersSheetProps> = ({
  visible,
  onClose,
  eventId,
  scanId,
  guestName,
}) => {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const fetchAnswers = useCallback(async (): Promise<void> => {
    setLoad({ kind: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke("scan-ticket", {
        body: { action: "door_full_answers", eventId, scanId },
      });
      if (error) {
        const status = httpStatus(error);
        console.error("[door] full answers failed", status);
        if (live.current) setLoad({ kind: "error", scanRequired: status === 403 });
        return;
      }
      const value = readDoorFullAnswers(data);
      if (live.current) setLoad({ kind: "ready", value });
    } catch (e) {
      console.error("[door] full answers failed", e instanceof Error ? e.message : "unknown");
      if (live.current) setLoad({ kind: "error", scanRequired: false });
    }
  }, [eventId, scanId]);

  useEffect(() => {
    void fetchAnswers();
  }, [fetchAnswers]);

  const body = ((): React.ReactNode => {
    if (load.kind === "loading") {
      return (
        <View style={styles.center} testID="door-answers-loading">
          <ActivityIndicator color={color.text2} />
          <Text style={styles.muted}>{DOOR_ANSWERS_COPY.loading}</Text>
        </View>
      );
    }
    if (load.kind === "error") {
      return (
        <View style={styles.block} accessibilityRole="alert" testID="door-answers-error">
          <Text style={styles.muted}>
            {load.scanRequired ? DOOR_ANSWERS_COPY.scanRequired : DOOR_ANSWERS_COPY.failed}
          </Text>
          {load.scanRequired ? null : (
            <Button label={DOOR_ANSWERS_COPY.retry} variant="secondary" size="sm" onPress={() => void fetchAnswers()} />
          )}
        </View>
      );
    }
    const v = load.value;
    switch (v.state) {
      case "answered":
        return (
          <View style={styles.block} testID="door-answers-full">
            <Text style={styles.formName}>{v.formName}</Text>
            {v.fromOrderOf !== null ? (
              <Text style={styles.muted} testID="door-answers-from">{`From ${v.fromOrderOf}'s order`}</Text>
            ) : null}
            {v.isCurrentVersion ? null : <Text style={styles.muted}>{DOOR_ANSWERS_COPY.earlierVersion}</Text>}
            <BrandFormRenderer
              definition={v.definition}
              answers={v.answers}
              onAnswersChange={noop}
              primitives={businessFormPrimitives}
              disabled
              testID="door-answers-renderer"
            />
          </View>
        );
      case "not_answered":
        return (
          <View style={styles.block} testID="door-answers-not-answered">
            <Text style={styles.formName}>{v.formName}</Text>
            <Text style={styles.warn}>{DOOR_ANSWERS_COPY.notAnswered}</Text>
            <Text style={styles.muted}>{DOOR_ANSWERS_COPY.notAnsweredLine}</Text>
          </View>
        );
      case "line_only":
        return (
          <View style={styles.block} testID="door-answers-line-only">
            <Text style={styles.formName}>{v.formName}</Text>
            {v.line !== null ? <Text style={styles.line}>{v.line}</Text> : null}
            <Text style={styles.muted}>{DOOR_ANSWERS_COPY.lineOnly}</Text>
          </View>
        );
      case "no_form":
        return <Text style={styles.muted} testID="door-answers-no-form">{DOOR_ANSWERS_COPY.noForm}</Text>;
      case "rate_limited":
        return <Text style={styles.muted} testID="door-answers-rate-limited">{DOOR_ANSWERS_COPY.rateLimited}</Text>;
      default: {
        const never: never = v;
        return never;
      }
    }
  })();

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{DOOR_ANSWERS_COPY.title}</Text>
          <Text style={styles.muted} numberOfLines={1}>{guestName}</Text>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={DOOR_ANSWERS_COPY.close}
          hitSlop={12}
          testID="door-answers-close"
        >
          <Text style={styles.close}>{DOOR_ANSWERS_COPY.close}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: "700", color: color.text1 },
  close: { fontSize: 15, fontWeight: "600", color: color.text1 },
  scroll: { paddingHorizontal: space[4], paddingBottom: space[8] },
  center: { alignItems: "center", gap: space[2], paddingVertical: space[6] },
  block: { gap: space[3] },
  formName: { fontSize: 16, fontWeight: "600", color: color.text1 },
  line: { fontSize: 14, color: color.text1 },
  warn: { fontSize: 14, fontWeight: "600", color: color.warningText },
  muted: { fontSize: 13, lineHeight: 18, color: color.text2 },
});
