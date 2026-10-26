import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Icon } from "../ui/Icon";
import { spacing, text as textTokens } from "../../constants/designSystem";

type Props = {
  title: string;
  /** Where Back goes when the screen opened from a link and has no history. */
  fallback: string;
};

/**
 * #3872 — Creator, gig and roster screens hide the native header, so this bar is
 * their only way back. It mirrors the Referrals header (chevL, 40pt target).
 */
export function ProgramBackBar({ title, fallback }: Props): React.ReactElement {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        style={styles.back}
      >
        <Icon name="chevL" size={22} color={textTokens.primary} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: textTokens.primary, fontSize: 20, fontWeight: "800" },
});
