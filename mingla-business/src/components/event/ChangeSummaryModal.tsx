/**
 * ChangeSummaryModal — review-before-save modal listing field-level diffs
 * + required reason input + notification footer note (ORCH-0704 v2).
 *
 * Sheet primitive (snap=full) with:
 *   - Diff list (each row: severity stripe + field label + old → new value)
 *   - Tickets sub-renderer (added / removed / updated tiers when patch.tickets)
 *   - Required multiline reason input (10..200 chars, char counter)
 *   - Footer note saying, truthfully, whether buyers will be emailed
 *     (issue #3827: the words come from `utils/buyerNoticeCopy`)
 *   - Save changes (primary, disabled until reason valid) + Cancel (ghost)
 *
 * Save button calls `onConfirm(reason.trim())` — caller handles the actual
 * mutation. Whether buyers are emailed is decided by the server on save.
 *
 * Per ORCH-0704 v2 spec §3.4.4.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";

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
// issue #3827 — the rows a host reads: no raw data, no duplicate pin row.
import { changeSummaryRows } from "../../utils/changeSummaryRows";
// ORCH-0876 [Trip CRUD + Purchase Flow Completion]: generalized to render
// trip-shape diffs (days / inclusions / pricing tiers) alongside events'
// existing ticket diffs. All new props are optional + backward-compatible.
import type {
  TripDayDiff,
  TripInclusionDiff,
  TripPricingTierDiff,
} from "../../utils/tripAdapter";

// issue #3827 — the footer and the tag say what the server will do.
import {
  changeSummaryNotice,
  type BuyerNoticeNoun,
  type BuyerNoticeStatus,
} from "../../utils/buyerNoticeCopy";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
// #3372 — naira trip package price changes show "₦", not "NGN" (#3341 rule).
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

const REASON_MIN = 10;
const REASON_MAX = 200;

export interface ChangeSummaryModalProps {
  visible: boolean;
  diffs: FieldDiff[];
  /** When patch.tickets changed (events), expand per-tier diffs in their own row. */
  ticketDiffs?: TicketDiff[];
  // ORCH-0876 trip-shape diffs (optional — only set by trip-side consumers):
  /** When patch.days changed (trips), expand per-day diffs. */
  tripDayDiffs?: TripDayDiff[];
  /** When patch.inclusions changed (trips), expand per-inclusion diffs. */
  tripInclusionDiffs?: TripInclusionDiff[];
  /** When patch.pricing_tiers changed (trips), expand per-tier diffs. */
  tripPricingTierDiffs?: TripPricingTierDiff[];
  severity: EditSeverity;
  /**
   * [TRANSITIONAL] issue #3827 — accepted and ignored. It used to add a
   * text-message promise to the footer; no edit is ever sent by text. Exit: the trip
   * editor and the #3827 change-summary suite stop passing it, then it goes.
   */
  webPurchasePresent?: boolean;
  /** Optional label override for the entity type (default "event"). Trips
   *  pass "trip" so the subhead + footer + log-history copy read naturally. */
  entityLabel?: "event" | "trip";
  onClose: () => void;
  /** Called with the trimmed reason (10..200 chars validated by parent). */
  onConfirm: (reason: string) => void;
  /** Disables both buttons during the parent's async commit. */
  submitting?: boolean;
  /**
   * issue #3827 — how many buyers the event has, when that is KNOWN.
   *   - `undefined` / `null` (trip editors, RSVP, still loading, unknown):
   *     nothing changes — the reason is required and the buyer copy shows.
   *   - `0`: nobody is there to notify, so the NOTIFIES BUYERS tag and the
   *     buyer-email footer are not shown (the edit-history copy is), and the
   *     reason is optional: Save is enabled when it is blank or 10..200 long.
   *   - one or more: nothing changes.
   */
  buyerCount?: number | null;
  /**
   * issue #3827 — whether buyer emails are on for this brand and how many
   * people a material change would reach, from
   * `business_event_buyer_notice_status`. `null` means "not known" and reads
   * as "not switched on": the sheet never promises an email it cannot see.
   */
  buyerNoticeStatus?: BuyerNoticeStatus | null;
  /** issue #3827 — "guests" for an RSVP; default "buyers". */
  buyerNoticeNoun?: BuyerNoticeNoun;
  /**
   * issue #3827 — the event has sales and this save is not "refund all":
   * the server refuses a date or time change, so those rows are never tagged
   * as emailed.
   */
  whenChangeRefused?: boolean;
}

export const ChangeSummaryModal: React.FC<ChangeSummaryModalProps> = ({
  visible,
  diffs,
  ticketDiffs,
  tripDayDiffs,
  tripInclusionDiffs,
  tripPricingTierDiffs,
  severity,
  entityLabel = "event",
  onClose,
  onConfirm,
  submitting = false,
  buyerCount,
  buyerNoticeStatus,
  buyerNoticeNoun = "buyers",
  whenChangeRefused = false,
}) => {
  const [reason, setReason] = useState<string>("");
  // issue #3827 — only a KNOWN zero relaxes anything.
  const noBuyers = buyerCount === 0;

  // Reset reason whenever modal becomes visible (defensive — same modal
  // instance reused across edits in EditPublishedScreen).
  useEffect(() => {
    if (visible) {
      setReason("");
    }
  }, [visible]);

  const trimmedLen = reason.trim().length;
  const reasonValid =
    (trimmedLen >= REASON_MIN && trimmedLen <= REASON_MAX) ||
    (noBuyers && trimmedLen === 0);

  const handleConfirm = useCallback((): void => {
    if (submitting || !reasonValid) return;
    onConfirm(reason.trim());
  }, [submitting, reasonValid, onConfirm, reason]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  // issue #3827 — one decision for the footer and for the tag: a row is
  // tagged only when the footer says its buyers will really be told.
  const notice = changeSummaryNotice({
    loggedCopy: `Changes will be logged in your ${entityLabel}'s edit history. No buyer notification.`,
    entityLabel,
    severity,
    noBuyers,
    fieldKeys: diffs.map((diff) => String(diff.fieldKey)),
    status: buyerNoticeStatus,
    noun: buyerNoticeNoun,
    whenRefused: whenChangeRefused,
  });
  const footerCopy = notice.footer;
  const rows = changeSummaryRows(diffs);
  // The footer is styled for what it SAYS, not for the severity.
  const footerIsMaterial = notice.footerIsNotice;

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
        >
          {/* Diff list */}
          {rows.length === 0 ? (
            <Text style={styles.emptyCopy}>No changes to review.</Text>
          ) : (
            <View style={styles.diffsList}>
              {rows.map((diff) => {
                const isMaterial = diff.severity === "material";
                const isTicketsRow = diff.fieldKey === "tickets";
                // ORCH-0876: trip-shape sub-renderer dispatch keys.
                const isTripDaysRow = diff.fieldKey === "days";
                const isTripInclusionsRow = diff.fieldKey === "inclusions";
                const isTripPricingTiersRow = diff.fieldKey === "pricing_tiers";
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
                        {notice.taggedKeys.has(String(diff.fieldKey)) ? (
                          <Text style={styles.severityTag}>{notice.tag}</Text>
                        ) : null}
                      </View>
                      {isTicketsRow &&
                      ticketDiffs !== undefined &&
                      ticketDiffs.length > 0 ? (
                        <TicketsDiffSubRenderer ticketDiffs={ticketDiffs} />
                      ) : isTripDaysRow &&
                        tripDayDiffs !== undefined &&
                        tripDayDiffs.length > 0 ? (
                        <TripDaysDiffSubRenderer tripDayDiffs={tripDayDiffs} />
                      ) : isTripInclusionsRow &&
                        tripInclusionDiffs !== undefined &&
                        tripInclusionDiffs.length > 0 ? (
                        <TripInclusionsDiffSubRenderer
                          tripInclusionDiffs={tripInclusionDiffs}
                        />
                      ) : isTripPricingTiersRow &&
                        tripPricingTierDiffs !== undefined &&
                        tripPricingTierDiffs.length > 0 ? (
                        <TripPricingTierDiffSubRenderer
                          tripPricingTierDiffs={tripPricingTierDiffs}
                        />
                      ) : diff.summary !== undefined && diff.summary.length > 0 ? (
                        <View style={styles.diffValuesRow}>
                          <Text
                            style={styles.newValue}
                            numberOfLines={1}
                            testID={`change-summary-${diff.fieldKey}-summary`}
                          >
                            {diff.summary}
                          </Text>
                        </View>
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
            {noBuyers ? (
              <Text style={styles.reasonLabel}>Reason (optional)</Text>
            ) : (
              <Text style={styles.reasonLabel}>
                Why are you making this change? <Text style={styles.required}>*</Text>
              </Text>
            )}
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
                {noBuyers && trimmedLen === 0
                  ? `Optional. Min ${REASON_MIN} characters if you add one`
                  : trimmedLen < REASON_MIN
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
                footerIsMaterial
                  ? styles.footerNoteMaterial
                  : styles.footerNoteSafe,
              ]}
            >
              <Icon
                name={footerIsMaterial ? "flag" : "bell"}
                size={14}
                color={footerIsMaterial ? accent.warm : textTokens.tertiary}
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
  allowTransfers: "Transfer setting",
  displayOrder: "Display order",
  availableAt: "Available at",
  validDayIds: "Valid days",
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

// ============================================================
// ORCH-0876 [Trip CRUD + Purchase Flow Completion] — trip-shape sub-renderers
// ============================================================
// Mirror the TicketsDiffSubRenderer pattern for trip days, inclusions, and
// pricing tiers. All three render a vertically-stacked list of
// "Added/Removed/Updated: <name>" lines using the same kind-color tokens
// (added: green, removed: red, updated: warm-accent).

interface TripDaysDiffSubRendererProps {
  tripDayDiffs: TripDayDiff[];
}

const TripDaysDiffSubRenderer: React.FC<TripDaysDiffSubRendererProps> = ({
  tripDayDiffs,
}) => (
  <View style={styles.ticketsSubList}>
    {tripDayDiffs.map((d) => {
      const dayLabel = `Day ${d.ordinal}${
        (d.newTitle ?? d.oldTitle) !== null
          ? ` · ${d.newTitle ?? d.oldTitle ?? ""}`
          : ""
      }`;
      if (d.status === "added") {
        return (
          <Text key={`day-${d.ordinal}`} style={styles.ticketSubLine}>
            <Text style={styles.ticketSubKindAdded}>Added</Text>: {dayLabel}
          </Text>
        );
      }
      if (d.status === "removed") {
        return (
          <Text key={`day-${d.ordinal}`} style={styles.ticketSubLine}>
            <Text style={styles.ticketSubKindRemoved}>Removed</Text>: {dayLabel}
          </Text>
        );
      }
      // modified
      const changedFields: string[] = [];
      if (d.oldTitle !== d.newTitle) changedFields.push("Title");
      if ((d.oldNarrative ?? null) !== (d.newNarrative ?? null)) {
        changedFields.push("Narrative");
      }
      const fieldList =
        changedFields.length > 0 ? changedFields.join(", ") : "(no field detail)";
      return (
        <Text key={`day-${d.ordinal}`} style={styles.ticketSubLine}>
          <Text style={styles.ticketSubKindUpdated}>Updated</Text>: {dayLabel}{" "}
          <Text style={styles.ticketSubFields}>— {fieldList}</Text>
        </Text>
      );
    })}
  </View>
);

interface TripInclusionsDiffSubRendererProps {
  tripInclusionDiffs: TripInclusionDiff[];
}

const TripInclusionsDiffSubRenderer: React.FC<
  TripInclusionsDiffSubRendererProps
> = ({ tripInclusionDiffs }) => (
  <View style={styles.ticketsSubList}>
    {tripInclusionDiffs.map((d) => {
      const itemLabel = `${(d.newKind ?? d.oldKind ?? "").toUpperCase()}: ${
        d.newItem ?? d.oldItem ?? ""
      }`;
      if (d.status === "added") {
        return (
          <Text key={`inc-${d.key}`} style={styles.ticketSubLine}>
            <Text style={styles.ticketSubKindAdded}>Added</Text>: {itemLabel}
          </Text>
        );
      }
      if (d.status === "removed") {
        return (
          <Text key={`inc-${d.key}`} style={styles.ticketSubLine}>
            <Text style={styles.ticketSubKindRemoved}>Removed</Text>:{" "}
            {itemLabel}
          </Text>
        );
      }
      // modified — rare; inclusion keys are (kind, item) pairs which means
      // same-key is byte-identical. This branch is reachable only if the
      // diff computer evolves to allow same-key item rewording.
      return (
        <Text key={`inc-${d.key}`} style={styles.ticketSubLine}>
          <Text style={styles.ticketSubKindUpdated}>Updated</Text>: {itemLabel}
        </Text>
      );
    })}
  </View>
);

interface TripPricingTierDiffSubRendererProps {
  tripPricingTierDiffs: TripPricingTierDiff[];
}

const formatCentsMinor = (
  cents: number | null,
  currency: string = "USD",
): string => {
  if (cents === null) return "—";
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(cents / 100),
      currency,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

const TripPricingTierDiffSubRenderer: React.FC<
  TripPricingTierDiffSubRendererProps
> = ({ tripPricingTierDiffs }) => (
  <View style={styles.ticketsSubList}>
    {tripPricingTierDiffs.map((d) => {
      const tierLabel = d.newName ?? d.oldName ?? "Tier";
      if (d.status === "added") {
        return (
          <Text key={`tier-${d.ticketTypeId}`} style={styles.ticketSubLine}>
            <Text style={styles.ticketSubKindAdded}>Added</Text>: {tierLabel}{" "}
            <Text style={styles.ticketSubFields}>
              — {formatCentsMinor(d.newPriceCents)}
            </Text>
          </Text>
        );
      }
      if (d.status === "removed") {
        return (
          <Text key={`tier-${d.ticketTypeId}`} style={styles.ticketSubLine}>
            <Text style={styles.ticketSubKindRemoved}>Removed</Text>:{" "}
            {tierLabel}
          </Text>
        );
      }
      // modified
      const changedFields: string[] = [];
      if (d.oldName !== d.newName) {
        changedFields.push(`Name: ${d.oldName ?? "—"} → ${d.newName ?? "—"}`);
      }
      if (d.oldPriceCents !== d.newPriceCents) {
        changedFields.push(
          `Price: ${formatCentsMinor(d.oldPriceCents)} → ${formatCentsMinor(d.newPriceCents)}`,
        );
      }
      const fieldList =
        changedFields.length > 0 ? changedFields.join(", ") : "(no field detail)";
      return (
        <Text key={`tier-${d.ticketTypeId}`} style={styles.ticketSubLine}>
          <Text style={styles.ticketSubKindUpdated}>Updated</Text>: {tierLabel}{" "}
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
    overflow: "hidden",
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
