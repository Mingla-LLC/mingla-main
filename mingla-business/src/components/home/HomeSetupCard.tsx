/**
 * #4389 (screen H1) — "Finish setting up {brand}": one card from the server
 * checklist (brand_readiness(brand_setup)). Hidden when done, loading or on
 * error (the To do list carries the readiness error row). Comes back with
 * "One more thing" when the payment partner asks for more later (S-h).
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  materials,
  type,
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
        accessibilityLabel={C.h1.progressLabel}
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
    marginBottom: space[4],
    padding: space[4],
    gap: space[2],
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tabOn,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  title: { ...type.row, flex: 1, color: color.text1, fontWeight: "600" },
  count: { ...type.caption, color: color.text2 },
  bar: { flexDirection: "row", gap: space[1] },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.fill.step },
  segOn: { backgroundColor: color.accent },
  sub: { ...type.caption, color: color.text2 },
  cta: {
    minHeight: 44,
    borderRadius: radiusTokens.full,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space[1],
  },
  ctaLabel: { ...type.btnSm, color: color.ink },
  pressed: { opacity: 0.72 },
});
