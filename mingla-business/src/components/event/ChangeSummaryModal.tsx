/**
 * ChangeSummaryModal — review-before-save modal listing field-level diffs
 * + required reason input + notification footer note (ORCH-0704 v2).
 *
 * Sheet primitive (snap=full) with:
 *   - Diff list (each row: severity stripe + field label + old → new value)
 *   - Tickets sub-renderer (added / removed / updated tiers when patch.tickets)
 *   - Required multiline reason input (10..200 chars, char counter)
 *   - Severity-dependent footer note about buyer notification
 *   - Save changes (primary, disabled until reason valid) + Cancel (ghost)
 *
 * Save button calls `onConfirm(reason.trim())` — caller handles the actual
 * mutation + dispatch of notification stack.
 *
 * Per ORCH-0704 v2 spec §3.4.4.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
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
  typography,
} from "../../constants/designSystem";
import type { EditSeverity } from "../../store/eventEditLogStore";
import type { FieldDiff, TicketDiff } from "../../utils/liveEventAdapter";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

const REASON_MIN = 10;
const REASON_MAX = 200;

export interface ChangeSummaryModalProps {
  visible: boolean;
  diffs: FieldDiff[];
  /** When patch.tickets changed, expand per-tier diffs in their own row. */
  ticketDiffs?: TicketDiff[];
  severity: EditSeverity;
  /** Drives the "and SMS" copy in the footer note. */
  webPurchasePresent: boolean;
  onClose: () => void;
  /** Called with the trimmed reason (10..200 chars validated by parent). */
  onConfirm: (reason: string) => void;
  /** Disables both buttons during the parent's async commit. */
  submitting?: boolean;
}

export const ChangeSummaryModal: React.FC<ChangeSummaryModalProps> = ({
  visible,
  diffs,
  ticketDiffs,
  severity,
  webPurchasePresent,
  onClose,
  onConfirm,
  submitting = false,
}) => {
  const [reason, setReason] = useState<string>("");

  // Reset reason whenever modal becomes visible (defensive — same modal
  // instance reused across edits in EditPublishedScreen).
  useEffect(() => {
    if (visible) {
      setReason("");
    }
  }, [visible]);

  const trimmedLen = reason.trim().length;
  const reasonValid =
    trimmedLen >= REASON_MIN && trimmedLen <= REASON_MAX;

  const handleConfirm = useCallback((): void => {
    if (submitting || !reasonValid) return;
    onConfirm(reason.trim());
  }, [submitting, reasonValid, onConfirm, reason]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const footerCopy = ((): string => {
    if (severity === "additive") {
      return "Changes will be logged in your event's edit history. No buyer notification.";
    }
    if (severity === "material") {
      return webPurchasePresent
        ? "Material changes notify your buyers by email and SMS. Your reason will be included in the message."
        : "Material changes notify your buyers by email. Your reason will be included in the message.";
    }
    return "";
  })();

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title}>Review changes</Text>
        <Text style={styles.subhead}>
          These changes save immediately when confirmed.
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          // iOS native: scrolls focused TextInput above keyboard.
          automaticallyAdjustKeyboardInsets
        >
          {/* Diff list */}
          {diffs.length === 0 ? (
            <Text style={styles.emptyCopy}>No changes to review.</Text>
          ) : (
            <View style={styles.diffsList}>
              {diffs.map((diff) => {
                const isMaterial = diff.severity === "material";
                const isTicketsRow = diff.fieldKey === "tickets";
                return (
                  <View
                    key={diff.fieldKey}
                    style={[
                      styles.diffRow,
                      isMaterial ? styles.diffRowMaterial : styles.diffRowSafe,
                    ]}
                  >
                    {/* Left-edge severity stripe — color + structure */}
                    <View
                      style={[
                        styles.stripe,
                        isMaterial
                          ? styles.stripeMaterial
                          : styles.stripeSafe,
                      ]}
                    />
                    <View style={styles.diffContent}>
                      <View style={styles.diffHeaderRow}>
                        <Text style={styles.fieldLabel}>{diff.fieldLabel}</Text>
                        {isMaterial ? (
                          <Text style={styles.severityTag}>NOTIFIES BUYERS</Text>
                        ) : null}
                      </View>
                      {isTicketsRow &&
                      ticketDiffs !== undefined &&
                      ticketDiffs.length > 0 ? (
                        <TicketsDiffSubRenderer ticketDiffs={ticketDiffs} />
                      ) : (
                        <View style={styles.diffValuesRow}>
                          <Text style={styles.oldValue} numberOfLines={2}>
                            {diff.oldValue}
                          </Text>
                          <View style={styles.arrowSlot}>
                            <Icon
                              name="chevR"
                              size={14}
                              color={textTokens.tertiary}
                            />
                          </View>
                          <Text style={styles.newValue} numberOfLines={2}>
                            {diff.newValue}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Required reason input */}
          <View style={styles.reasonSection}>
            <Text style={styles.reasonLabel}>
              Why are you making this change? <Text style={styles.required}>*</Text>
            </Text>
            <View
              style={[
                styles.reasonInputWrap,
                trimmedLen > 0 && !reasonValid ? styles.reasonInputError : null,
              ]}
            >
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Venue change due to weather; updating ticket prices for next phase; correcting typo"
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={4}
                maxLength={REASON_MAX}
                style={styles.reasonInput}
                editable={!submitting}
                accessibilityLabel="Reason for change"
              />
            </View>
            <View style={styles.reasonMetaRow}>
              <Text
                style={[
                  styles.reasonHelper,
                  trimmedLen >= REASON_MIN
                    ? styles.reasonHelperOk
                    : null,
                ]}
              >
                {trimmedLen < REASON_MIN
                  ? `Min ${REASON_MIN} characters`
                  : "Looks good"}
              </Text>
              <Text style={styles.reasonCount}>
                {trimmedLen} / {REASON_MAX}
              </Text>
            </View>
          </View>

          {/* Footer note */}
          {footerCopy.length > 0 ? (
            <View
              style={[
                styles.footerNote,
                severity === "material"
                  ? styles.footerNoteMaterial
                  : styles.footerNoteSafe,
              ]}
            >
              <Icon
                name={severity === "material" ? "flag" : "bell"}
                size={14}
                color={
                  severity === "material" ? accent.warm : textTokens.tertiary
                }
              />
              <Text style={styles.footerCopy}>{footerCopy}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Sticky bottom CTAs */}
        <View style={styles.actions}>
          <Button
            label="Save changes"
            onPress={handleConfirm}
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={submitting || !reasonValid || diffs.length === 0}
            accessibilityLabel="Save changes"
          />
          <View style={styles.actionSpacer} />
          <Button
            label="Cancel"
            onPress={handleClose}
            variant="ghost"
            size="md"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Cancel and return to editor"
          />
        </View>
      </View>
    </Sheet>
  );
};

// ---- TicketsDiffSubRenderer ----------------------------------------

interface TicketsDiffSubRendererProps {
  ticketDiffs: TicketDiff[];
}

const TICKET_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  priceGbp: "Price",
  isFree: "Free",
  capacity: "Capacity",
  isUnlimited: "Unlimited",
  visibility: "Visibility",
  description: "Description",
  saleStartAt: "Sale start",
  saleEndAt: "Sale end",
  approvalRequired: "Approval required",
  passwordProtected: "Password protected",
  password: "Password",
  waitlistEnabled: "Waitlist",
  minPurchaseQty: "Min purchase qty",
  maxPurchaseQty: "Max purchase qty",
  allowTransfers: "Allow transfers",
  displayOrder: "Display order",
  availableAt: "Available at",
};

const TicketsDiffSubRenderer: React.FC<TicketsDiffSubRendererProps> = ({
  ticketDiffs,
}) => (
  <View style={styles.ticketsSubList}>
    {ticketDiffs.map((td) => {
      if (td.kind === "added") {
        return (
          <Text key={td.ticketId} style={styles.ticketSubLine}>
            <Text style={styles.ticketSubKindAdded}>Added</Text>: {td.ticketName}
          </Text>
        );
      }
      if (td.kind === "removed") {
        return (
          <Text key={td.ticketId} style={styles.ticketSubLine}>
            <Text style={styles.ticketSubKindRemoved}>Removed</Text>:{" "}
            {td.ticketName}
          </Text>
        );
      }
      // updated
      const fieldList =
        td.fieldChanges !== undefined && td.fieldChanges.length > 0
          ? td.fieldChanges
              .map(
                (fc) =>
                  TICKET_FIELD_LABELS[String(fc.key)] ?? String(fc.key),
              )
              .join(", ")
          : "(no field detail)";
      return (
        <Text key={td.ticketId} style={styles.ticketSubLine}>
          <Text style={styles.ticketSubKindUpdated}>Updated</Text>: {td.ticketName}{" "}
          <Text style={styles.ticketSubFields}>— {fieldList}</Text>
        </Text>
      );
    })}
  </View>
);

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
  emptyCopy: {
    fontSize: 14,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  diffsList: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  diffRow: {
    flexDirection: "row",
    overflow: "hidden",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
  },
  diffRowSafe: {
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  diffRowMaterial: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  stripe: {
    width: 4,
  },
  stripeSafe: {
    backgroundColor: textTokens.tertiary,
  },
  stripeMaterial: {
    backgroundColor: accent.warm,
  },
  diffContent: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  diffHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.primary,
    textTransform: "uppercase",
  },
  severityTag: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: accent.warm,
    textTransform: "uppercase",
  },
  diffValuesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  oldValue: {
    flex: 1,
    fontSize: 13,
    color: textTokens.tertiary,
    textDecorationLine: "line-through",
  },
  arrowSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  newValue: {
    flex: 1,
    fontSize: 13,
    color: textTokens.primary,
    fontWeight: "500",
  },
  // Tickets sub-renderer
  ticketsSubList: {
    gap: 4,
  },
  ticketSubLine: {
    fontSize: 13,
    color: textTokens.primary,
    lineHeight: 18,
  },
  ticketSubKindAdded: {
    fontWeight: "700",
    color: "#34c759",
  },
  ticketSubKindRemoved: {
    fontWeight: "700",
    color: "#ff3b30",
  },
  ticketSubKindUpdated: {
    fontWeight: "700",
    color: accent.warm,
  },
  ticketSubFields: {
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  // Reason input
  reasonSection: {
    marginBottom: spacing.md,
  },
  reasonLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  required: {
    color: accent.warm,
  },
  reasonInputWrap: {
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 100,
  },
  reasonInputError: {
    borderColor: accent.warm,
  },
  reasonInput: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    minHeight: 80,
    textAlignVertical: "top",
    ...(Platform.OS === "web"
      ? ({ outlineWidth: 0 } as Record<string, number>)
      : null),
  },
  reasonMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  reasonHelper: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  reasonHelperOk: {
    color: textTokens.secondary,
  },
  reasonCount: {
    fontSize: 11,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  // Footer notification note
  footerNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
  },
  footerNoteSafe: {
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  footerNoteMaterial: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  footerCopy: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.secondary,
  },
  // Bottom CTAs
  actions: {
    marginTop: spacing.sm,
  },
  actionSpacer: {
    height: spacing.sm,
  },
});

export default ChangeSummaryModal;
