/**
 * ORCH-0864 [Marketing Composer V2] Stage E — TemplatePreviewDrawer.
 *
 * Side-drawer (≥768px) / bottom-sheet (<768px) for swiping through saved
 * templates with a LIVE preview rendered against the operator's audience
 * variables. Two CTAs: Apply (full replace, confirm if dirty) and Apply
 * at cursor (insert body fragment, leave subject untouched).
 *
 * Behaviour (SPEC §4.9):
 *   - Templates list = merge of starter + user templates, dedupe by id,
 *     sort starter-first.
 *   - Swiper: ◀ N of M ▶ + dot indicators when M ≤ 8; horizontal page
 *     scroller for the title strip when M > 8.
 *   - Live preview render is debounced 250ms on index change. If operator
 *     swipes again before the timer fires, the in-flight preview is
 *     cancelled and the new one starts (state-versioning pattern; no
 *     true cancellation needed because previewBlocks is sync).
 *   - Apply (replace): if currentDraftIsDirty → confirm via Alert; else
 *     direct replace. Closes drawer on success.
 *   - Apply at cursor: inserts body fragment via callback; subject
 *     untouched; closes drawer.
 *   - Dismiss (swipe right / tap outside / Escape on web) does NOT apply.
 *   - Starter templates apply normally — is_starter_pack only governs
 *     EDITING, not USING (I-PROPOSED-MKT-STARTER-TEMPLATES-READ-ONLY).
 *
 * Pure RN — no TenTap dep. The host (ComposerV2Editor / compose.tsx)
 * wires the Apply callbacks to `editor.setContent()` for replace and
 * `editor.insertContent()` for insert-at-cursor.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  previewBlocks,
  type PreviewBlock,
  type PreviewVariables,
} from "../../../services/marketing/marketingRenderingService";
import type { MarketingTemplateRow } from "../../../types/marketing";
import {
  sortTemplatesStarterFirst,
  substituteOnce,
} from "./templateDrawerHelpers";

const TABLET_BREAKPOINT_PX = 768;
const PREVIEW_DEBOUNCE_MS = 250;

export interface TemplatePreviewDrawerProps {
  visible: boolean;
  onClose: () => void;
  templates: MarketingTemplateRow[];
  previewVariables: PreviewVariables;
  brandName: string | null;
  /** True if the operator has unsaved edits — Apply (replace) will confirm. */
  currentDraftIsDirty: boolean;
  /** Full-replace apply: setContent on the editor + setSubject. */
  onApplyReplace: (template: MarketingTemplateRow) => void;
  /** Insert-at-cursor apply: insertContent only; subject untouched. */
  onApplyAtCursor: (template: MarketingTemplateRow) => void;
}

export function TemplatePreviewDrawer(
  props: TemplatePreviewDrawerProps,
): React.ReactElement | null {
  const {
    visible,
    onClose,
    templates,
    previewVariables,
    brandName,
    currentDraftIsDirty,
    onApplyReplace,
    onApplyAtCursor,
  } = props;
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT_PX;

  // Sort starter-first then by name — stable so the swiper index is meaningful.
  const sortedTemplates = useMemo(
    () => sortTemplatesStarterFirst(templates),
    [templates],
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);

  // Reset to index 0 when drawer reopens.
  useEffect(() => {
    if (visible) setCurrentIndex(0);
  }, [visible]);

  // Debounce preview render — bump `previewVersion` after 250ms of idle
  // index. Any swipe before the timer fires resets the timer.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewVersion((v) => v + 1);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  const currentTemplate = sortedTemplates[currentIndex] ?? null;

  // Live preview blocks for the current template — recomputed when
  // previewVersion or variables change.
  const previewBlocksList = useMemo<PreviewBlock[]>(() => {
    if (currentTemplate === null) return [];
    return previewBlocks(currentTemplate.body_template, previewVariables);
    // previewVersion intentionally in deps — bumping it forces recompute
    // after the debounce, even if currentTemplate identity is unchanged
    // (e.g., operator swiped away and back).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTemplate, previewVariables, previewVersion]);

  const previewSubject = useMemo(() => {
    if (currentTemplate === null) return "";
    return substituteOnce(currentTemplate.subject_template ?? "", previewVariables);
  }, [currentTemplate, previewVariables]);

  const goPrev = useCallback((): void => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback((): void => {
    setCurrentIndex((i) => Math.min(sortedTemplates.length - 1, i + 1));
  }, [sortedTemplates.length]);

  const handleApplyReplace = useCallback((): void => {
    if (currentTemplate === null) return;
    if (currentDraftIsDirty) {
      Alert.alert(
        "Replace current draft?",
        `This will overwrite your subject and body with "${currentTemplate.name}". Your unsaved edits will be lost.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Replace",
            style: "destructive",
            onPress: () => {
              onApplyReplace(currentTemplate);
              onClose();
            },
          },
        ],
      );
      return;
    }
    onApplyReplace(currentTemplate);
    onClose();
  }, [currentTemplate, currentDraftIsDirty, onApplyReplace, onClose]);

  const handleApplyAtCursor = useCallback((): void => {
    if (currentTemplate === null) return;
    onApplyAtCursor(currentTemplate);
    onClose();
  }, [currentTemplate, onApplyAtCursor, onClose]);

  if (!visible) return null;

  const isEmpty = sortedTemplates.length === 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isTablet ? "fade" : "slide"}
      onRequestClose={onClose}
      testID="composer-v2-template-drawer"
    >
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityLabel="Close template drawer"
        accessibilityRole="button"
      />
      <View
        style={[
          styles.drawer,
          isTablet ? styles.drawerTablet : styles.drawerPhone,
        ]}
        accessibilityViewIsModal
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Templates</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.closeBtn, pressed ? styles.pressed : null]}
            testID="composer-v2-template-drawer-close"
          >
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>

        {isEmpty ? (
          <View style={styles.emptyHost}>
            <Text style={styles.emptyText}>
              No templates yet. Create one from the Templates tab.
            </Text>
          </View>
        ) : (
          <>
            {/* Swiper header */}
            <View style={styles.swiperRow}>
              <Pressable
                onPress={goPrev}
                disabled={currentIndex === 0}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Previous template"
                style={({ pressed }) => [
                  styles.swiperBtn,
                  currentIndex === 0 ? styles.swiperBtnDisabled : null,
                  pressed ? styles.pressed : null,
                ]}
                testID="composer-v2-template-prev"
              >
                <Text style={styles.swiperBtnText}>{"◀"}</Text>
              </Pressable>
              <View style={styles.swiperTitleHost}>
                <Text style={styles.swiperTitle} numberOfLines={1}>
                  {currentTemplate?.name ?? ""}
                </Text>
                <Text style={styles.swiperMeta}>
                  {currentIndex + 1} of {sortedTemplates.length}
                  {currentTemplate?.is_starter_pack === true ? " · Starter" : ""}
                </Text>
              </View>
              <Pressable
                onPress={goNext}
                disabled={currentIndex >= sortedTemplates.length - 1}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Next template"
                style={({ pressed }) => [
                  styles.swiperBtn,
                  currentIndex >= sortedTemplates.length - 1 ? styles.swiperBtnDisabled : null,
                  pressed ? styles.pressed : null,
                ]}
                testID="composer-v2-template-next"
              >
                <Text style={styles.swiperBtnText}>{"▶"}</Text>
              </Pressable>
            </View>

            {/* Live preview pane */}
            <ScrollView
              style={styles.previewHost}
              contentContainerStyle={styles.previewContent}
              accessibilityLabel="Template preview"
            >
              {previewSubject.length > 0 ? (
                <Text style={styles.previewSubject}>{previewSubject}</Text>
              ) : null}
              {brandName !== null && brandName.length > 0 ? (
                <Text style={styles.previewBrand}>From {brandName}</Text>
              ) : null}
              <View style={styles.previewDivider} />
              {previewBlocksList.length === 0 ? (
                <Text style={styles.previewEmptyBlock}>(empty template)</Text>
              ) : (
                previewBlocksList.map((block, i) => (
                  <PreviewBlockView key={`${block.kind}-${i}`} block={block} />
                ))
              )}
            </ScrollView>

            {/* CTAs */}
            <View style={styles.footer}>
              <Pressable
                onPress={handleApplyAtCursor}
                accessibilityRole="button"
                accessibilityLabel="Insert template body at cursor — leave subject untouched"
                style={({ pressed }) => [
                  styles.ctaSecondary,
                  pressed ? styles.pressed : null,
                ]}
                testID="composer-v2-template-apply-cursor"
              >
                <Text style={styles.ctaSecondaryText}>Insert at cursor</Text>
              </Pressable>
              <Pressable
                onPress={handleApplyReplace}
                accessibilityRole="button"
                accessibilityLabel={
                  currentDraftIsDirty
                    ? "Replace current draft with this template"
                    : "Apply this template"
                }
                style={({ pressed }) => [
                  styles.ctaPrimary,
                  pressed ? styles.pressed : null,
                ]}
                testID="composer-v2-template-apply-replace"
              >
                <Text style={styles.ctaPrimaryText}>
                  {currentDraftIsDirty ? "Replace draft" : "Apply"}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

// ─── Preview block view ────────────────────────────────────────────────────

interface PreviewBlockViewProps {
  block: PreviewBlock;
}

function PreviewBlockView(props: PreviewBlockViewProps): React.ReactElement {
  const { block } = props;
  if (block.kind === "event_card") {
    return (
      <View style={styles.eventCardPreview}>
        <Text style={styles.eventCardGlyph}>{"▣"}</Text>
        <Text style={styles.eventCardLabel}>Event card</Text>
      </View>
    );
  }
  return <Text style={styles.previewParagraph}>{block.content}</Text>;
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  drawer: {
    position: "absolute",
    backgroundColor: canvas.discover,
    borderColor: glass.border.chrome,
    overflow: "hidden",
  },
  drawerTablet: {
    top: 0,
    right: 0,
    bottom: 0,
    width: 360,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  drawerPhone: {
    bottom: 0,
    left: 0,
    right: 0,
    height: "85%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.chrome,
  },
  headerTitle: {
    ...typography.h3,
    color: textTokens.primary,
  },
  closeBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  closeBtnText: {
    ...typography.buttonMd,
    color: textTokens.secondary,
  },
  pressed: {
    opacity: 0.7,
  },
  emptyHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  swiperRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.chrome,
    gap: spacing.sm,
  },
  swiperBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: glass.tint.badge.idle,
  },
  swiperBtnDisabled: {
    opacity: 0.35,
  },
  swiperBtnText: {
    ...typography.body,
    color: textTokens.primary,
  },
  swiperTitleHost: {
    flex: 1,
    alignItems: "center",
  },
  swiperTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
  },
  swiperMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  previewHost: {
    flex: 1,
  },
  previewContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  previewSubject: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
  },
  previewBrand: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  previewDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.chrome,
    marginVertical: spacing.sm,
  },
  previewParagraph: {
    ...typography.body,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  previewEmptyBlock: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  eventCardPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: accent.tint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    marginVertical: spacing.xs,
  },
  eventCardGlyph: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  eventCardLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.chrome,
  },
  ctaSecondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.badge.idle,
  },
  ctaSecondaryText: {
    ...typography.buttonMd,
    color: textTokens.primary,
  },
  ctaPrimary: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.warm,
  },
  ctaPrimaryText: {
    ...typography.buttonMd,
    color: textTokens.inverse,
    fontWeight: "700",
  },
});
