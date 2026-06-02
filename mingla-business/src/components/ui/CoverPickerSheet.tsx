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

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

// ORCH-0892-B v2 sheet-consumer contract: the body scroll routes through the
// SmartScrollView wrapper (KAS on native) so the GIF/Stock search input
// scrolls above the keyboard without bespoke listeners (KeyboardRoot test).
import { ScrollView } from "../../wrappers/SmartScrollView";
import {
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
            onCoverChange={onCoverChange}
            onShowToast={onShowToast}
            disabled={disabled}
            isWideDesktop={isWideDesktop}
            onCoverVideoProcessingChange={onCoverVideoProcessingChange}
          />
        </ScrollView>

        {/* META-ORCH-1009 Sub-E: an explicit Done button anchored at the bottom.
            The top-right X is easy to miss once the picker is scrolled down after
            an upload; a clear primary "Done" gives a reliable way to confirm and
            close. Cover changes persist live via onCoverChange, so Done is purely
            a dismiss. */}
        <View style={styles.footer}>
          <Button
            label="Done"
            variant="primary"
            size="lg"
            fullWidth
            onPress={onClose}
            accessibilityLabel="Done choosing cover"
            testID="cover-picker-done"
          />
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
});
