/**
 * FloatingOfferingBar (app-mobile) — ORCH-1117 [public offering page polish].
 *
 * The Buy bar for the consumer brand-event / experience sheet. F-B HARD
 * constraint: inside a gorhom BottomSheetScrollView the bar MUST be an in-flow
 * SCROLL SIBLING at the END of the bare scroll content — NEVER
 * BaseBottomSheet.stickyFooter (which froze the scroll in ORCH-1016). This
 * component is therefore an in-flow row (NOT position:absolute); the host renders
 * it as the last child of the sheet's scroll passthrough so it pins at the
 * bottom of the content the same way ConsumerTripDetailScreen's reserveFooter
 * does.
 *
 * State is a PURE projection of the shared resolveOfferingCta (one owner). The
 * native brand sheets ship the TAPPABLE states for v1; the bookable===false
 * info-strip is deferred (OQ-B — the BusinessEventCard supply lacks `bookable`),
 * and the existing checkout 409 → cart toast remains the no-dead-end backstop.
 * The unavailable info-strip branch is still implemented here (non-tappable) so
 * sold-out / ended / pre-sale / door states never render a dead Buy button.
 *
 * Dark surface only (consumer sheets are fixed-dark #0c0e12). Opaque ≥0.92 fill
 * satisfies ANDROID_GLASS_USES_OPAQUE_FALLBACK; no Android shadow.
 */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import type { CtaState } from "@mingla/event-rendering";
import { colors } from "../../constants/colors";

export interface FloatingOfferingBarProps {
  cta: CtaState;
  onPress: () => void;
  bottomInset?: number;
  testID?: string;
}

export const FloatingOfferingBar: React.FC<FloatingOfferingBarProps> = ({
  cta,
  onPress,
  bottomInset = 16,
  testID,
}) => {
  const handlePress = (): void => {
    if (!cta.tappable) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  if (!cta.tappable) {
    // Non-tappable info strip (sold-out / ended / pre-sale / door / not-ready).
    // accessibilityRole "text" — never "button" (no dead-tap activation prompt).
    return (
      <View
        style={[styles.bar, styles.barStrip, { paddingBottom: bottomInset }]}
        accessibilityRole="text"
        accessibilityLabel={
          cta.subline !== null ? `${cta.title}. ${cta.subline}` : cta.title
        }
        testID={testID !== undefined ? `${testID}-unavailable` : undefined}
      >
        <Text style={styles.stripGlyph}>ⓘ</Text>
        <View style={styles.stripTextCol}>
          <Text style={styles.stripTitle}>{cta.title}</Text>
          {cta.subline !== null ? (
            <Text style={styles.stripSubline}>{cta.subline}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.bar, { paddingBottom: bottomInset }]}
      testID={testID}
    >
      {cta.kind === "buy" ? (
        <View style={styles.priceCol}>
          <Text style={styles.priceValue}>{cta.price}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={
          cta.kind === "buy" && cta.price.length > 0
            ? `${cta.label}, ${cta.price}`
            : cta.label
        }
        style={({ pressed }) => [
          styles.button,
          // ORCH-1128 — no price slot (free / waitlist) → the sole CTA spans the
          // full bar width instead of hugging content on the right of an empty
          // flex:1 column. Paid "buy" keeps the price-left / button-right split.
          cta.kind !== "buy" && styles.buttonFull,
          pressed && styles.buttonPressed,
        ]}
        testID={testID !== undefined ? `${testID}-action` : undefined}
      >
        <Text style={styles.buttonLabel}>{cta.label}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    // Opaque ≥0.92 fill (Android opaque-glass fallback); no Android shadow.
    backgroundColor: "rgba(16,18,22,0.98)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
    ...Platform.select({ android: { elevation: 0 }, default: {} }),
  },
  barStrip: {
    justifyContent: "flex-start",
    gap: 10,
  },
  priceCol: { flex: 1, justifyContent: "center" },
  priceValue: { fontSize: 19, lineHeight: 24, fontWeight: "900", color: "#FFFFFF" },
  button: {
    minHeight: 56,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 16,
  },
  // ORCH-1128 — full-width sole CTA (free / waitlist): fill the bar, drop the
  // left margin that only exists to separate the button from the price column.
  buttonFull: { flex: 1, marginLeft: 0 },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  buttonLabel: { fontSize: 17, fontWeight: "900", color: "#FFFFFF" },
  stripGlyph: { fontSize: 18, color: "rgba(255,255,255,0.52)" },
  stripTextCol: { flex: 1 },
  stripTitle: { fontSize: 14, fontWeight: "700", color: "rgba(255,255,255,0.72)" },
  stripSubline: {
    fontSize: 12,
    color: "rgba(255,255,255,0.52)",
    marginTop: 2,
  },
});

export default FloatingOfferingBar;
