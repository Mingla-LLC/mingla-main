/**
 * CoverPickerSheet — ORCH-0989 [Unified cover picker sheet].
 *
 * The ONE Sheet-hosted cover surface for all 6 cover mounts (event create,
 * event edit, trip create, trip edit, brand edit, brand onboarding). Wraps the
 * unified `CoverPicker` inside the `Sheet` primitive so every surface presents
 * the identical dark-glass gallery drawer. Retires BrandCoverPickerSheet.
 *
 * Web: `Sheet` auto-resolves to the desktop centred card (>=1024px) /
 * mobile-web bottom sheet (<1024px) via Sheet.web.tsx + useResponsiveLayout
 * (I-DESKTOP-GATE-VIA-HOOK). The picker masonry switches to 3 columns on the
 * wide-desktop card.
 *
 * MUST be rendered as a JSX child of the parent host View (never a sibling
 * Fragment) per I-SUB-SHEET-INSIDE-PARENT — native Modal sibling mounts
 * compete at the OS root layer.
 *
 * Per SPEC_ORCH-0989 §3.1/§4.1 + SPEC_ORCH-0989_..._DESIGN.md §2.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

// ORCH-0892-B v2 sheet-consumer contract: the body scroll routes through the
// SmartScrollView wrapper (KAS on native) so the GIF/Stock search input
// scrolls above the keyboard without bespoke listeners (KeyboardRoot test).
import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Button } from "./Button";
import { CoverPicker, type CoverPatch } from "./CoverPicker";
import type { CoverTarget } from "./coverTarget";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

export interface CoverPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Discriminated cover target — drives persistence + video availability. */
  target: CoverTarget;
  /** Current cover state for preview + remove (the 7-field CoverPicker patch). */
  initial: CoverPatch;
  /** Cover hue fallback for the empty preview (0..360). */
  initialCoverHue?: number;
  onCoverChange: (patch: CoverPatch) => void;
  onShowToast: (msg: string) => void;
  disabled?: boolean;
  onCoverVideoProcessingChange?: (isProcessing: boolean) => void;
}

export const CoverPickerSheet: React.FC<CoverPickerSheetProps> = ({
  visible,
  onClose,
  target,
  initial,
  initialCoverHue = 0,
  onCoverChange,
  onShowToast,
  disabled = false,
  onCoverVideoProcessingChange,
}) => {
  const { isWideDesktop } = useResponsiveLayout();

  // META-ORCH-1059 [cover picker selected-state]: track the live selection so
  // the bottom confirm button can show a thumbnail of the chosen cover and read
  // "Use this cover". Covers persist live via onCoverChange (this button is
  // confirm + close, NOT the persistence path). Seed from `initial`; re-sync
  // when `initial` changes (sheet reopened for a different target / cover).
  const [currentPatch, setCurrentPatch] = useState<CoverPatch>(initial);
  useEffect(() => {
    setCurrentPatch(initial);
  }, [initial]);

  const handleCoverChange = useCallback(
    (patch: CoverPatch): void => {
      setCurrentPatch(patch);
      onCoverChange(patch);
    },
    [onCoverChange],
  );

  const hasSelection = currentPatch.coverMediaUrl !== null;
  // Images + GIFs render a thumbnail; video covers show a play glyph instead of
  // a still (the processed URL is not an image source).
  const showThumb =
    hasSelection && currentPatch.coverMediaType !== "video";

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <View style={styles.host}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Cover</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close cover picker"
            hitSlop={12}
            style={({ pressed }) => [pressed && styles.closePressed]}
          >
            <Icon name="close" size={24} color={textTokens.secondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <CoverPicker
            target={target}
            initialCoverHue={initialCoverHue}
            initialMediaUrl={initial.coverMediaUrl}
            initialMediaType={initial.coverMediaType}
            initialProvider={initial.coverMediaProvider}
            initialSourceUrl={initial.coverMediaSourceUrl}
            initialCredit={initial.coverMediaCredit}
            initialCreditUrl={initial.coverMediaCreditUrl}
            initialAlt={initial.coverMediaAlt}
            onCoverChange={handleCoverChange}
            onShowToast={onShowToast}
            disabled={disabled}
            isWideDesktop={isWideDesktop}
            onCoverVideoProcessingChange={onCoverVideoProcessingChange}
          />
        </ScrollView>

        {/* META-ORCH-1009 Sub-E + META-ORCH-1059: an explicit confirm button
            anchored at the bottom. The top-right X is easy to miss once the
            picker is scrolled after an upload, AND tapping a tile gave no
            persistent signal. The confirm button now reflects the live
            selection: "Use this cover" with a thumbnail of the chosen media
            once something is picked, or a plain "Done" dismiss when nothing is
            selected yet. Covers persist live via onCoverChange, so this button
            is confirm + close, not the persistence path. */}
        <View style={styles.footer}>
          {hasSelection ? (
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Use this cover"
              testID="cover-picker-confirm"
              style={({ pressed }) => [
                styles.confirmButton,
                pressed && styles.confirmButtonPressed,
              ]}
            >
              {showThumb && currentPatch.coverMediaUrl !== null ? (
                <Image
                  source={{ uri: currentPatch.coverMediaUrl }}
                  style={styles.confirmThumb}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View style={[styles.confirmThumb, styles.confirmThumbVideo]}>
                  <Icon name="play" size={16} color={textTokens.inverse} />
                </View>
              )}
              <Text style={styles.confirmLabel} numberOfLines={1}>
                Use this cover
              </Text>
              <Icon name="check" size={20} color={textTokens.inverse} />
            </Pressable>
          ) : (
            <Button
              label="Done"
              variant="primary"
              size="lg"
              fullWidth
              onPress={onClose}
              accessibilityLabel="Done choosing cover"
              testID="cover-picker-done"
            />
          )}
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 44,
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  closePressed: {
    opacity: 0.7,
  },
  bodyScroll: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: spacing.lg,
  },
  footer: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  // META-ORCH-1059: confirm CTA with selection thumbnail. Primary-filled,
  // 52px tall to match Button size="lg".
  confirmButton: {
    flexDirection: "row",
    alignItems: "center",
    height: 52,
    paddingLeft: spacing.xs,
    paddingRight: spacing.md,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.warm,
    gap: spacing.sm,
  },
  confirmButtonPressed: {
    opacity: 0.85,
  },
  confirmThumb: {
    width: 40,
    height: 40,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
  },
  confirmThumbVideo: {
    alignItems: "center",
    justifyContent: "center",
  },
  confirmLabel: {
    flex: 1,
    fontSize: typography.buttonLg.fontSize,
    lineHeight: typography.buttonLg.lineHeight,
    fontWeight: typography.buttonLg.fontWeight,
    letterSpacing: typography.buttonLg.letterSpacing,
    color: textTokens.inverse,
  },
});
