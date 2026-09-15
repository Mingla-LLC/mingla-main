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
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { DraftEventVisibility } from "../../store/draftEventStore";
import { type StepBodyProps } from "../event/types";
import { Icon } from "../ui/Icon";
import { TurnoutForecastCard } from "../intel/TurnoutForecastCard";
import { useTurnoutFocusTarget } from "../intel/useTurnoutFocusTarget";
// #3372 — the chip-in money prefix reads "₦", not "NGN" (#3341 rule).
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

const ROW_BG = Platform.select({
  ios: glass.tint.profileBase,
  android: "#23262b",
  default: glass.tint.profileBase,
});

const VISIBILITY_OPTIONS: readonly {
  id: DraftEventVisibility;
  label: string;
}[] = [
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
      <View
        style={[
          styles.toggleThumb,
          on ? styles.toggleThumbOn : styles.toggleThumbOff,
        ]}
      />
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

const NumberStepper: React.FC<StepperRowProps> = ({
  label,
  value,
  min,
  onChange,
  testID,
}) => (
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
      <Text
        style={styles.stepperValue}
        testID={testID ? `${testID}-value` : undefined}
      >
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

// ORCH-1291 [rsvp-chip-in] — currency symbol for the money-field prefix.
const currencySymbol = (currency: string): string => {
  try {
    return (
      withCurrencyGlyph(
        new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency || "USD",
        }).format(0),
        currency,
      ).replace(/[\d.,\s]/g, "") || "$"
    );
  } catch {
    return "$";
  }
};

interface MoneyFieldProps {
  label: string;
  helper?: string;
  currency: string;
  cents: number | null;
  onChange: (cents: number | null) => void;
  testID?: string;
}

// ORCH-1291 — currency-prefixed money field (major units in, cents out).
const MoneyField: React.FC<MoneyFieldProps> = ({
  label,
  helper,
  currency,
  cents,
  onChange,
  testID,
}) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={styles.moneyRow}>
      <Text style={styles.moneyPrefix}>{currencySymbol(currency)}</Text>
      <TextInput
        value={
          cents !== null && cents > 0 ? String(Math.round(cents / 100)) : ""
        }
        onChangeText={(raw) => {
          const digits = raw.replace(/[^\d]/g, "");
          onChange(digits.length > 0 ? parseInt(digits, 10) * 100 : null);
        }}
        keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
        placeholder="0"
        placeholderTextColor={textTokens.tertiary}
        accessibilityLabel={label}
        style={styles.moneyInput}
        testID={testID}
      />
    </View>
    {helper !== undefined ? <Text style={styles.helper}>{helper}</Text> : null}
  </View>
);

// "Who can find this" — what each choice does on the server, so each pairing
// has exactly one meaning on screen:
//   Public   → listed on the brand page (business_public_events_view admits only
//              visibility='public') and open to anyone with the link. The feed
//              switch adds the Explorer discovery feed on top
//              (pg_discover_business_events needs visibility='public' AND
//              rsvp_discoverable). Public + feed OFF is NOT Unlisted: it is
//              still on the brand page.
//   Unlisted → stored 'hidden': link only. Never on the brand page or the feed,
//              whatever rsvp_discoverable says.
//   Private  → never on the brand page or the feed; the publish RPC also forces
//              rsvp_discoverable off.
// The feed switch therefore only means something under Public, so it is shown
// only there, and picking Unlisted or Private saves it OFF.
export const rsvpDiscoverySub = (discoverable: boolean): string =>
  discoverable
    ? "On: people nearby can also find it in the Mingla app and RSVP."
    : "Off: people find it on your brand page or with your link.";

export const RSVP_DISCOVERY_UNAVAILABLE: Readonly<
  Record<Exclude<DraftEventVisibility, "public">, string>
> = {
  unlisted:
    "Unlisted RSVPs are link-only, so they stay off your brand page and Mingla's discovery feed.",
  private:
    "Private RSVPs stay off your brand page and Mingla's discovery feed.",
};

// The spots-left sub-copy must not promise "guests see who's going" when the
// host has made the guest list private.
export const rsvpHideCountSub = (privateGuestList: boolean): string =>
  privateGuestList
    ? "Guests won't see how many spots remain."
    : "Guests see who's going — not how many spots remain.";

export const RsvpStep5Setup: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  brandDefaultCurrency,
  chipInPayoutReady,
}) => {
  const intelCapacityHighlight = useTurnoutFocusTarget("capacity");
  const capacityOn = draft.rsvpCapacity !== null;
  const chipCurrency = brandDefaultCurrency ?? draft.currency ?? "USD";
  const contributionOn = draft.rsvpContributionEnabled;
  const minGtSuggested =
    draft.rsvpContributionMinCents !== null &&
    draft.rsvpContributionSuggestedCents !== null &&
    draft.rsvpContributionMinCents > draft.rsvpContributionSuggestedCents;

  // ORCH-1355 C-2 — ONE combined patch. Turning capacity OFF also clears the
  // waitlist (no "full" → no waitlist) in the SAME write. A prior two-write
  // version dropped the second field from the autosave payload via the wizard's
  // stale closure (see RsvpCreatorWizard handleUpdate). One patch per user
  // action — see I-PROPOSED-1355-TOGGLE-SINGLE-PATCH.
  const toggleCapacity = useCallback(() => {
    updateDraft(
      capacityOn
        ? { rsvpCapacity: null, rsvpWaitlistEnabled: false }
        : { rsvpCapacity: Math.max(draft.rsvpCapacity ?? 1, 1) },
    );
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
    <View
      style={
        intelCapacityHighlight
          ? {
              borderColor: accent.warm,
              borderWidth: 2,
              borderRadius: radiusTokens.md,
              padding: spacing.xs,
            }
          : undefined
      }
    >
      {/* 1. Capacity */}
      <ToggleRow
        label="Limit the guest list"
        sub={
          capacityOn
            ? "Set a maximum number of guests."
            : "No limit — anyone with the link can RSVP."
        }
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
        onToggle={() =>
          updateDraft({ rsvpWaitlistEnabled: !draft.rsvpWaitlistEnabled })
        }
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
                accessibilityLabel={
                  mode === "auto" ? "Auto-approve" : "Approve each RSVP"
                }
                style={[styles.segment, active && styles.segmentActive]}
                testID={`rsvp-approval-${mode}`}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    active && styles.segmentLabelActive,
                  ]}
                >
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

      {/* 4.5 ORCH-1291 [rsvp-chip-in] — Contributions (money settings cluster). */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Contributions</Text>
        <ToggleRow
          label="Let guests chip in"
          sub="Guests can add a voluntary gift after they RSVP. Their RSVP stays free."
          on={contributionOn}
          onToggle={() =>
            updateDraft({ rsvpContributionEnabled: !contributionOn })
          }
          testID="rsvp-contribution-toggle"
        />
        {contributionOn ? (
          <>
            <MoneyField
              label="Suggested amount (optional)"
              currency={chipCurrency}
              cents={draft.rsvpContributionSuggestedCents}
              onChange={(c) =>
                updateDraft({ rsvpContributionSuggestedCents: c })
              }
              testID="rsvp-contribution-suggested"
            />
            <MoneyField
              label="Minimum contribution (optional)"
              helper={
                minGtSuggested
                  ? "Minimum can't be more than the suggested amount."
                  : "Guests can't chip in less than this."
              }
              currency={chipCurrency}
              cents={draft.rsvpContributionMinCents}
              onChange={(c) => updateDraft({ rsvpContributionMinCents: c })}
              testID="rsvp-contribution-min"
            />
            {/* ORCH-1335 — payout-aware callout. The HARD bank-gate still lives
                at publish (business_publish_rsvp_draft → pg_brand_can_collect →
                the paidPublishGuards "Finish bank setup" route); this is only the
                authoring hint. `chipInPayoutReady` is provider-aware (Stripe fresh
                "active" OR Paystack subaccount) and undefined-safe: undefined/false
                (or still-loading) falls to the neutral nudge so a false positive
                can never flash. */}
            {chipInPayoutReady ? (
              /* READY — positive confirmation (ORCH-1335). */
              <View
                style={styles.readyCallout}
                testID="rsvp-contribution-ready-callout"
              >
                <View style={styles.readyHeadingRow}>
                  <Icon name="check" size={16} color={semantic.success} />
                  <Text style={styles.readyHeading}>Payouts are on</Text>
                </View>
                <Text style={styles.readySub}>
                  Guests can chip in the moment you publish — no extra setup needed.
                </Text>
              </View>
            ) : (
              /* NOT READY / UNKNOWN — today's neutral nudge, copy UNCHANGED. */
              <View
                style={styles.connectCallout}
                testID="rsvp-contribution-connect-callout"
              >
                <Text style={styles.connectHeading}>
                  Connect your bank to collect contributions
                </Text>
                <Text style={styles.connectSub}>
                  Guests can chip in once your payouts are set up. If your bank
                  isn't connected yet, you'll be prompted to finish setup when
                  you publish.
                </Text>
              </View>
            )}
          </>
        ) : null}
      </View>

      {/* 5. Guest-list privacy */}
      <ToggleRow
        label="Keep the guest list private"
        // ORCH-1339 — D2-honest sub-copy (SPEC §4.8, byte-exact).
        sub="Hide who's going. Only you see the list."
        on={draft.privateGuestList}
        onToggle={() =>
          updateDraft({ privateGuestList: !draft.privateGuestList })
        }
        testID="rsvp-private-guestlist"
      />

      {/* 6. Spots-left visibility. ORCH-1339 — label + sub corrected (SPEC
          §4.8, byte-exact): the old label promised hiding the headcount —
          D2 keeps the going count visible and hides only the spots-left/fill
          scarcity, so the copy now says exactly that. */}
      <ToggleRow
        label="Hide the spots-left count"
        sub={rsvpHideCountSub(draft.privateGuestList)}
        on={draft.hideRemainingCount}
        onToggle={() =>
          updateDraft({ hideRemainingCount: !draft.hideRemainingCount })
        }
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
                onPress={() =>
                  // ORCH-1355 C-3 — ONE combined patch. Only a Public RSVP can
                  // be on the discovery feed, so Unlisted and Private force
                  // rsvpDiscoverable OFF in the SAME write (a prior two-write
                  // version dropped the forced discover-OFF from autosave via
                  // the wizard's stale closure). The server forces it off only
                  // for Private, so Unlisted must be forced here.
                  // One patch per user action — see I-PROPOSED-1355-TOGGLE-SINGLE-PATCH.
                  updateDraft(
                    opt.id === "public"
                      ? { visibility: opt.id }
                      : { visibility: opt.id, rsvpDiscoverable: false },
                  )
                }
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
                style={[
                  styles.visibilityPill,
                  active && styles.visibilityPillActive,
                ]}
                testID={`rsvp-visibility-${opt.id}`}
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
        {draft.visibility === "public" ? (
          <ToggleRow
            label="Also show this on Mingla's discovery feed"
            sub={rsvpDiscoverySub(draft.rsvpDiscoverable)}
            on={draft.rsvpDiscoverable}
            onToggle={() =>
              updateDraft({ rsvpDiscoverable: !draft.rsvpDiscoverable })
            }
            testID="rsvp-discoverable-toggle"
          />
        ) : (
          <Text style={styles.helper} testID="rsvp-discoverable-unavailable">
            {RSVP_DISCOVERY_UNAVAILABLE[draft.visibility]}
          </Text>
        )}
      </View>
      <TurnoutForecastCard surface="rsvp_setup" />
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

  // ORCH-1291 [rsvp-chip-in] — money field + connect callout.
  moneyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: ROW_BG,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
    gap: 6,
  },
  moneyPrefix: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  moneyInput: {
    flex: 1,
    fontSize: typography.bodyLg.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
    paddingVertical: spacing.sm,
  },
  connectCallout: {
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    marginTop: spacing.sm,
    backgroundColor: "rgba(245,158,11,0.18)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.45)",
  },
  connectHeading: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  connectSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.35,
    color: textTokens.secondary,
    marginTop: spacing.xxs,
  },

  // ORCH-1335 — payout-ready positive callout (mirrors connectCallout with the
  // kit's green success tokens).
  readyCallout: {
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    marginTop: spacing.sm,
    backgroundColor: semantic.successTint, // rgba(34, 197, 94, 0.18) — designSystem token
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.45)", // mirrors connectCallout's amber 0.45 border-alpha convention
  },
  readyHeadingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  readyHeading: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  readySub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.35,
    color: textTokens.secondary,
    marginTop: spacing.xxs,
  },

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
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
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
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
  },
  stepperBtnText: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
  },
  stepperValue: {
    minWidth: 28,
    textAlign: "center",
    fontSize: typography.bodyLg.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
});
