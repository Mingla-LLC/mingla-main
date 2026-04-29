/**
 * (tabs) layout — renders the active tab via `<Slot />` and our custom
 * glass `BottomNav` capsule below it.
 *
 * Per DEC-073: 3 fixed tabs (Home / Events / Account). Future-4-tab when
 * Marketing ships in Cycle 12 — at that point a 4th entry slots into
 * the TABS array here, no other change.
 */

import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Slot, useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomNav } from "../../src/components/ui/BottomNav";
import type { BottomNavTab } from "../../src/components/ui/BottomNav";
import { canvas, spacing } from "../../src/constants/designSystem";

const TABS: BottomNavTab[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "events", icon: "calendar", label: "Events" },
  { id: "account", icon: "user", label: "Account" },
];

const DEFAULT_TAB_ID = "home";

const detectActiveTab = (pathname: string): string => {
  const lower = pathname.toLowerCase();
  const match = TABS.find((tab) => lower.endsWith(`/${tab.id}`) || lower === `/${tab.id}`);
  return match?.id ?? DEFAULT_TAB_ID;
};

export default function TabsLayout(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const activeId = useMemo(() => detectActiveTab(pathname), [pathname]);

  const handleChange = (id: string): void => {
    // Expo Router resolves /(tabs)/<id> to /<id> at runtime.
    router.push(`/(tabs)/${id}` as never);
  };

  return (
    <View style={styles.host}>
      <View style={styles.content}>
        <Slot />
      </View>
      <View
        style={[
          styles.navWrap,
          {
            paddingBottom: Math.max(insets.bottom, spacing.sm),
            paddingTop: spacing.sm,
          },
        ]}
      >
        <BottomNav tabs={TABS} active={activeId} onChange={handleChange} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  content: {
    flex: 1,
  },
  navWrap: {
    paddingHorizontal: spacing.md,
  },
});
