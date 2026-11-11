/**
 * #4389 (screen H1) — "Finish setting up {brand}": one card from the server
 * checklist (brand_readiness(brand_setup)). Hidden when done, loading or on
 * error (the To do list carries the readiness error row). Comes back with
 * "One more thing" when the payment partner asks for more later (S-h).
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
import type { BrandSetupChecklist } from "../../services/brandSetupService";
import { HOME_SETUP_COPY as C } from "./homeSetupCopy";

export interface HomeSetupCardProps {
  brandName: string;
  checklist: BrandSetupChecklist | undefined;
  onContinue: () => void;
}

export const HomeSetupCard: React.FC<HomeSetupCardProps> = ({
  brandName,
  checklist,
  onContinue,
}) => {
  if (checklist === undefined || checklist.facts.complete) return null;
  const done = Math.max(0, Math.min(4, checklist.doneCount));
  const waiting = checklist.facts.waitingFor;
  const more = checklist.facts.stripeState === "action_needed";
  const sub = waiting !== null ? C.h1.waiting(waiting) : more ? C.h1.moreNeeded : null;
  return (
    <View style={styles.card} testID="home-setup-card">
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={2}>
          {C.h1.title(brandName)}
        </Text>
        <Text style={styles.count}>{C.h1.count(done)}</Text>
      </View>
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
      {sub !== null ? <Text style={styles.sub}>{sub}</Text> : null}
      {waiting === null ? (
        // A plain pressable, not ui/Button: Button pulls the animation
        // runtime into Home's boot path (and its render suites).
        <Pressable
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel={`${C.h1.cta}: ${C.h1.title(brandName)}`}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          testID="home-setup-continue"
        >
          <Text style={styles.ctaLabel}>{C.h1.cta}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { ...typography.bodyLg, flex: 1, color: textTokens.primary, fontWeight: "600" },
  count: { ...typography.caption, color: textTokens.secondary },
  bar: { flexDirection: "row", gap: spacing.xs },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.14)" },
  segOn: { backgroundColor: accent.warm },
  sub: { ...typography.caption, color: textTokens.secondary },
  cta: {
    minHeight: 44,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  ctaLabel: { ...typography.bodySm, color: "#101216", fontWeight: "700" },
  pressed: { opacity: 0.72 },
});
