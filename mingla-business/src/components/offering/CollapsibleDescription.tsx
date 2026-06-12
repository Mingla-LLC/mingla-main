/**
 * CollapsibleDescription — ORCH-1117 [public offering page polish].
 *
 * Shared collapsible description block for the dark-surface buyer previews
 * (TripPreview, ExperiencePreview). Collapsed by default (3-line peek + "Read
 * more" + down chevron); expands on tap. Copy ≤160 chars renders full with NO
 * toggle (a toggle for 2 lines is noise) — mirrors the EVT-NATIVE reference.
 *
 * The whole header row is one ≥44pt tap target. State is signaled by BOTH the
 * chevron rotation AND the "Read more"/"Show less" word — never color alone.
 * Reduce-motion: skip the LayoutAnimation; chevron still flips (static).
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";

import { Icon } from "../ui/Icon";
import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

// Copy ≤ this fits the 3-line peek → render full, no toggle.
const COLLAPSE_THRESHOLD = 160;

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface CollapsibleDescriptionProps {
  text: string;
  /** Optional style override for the body Text (font/size/color). */
  bodyStyle?: object;
  testID?: string;
}

export const CollapsibleDescription: React.FC<CollapsibleDescriptionProps> = ({
  text,
  bodyStyle,
  testID,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(true);
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value: boolean) => setReduceMotion(value),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const canCollapse = text.length > COLLAPSE_THRESHOLD;

  const toggle = useCallback((): void => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          200,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
    }
    setCollapsed((c) => !c);
  }, [reduceMotion]);

  if (!canCollapse) {
    return (
      <Text style={[styles.body, bodyStyle]} testID={testID}>
        {text}
      </Text>
    );
  }

  const isClamped = collapsed;

  return (
    <View testID={testID}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel="About"
        accessibilityState={{ expanded: !isClamped }}
        accessibilityHint={
          isClamped ? "Expands the description" : "Collapses the description"
        }
        style={styles.headerRow}
      >
        <Text
          style={[styles.body, bodyStyle, styles.peek]}
          numberOfLines={isClamped ? 3 : undefined}
          ellipsizeMode="tail"
        >
          {text}
        </Text>
      </Pressable>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={isClamped ? "Read more" : "Show less"}
        style={styles.toggleRow}
        testID={testID !== undefined ? `${testID}-toggle` : undefined}
      >
        <Text style={styles.toggleText}>
          {isClamped ? "Read more" : "Show less"}
        </Text>
        <Icon
          name={isClamped ? "chevD" : "chevU"}
          size={16}
          color={accent.warm}
        />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  headerRow: {
    minHeight: 44,
    justifyContent: "center",
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  peek: {
    marginTop: 0,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
  },
  toggleText: {
    fontSize: typography.buttonMd.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});

export default CollapsibleDescription;
