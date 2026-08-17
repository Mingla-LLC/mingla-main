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
import {
  PRIVATE_NOT_READY_HELPER,
  canSelectPrivateVisibility,
} from "../../services/privateEventAccessService";
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
  // #1931 — Private ticket sales are not ready. The row stays VISIBLE but disabled, and a
  // legacy draft already stored as `private` stays SELECTED rather than being silently
  // rewritten; Publish is blocked separately with the same actionable copy.
  const privateSelectable = canSelectPrivateVisibility();

  const handleSelectVisibility = useCallback(
    (visibility: DraftEventVisibility): void => {
      if (visibility === "private" && !privateSelectable) return;
      updateDraft({ visibility });
    },
    [updateDraft, privateSelectable],
  );

  return (
    <View>
      {/* Visibility */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Visibility</Text>
        <View style={styles.visibilityWrap}>
          {VISIBILITY_OPTIONS.map((opt) => {
            const active = draft.visibility === opt.id;
            const disabled = opt.id === "private" && !privateSelectable;
            return (
              <Pressable
                key={opt.id}
                onPress={() => handleSelectVisibility(opt.id)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled }}
                accessibilityLabel={opt.label}
                style={[
                  styles.visibilityPill,
                  active && styles.visibilityPillActive,
                  disabled && styles.visibilityPillDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.visibilityPillLabel,
                    active && styles.visibilityPillLabelActive,
                    disabled && styles.visibilityPillLabelDisabled,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.visibilityHelper}>
          {draft.visibility === "private" && !privateSelectable
            ? PRIVATE_NOT_READY_HELPER
            : VISIBILITY_HELPERS[draft.visibility]}
        </Text>
        {!privateSelectable && draft.visibility !== "private" ? (
          <Text style={styles.visibilityHelper}>{PRIVATE_NOT_READY_HELPER}</Text>
        ) : null}
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
        // ORCH-1339 — D2-honest sub-copy (SPEC §4.8, byte-exact): the flag
        // hides scarcity + fill level; the going count stays visible.
        sub={'Don\'t show "X left" or how full it is.'}
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

      <ToggleRow
        label="Private guest list"
        // ORCH-1339 — D2-honest sub-copy (SPEC §4.8, byte-exact): the flag
        // hides WHO is going (the cluster/list), never the going count.
        sub="Hide who's going. Guests still see the going count."
        on={draft.privateGuestList}
        onToggle={() =>
          updateDraft({ privateGuestList: !draft.privateGuestList })
        }
      />

      {/* Cycle 12 — In-person payments */}
      <ToggleRow
        label="In-person payments"
        sub='Sell tickets at the door. Adds a "Door Sales" tile to your event.'
        on={draft.inPersonPaymentsEnabled}
        onToggle={() =>
          updateDraft({
            inPersonPaymentsEnabled: !draft.inPersonPaymentsEnabled,
          })
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
    overflow: "hidden",
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
  visibilityPillDisabled: {
    opacity: 0.45,
  },
  visibilityPillLabelDisabled: {
    color: textTokens.secondary,
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
    overflow: "hidden",
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
