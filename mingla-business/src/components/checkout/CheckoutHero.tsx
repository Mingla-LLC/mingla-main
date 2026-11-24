/**
 * CheckoutHero — issue #4420 wave 2 (spec §4.2, the "Confirm" and "Total
 * changed" rows). The one centred hero every checkout ending shares:
 *
 *        ( ✓ )       72 disc: the host accent fill with a white check
 *     You're in.     host face 34
 *   2 tickets for …  15/22 secondary, max 38ch
 *
 * - "success": the accent FILL (gradient-aware, #1023) and the colour the
 *   palette picks for text on it. The disc pops in (scale 0.6 → 1, spring);
 *   reduced motion skips it.
 * - "warning" / "error": the status tint with the status text colour
 *   (`statusOn`, through the checkout tokens), no animation.
 *
 * Colours come from the checkout tokens, so on Graphite (no host palette)
 * the hero is the Graphite hero, and in a host's checkout it is the host's.
 */
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { radius as radiusTokens, space } from "../../constants/designSystem";
import { useReduceMotion } from "../../hooks/useMotionPreferences";
import { Icon, type IconName } from "../ui/Icon";
import {
  checkoutAccentFill,
  checkoutOnAccent,
  checkoutStyles,
  checkoutTitleFace,
  color,
} from "./checkoutTheme";

export type CheckoutHeroTone = "success" | "warning" | "error";

export interface CheckoutHeroProps {
  tone: CheckoutHeroTone;
  icon: IconName;
  title: string;
  body?: string | null;
  testID?: string;
}

export function CheckoutHero({
  tone,
  icon,
  title,
  body = null,
  testID,
}: CheckoutHeroProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const pop = useRef(new Animated.Value(tone === "success" && !reduceMotion ? 0 : 1)).current;
  useEffect(() => {
    if (tone !== "success" || reduceMotion) {
      pop.setValue(1);
      return;
    }
    Animated.spring(pop, {
      toValue: 1,
      damping: 26,
      stiffness: 260,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [pop, reduceMotion, tone]);

  const disc =
    tone === "success"
      ? checkoutAccentFill()
      : {
          backgroundColor: tone === "error" ? color.errorTint : color.warningTint,
        };
  const glyph =
    tone === "success"
      ? checkoutOnAccent()
      : tone === "error"
        ? color.errorText
        : color.warningText;
  return (
    <View style={styles.hero} testID={testID}>
      <Animated.View
        style={[
          styles.disc,
          disc,
          tone === "success"
            ? {
                opacity: pop,
                transform: [
                  {
                    scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
                  },
                ],
              }
            : null,
        ]}
        testID={testID === undefined ? undefined : `${testID}-disc`}
      >
        <Icon name={icon} size={tone === "success" ? 32 : 30} color={glyph} strokeWidth={2.4} />
      </Animated.View>
      <Text style={[styles.title, checkoutTitleFace()]} accessibilityRole="header">
        {title}
      </Text>
      {body !== null && body.length > 0 ? (
        <Text style={styles.body} accessibilityLiveRegion="polite">
          {body}
        </Text>
      ) : null}
    </View>
  );
}

const styles = checkoutStyles(() =>
  StyleSheet.create({
    hero: {
      alignItems: "center",
      gap: space[3],
      paddingVertical: space[3],
      marginBottom: space[5],
    },
    disc: {
      width: 72,
      height: 72,
      borderRadius: radiusTokens.full,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontSize: 34,
      lineHeight: 38,
      fontWeight: "800",
      letterSpacing: -0.4,
      textAlign: "center",
      color: color.text1,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
      color: color.text2,
      maxWidth: 380,
    },
  }),
);

/**
 * "2 tickets for Graphite Rooftop Night, Sat 12 Dec." — the line under
 * "You're in." (spec §4.2 Confirm). Null when the receipt is not back yet.
 */
export function youreInLine(
  receipt: { lines: ReadonlyArray<{ qty: number; addOn?: true }>; dateLine: string | null } | null | undefined,
  offeringName: string,
  noun: { one: string; many: string },
): string | null {
  if (receipt === null || receipt === undefined) return null;
  // issue #4522 E-8 — places are counted, not lines: an add-on is not a place.
  const count = receipt.lines
    .filter((line) => line.addOn !== true)
    .reduce((sum, line) => sum + line.qty, 0);
  if (count <= 0) return null;
  const what = `${count} ${count === 1 ? noun.one : noun.many} for ${offeringName}`;
  const when = receipt.dateLine?.trim() ?? "";
  return when.length > 0 ? `${what}, ${when}.` : `${what}.`;
}

export default CheckoutHero;
