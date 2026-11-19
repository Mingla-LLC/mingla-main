import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ui } from "./ui";

/*
 * #4453 — LOCAL FALLBACK for the brand switcher slot (build contract H / I).
 * INTEGRATOR: once `components/brand/WorkspaceBrandSwitcher.tsx` is merged,
 * replace this component's body with
 *   <WorkspaceBrandSwitcher brandId={brandId} compact />
 * (or swap the import in workspace/PanelHeader.tsx). Until then it shows the
 * brand being edited, read from the route's brand, so the header can never
 * name a different brand from the one on screen.
 */
export function BrandSlot({ brandId, brandName, line }: { brandId: string; brandName: string; line: string }): React.ReactElement {
  return (
    <View style={styles.slot} testID="workspace-brand-slot" accessibilityLabel={`${brandName}. ${line}`} nativeID={`workspace-brand-${brandId}`}>
      <Text style={styles.name} numberOfLines={1} role="heading" aria-level={1}>{brandName}</Text>
      <Text style={styles.line} numberOfLines={1} testID="workspace-save-state">{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: ui.t1 },
  line: { fontSize: 12, lineHeight: 16, color: ui.t3 },
});
