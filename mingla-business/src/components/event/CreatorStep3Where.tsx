/**
 * Wizard Step 3 — Where.
 *
 * Designer source: screens-creator.jsx lines 128-161 (CreatorStep3).
 * Render branches by draft.format:
 *   - in_person: venue name + address + map placeholder + privacy info
 *   - online: conferencing URL + privacy info
 *   - hybrid: BOTH in_person fields AND online URL
 *
 * Map preview is a solid striped placeholder. Real geocoding +
 * Google Places autocomplete land in B-cycle.
 *
 * Per Cycle 3 spec §3.9 Step 3.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";

import { errorForKey, type StepBodyProps } from "./types";

export const CreatorStep3Where: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
  scrollToBottom,
}) => {
  const venueError = showErrors ? errorForKey(errors, "venueName") : undefined;
  const addressError = showErrors ? errorForKey(errors, "address") : undefined;
  const onlineError = showErrors ? errorForKey(errors, "onlineUrl") : undefined;

  const showInPerson = draft.format === "in_person" || draft.format === "hybrid";
  const showOnline = draft.format === "online" || draft.format === "hybrid";

  return (
    <View>
      {showInPerson ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Venue name</Text>
            <Input
              value={draft.venueName ?? ""}
              onChangeText={(v) => updateDraft({ venueName: v })}
              placeholder="e.g. Hidden Rooms"
              variant="text"
              accessibilityLabel="Venue name"
              style={venueError !== undefined ? styles.inputError : undefined}
            />
            {venueError !== undefined ? (
              <Text style={styles.helperError}>{venueError}</Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Address</Text>
            <Input
              value={draft.address ?? ""}
              onChangeText={(v) => updateDraft({ address: v })}
              placeholder="Street, city, postcode"
              variant="text"
              accessibilityLabel="Venue address"
              style={addressError !== undefined ? styles.inputError : undefined}
            />
            {addressError !== undefined ? (
              <Text style={styles.helperError}>{addressError}</Text>
            ) : null}
          </View>

          {/* Hide-address toggle — replaces the static helper text from
              Cycle 3 v1. Default ON (matches prior behaviour). */}
          <Pressable
            onPress={() =>
              updateDraft({
                hideAddressUntilTicket: !draft.hideAddressUntilTicket,
              })
            }
            accessibilityRole="switch"
            accessibilityState={{ checked: draft.hideAddressUntilTicket }}
            accessibilityLabel="Hide address until ticket purchase"
            style={styles.toggleRow}
          >
            <View style={styles.toggleLabelCol}>
              <Text style={styles.toggleLabel}>
                Hide address until ticket purchase
              </Text>
              <Text style={styles.toggleSub}>
                {draft.hideAddressUntilTicket
                  ? "Address only revealed to ticketed guests."
                  : "Address visible on the public event page."}
              </Text>
            </View>
            <View
              style={[
                styles.toggleTrack,
                draft.hideAddressUntilTicket && styles.toggleTrackOn,
              ]}
            >
              <View
                style={[
                  styles.toggleThumb,
                  draft.hideAddressUntilTicket
                    ? styles.toggleThumbOn
                    : styles.toggleThumbOff,
                ]}
              />
            </View>
          </Pressable>

          {/* Map placeholder */}
          <View style={styles.mapWrap}>
            <View style={styles.mapStripes} />
            <View style={styles.mapPin} />
            <Text style={styles.mapHint}>map preview</Text>
          </View>

          {/* Privacy info card */}
          <GlassCard variant="base" padding={spacing.md} style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoIconWrap}>
                <Icon name="location" size={14} color={accent.warm} />
              </View>
              <Text style={styles.infoText}>
                Address appears in tickets and confirmation emails — not on the
                public page until the guest checks out.
              </Text>
            </View>
          </GlassCard>
        </>
      ) : null}

      {showOnline ? (
        <View style={[styles.field, showInPerson && styles.onlineSpacer]}>
          <Text style={styles.fieldLabel}>Online conferencing link</Text>
          <Input
            value={draft.onlineUrl ?? ""}
            onChangeText={(v) => updateDraft({ onlineUrl: v })}
            // Online URL is the bottom-most field on Step 3 (when format
            // is online or hybrid). Same scroll-to-bottom pattern as
            // Step 1's Description: keyboard-rise-aware scroll lands
            // the field flush above the keyboard.
            onFocus={scrollToBottom}
            placeholder="https://..."
            variant="text"
            accessibilityLabel="Online conferencing link"
            style={onlineError !== undefined ? styles.inputError : undefined}
          />
          <Text style={styles.helperHint}>
            Link is shared with ticketed guests only — never posted publicly.
          </Text>
          {onlineError !== undefined ? (
            <Text style={styles.helperError}>{onlineError}</Text>
          ) : null}
        </View>
      ) : null}
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
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  helperHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  inputError: {
    borderColor: semantic.error,
    borderWidth: 1,
  },
  onlineSpacer: {
    marginTop: spacing.md,
  },

  // Hide-address toggle (matches Step 6 ToggleRow visual) ---------------
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
    marginBottom: spacing.md,
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

  // Map placeholder ----------------------------------------------------
  mapWrap: {
    height: 160,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
    position: "relative",
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  mapStripes: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1a1d22",
    opacity: 0.6,
  },
  mapPin: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: accent.warm,
    borderWidth: 3,
    borderColor: "#fff",
  },
  mapHint: {
    position: "absolute",
    bottom: spacing.xs,
    right: spacing.sm,
    fontSize: 10,
    color: textTokens.quaternary,
  },

  // Info card ----------------------------------------------------------
  infoCard: {
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  infoText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.4,
    color: textTokens.secondary,
  },
});
