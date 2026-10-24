/**
 * Wizard Step 6 — Settings.
 *
 * Designer source: screens-creator.jsx lines 237-277 (CreatorStep6).
 * Visibility 3-pill (Public / Unlisted / Private) + access ToggleRows.
 * #2879 Ilashe P0 — transfer toggle removed: product cannot transfer yet.
 *
 * Watch-point WK-CYCLE-3-1 — ToggleRow kit lift still tracked for reuse.
 *
 * Per Cycle 3 spec §3.9 Step 6.
 *
 * issue #3284 [refund terms] — the REFUND POLICY block renders FIRST: the shared
 * RefundPolicyEditor (event presets) in a GlassCard, the honesty helper (Mingla
 * does not refund automatically), and — on the published-event edit surface once
 * tickets have sold — a read-only warning that terms cannot be made worse. Every
 * input comes from `draft` and the existing `editMode.soldCountByTier`, so there
 * is no new StepBodyProps field for a host to forget to pass.
 */

import React, { useCallback, useEffect, useState } from "react";
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
import {
  PRIVATE_NOT_READY_HELPER,
  canSelectPrivateVisibility,
} from "../../services/privateEventAccessService";
import type { DraftEventVisibility } from "../../store/draftEventStore";
import type { RefundPolicy } from "../../services/refundPolicyService";
// issue #3284 [bundle budget] — the editor loads in its own chunk (ORCH-1083);
// never import ./RefundPolicyEditor statically here.
import { LazyRefundPolicyEditor as RefundPolicyEditor } from "../trip/LazyRefundPolicyEditor";
import { GlassCard } from "../ui/GlassCard";
import { ExtraGuestsField } from "../ui/ExtraGuestsField";
import { HIDE_REMAINING_LOCKED_SUB } from "../../constants/guestListPrivacy";
import { Icon } from "../ui/Icon";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import { doorFullPriceNotice } from "../discounts/doorDiscountContract";

import { type StepBodyProps } from "./types";

const loadDiscountService = () => import("../../services/discountService");

// issue #3284 — design §4.5 organiser copy (event variants).
const REFUND_HELPER_PAID =
  "Guests see these terms before they buy. You issue refunds from Orders — Mingla doesn't refund automatically yet.";
const REFUND_HELPER_ALL_FREE =
  "All your tickets are free, so guests won't see this until you add a paid ticket.";
const refundSalesBannerCopy = (n: number): string =>
  `${n} guest${n === 1 ? "" : "s"} already bought under these terms. More-generous refunds or an extra tier save instantly — but you can't make terms worse for them here.`;

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
  /** issue #3827 going-box (Q1) — a locked switch shows its state, ignores taps. */
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
    style={[styles.toggleRow, disabled && styles.toggleRowDisabled]}
    testID={testID}
  >
    <View style={styles.toggleLabelCol}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleSub}>{sub}</Text>
    </View>
    <View style={[styles.toggleTrack, on && styles.toggleTrackOn]}>
      <View
        style={[
          styles.toggleThumb,
          on ? styles.toggleThumbOn : styles.toggleThumbOff,
        ]}
      />
    </View>
  </Pressable>
);

export interface CreatorStep6SettingsProps extends StepBodyProps {
  /** Present only after publish; the create wizard deliberately omits it. */
  publishedEventId?: string;
}

export const CreatorStep6Settings: React.FC<CreatorStep6SettingsProps> = ({
  draft,
  updateDraft,
  editMode,
  publishedEventId,
}) => {
  // #1931 — Private ticket sales are not ready. The row stays VISIBLE but disabled, and a
  // legacy draft already stored as `private` stays SELECTED rather than being silently
  // rewritten; Publish is blocked separately with the same actionable copy.
  const privateSelectable = canSelectPrivateVisibility();
  // Q1 (#3827) — "Hide remaining count" is locked on while the list is
  // private. An older private event saved before this rule keeps an unlocked
  // switch showing its real state; turning it on then locks it.
  const hideRemainingLocked =
    draft.privateGuestList && draft.hideRemainingCount;
  const [discountsAllowed, setLocalDiscountsAllowed] = useState(true);
  const [discountsPending, setDiscountsPending] = useState(false);

  useEffect(() => {
    if (publishedEventId === undefined) return;
    let active = true;
    void loadDiscountService()
      .then(({ fetchDiscountsAllowed }) =>
        fetchDiscountsAllowed("event", publishedEventId),
      )
      .then((allowed) => {
        if (active) setLocalDiscountsAllowed(allowed);
      })
      .catch(() => {
        // The database defaults to allowed. Keep that honest default and let
        // an explicit write surface any connectivity problem to the Host.
      });
    return () => {
      active = false;
    };
  }, [publishedEventId]);

  const handleDiscountsAllowed = useCallback((): void => {
    if (publishedEventId === undefined || discountsPending) return;
    const next = !discountsAllowed;
    setLocalDiscountsAllowed(next);
    setDiscountsPending(true);
    void loadDiscountService()
      .then(({ setDiscountsAllowed }) =>
        setDiscountsAllowed("event", [publishedEventId], next),
      )
      .then(() =>
        captureDiscountEvent("discount_allow_toggled", {
          item_kind: "event",
          allowed: next,
        }),
      )
      .catch(() => {
        setLocalDiscountsAllowed(!next);
      })
      .finally(() => setDiscountsPending(false));
  }, [discountsAllowed, discountsPending, publishedEventId]);

  const handleSelectVisibility = useCallback(
    (visibility: DraftEventVisibility): void => {
      if (visibility === "private" && !privateSelectable) return;
      updateDraft({ visibility });
    },
    [updateDraft, privateSelectable],
  );

  // issue #3284 — the refund block's inputs, all derived (no new props).
  const hasPaidTicket = draft.tickets.some((t) => !t.isFree);
  const soldTotal = Object.values(editMode?.soldCountByTier ?? {}).reduce(
    (sum, n) => sum + (Number.isFinite(n) && n > 0 ? n : 0),
    0,
  );
  const handleRefundPolicyChange = useCallback(
    (refundPolicy: RefundPolicy | null): void => {
      updateDraft({ refundPolicy });
    },
    [updateDraft],
  );

  return (
    <View>
      {/* issue #3284 — Refund policy (first Settings block) */}
      <View style={styles.field}>
        <GlassCard
          variant="base"
          radius="md"
          padding={spacing.md}
          testID="event-settings-refund-card"
        >
          <RefundPolicyEditor
            offeringType="event"
            value={draft.refundPolicy ?? null}
            onChange={handleRefundPolicyChange}
          />
        </GlassCard>
        <Text
          style={styles.visibilityHelper}
          testID="event-settings-refund-helper"
        >
          {hasPaidTicket ? REFUND_HELPER_PAID : REFUND_HELPER_ALL_FREE}
        </Text>
        {soldTotal > 0 ? (
          <GlassCard
            variant="base"
            radius="md"
            padding={spacing.md}
            style={styles.refundSalesBanner}
            testID="event-settings-refund-sales-banner"
          >
            <View style={styles.refundSalesRow}>
              <Icon
                name="bell"
                size={20}
                color={semantic.warning}
                strokeWidth={2}
              />
              <Text style={styles.refundSalesText}>
                {refundSalesBannerCopy(soldTotal)}
              </Text>
            </View>
          </GlassCard>
        ) : null}
      </View>

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
          <Text style={styles.visibilityHelper}>
            {PRIVATE_NOT_READY_HELPER}
          </Text>
        ) : null}
      </View>

      <ToggleRow
        label="Require approval to buy"
        sub="Manually approve every order."
        on={draft.requireApproval}
        onToggle={() =>
          updateDraft({ requireApproval: !draft.requireApproval })
        }
      />

      <ToggleRow
        label="Hide remaining count"
        // ORCH-1339 — D2-honest sub-copy (SPEC §4.8, byte-exact): the flag
        // hides scarcity + fill level. issue #3827 (Q1) — locked on while the
        // guest list is private, because capacity minus "X left" gives the
        // count away.
        sub={
          hideRemainingLocked
            ? HIDE_REMAINING_LOCKED_SUB
            : 'Don\'t show "X left" or how full it is.'
        }
        on={draft.hideRemainingCount}
        onToggle={() =>
          updateDraft({ hideRemainingCount: !draft.hideRemainingCount })
        }
        disabled={hideRemainingLocked}
        testID="event-hide-remaining"
      />

      <ToggleRow
        label="Private guest list"
        // issue #3827 going-box — private now hides the whole going box
        // (count included) on every buyer surface, and the server withholds it.
        sub="Hide who's going and how many. Guests won't see a going count."
        on={draft.privateGuestList}
        onToggle={() =>
          // Q1 (#3827): turning private ON also hides the remaining count and
          // locks it while the list stays private.
          updateDraft(
            draft.privateGuestList
              ? { privateGuestList: false }
              : { privateGuestList: true, hideRemainingCount: true },
          )
        }
        testID="event-private-guestlist"
      />

      {/* issue #3827 going-box — guests on the host's own list. */}
      <ExtraGuestsField
        value={draft.extraGuestCount ?? 0}
        privateGuestList={draft.privateGuestList}
        onChange={(n) => updateDraft({ extraGuestCount: n })}
        testID="event-extra-guests"
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
      {doorFullPriceNotice(draft.inPersonPaymentsEnabled) !== null ? (
        <Text
          style={styles.doorFullPriceNote}
          testID="event-door-full-price-note"
        >
          {doorFullPriceNotice(draft.inPersonPaymentsEnabled)}
        </Text>
      ) : null}

      {publishedEventId !== undefined ? (
        <ToggleRow
          label="Allow discounts on this event"
          sub="You choose which tickets and discounts are eligible."
          on={discountsAllowed}
          onToggle={handleDiscountsAllowed}
          disabled={discountsPending}
          testID="event-discounts-allowed"
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  doorFullPriceNote: {
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    marginLeft: spacing.sm,
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
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

  // issue #3284 — refund sales banner (copied from the trip settings accordion).
  refundSalesBanner: {
    borderColor: semantic.warning,
    borderWidth: 1,
    backgroundColor: semantic.warningTint,
    marginTop: spacing.sm,
  },
  refundSalesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  refundSalesText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
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
  toggleRowDisabled: {
    opacity: 0.6,
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
