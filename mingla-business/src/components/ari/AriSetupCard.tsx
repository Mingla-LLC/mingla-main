/**
 * #4389 (screens A1, A2, A5) — Ari's brand setup cards, written into the app
 * so they work with no AI call (AR-1) and render from the server checklist,
 * never from Ari's words (AR-2).
 *
 *   A1  first landing, no brand: "Set up your brand" · About 3 minutes ·
 *       4 rows · Set up my brand / Do it with Ari.
 *   A2  a brand still in setup: "{n} of 4 done", 4 rows, Continue; waiting
 *       for a client shows who; complete collapses to "All set" once (AR-9).
 *   A5  a sensitive number was hidden before send: notice + Open secure setup.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { ARI_SETUP_COPY as C, ARI_SETUP_ITEMS } from "./ariSetupCopy";

type CardButton = { label: string; onPress: () => void; primary?: boolean; testID?: string };

const CardButtons: React.FC<{ buttons: CardButton[] }> = ({ buttons }) => (
  <View style={styles.buttons}>
    {buttons.map((b) => (
      <Pressable
        key={b.label}
        onPress={b.onPress}
        accessibilityRole="button"
        accessibilityLabel={b.label}
        style={({ pressed }) => [b.primary ? styles.btnPrimary : styles.btnSecondary, pressed && styles.pressed]}
        testID={b.testID}
      >
        <Text style={b.primary ? styles.btnPrimaryLabel : styles.btnSecondaryLabel}>{b.label}</Text>
      </Pressable>
    ))}
  </View>
);

export interface AriSetupCardProps {
  /** null → A1 (no brand yet). */
  brandName: string | null;
  doneCount: number;
  waitingFor?: string | null;
  state?: "ready" | "complete" | "error";
  onSetUp: () => void;
  onWithAri?: () => void;
  onRetry?: () => void;
  testID?: string;
}

export const AriSetupCard: React.FC<AriSetupCardProps> = ({
  brandName,
  doneCount,
  waitingFor = null,
  state = "ready",
  onSetUp,
  onWithAri,
  onRetry,
  testID = "ari-setup-card",
}) => {
  if (state === "complete") {
    return (
      <View style={[styles.card, styles.row]} testID={`${testID}-all-set`}>
        <View style={styles.tickOk}>
          <Text style={styles.tickGlyph}>✓</Text>
        </View>
        <Text style={styles.title}>{C.a2.allSet}</Text>
      </View>
    );
  }
  if (state === "error") {
    return (
      <View style={styles.card} testID={`${testID}-error`} accessibilityRole="alert">
        <Text style={styles.body}>{C.a2.error}</Text>
        {onRetry ? <CardButtons buttons={[{ label: C.a2.retry, onPress: onRetry }]} /> : null}
      </View>
    );
  }
  const done = brandName === null ? 0 : Math.max(0, Math.min(4, doneCount));
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={2}>
          {brandName === null ? C.a1.cardTitle : brandName}
        </Text>
        <Text style={styles.meta}>{brandName === null ? C.a1.minutes : C.a2.count(done)}</Text>
      </View>
      {brandName !== null ? (
        <View
          style={styles.bar}
          accessibilityRole="progressbar"
          accessibilityLabel="Setup progress"
          accessibilityValue={{ min: 0, max: 4, now: done }}
        >
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.seg, i < done && styles.segOn]} />
          ))}
        </View>
      ) : null}
      {ARI_SETUP_ITEMS.map((item, i) => {
        const waiting = waitingFor !== null && i >= 2;
        return (
          <View key={item} style={styles.itemRow}>
            {i < done ? (
              <View style={styles.tickOk}>
                <Text style={styles.tickGlyph}>✓</Text>
              </View>
            ) : (
              <View style={[styles.ring, i === done && !waiting && styles.ringCurrent]} />
            )}
            <View style={styles.itemCopy}>
              <Text style={styles.item}>{item}</Text>
              {waiting ? <Text style={styles.meta}>{C.a2.waiting(waitingFor ?? "")}</Text> : null}
            </View>
          </View>
        );
      })}
      {brandName === null ? (
        <CardButtons
          buttons={[
            { label: C.a1.setUp, onPress: onSetUp, primary: true, testID: "ari-setup-start" },
            ...(onWithAri ? [{ label: C.a1.withAri, onPress: onWithAri, testID: "ari-setup-with-ari" }] : []),
          ]}
        />
      ) : waitingFor === null ? (
        <CardButtons buttons={[{ label: C.a2.cta, onPress: onSetUp, primary: true, testID: "ari-setup-continue" }]} />
      ) : null}
    </View>
  );
};

export const AriSensitiveNotice: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <View style={styles.card} testID="ari-sensitive-notice" accessibilityRole="alert">
    <Text style={styles.body}>{C.a5.notice}</Text>
    <CardButtons buttons={[{ label: C.a5.open, onPress: onOpen, primary: true, testID: "ari-sensitive-open" }]} />
  </View>
);

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(30, 33, 39, 0.92)",
  },
  row: { flexDirection: "row", alignItems: "center" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { ...typography.bodyLg, flex: 1, color: textTokens.primary, fontWeight: "600" },
  meta: { ...typography.caption, color: textTokens.tertiary },
  body: { ...typography.body, color: textTokens.secondary },
  bar: { flexDirection: "row", gap: spacing.xs },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.14)" },
  segOn: { backgroundColor: accent.warm },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 32 },
  itemCopy: { flex: 1 },
  item: { ...typography.bodySm, color: textTokens.primary },
  ring: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "rgba(255,255,255,0.24)" },
  ringCurrent: { borderColor: accent.warm },
  tickOk: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#22A06B",
    alignItems: "center",
    justifyContent: "center",
  },
  tickGlyph: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", lineHeight: 13 },
  buttons: { gap: spacing.sm, marginTop: spacing.xs },
  btnPrimary: {
    minHeight: 44,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryLabel: { ...typography.bodySm, color: "#101216", fontWeight: "700" },
  btnSecondary: {
    minHeight: 44,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondaryLabel: { ...typography.bodySm, color: textTokens.primary, fontWeight: "600" },
  pressed: { opacity: 0.72 },
});
