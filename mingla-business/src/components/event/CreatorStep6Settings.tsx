/**
 * Wizard Step 6 — Settings.
 *
 * Designer source: screens-creator.jsx lines 237-277 (CreatorStep6).
 * Visibility 3-pill (Public / Unlisted / Private) + 4 ToggleRows
 * (Require approval / Allow transfers / Hide remaining / Password).
 *
 * Watch-point WK-CYCLE-3-1 — ToggleRow appears 4× here. If Cycle 4+
 * surfaces 5th use, lift to kit primitive (carve-out DEC required).
 *
 * Per Cycle 3 spec §3.9 Step 6.
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { DraftEventVisibility } from "../../store/draftEventStore";

import { type StepBodyProps } from "./types";

const VISIBILITY_OPTIONS: ReadonlyArray<{
  id: DraftEventVisibility;
  label: string;
}> = [
  { id: "public", label: "Public" },
  { id: "unlisted", label: "Unlisted" },
  { id: "private", label: "Private" },
];

const VISIBILITY_HELPERS: Record<DraftEventVisibility, string> = {
  public: "Anyone on Mingla can find this event. The link is shareable.",
  unlisted: "Only people with the direct link can see this event.",
  private:
    "Hidden from search and discovery — only invited guests can buy tickets.",
};

interface ToggleRowProps {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, sub, on, onToggle }) => (
  <Pressable
    onPress={onToggle}
    accessibilityRole="switch"
    accessibilityState={{ checked: on }}
    accessibilityLabel={label}
    style={styles.toggleRow}
  >
    <View style={styles.toggleLabelCol}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleSub}>{sub}</Text>
    </View>
    <View style={[styles.toggleTrack, on && styles.toggleTrackOn]}>
      <View
        style={[styles.toggleThumb, on ? styles.toggleThumbOn : styles.toggleThumbOff]}
      />
    </View>
  </Pressable>
);

export const CreatorStep6Settings: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
}) => {
  const handleSelectVisibility = useCallback(
    (visibility: DraftEventVisibility): void => {
      updateDraft({ visibility });
    },
    [updateDraft],
  );

  return (
    <View>
      {/* Visibility */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Visibility</Text>
        <View style={styles.visibilityWrap}>
          {VISIBILITY_OPTIONS.map((opt) => {
            const active = draft.visibility === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => handleSelectVisibility(opt.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
                style={[
                  styles.visibilityPill,
                  active && styles.visibilityPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.visibilityPillLabel,
                    active && styles.visibilityPillLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.visibilityHelper}>
          {VISIBILITY_HELPERS[draft.visibility]}
        </Text>
      </View>

      <ToggleRow
        label="Require approval to buy"
        sub="Manually approve every order."
        on={draft.requireApproval}
        onToggle={() => updateDraft({ requireApproval: !draft.requireApproval })}
      />

      <ToggleRow
        label="Allow ticket transfers"
        sub="Buyers can send to friends."
        on={draft.allowTransfers}
        onToggle={() => updateDraft({ allowTransfers: !draft.allowTransfers })}
      />

      <ToggleRow
        label="Hide remaining count"
        sub="Don't show 'X tickets left'."
        on={draft.hideRemainingCount}
        onToggle={() =>
          updateDraft({ hideRemainingCount: !draft.hideRemainingCount })
        }
      />

      <ToggleRow
        label="Password-protected"
        sub="Guests need a code to see it."
        on={draft.passwordProtected}
        onToggle={() =>
          updateDraft({ passwordProtected: !draft.passwordProtected })
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },

  // Visibility pills ---------------------------------------------------
  visibilityWrap: {
    flexDirection: "row",
    padding: 4,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: 4,
  },
  visibilityPill: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: radiusTokens.md - 2,
  },
  visibilityPillActive: {
    backgroundColor: accent.tint,
  },
  visibilityPillLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  visibilityPillLabelActive: {
    color: textTokens.primary,
  },
  visibilityHelper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.4,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },

  // ToggleRow ----------------------------------------------------------
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  toggleLabelCol: {
    flex: 1,
    marginRight: spacing.sm,
  },
  toggleLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 3,
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  toggleThumbOff: {
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },
});
