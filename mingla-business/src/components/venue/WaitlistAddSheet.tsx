/**
 * META-ORCH-1148 sub-ORCH 2.1b — add-to-waitlist sheet.
 *
 * Guest · party · preferred seating · quoted wait · contact (E.164 phone for the
 * "table's ready" SMS). Writes via the RLS-gated insert (useAddToWaitlist).
 * a11y labels on every Pressable. Android glass via Sheet.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
// ORCH-1193 [sheet-cutoff]: body ScrollView via SmartScrollView wrapper so the
// CTA clears the keyboard + 42dp Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { isValidE164 } from "../../utils/phone";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import type {
  VenueTableZone,
  WaitlistAddInput,
} from "../../types/venueReservation";

const ZONES: readonly { value: VenueTableZone; label: string }[] = [
  { value: "indoor", label: "Indoor" },
  { value: "outdoor", label: "Outdoor" },
  { value: "private_room", label: "Private room" },
  { value: "bar", label: "Bar" },
  { value: "patio", label: "Patio" },
];

const parseIntOrNull = (raw: string): number | null => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export interface WaitlistAddSheetProps {
  visible: boolean;
  onClose: () => void;
  onSave: (input: WaitlistAddInput) => void;
  saving: boolean;
  testID?: string;
}

export function WaitlistAddSheet({
  visible,
  onClose,
  onSave,
  saving,
  testID,
}: WaitlistAddSheetProps): React.ReactElement {
  const [guestName, setGuestName] = useState<string>("");
  const [partySize, setPartySize] = useState<number>(2);
  const [zone, setZone] = useState<VenueTableZone | null>(null);
  const [quotedWait, setQuotedWait] = useState<string>("");
  const [phone, setPhone] = useState<string>("");

  useEffect(() => {
    if (!visible) return;
    setGuestName("");
    setPartySize(2);
    setZone(null);
    setQuotedWait("");
    setPhone("");
  }, [visible]);

  const phoneValid = phone.trim().length === 0 || isValidE164(phone.trim());
  const canSave = guestName.trim().length > 0 && phoneValid && !saving;

  const handleSave = useCallback((): void => {
    if (!canSave) return;
    onSave({
      guestName: guestName.trim(),
      guestPhoneE164: phone.trim().length > 0 ? phone.trim() : null,
      guestEmail: null,
      partySize,
      preferredZone: zone,
      quotedWaitMinutes: parseIntOrNull(quotedWait),
    });
  }, [canSave, guestName, phone, partySize, zone, quotedWait, onSave]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.8}
      testID={testID ?? "waitlist-add-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>Add to waitlist</Text>
        <ScrollView
          style={styles.scrollFlex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.groupLabel}>Guest</Text>
          <Input
            value={guestName}
            onChangeText={setGuestName}
            placeholder="Guest name"
            accessibilityLabel="Guest name"
            testID="waitlist-guest-name"
          />

          <Text style={styles.groupLabel}>Party size</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setPartySize((p) => Math.max(1, p - 1))}
              accessibilityRole="button"
              accessibilityLabel="Decrease party size"
              style={styles.stepBtn}
              testID="waitlist-party-minus"
            >
              <Text style={styles.stepBtnLabel}>−</Text>
            </Pressable>
            <Text style={styles.stepValue}>{partySize}</Text>
            <Pressable
              onPress={() => setPartySize((p) => Math.min(100, p + 1))}
              accessibilityRole="button"
              accessibilityLabel="Increase party size"
              style={styles.stepBtn}
              testID="waitlist-party-plus"
            >
              <Text style={styles.stepBtnLabel}>+</Text>
            </Pressable>
          </View>

          <Text style={styles.groupLabel}>Preferred seating (optional)</Text>
          <View style={styles.chipRow}>
            {ZONES.map((z) => {
              const active = z.value === zone;
              return (
                <Pressable
                  key={z.value}
                  onPress={() => setZone(active ? null : z.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Preferred seating ${z.label}`}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  testID={`waitlist-zone-${z.value}`}
                >
                  <Text
                    style={[styles.chipLabel, active ? styles.chipLabelActive : null]}
                  >
                    {z.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.groupLabel}>Quoted wait (minutes, optional)</Text>
          <Input
            value={quotedWait}
            onChangeText={setQuotedWait}
            variant="number"
            placeholder="20"
            accessibilityLabel="Quoted wait in minutes"
            testID="waitlist-quoted-wait"
          />

          <Text style={styles.groupLabel}>Phone for the “table’s ready” text</Text>
          <Input
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 123 4567"
            accessibilityLabel="Guest phone, E.164 format"
            testID="waitlist-phone"
          />
          {!phoneValid ? (
            <Text style={styles.errorText} testID="waitlist-phone-error">
              Enter a valid phone like +15551234567.
            </Text>
          ) : null}

          <Button
            label="Add to waitlist"
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            style={styles.saveBtn}
            testID="waitlist-add-save"
          />
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  heading: {
    ...typography.h3,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  // ORCH-1193: bound the scroll viewport to the fixed-height panel so the CTA
  // scrolls into view instead of overflowing past the panel's overflow:hidden.
  scrollFlex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  groupLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xxs,
  },
  errorText: {
    ...typography.bodySm,
    color: "#ff6b6b",
    marginTop: spacing.xxs,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  stepBtnLabel: {
    ...typography.h3,
    color: textTokens.primary,
  },
  stepValue: {
    ...typography.h3,
    color: textTokens.primary,
    minWidth: 32,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipActive: {
    backgroundColor: accent.warm,
  },
  chipLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  chipLabelActive: {
    color: "#0c0e12",
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
});

export default WaitlistAddSheet;
