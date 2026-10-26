import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Icon } from "../ui/Icon";
import { spacing, text as textTokens } from "../../constants/designSystem";

type Props = {
  title: string;
  /** Where Back goes when the screen opened from a link and has no history. */
  fallback: string;
  /** "close" shows an X (for full-screen editors) instead of a back chevron. */
  leading?: "back" | "close";
  /** Optional right-hand accessory (a pill, an action). */
  right?: React.ReactNode;
};

/**
 * #3872 — Creator, gig and roster screens hide the native header, so this bar is
 * their only way back. Plain title bar: Back (falls back when there's no
 * history), a centred title, an optional right accessory.
 */
export function ProgramBackBar({
  title,
  fallback,
  leading = "back",
  right,
}: Props): React.ReactElement {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace(fallback as never)
        }
        accessibilityRole="button"
        accessibilityLabel={leading === "close" ? "Close" : "Back"}
        hitSlop={8}
        style={styles.back}
      >
        <Icon
          name={leading === "close" ? "close" : "chevL"}
          size={22}
          color={textTokens.primary}
        />
      </Pressable>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.right}>{right ?? null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    color: textTokens.primary,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  right: { minWidth: 40, alignItems: "flex-end", justifyContent: "center" },
});
