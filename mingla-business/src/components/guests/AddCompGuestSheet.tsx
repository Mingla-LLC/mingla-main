/**
 * AddCompGuestSheet — J-G4 manual-add comp guest.
 *
 * Operator opens from J-G1 footer "+" CTA. Required inputs: name, email,
 * reason (10..200 chars). Optional: phone, ticket type, notes.
 *
 * On confirm: useGuestStore.recordCompEntry → useEventEditLogStore.recordEdit
 * (severity material, orderId undefined so it surfaces in Cycle 9c-2
 * activity feed) → close sheet → parent shows toast.
 *
 * No buyer notification fired — comp guests are operator-side, no buyer
 * surface in Cycle 10 honors the changes (I-26 enforcement).
 *
 * Per Cycle 10 SPEC §5/J-G4.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useEventEditLogStore } from "../../store/eventEditLogStore";
import { useGuestStore } from "../../store/guestStore";
import type { CompGuestEntry } from "../../store/guestStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { TicketStub } from "../../store/draftEventStore";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

const REASON_MIN = 10;
const REASON_MAX = 200;
const NAME_MAX = 120;
const EMAIL_MAX = 200;
const PHONE_MAX = 50;
const NOTES_MAX = 200;
const PROCESSING_MS = 800;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isValidEmail = (s: string): boolean => {
  const t = s.trim();
  return t.length >= 1 && t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};

export interface AddCompGuestSheetProps {
  visible: boolean;
  event: LiveEvent;
  brandId: string;
  operatorAccountId: string;
  onClose: () => void;
  onSuccess: (entry: CompGuestEntry) => void;
}

export const AddCompGuestSheet: React.FC<AddCompGuestSheetProps> = ({
  visible,
  event,
  brandId,
  operatorAccountId,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [ticketTypeId, setTicketTypeId] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reset state on visible flip → true
  useEffect(() => {
    if (visible) {
      setName("");
      setEmail("");
      setPhone("");
      setTicketTypeId(null);
      setNotes("");
      setReason("");
      setSubmitting(false);
    }
  }, [visible]);

  // Visible (non-hidden) ticket types for picker.
  // Cycle 12 I-30: comps stay tied to "both" tiers only — door-only tiers
  // are walk-up-only and don't surface as comp options (use case is unclear;
  // deferred). Online-only tiers are fine as comps (operator-side advance grant).
  const pickableTickets = useMemo<TicketStub[]>(
    () =>
      event.tickets
        .filter((t) => t.visibility !== "hidden" && t.availableAt === "both")
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [event.tickets],
  );

  // Validation
  const trimmedNameLen = name.trim().length;
  const trimmedReasonLen = reason.trim().length;
  const nameValid = trimmedNameLen >= 1 && trimmedNameLen <= NAME_MAX;
  const emailValid = isValidEmail(email);
  const phoneValid = phone.length <= PHONE_MAX;
  const notesValid = notes.length <= NOTES_MAX;
  const reasonValid =
    trimmedReasonLen >= REASON_MIN && trimmedReasonLen <= REASON_MAX;
  const isValid =
    nameValid && emailValid && phoneValid && notesValid && reasonValid;
  const canSubmit = !submitting && isValid;

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await sleep(PROCESSING_MS);
      const ticketStub =
        ticketTypeId !== null
          ? event.tickets.find((t) => t.id === ticketTypeId) ?? null
          : null;
      const newEntry = useGuestStore.getState().recordCompEntry({
        eventId: event.id,
        brandId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        ticketTypeId,
        ticketNameAtCreation: ticketStub?.name ?? null,
        addedBy: operatorAccountId,
        notes: notes.trim(),
      });
      // Audit log entry (caller-side per Cycle 9c v2 require-cycle lesson).
      // orderId NOT set — keeps activity feed visibility per Cycle 9c-2 filter.
      useEventEditLogStore.getState().recordEdit({
        eventId: event.id,
        brandId,
        reason: reason.trim(),
        severity: "material",
        changedFieldKeys: ["compEntries"],
        diffSummary: [`added comp guest: ${newEntry.name}`],
        affectedOrderIds: [],
      });
      onSuccess(newEntry);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    ticketTypeId,
    event,
    brandId,
    operatorAccountId,
    name,
    email,
    phone,
    notes,
    reason,
    onSuccess,
  ]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title}>Add comp guest</Text>
        <Text style={styles.subhead}>
          They'll appear in your guest list as a comp ticket.
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Name <Text style={styles.required}>*</Text>
            </Text>
            <View
              style={[
                styles.inputWrap,
                trimmedNameLen > 0 && !nameValid && styles.inputError,
              ]}
            >
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Tunde Olu"
                placeholderTextColor={textTokens.quaternary}
                maxLength={NAME_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Guest name"
              />
            </View>
            {trimmedNameLen > 0 && !nameValid ? (
              <Text style={styles.errorText}>Enter the guest's name.</Text>
            ) : null}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Email <Text style={styles.required}>*</Text>
            </Text>
            <View
              style={[
                styles.inputWrap,
                email.length > 0 && !emailValid && styles.inputError,
              ]}
            >
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="tunde@example.com"
                placeholderTextColor={textTokens.quaternary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={EMAIL_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Guest email"
              />
            </View>
            {email.length > 0 && !emailValid ? (
              <Text style={styles.errorText}>Enter a valid email.</Text>
            ) : null}
          </View>

          {/* Phone (optional) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Phone</Text>
            <View
              style={[styles.inputWrap, !phoneValid && styles.inputError]}
            >
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="Optional"
                placeholderTextColor={textTokens.quaternary}
                keyboardType="phone-pad"
                maxLength={PHONE_MAX}
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Guest phone"
              />
            </View>
            {!phoneValid ? (
              <Text style={styles.errorText}>Phone too long.</Text>
            ) : null}
          </View>

          {/* Ticket type picker (optional) */}
          {pickableTickets.length > 0 ? (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Ticket type</Text>
              <View style={styles.ticketTypeRow}>
                <Pressable
                  onPress={() => setTicketTypeId(null)}
                  style={[
                    styles.ticketTypeChip,
                    ticketTypeId === null && styles.ticketTypeChipActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ticketTypeId === null }}
                  accessibilityLabel="General comp"
                  disabled={submitting}
                >
                  <Text
                    style={[
                      styles.ticketTypeChipLabel,
                      ticketTypeId === null && styles.ticketTypeChipLabelActive,
                    ]}
                  >
                    General comp
                  </Text>
                </Pressable>
                {pickableTickets.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => setTicketTypeId(t.id)}
                    style={[
                      styles.ticketTypeChip,
                      ticketTypeId === t.id && styles.ticketTypeChipActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: ticketTypeId === t.id }}
                    accessibilityLabel={t.name}
                    disabled={submitting}
                  >
                    <Text
                      style={[
                        styles.ticketTypeChipLabel,
                        ticketTypeId === t.id &&
                          styles.ticketTypeChipLabelActive,
                      ]}
                    >
                      {t.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Notes (optional) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Notes</Text>
            <View
              style={[styles.inputWrap, !notesValid && styles.inputError]}
            >
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="VIP, plus-one for performer, press list..."
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={2}
                maxLength={NOTES_MAX}
                style={[styles.input, styles.inputMultiline]}
                editable={!submitting}
                accessibilityLabel="Notes"
              />
            </View>
            {!notesValid ? (
              <Text style={styles.errorText}>
                Notes can't exceed {NOTES_MAX} characters.
              </Text>
            ) : null}
          </View>

          {/* Reason (required) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Why are you adding this guest?{" "}
              <Text style={styles.required}>*</Text>
            </Text>
            <View
              style={[
                styles.inputWrap,
                trimmedReasonLen > 0 && !reasonValid && styles.inputError,
              ]}
            >
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. VIP comp; plus-one for performer; press list"
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={3}
                maxLength={REASON_MAX}
                style={[styles.input, styles.inputMultiline]}
                editable={!submitting}
                accessibilityLabel="Reason"
              />
            </View>
            <View style={styles.reasonMetaRow}>
              <Text
                style={[
                  styles.reasonHelper,
                  trimmedReasonLen >= REASON_MIN && styles.reasonHelperOk,
                ]}
              >
                {trimmedReasonLen < REASON_MIN
                  ? `Tell us why (${REASON_MIN}–${REASON_MAX} chars).`
                  : "Looks good"}
              </Text>
              <Text style={styles.reasonCount}>
                {trimmedReasonLen} / {REASON_MAX}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Sticky bottom CTAs */}
        <View style={styles.actions}>
          <Button
            label={submitting ? "Adding..." : "Add guest"}
            onPress={handleConfirm}
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel="Add comp guest"
          />
          <View style={styles.actionSpacer} />
          <Button
            label="Cancel"
            onPress={handleClose}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Cancel add guest"
          />
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  subhead: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  scroll: {
    flex: 1,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 6,
  },
  required: {
    color: accent.warm,
  },
  inputWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  inputError: {
    borderColor: "rgba(235, 120, 37, 0.5)",
  },
  input: {
    fontSize: 15,
    color: textTokens.primary,
    minHeight: 40,
    paddingVertical: 6,
  },
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  errorText: {
    fontSize: 12,
    color: accent.warm,
    marginTop: 4,
  },
  ticketTypeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  ticketTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  ticketTypeChipActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  ticketTypeChipLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.primary,
  },
  ticketTypeChipLabelActive: {
    fontWeight: "600",
  },
  reasonMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  reasonHelper: {
    fontSize: 12,
    color: textTokens.tertiary,
  },
  reasonHelperOk: {
    color: textTokens.secondary,
  },
  reasonCount: {
    fontSize: 11,
    color: textTokens.quaternary,
    fontVariant: ["tabular-nums"],
  },
  actions: {
    paddingTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
});

export default AddCompGuestSheet;
