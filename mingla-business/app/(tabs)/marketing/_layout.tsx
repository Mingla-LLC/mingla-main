/**
 * Marketing tab layout (ORCH-0815-B foundation).
 *
 * Wraps `/(tabs)/marketing/*` sub-routes. The MarketingSubNav stays sticky
 * at the top; expo-router's `<Slot />` renders whichever sub-route the
 * user navigated to (Overview / Audiences / Campaigns / Templates).
 *
 * The composer route (`/(tabs)/marketing/campaigns/compose`) will hide the
 * sub-nav when it lands in sub-ORCH-B (next sub-step) — for now the
 * sub-nav is rendered uniformly across every sub-route.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { Slot } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MarketingSubNav } from "../../../src/components/marketing/MarketingSubNav";
import { canvas } from "../../../src/constants/designSystem";

export default function MarketingTabLayout(): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <MarketingSubNav />
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
});
