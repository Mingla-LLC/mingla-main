import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { spacing } from "../../../../constants/designSystem";
import { Sheet } from "../../../ui/Sheet";
import { WebsiteIcon } from "../WebsiteIcon";
import { CardTitle, Hint, MiniButton, WButton, ui } from "../ui";
import { ShareLinksPanel } from "../sections/SharePreviewCard";

/**
 * #4453 M8 (spec v2 §7) — the slim bar over the full-screen preview, on web and
 * in the native full-screen modal: Back to editing, the brand and what this is
 * ("Draft preview"), and Share private link (brand admins and owners; others
 * are told why). Desktop / Tablet / Phone and rotate sit directly below it in
 * the preview panel. Draft chips never appear here, only in the editor frame.
 */
export function FullScreenPreviewBar({ brandName, onClose, canShare, shareReady, plan }: {
  brandName: string;
  onClose: () => void;
  /** Brand admins and owners (Core decides; this follows the publish capability). */
  canShare: boolean;
  /** A draft exists to share. */
  shareReady: boolean;
  /**
   * #4453 M10 — the plan preview's bar: "Preview · nothing built yet", Back to
   * compare, and Build with this style (absent when the viewer cannot build).
   * There is no share link for a plan preview.
   */
  plan?: { onBuild: (() => void) | null };
}): React.ReactElement {
  const [shareOpen, setShareOpen] = useState(false);
  if (plan) {
    return (
      <View style={styles.bar} testID="fullscreen-preview-bar">
        <Pressable onPress={onClose} role="button" accessibilityRole="button" accessibilityLabel="Back to compare" style={styles.back} testID="preview-back">
          <WebsiteIcon name="left" size={16} color={ui.t1} />
          <Text style={styles.backText}>Back to compare</Text>
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1} role="heading" aria-level={1}>Preview · nothing built yet</Text>
          <Text style={styles.brand} numberOfLines={1}>{brandName}</Text>
        </View>
        {plan.onBuild ? <WButton label="Build with this style" size="sm" variant="primary" onPress={plan.onBuild} testID="plan-preview-build-full" /> : null}
      </View>
    );
  }
  return (
    <>
      <View style={styles.bar} testID="fullscreen-preview-bar">
        <Pressable onPress={onClose} role="button" accessibilityRole="button" accessibilityLabel="Back to editing" style={styles.back} testID="preview-back">
          <WebsiteIcon name="left" size={16} color={ui.t1} />
          <Text style={styles.backText}>Back to editing</Text>
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1} role="heading" aria-level={1}>Draft preview</Text>
          <Text style={styles.brand} numberOfLines={1}>{brandName}</Text>
        </View>
        <WButton
          label="Share private link"
          icon="ext"
          size="sm"
          variant="secondary"
          disabled={!shareReady}
          onPress={() => setShareOpen(true)}
          testID="preview-share"
        />
      </View>
      <Sheet visible={shareOpen} onClose={() => setShareOpen(false)} snapPoint="full" testID="preview-share-sheet">
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={styles.grow}>
              <CardTitle>Share a private preview</CardTitle>
              <Hint>Send your draft to someone outside your team. They don&apos;t need to sign in. The link shows your latest draft, stays out of search engines and stops working when it ends or you turn it off.</Hint>
            </View>
            <MiniButton icon="close" label="Close" onPress={() => setShareOpen(false)} testID="preview-share-close" />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            {canShare ? <ShareLinksPanel /> : (
              <Text style={styles.help} testID="preview-share-no-permission">Only brand admins and owners can share a private preview.</Text>
            )}
          </ScrollView>
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  back: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, paddingRight: spacing.xs },
  backText: { fontSize: 14, fontWeight: "600", color: ui.t1 },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "700", color: ui.t1 },
  brand: { fontSize: 12, lineHeight: 16, color: ui.t3 },
  sheet: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingBottom: spacing.md },
  sheetScroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  help: { fontSize: 13, lineHeight: 18, color: ui.t3 },
});
