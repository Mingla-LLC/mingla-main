import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PromoterHomeView } from "../../src/components/referrals/PromoterHomeView";
import { Icon } from "../../src/components/ui/Icon";
import {
  canvas,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";

export default function PromotingRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/account" as never)
          }
          accessibilityLabel="Back"
          accessibilityRole="button"
          style={styles.back}
        >
          <Icon name="chevL" size={22} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.title}>Promoting</Text>
      </View>
      <PromoterHomeView />
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: canvas.profile },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
});
