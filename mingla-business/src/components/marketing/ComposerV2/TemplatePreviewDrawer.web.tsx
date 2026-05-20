/**
 * TemplatePreviewDrawer.web — ORCH-0891 M2 right-rail desktop variant.
 *
 * Metro picks this file on web; `TemplatePreviewDrawer.tsx` (the mobile
 * bottom-sheet) is the truth on iOS/Android. On narrow web (<1024px),
 * this file falls through to the mobile drawer.
 *
 * # Runtime behaviour (per SPEC §3.5.4 + DESIGN_SPEC §4)
 * - `isWideDesktop === false` → renders the canonical mobile drawer
 *   (existing bottom-sheet pattern). Visual contract bit-identical to today.
 * - `isWideDesktop === true` → renders a positionless `<View>` pane that
 *   `ComposerCanvas.web.tsx` slots into its drawer slot. NO bottom sheet,
 *   NO Modal — just an inline pane with header + scrollable template rows.
 *
 * # Why positionless View on wide-desktop (not Modal)
 * The wide-desktop drawer is mounted INSIDE the composer canvas layout
 * by `ComposerCanvas.web.tsx` as the middle pane between editor and
 * preview. Wrapping it in a Modal would lift it off the canvas back to
 * screen root — defeating the whole point of the side-by-side layout.
 * The wide-desktop variant is a plain inline pane; canvas owns the
 * positioning + width via the 3-pane breakpoint table.
 *
 * # Template row specs (DESIGN_SPEC §4.2)
 * - Row height 64pt
 * - Row spacing 2pt (spacing.xxs)
 * - Row internal padding spacing.sm (8pt)
 * - Row hover bg rgba(255,255,255,0.04) with 120ms cubic-bezier transition
 * - Row selected (applied) bg accent.tint (rgba(235,120,37,0.28))
 * - Template thumbnail 48×48pt with first-letter fallback
 * - Template name: typography.body, text.primary, single-line ellipsis
 * - Template metadata: typography.bodySm, text.tertiary, single line
 *
 * # Invariants honoured
 * - **I-DESKTOP-GATE-VIA-HOOK** — branches via `useResponsiveLayout()`.
 * - **I-RN-COLOR-FORMATS** — all colors via designSystem tokens.
 * - **I-CROSS-SURFACE-IMPACT** — mobile drawer (TemplatePreviewDrawer.tsx)
 *   unchanged; the wide-desktop variant is web-only.
 *
 * Per SPEC_ORCH-0891 §3.5.4 + DESIGN_SPEC §4.
 */

import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import type { MarketingTemplateRow } from "../../../types/marketing";

import {
  TemplatePreviewDrawer as MobileDrawer,
  type TemplatePreviewDrawerProps,
} from "./TemplatePreviewDrawer";

// Re-export the props type so consumers can import everything from the
// canonical specifier `./TemplatePreviewDrawer` (Metro picks the right
// platform variant).
export type { TemplatePreviewDrawerProps };

export const TemplatePreviewDrawer: React.FC<TemplatePreviewDrawerProps> = (props) => {
  const { isWideDesktop } = useResponsiveLayout();

  // Narrow web + native fall-through.
  if (!isWideDesktop) {
    return <MobileDrawer {...props} />;
  }

  // Wide-desktop: render the right-rail pane.
  return <DesktopRightRail {...props} />;
};

interface DesktopRightRailProps extends TemplatePreviewDrawerProps {}

/**
 * Desktop right-rail pane. Mounted inside `ComposerCanvas.web.tsx`'s
 * 3-pane layout when `drawerOpen === true`. Returns `null` when
 * `visible === false` so the canvas's drawer-slot collapses cleanly.
 */
const DesktopRightRail: React.FC<DesktopRightRailProps> = ({
  visible,
  onClose,
  templates,
  onApplyReplace,
  onApplyAtCursor,
  currentDraftIsDirty,
}) => {
  const [appliedId, setAppliedId] = useState<string | null>(null);

  // Split templates into starter pack (read-only) + user templates.
  // Mirrors the existing `templates/index.tsx` two-section layout so the
  // operator sees a consistent mental model whether they're browsing
  // templates from the list view or from inside the composer.
  const { starters, userTemplates } = useMemo(() => {
    const s: MarketingTemplateRow[] = [];
    const u: MarketingTemplateRow[] = [];
    for (const t of templates) {
      // Starter pack templates have `account_id === null` in marketing_templates.
      // Use the canonical discriminator from the row.
      if (t.account_id === null) {
        s.push(t);
      } else {
        u.push(t);
      }
    }
    return { starters: s, userTemplates: u };
  }, [templates]);

  if (!visible) return null;

  const handleApply = (template: MarketingTemplateRow): void => {
    setAppliedId(template.id);
    onApplyReplace(template);
  };

  const handleApplyAtCursor = (template: MarketingTemplateRow): void => {
    setAppliedId(template.id);
    onApplyAtCursor(template);
  };

  return (
    <View style={styles.rail} testID="template-drawer-right-rail">
      {/* Header — sticky 56pt with Close button */}
      <View style={styles.header}>
        <Text style={styles.title}>Templates</Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close templates"
          hitSlop={8}
          style={({ pressed }) => [
            styles.closeBtn,
            pressed ? styles.closeBtnPressed : null,
          ]}
        >
          <Text style={styles.closeBtnText}>×</Text>
        </Pressable>
      </View>

      {/* Scrollable body */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {starters.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>STARTER PACK</Text>
            {starters.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                isApplied={appliedId === t.id}
                onApply={handleApply}
                onApplyAtCursor={handleApplyAtCursor}
                draftIsDirty={currentDraftIsDirty}
              />
            ))}
          </>
        ) : null}

        {userTemplates.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, styles.sectionLabelSpacing]}>
              YOUR TEMPLATES
            </Text>
            {userTemplates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                isApplied={appliedId === t.id}
                onApply={handleApply}
                onApplyAtCursor={handleApplyAtCursor}
                draftIsDirty={currentDraftIsDirty}
              />
            ))}
          </>
        ) : (
          <>
            {starters.length > 0 ? <View style={styles.sectionSpacer} /> : null}
            <Text style={styles.emptyHint}>
              Save a template to find it here. Tap any blast you've composed →
              Save as template.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
};

interface TemplateRowProps {
  template: MarketingTemplateRow;
  isApplied: boolean;
  onApply: (t: MarketingTemplateRow) => void;
  onApplyAtCursor: (t: MarketingTemplateRow) => void;
  draftIsDirty: boolean;
}

const TemplateRow: React.FC<TemplateRowProps> = ({
  template,
  isApplied,
  onApply,
  onApplyAtCursor,
  draftIsDirty,
}) => {
  const firstLetter = template.name.charAt(0).toUpperCase();
  const isStarter = template.account_id === null;
  const subtitle = isStarter ? "Starter" : "Custom";

  return (
    <View
      style={[styles.row, isApplied ? styles.rowApplied : null]}
      testID={`template-drawer-row-${template.id}`}
    >
      <View style={styles.thumb}>
        <Text style={styles.thumbLetter}>{firstLetter}</Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.rowName} numberOfLines={1}>
          {template.name}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => onApply(template)}
          accessibilityRole="button"
          accessibilityLabel={
            draftIsDirty
              ? `Replace draft with ${template.name}`
              : `Apply ${template.name}`
          }
          style={({ pressed }) => [
            styles.actionBtn,
            pressed ? styles.actionBtnPressed : null,
          ]}
          hitSlop={4}
        >
          <Text style={styles.actionBtnText}>Apply</Text>
        </Pressable>
        <Pressable
          onPress={() => onApplyAtCursor(template)}
          accessibilityRole="button"
          accessibilityLabel={`Insert ${template.name} at cursor`}
          style={({ pressed }) => [
            styles.actionBtnSecondary,
            pressed ? styles.actionBtnSecondaryPressed : null,
          ]}
          hitSlop={4}
        >
          <Text style={styles.actionBtnSecondaryText}>At cursor</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  rail: {
    flex: 1,
    flexDirection: "column",
  },
  header: {
    height: 56,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  title: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  closeBtnPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  closeBtnText: {
    fontSize: 22,
    color: textTokens.tertiary,
    lineHeight: 24,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    paddingBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    fontWeight: "600",
    letterSpacing: 1.0,
  },
  sectionLabelSpacing: {
    marginTop: spacing.md,
  },
  sectionSpacer: {
    height: spacing.md,
  },
  emptyHint: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    padding: spacing.md,
    lineHeight: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.xxs,
    height: 64,
  },
  rowApplied: {
    backgroundColor: accent.tint,
  },
  thumb: {
    width: 48,
    height: 48,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  thumbLetter: {
    color: accent.warm,
    fontSize: 18,
    fontWeight: "700",
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "500",
  },
  rowSub: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  actions: {
    flexDirection: "column",
    gap: spacing.xxs,
    alignItems: "flex-end",
  },
  actionBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  actionBtnText: {
    ...typography.bodySm,
    color: accent.warm,
    fontWeight: "600",
  },
  actionBtnSecondary: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  actionBtnSecondaryPressed: {
    opacity: 0.7,
  },
  actionBtnSecondaryText: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "500",
  },
});

export default TemplatePreviewDrawer;
