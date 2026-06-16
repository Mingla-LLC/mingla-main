/**
 * ORCH-1150 — RSVP-setup step (replaces the Tickets step for RSVP events).
 *
 * Full host control (SPEC §4.4): capacity cap, plus-ones, waitlist, approval
 * mode, guest-list privacy, going-count visibility, and the "who can find this"
 * section (visibility pills + the discovery toggle, co-located — SPEC §4.3).
 *
 * NO ticket tiers, NO price, NO Stripe (RSVP is moneyless — Constitution #10).
 * validateRsvpStep(4) returns [] — no required fields; the only cross-field
 * rules (waitlist-needs-capacity, plus-max≥1) are UI-enforced via disabled
 * states, not a publish blocker.
 *
 * Android glass: cards/rows use the opaque fallback (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
 */

import React, { useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { DraftEventVisibility } from "../../store/draftEventStore";
import { type StepBodyProps } from "../event/types";

const ROW_BG = Platform.select({
  ios: glass.tint.profileBase,
  android: "#23262b",
  default: glass.tint.profileBase,
});

const VISIBILITY_OPTIONS: readonly { id: DraftEventVisibility; label: string }[] = [
  { id: "public", label: "Public" },
  { id: "unlisted", label: "Unlisted" },
  { id: "private", label: "Private" },
];

interface ToggleRowProps {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  testID?: string;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  sub,
  on,
  onToggle,
  disabled = false,
  testID,
}) => (
  <Pressable
    onPress={disabled ? undefined : onToggle}
    accessibilityRole="switch"
    accessibilityState={{ checked: on, disabled }}
    accessibilityLabel={label}
    disabled={disabled}
    style={[styles.toggleRow, disabled && styles.rowDisabled]}
    testID={testID}
  >
    <View style={styles.toggleLabelCol}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleSub}>{sub}</Text>
    </View>
    <View style={[styles.toggleTrack, on && styles.toggleTrackOn]}>
      <View style={[styles.toggleThumb, on ? styles.toggleThumbOn : styles.toggleThumbOff]} />
    </View>
  </Pressable>
);

interface StepperRowProps {
  label: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
  testID?: string;
}

const NumberStepper: React.FC<StepperRowProps> = ({ label, value, min, onChange, testID }) => (
  <View style={styles.stepperRow}>
    <Text style={styles.stepperLabel}>{label}</Text>
    <View style={styles.stepperControls}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={styles.stepperBtn}
        testID={testID ? `${testID}-dec` : undefined}
      >
        <Text style={styles.stepperBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue} testID={testID ? `${testID}-value` : undefined}>
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        onPress={() => onChange(value + 1)}
        style={styles.stepperBtn}
        testID={testID ? `${testID}-inc` : undefined}
      >
        <Text style={styles.stepperBtnText}>+</Text>
      </Pressable>
    </View>
  </View>
);

export const RsvpStep5Setup: React.FC<StepBodyProps> = ({ draft, updateDraft }) => {
  const capacityOn = draft.rsvpCapacity !== null;

  const toggleCapacity = useCallback(() => {
    updateDraft({ rsvpCapacity: capacityOn ? null : Math.max(draft.rsvpCapacity ?? 1, 1) });
    // Turning capacity OFF also disables waitlist (no "full" → no waitlist).
    if (capacityOn) updateDraft({ rsvpWaitlistEnabled: false });
  }, [capacityOn, draft.rsvpCapacity, updateDraft]);

  const togglePlusOnes = useCallback(() => {
    const next = !draft.rsvpAllowPlusOnes;
    updateDraft({
      rsvpAllowPlusOnes: next,
      rsvpPlusOnesMax: next ? Math.max(draft.rsvpPlusOnesMax, 1) : 0,
    });
  }, [draft.rsvpAllowPlusOnes, draft.rsvpPlusOnesMax, updateDraft]);

  const selectApprovalMode = useCallback(
    (mode: "auto" | "manual") => updateDraft({ rsvpApprovalMode: mode }),
    [updateDraft],
  );

  return (
    <View>
      {/* 1. Capacity */}
      <ToggleRow
        label="Limit the guest list"
        sub={capacityOn ? "Set a maximum number of guests." : "No limit — anyone with the link can RSVP."}
        on={capacityOn}
        onToggle={toggleCapacity}
        testID="rsvp-capacity-toggle"
      />
      {capacityOn ? (
        <NumberStepper
          label="Max guests"
          value={draft.rsvpCapacity ?? 1}
          min={1}
          onChange={(n) => updateDraft({ rsvpCapacity: Math.max(1, n) })}
          testID="rsvp-capacity"
        />
      ) : null}

      {/* 2. Plus-ones */}
      <ToggleRow
        label="Allow guests to bring extras"
        sub="Each guest's extras count toward your limit."
        on={draft.rsvpAllowPlusOnes}
        onToggle={togglePlusOnes}
        testID="rsvp-plusones-toggle"
      />
      {draft.rsvpAllowPlusOnes ? (
        <NumberStepper
          label="Max extra guests per person"
          value={Math.max(draft.rsvpPlusOnesMax, 1)}
          min={1}
          onChange={(n) => updateDraft({ rsvpPlusOnesMax: Math.max(1, n) })}
          testID="rsvp-plusones-max"
        />
      ) : null}

      {/* 3. Waitlist (disabled until capacity is on) */}
      <ToggleRow
        label="Start a waitlist when full"
        sub={
          !capacityOn
            ? "Add a guest limit first."
            : "When a spot opens, the next person on the waitlist is automatically moved in and notified."
        }
        on={draft.rsvpWaitlistEnabled}
        onToggle={() => updateDraft({ rsvpWaitlistEnabled: !draft.rsvpWaitlistEnabled })}
        disabled={!capacityOn}
        testID="rsvp-waitlist-toggle"
      />

      {/* 4. Approvals */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Approvals</Text>
        <View style={styles.segmentWrap}>
          {(["auto", "manual"] as const).map((mode) => {
            const active = draft.rsvpApprovalMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => selectApprovalMode(mode)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={mode === "auto" ? "Auto-approve" : "Approve each RSVP"}
                style={[styles.segment, active && styles.segmentActive]}
                testID={`rsvp-approval-${mode}`}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                  {mode === "auto" ? "Auto-approve" : "Approve each RSVP"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.helper}>
          {draft.rsvpApprovalMode === "auto"
            ? "Guests are in the moment they tap Going."
            : "You approve each guest from your Guests list. They'll see “Awaiting host approval” until you do."}
        </Text>
      </View>

      {/* 5. Guest-list privacy */}
      <ToggleRow
        label="Keep the guest list private"
        sub="Only you see who's coming."
        on={draft.privateGuestList}
        onToggle={() => updateDraft({ privateGuestList: !draft.privateGuestList })}
        testID="rsvp-private-guestlist"
      />

      {/* 6. Going-count visibility */}
      <ToggleRow
        label="Hide the Going count from guests"
        sub="Guests won't see how many are coming."
        on={draft.hideRemainingCount}
        onToggle={() => updateDraft({ hideRemainingCount: !draft.hideRemainingCount })}
        testID="rsvp-hide-count"
      />

      {/* 7. Who can find this — visibility + discovery, co-located */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Who can find this</Text>
        <View style={styles.visibilityWrap}>
          {VISIBILITY_OPTIONS.map((opt) => {
            const active = draft.visibility === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => {
                  updateDraft({ visibility: opt.id });
                  // A private RSVP can't be on a public feed — force discover OFF.
                  if (opt.id === "private") updateDraft({ rsvpDiscoverable: false });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
                style={[styles.visibilityPill, active && styles.visibilityPillActive]}
                testID={`rsvp-visibility-${opt.id}`}
              >
                <Text style={[styles.visibilityPillLabel, active && styles.visibilityPillLabelActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ToggleRow
          label="Also show this on Mingla's discovery feed"
          sub={
            draft.visibility === "private"
              ? "A private RSVP can't be on the public feed."
              : "Off = invite-link only. On = anyone nearby can find and RSVP."
          }
          on={draft.rsvpDiscoverable}
          onToggle={() => updateDraft({ rsvpDiscoverable: !draft.rsvpDiscoverable })}
          disabled={draft.visibility === "private"}
          testID="rsvp-discoverable-toggle"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  field: { marginBottom: spacing.md, marginTop: spacing.sm },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  helper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.4,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  rowDisabled: { opacity: 0.55 },

  // Segmented control
  segmentWrap: {
    flexDirection: "row",
    padding: 4,
    backgroundColor: ROW_BG,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: radiusTokens.md - 2,
  },
  segmentActive: { backgroundColor: accent.tint },
  segmentLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  segmentLabelActive: { color: textTokens.primary },

  // Visibility pills
  visibilityWrap: {
    flexDirection: "row",
    padding: 4,
    backgroundColor: ROW_BG,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: 4,
    marginBottom: spacing.sm,
  },
  visibilityPill: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: radiusTokens.md - 2,
  },
  visibilityPillActive: { backgroundColor: accent.tint },
  visibilityPillLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  visibilityPillLabelActive: { color: textTokens.primary },

  // Toggle row (Android opaque fallback via ROW_BG)
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: ROW_BG,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  toggleLabelCol: { flex: 1, marginRight: spacing.sm },
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
  toggleTrackOn: { backgroundColor: accent.warm },
  toggleThumb: { width: 20, height: 20, borderRadius: 999, backgroundColor: "#fff" },
  toggleThumbOff: { transform: [{ translateX: 0 }] },
  toggleThumbOn: { transform: [{ translateX: 18 }] },

  // Number stepper
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: ROW_BG,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  stepperLabel: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
  },
  stepperBtnText: { fontSize: 20, fontWeight: "700", color: textTokens.primary },
  stepperValue: {
    minWidth: 28,
    textAlign: "center",
    fontSize: typography.bodyLg.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
});
