/**
 * #4541 R2.8 (design v10 C) — "You're in. One more thing." A block inside the
 * cart's success panel (never a new sheet over the payment screens), shown
 * once per order when the host asks "After they purchase" and the order has
 * no answer yet.
 *
 * Answer now closes the sheet (which lands on the purchase page), then pushes
 * the form over it, so Back returns to the ticket. Later, or closing the sheet
 * any way, leaves the card reading "To answer". In the RSVP popup Later also
 * closes the popup (`onLater`), as on web. Seen once per order:
 * `mingla_form_handoff_seen_v1:{kind}:{id}` (cleared on sign-out by the
 * `mingla_` prefix). The block fades and rises 8 pt over 220 ms, 300 ms after
 * the panel settles; with Reduce Motion it just appears.
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { pendingFormFor, useMyPendingForms } from "../../hooks/useBrandForm";
import { useAppStore } from "../../store/appStore";
import type { PendingBrandForm } from "../../services/brandFormService";
import { formRoutePath, type FormOpenedFrom, type FormSubjectKind } from "./formRoute";
import { FORM_DARK } from "./useFormPrimitives";

export const HANDOFF_SEEN_PREFIX = "mingla_form_handoff_seen_v1:";
export const handoffSeenKey = (kind: FormSubjectKind, id: string): string =>
  `${HANDOFF_SEEN_PREFIX}${kind}:${id}`;

/** The row that earns a hand-off: after_purchase, live, unanswered. Pure; exported for tests. */
export function handoffRow(
  rows: readonly PendingBrandForm[] | undefined,
  kind: FormSubjectKind,
  id: string,
): PendingBrandForm | null {
  const row = pendingFormFor(rows, kind, id);
  return row !== null && row.mode === "after_purchase" && !row.answered && row.formStatus === "live"
    ? row
    : null;
}

/** Whether this hand-off was already shown (it shows once). */
export async function wasHandoffSeen(kind: FormSubjectKind, id: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(handoffSeenKey(kind, id))) !== null;
  } catch {
    return false;
  }
}

export async function markHandoffSeen(kind: FormSubjectKind, id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(handoffSeenKey(kind, id), String(Date.now()));
  } catch (error) {
    console.warn("[forms] hand-off seen not saved", error instanceof Error ? error.name : "unknown");
  }
}

export interface FormHandoffBlockProps {
  kind: FormSubjectKind;
  subjectId: string;
  from: Extract<FormOpenedFrom, "purchase" | "rsvp">;
  /** Close the surface first (the cart lands on the purchase page). */
  onBeforeAnswer: () => void;
  /**
   * "Later" also closes the surface (the RSVP popup, as on web). Absent: Later
   * only hides the block (the cart's success panel stays on its ticket).
   */
  onLater?: () => void;
  /** "row": the light sent-ticket sheet's compact row (one button). */
  variant?: "block" | "row";
}

export function FormHandoffBlock({
  kind,
  subjectId,
  from,
  onBeforeAnswer,
  onLater,
  variant = "block",
}: FormHandoffBlockProps): React.ReactElement | null {
  const { t } = useTranslation("forms");
  const router = useRouter();
  const pending = useMyPendingForms();
  const row = handoffRow(pending.data, kind, subjectId);
  const [seen, setSeen] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(8)).current;

  // The list was read before this order existed: read it again once.
  const refetchPending = pending.refetch;
  const signedIn = useAppStore((st) => st.user !== null);
  useEffect(() => {
    if (signedIn) void refetchPending();
  }, [refetchPending, subjectId, signedIn]);

  useEffect(() => {
    let live = true;
    void wasHandoffSeen(kind, subjectId).then((value) => {
      if (live) setSeen(value);
    });
    return () => {
      live = false;
    };
  }, [kind, subjectId]);

  const show = row !== null && seen === false && !hidden;

  useEffect(() => {
    if (!show) return undefined;
    void markHandoffSeen(kind, subjectId);
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        opacity.setValue(1);
        lift.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, delay: 300, useNativeDriver: true }),
        Animated.timing(lift, { toValue: 0, duration: 220, delay: 300, useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, [show, kind, subjectId, opacity, lift]);

  if (!show || row === null) return null;
  const brand = row.brand?.displayName?.trim() || t("theHost");
  const answerNow = (): void => {
    setHidden(true);
    onBeforeAnswer();
    router.push(formRoutePath({ formId: row.formId, eventId: row.eventId, as: kind, sid: subjectId, from }) as never);
  };

  if (variant === "row") {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={answerNow}
        style={({ pressed }) => [styles.lightRow, pressed && styles.pressed]}
        testID="form-handoff-row"
      >
        <Text style={styles.lightTitle}>{t("sentRowTitle", { brand })}</Text>
        <Text style={styles.lightAction}>{t("answerNow")}</Text>
      </Pressable>
    );
  }

  return (
    <Animated.View style={[styles.block, { opacity, transform: [{ translateY: lift }] }]} testID="form-handoff">
      <View style={styles.strip}>
        <Text style={styles.stripText} numberOfLines={1}>{t("fromBrand", { brand })}</Text>
      </View>
      <View style={styles.inner}>
        <Text accessibilityRole="header" style={styles.title}>{t("handoffTitle")}</Text>
        <Text style={styles.body}>{t("handoffBody", { brand })}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={answerNow}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            testID="form-handoff-answer"
          >
            <Text style={styles.primaryText}>{t("answerNow")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setHidden(true);
              onLater?.();
            }}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID="form-handoff-later"
          >
            <Text style={styles.secondaryText}>{t("later")}</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FORM_DARK.line,
    backgroundColor: FORM_DARK.panel,
    overflow: "hidden",
  },
  strip: { backgroundColor: FORM_DARK.panelStrong, paddingHorizontal: 16, paddingVertical: 10 },
  stripText: { color: FORM_DARK.text1, fontSize: 13, fontWeight: "700", textAlign: "left" },
  inner: { padding: 16, gap: 8 },
  title: { color: FORM_DARK.text1, fontSize: 17, lineHeight: 22, fontWeight: "700", textAlign: "left" },
  body: { color: FORM_DARK.text2, fontSize: 14, lineHeight: 20, textAlign: "left" },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  primary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: FORM_DARK.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  primaryText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  secondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FORM_DARK.line,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryText: { color: FORM_DARK.text1, fontSize: 15, fontWeight: "600" },
  lightRow: {
    minHeight: 56,
    marginTop: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e6e7ea",
    backgroundColor: "#f6f6f7",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 2,
  },
  lightTitle: { color: "#17191e", fontSize: 15, fontWeight: "700", textAlign: "left" },
  lightAction: { color: "#17191e", fontSize: 14, fontWeight: "600", textDecorationLine: "underline", textAlign: "left" },
  pressed: { opacity: 0.72 },
});

export default FormHandoffBlock;
