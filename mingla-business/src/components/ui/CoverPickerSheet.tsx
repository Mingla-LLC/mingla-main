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

import React, { Suspense, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

// ORCH-0892-B v2 sheet-consumer contract: the body scroll routes through the
// SmartScrollView wrapper (KAS on native) so the GIF/Stock search input
// scrolls above the keyboard without bespoke listeners (KeyboardRoot test).
import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  ariPalette,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Button } from "./Button";
import { type CoverPatch } from "./CoverPicker";
import type { CoverTarget } from "./coverTarget";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
// issue #1356 [cover-nested-toast] — Tier 1 of #1342. The cover feedback Toast
// is rendered INSIDE this Sheet (see the nested <Toast> below), never forwarded
// to the parent's root-level sibling Toast.
import { Toast } from "./Toast";
import type { ToastKind } from "./toastTimings";

// issue #868 [cover-gallery] — ORCH-1083 web bundle-budget fix. CoverPicker is
// the heavy authoring picker (device/GIPHY/Pexels/video-trim + the #868 gallery
// manager, ~35 KB on web). CoverPickerSheet is its SOLE runtime importer, so a
// static import forced the whole picker into Metro's eager `__common` boot chunk
// — where #868's gallery-manager growth tipped it past the 2.30 MB cap. Deferring
// it to its own async web chunk (React.lazy) pulls all of it OUT of the boot path
// (native keeps it inline — Metro RN doesn't split, so it loads instantly). It is
// only ever mounted inside this Sheet (opened on user action), so a Suspense
// fallback is the natural, correct UX. Type-only `CoverPatch` above stays erased.
const CoverPicker = React.lazy(() =>
  import("./CoverPicker").then((m) => ({ default: m.CoverPicker })),
);

// issue #1356 [cover-nested-toast] — the picker's onShowToast(msg) seam carries
// no explicit kind, but cover UPLOAD FAILURES must keep the red "error" styling.
// Infer the kind from the message text against a fixed error-signal set (SPEC
// §4): any match → "error"; everything else → neutral "info" (matches the
// parents' historical static "info" kind, so per-message inference is
// parity-preserving, never a regression). Lowercased substring match.
const COVER_TOAST_ERROR_SIGNALS: readonly string[] = [
  "fail",
  "error",
  "permission",
  "couldn't",
  "could not",
  "too large",
  "30 mb",
  "needs a server",
  "try again",
];

export const inferKind = (message: string): ToastKind => {
  const lower = message.toLowerCase();
  return COVER_TOAST_ERROR_SIGNALS.some((signal) => lower.includes(signal))
    ? "error"
    : "info";
};

export interface CoverPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Discriminated cover target — drives persistence + video availability. */
  target: CoverTarget;
  /** Current cover state for preview + remove (the 7-field CoverPicker patch). */
  initial: CoverPatch;
  /** Cover hue fallback for the empty preview (0..360). */
  initialCoverHue?: number;
  onCoverChange: (patch: CoverPatch) => void | Promise<void>;
  // issue #1356 [cover-nested-toast]: retained on the interface for API
  // compatibility (all 11 parent mounts still pass it — zero parent edits), but
  // the sheet NO LONGER forwards it to CoverPicker. Cover feedback now routes to
  // the nested <Toast> below (handleShowToast) so it presents from the Sheet's
  // own modal VC instead of the screen-root VC. It MUST NOT be re-wired to drive
  // a root-level sibling Toast (that is the exact #1356/#1342 bug).
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
  // onShowToast is intentionally NOT destructured — see the interface note.
  // Cover feedback is owned by the nested <Toast> (handleShowToast), never the
  // parent's root-level sibling Toast.
  disabled = false,
  onCoverVideoProcessingChange,
}) => {
  const { isWideDesktop } = useResponsiveLayout();

  // issue #1356 [cover-nested-toast] — local toast state driving the nested
  // <Toast> at the bottom of this Sheet's subtree. The picker's onShowToast
  // messages land here instead of the parent's root Toast (which iOS New-Arch
  // silently drops as a second modal on the screen-root VC — the proven #1356
  // "already presenting" refusal).
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    kind: ToastKind;
  }>({ visible: false, message: "", kind: "info" });
  const [videoProcessing, setVideoProcessing] = useState(false);

  const handleShowToast = useCallback((message: string): void => {
    setToast({ visible: true, message, kind: inferKind(message) });
  }, []);

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
    async (patch: CoverPatch): Promise<void> => {
      setCurrentPatch(patch);
      await onCoverChange(patch);
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
          <Suspense
            fallback={
              <View style={styles.pickerLoading} testID="cover-picker-loading">
                <ActivityIndicator color={textTokens.secondary} />
              </View>
            }
          >
            <CoverPicker
              target={target}
              initialCoverHue={initialCoverHue}
              initialMediaUrl={initial.coverMediaUrl}
              initialMediaPosterUrl={initial.coverMediaPosterUrl}
              initialMediaType={initial.coverMediaType}
              initialProvider={initial.coverMediaProvider}
              initialSourceUrl={initial.coverMediaSourceUrl}
              initialCredit={initial.coverMediaCredit}
              initialCreditUrl={initial.coverMediaCreditUrl}
              initialAlt={initial.coverMediaAlt}
              // issue #868 [cover-gallery] — the ADDITIONAL image/GIF items.
              initialCoverGallery={initial.coverGallery}
              onCoverChange={handleCoverChange}
              // issue #1356 [cover-nested-toast] — route to the LOCAL handler so
              // feedback renders via the nested <Toast> below (inside this Sheet),
              // NOT the parent's root sibling Toast that iOS drops.
              onShowToast={handleShowToast}
              disabled={disabled}
              isWideDesktop={isWideDesktop}
              onCoverVideoProcessingChange={(processing): void => {
                setVideoProcessing(processing);
                onCoverVideoProcessingChange?.(processing);
              }}
            />
          </Suspense>
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
          {videoProcessing ? (
            <Button
              label="Close — keep working"
              variant="primary"
              size="lg"
              fullWidth
              onPress={onClose}
              accessibilityLabel="Close cover picker; video keeps working"
              testID="cover-picker-keep-working"
            />
          ) : hasSelection ? (
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

        {/* issue #1356 [cover-nested-toast] — Tier 1 of #1342. Cover
            confirmation/error feedback renders from THIS Toast, a JSX descendant
            of the open <Sheet> (I-SUB-SHEET-INSIDE-PARENT), so its native
            <Modal> presents from the Sheet's own modal VC — NOT the screen-root
            VC. The old wiring forwarded onShowToast to the parent's root-level
            sibling Toast; on iOS New-Arch that is a SECOND modal on the screen
            root, which UIKit refuses with "Attempt to present … which is already
            presenting …" and every cover toast was silently dropped (proven on
            the iOS sim). Nesting it here is the fix, matching the proven
            ShareModal / JoinWaitlistSheet pattern. The video flow keeps its
            inline videoPickNotice banner (#1338/#1350) — untouched. */}
        <Toast
          visible={toast.visible}
          kind={toast.kind}
          message={toast.message}
          onDismiss={(): void => setToast((t) => ({ ...t, visible: false }))}
          testID="cover-picker-sheet-toast"
        />
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
  // issue #868 — Suspense fallback while the deferred CoverPicker web chunk loads
  // (native resolves instantly). Keeps the sheet body from collapsing mid-load.
  pickerLoading: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
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
    // ORCH-1103: contrast + Ari parity — white-on-accent.warm (#eb7825) is
    // 2.90:1 (fails even the 3:1 large bar). ariPalette.userBubble (#a85a44)
    // is 4.99:1. Same correction ORCH-1101 applied to the Confirm button.
    backgroundColor: ariPalette.userBubble,
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
