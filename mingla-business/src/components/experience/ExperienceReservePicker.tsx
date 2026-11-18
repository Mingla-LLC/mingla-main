/**
 * ExperienceReservePicker — ORCH-1138 Leg 3 (§4.4 / §4.5).
 *
 * The web/business public-page (`/exp/`) adaptive-reservation surface. ONE
 * component, two modes (driven by `mode`):
 *
 *   mode="slots" — a recurring / multi-date experience with >1 bookable
 *     occurrence. Lists the upcoming occurrences (from materialized event_dates),
 *     each with its "N left" / sold-out state; the buyer picks one slot →
 *     Reserve confirms with that occurrence's eventDateId. (The single-occurrence
 *     / one-off case never reaches this picker — the route auto-selects + goes
 *     straight to cart, §4.4.)
 *
 *   mode="open-daily" — a daily/recurring "open daily within hours" experience
 *     (OQ-5: "any time within the window"). The buyer picks a DATE (from the
 *     materialized daily occurrences), then ANY time within that occurrence's
 *     [start_at, end_at] window (free time entry bounded by the window — no
 *     fabricated fixed slots), then a PARTY size (= cart quantity, never new
 *     line items — I-1). Reserve confirms with the chosen occurrence's
 *     eventDateId + party-size.
 *
 * Web/native-safe: built on the `Sheet` primitive (has a `.web.tsx`), a plain
 * RN Modal-free surface. Palette-themed (ANDROID opaque fills via the page
 * palette, no translucent glass). Selection-only — owns NO money; the route
 * routes the confirmed (eventDateId, quantity) into the existing checkout chain
 * (byte-identical except the already-supported eventDateId + quantity).
 *
 * Anon-tolerant: no useAuth, no fetch — the route passes resolved occurrences.
 */

import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  experienceBlockLengthLabel,
  experiencePriceBasisLabel,
  experienceZoneCityLabel,
  experienceZoneDiffersFromViewer,
  formatExperienceMinute,
  type ExperienceOfferingTicket,
  type ThemePalette,
} from "@mingla/offering-rendering";
// issue #4420 — the reservation rules live in ONE shared hook, used by this
// sheet and by the page's inline "Book a time" picker.
import {
  useExperienceReserveState,
  type ExperienceSlotFetcher,
} from "@mingla/offering-rendering/useExperienceReserveState";
import {
  EXPERIENCE_MAX_PARTY,
  parseSlotAvailability,
  type ExperienceReserveMode as SharedReserveMode,
  type ExperienceReserveSelection as SharedReserveSelection,
} from "@mingla/offering-rendering/experienceReserveModel";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/Icon";
import type { PublicExperienceDate } from "../../services/publicExperienceService";
import { supabase } from "../../services/supabase";
import { ExperienceDayStep } from "./ExperienceDayStep";
import { experienceRemainingChipText } from "@mingla/offering-rendering/experienceR3";
import { accentFill, accentOutline } from "@mingla/offering-rendering/themeAccentStyle";
import { opaqueAccentWashColor } from "@mingla/offering-rendering/themePalette";

/**
 * issue #4420 — the live per-start spots fetcher, shared by this sheet and
 * the inline picker (`pg_experience_slot_availability`). Errors and malformed
 * payloads resolve null: unknown spots stay unknown, never fabricated.
 */
export const fetchExperienceSlotAvailability: ExperienceSlotFetcher = async ({
  eventId,
  eventDateId,
  ticketTypeId,
}) => {
  const { data, error } = await supabase.rpc("pg_experience_slot_availability", {
    p_event_id: eventId,
    p_event_date_id: eventDateId,
    p_ticket_type_id: ticketTypeId,
  });
  if (error) return null;
  return parseSlotAvailability(data);
};

export type ExperienceReserveMode = SharedReserveMode;

/** The checkout hand-off (unchanged contract; owned by the shared model). */
export type ExperienceReserveSelection = SharedReserveSelection;

export interface ExperienceReservePickerProps {
  visible: boolean;
  mode: ExperienceReserveMode;
  /** Upcoming bookable occurrences (sold-out ones still shown, disabled). */
  dates: ReadonlyArray<PublicExperienceDate>;
  timezone: string;
  palette: ThemePalette;
  /** Bold loaded font family (theme) for headings/values. */
  fontFamily?: string;
  /** Event-level remaining caps the party-size stepper (open-daily). */
  eventRemaining: number | null;
  /**
   * issue #3281 Round 1 — server all-in unit price in CENTS. When set with
   * `currency`, the confirm button reads "Reserve · ₦70,000" (party × unit).
   * Prefer `options` when present; this remains the single-ticket fallback.
   */
  unitAllInCents?: number | null;
  currency?: string | null;
  /**
   * issue #3281 R2 — sellable options. When length > 1, an option row sits at
   * the top of the day step. Absent / length ≤ 1 → legacy single-ticket UI.
   */
  options?: ReadonlyArray<ExperienceOfferingTicket>;
  /** issue #3281 R3 — start grid minutes (15/30/60/120). Default 30. */
  spacingMinutes?: number | null;
  /** issue #3281 R3 — earliest start = now + notice. Default 120. */
  minNoticeMinutes?: number | null;
  /** issue #3281 R3 — experience id for slot-availability fetch. */
  eventId?: string | null;
  /** issue #3281 R3 — capacity scope (drives slot remaining fetch). */
  capacityScope?: "total" | "per_day" | "per_start" | null;
  onCancel: () => void;
  onConfirm: (selection: ExperienceReserveSelection) => void;
  /**
   * #4453 milestone 5 — a Mingla website's pre-fill: the occurrence the guest
   * chose on the site (matched by the route) and their party size. Applied on
   * open; the guest can change both. Never selects a date not in `dates`.
   */
  initialDateId?: string | null;
  initialParty?: number | null;
}

const SHEET_SNAP = "full" as const;
const MAX_PARTY = EXPERIENCE_MAX_PARTY;

function formatDateLabel(startAt: string, timezone: string): string {
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "Date TBA";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || "UTC",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  }
}

function formatDayLabel(startAt: string, timezone: string): string {
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return "Date TBA";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: timezone || "UTC",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(d);
  }
}

function formatWindow(startAt: string, endAt: string, timezone: string): string {
  const fmt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone || "UTC",
      }).format(d);
    } catch {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    }
  };
  const s = fmt(startAt);
  const e = fmt(endAt);
  return s.length > 0 && e.length > 0 ? `${s} – ${e}` : s;
}

function remainingChip(remaining: number | null): string | null {
  // issue #3281 R3 — "N left" / "Full" (experienceRemainingChipText parity).
  if (remaining === null) return null;
  if (remaining <= 0) return "Full";
  return `${remaining} left`;
}

export const ExperienceReservePicker: React.FC<ExperienceReservePickerProps> = ({
  visible,
  mode,
  dates,
  timezone,
  palette,
  fontFamily,
  eventRemaining,
  unitAllInCents = null,
  currency = null,
  options,
  spacingMinutes: propsSpacingMinutes = null,
  minNoticeMinutes: propsMinNoticeMinutes = null,
  eventId = null,
  capacityScope = null,
  onCancel,
  onConfirm,
  initialDateId = null,
  initialParty = null,
}) => {
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  // ORCH-1186 Fix 4 — open-daily is a 3-step TAP-TO-ADVANCE wizard. Init
  // "day"; reset to "day" each open. (Slots mode ignores `step` — single list.)
  const [step, setStep] = useState<"day" | "time" | "party">("day");
  const reserve = useExperienceReserveState({
    mode,
    dates,
    timezone,
    eventRemaining,
    unitAllInCents,
    currency,
    options,
    spacingMinutes: propsSpacingMinutes,
    minNoticeMinutes: propsMinNoticeMinutes,
    eventId,
    capacityScope,
    fetchSlotAvailability: fetchExperienceSlotAvailability,
    // Keep the selected start's remaining through the party step; only the
    // time and party steps hold live spots.
    slotFetchEnabled: visible && (step === "time" || step === "party"),
  });
  const {
    optionList,
    selectedOption,
    selectedDateId,
    selectedDate,
    selectedMinute,
    selectedBlocks,
    party,
    timeChoices,
    slotRemainingByMinute,
    isBlockOption,
    isGroupOption,
    blockMinutes,
    blockChoices,
    partyMax,
    canConfirm,
  } = reserve;
  const showOptionChoice = optionList.length > 1;
  const resetReserve = reserve.reset;
  const selectReserveDate = reserve.selectDate;
  // setParty re-derives with partyMax; a ref keeps the open effect from
  // re-running (and wiping the guest's pick) whenever that cap moves.
  const setReservePartyRef = useRef(reserve.setParty);
  setReservePartyRef.current = reserve.setParty;

  // ORCH-1153 BUG-4 (Seth device, /exp date picker "dead"): reset the selection
  // whenever the sheet opens so a re-open starts clean (a stale selectedDateId
  // from a prior open could point at a date no longer in `dates` → selectedDate
  // resolves null → Reserve stays disabled even after a fresh tap). Mirrors the
  // consumer picker's expected fresh-open behavior.
  useEffect(() => {
    if (visible) {
      resetReserve();
      // #4453 milestone 5 — a website's pre-fill picks its date (only one in `dates`) and party.
      const seeded = initialDateId && dates.some((date) => date.id === initialDateId) ? initialDateId : null;
      if (seeded) selectReserveDate(seeded);
      if (typeof initialParty === "number") setReservePartyRef.current(initialParty);
      setStep(seeded && mode === "open-daily" ? "time" : "day");
    }
  }, [visible, resetReserve, selectReserveDate, initialDateId, initialParty, dates, mode]);

  const handleConfirm = (): void => {
    // issue #4420 — the shared model builds the byte-identical hand-off
    // (slots → quantity 1; person → party; group / block → 1 + partySize).
    if (reserve.selection === null) return;
    onConfirm(reserve.selection);
  };

  const formatMinute = formatExperienceMinute;

  const zoneCity = experienceZoneCityLabel(timezone);
  const showZoneHint = experienceZoneDiffersFromViewer(timezone);

  const confirmLabel =
    reserve.total === null ? "Reserve →" : `Reserve · ${reserve.total}`;

  const selectOption = (ticketTypeId: string): void => {
    reserve.selectOption(ticketTypeId);
  };

  // ORCH-1186 Fix 4 — wizard step machine (open-daily only). Slots mode shows
  // the single date list as before (no wizard — a single tap reserves).
  const isWizard = mode === "open-daily";
  const showDayStep = !isWizard || step === "day";
  const showTimeStep = isWizard && step === "time";
  const showPartyStep = isWizard && step === "party";

  // breadcrumb chosen-day / chosen-time labels (changeable via Back).
  const chosenDayLabel =
    selectedDate !== null ? formatDayLabel(selectedDate.startAt, timezone) : null;
  const chosenTimeLabel =
    selectedMinute !== null ? formatMinute(selectedMinute) : null;

  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      snapPoint={SHEET_SNAP}
      panelBackground={palette.page}
    >
      <View style={[styles.host, { backgroundColor: palette.page }]}>
        <View style={styles.headerRow}>
          {/* Back affordance — only past step 1 of the wizard. */}
          {isWizard && step !== "day" ? (
            <Pressable
              onPress={() => setStep(step === "party" ? "time" : "day")}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              style={[styles.backIcon, { backgroundColor: palette.card }]}
            >
              <Icon name="chevL" size={20} color={palette.secondaryText} />
            </Pressable>
          ) : null}
          <Text style={[styles.title, { color: palette.primaryText }, fontStyle]}>
            {mode === "open-daily" ? "Reserve a spot" : "Pick a date"}
          </Text>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={[styles.closeIcon, { backgroundColor: palette.card }]}
          >
            <Icon name="close" size={20} color={palette.secondaryText} />
          </Pressable>
        </View>

        {/* ORCH-1186 Fix 4 — slim summary breadcrumb (chosen day · time). Tapping
            a crumb jumps back to that step so prior choices stay changeable. */}
        {isWizard && (chosenDayLabel !== null || step !== "day") ? (
          <View style={styles.breadcrumb} testID="orch-1186-experience-breadcrumb">
            <Pressable
              onPress={() => setStep("day")}
              accessibilityRole="button"
              accessibilityLabel="Change day"
            >
              <Text style={[styles.crumb, { color: palette.accent }, fontStyle]}>
                {chosenDayLabel ?? "Choose a day"}
              </Text>
            </Pressable>
            {chosenTimeLabel !== null ? (
              <>
                <Text style={[styles.crumbSep, { color: palette.tertiaryText }]}>·</Text>
                <Pressable
                  onPress={() => setStep("time")}
                  accessibilityRole="button"
                  accessibilityLabel="Change time"
                >
                  <Text style={[styles.crumb, { color: palette.accent }, fontStyle]}>
                    {chosenTimeLabel}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* ---- STEP 1: OPTION (when multi) + DATE LIST ---- */}
          {showDayStep ? (
            <>
              {showOptionChoice ? (
                <>
                  <Text
                    style={[styles.sectionLabel, { color: palette.tertiaryText }]}
                  >
                    CHOOSE A PRICE
                  </Text>
                  <View
                    accessibilityRole="radiogroup"
                    style={styles.optionCol}
                    testID="issue-3281-experience-option-choice"
                  >
                    {optionList.map((opt) => {
                      const selected = selectedOption?.ticketTypeId === opt.ticketTypeId;
                      const unit = experiencePriceBasisLabel(
                        opt.priceBasis,
                        opt.blockMinutes,
                      );
                      return (
                        <Pressable
                          key={opt.ticketTypeId}
                          onPress={() => selectOption(opt.ticketTypeId)}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={`${opt.name}, ${unit}`}
                          style={[
                            styles.optionRow,
                            {
                              backgroundColor: palette.card,
                              borderColor: palette.panelBorder,
                            },
                            selected
                              ? {
                                  ...accentOutline(palette, { background: palette.accentWash, opaqueBackground: opaqueAccentWashColor(palette) }),
                                }
                              : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.optionName,
                              { color: palette.primaryText },
                              fontStyle,
                            ]}
                            numberOfLines={1}
                          >
                            {opt.name}
                          </Text>
                          <Text
                            style={[
                              styles.optionUnit,
                              { color: palette.secondaryText },
                            ]}
                          >
                            {unit}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
              <ExperienceDayStep
                mode={mode}
                dates={dates}
                timezone={timezone}
                palette={palette}
                fontStyle={fontStyle}
                selectedDateId={selectedDateId}
                formatDayLabel={formatDayLabel}
                formatDateLabel={formatDateLabel}
                remainingChip={remainingChip}
                onSelectDate={(dateId) => {
                  reserve.selectDate(dateId);
                  if (isWizard) setStep("time");
                }}
              />
            </>
          ) : null}

          {/* ---- STEP 2: TIME (+ HOW LONG for block) (wizard only) ---- */}
          {showTimeStep && selectedDate !== null ? (
            <>
              <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
                CHOOSE A TIME · {formatWindow(selectedDate.startAt, selectedDate.endAt, timezone)}
                {showZoneHint && zoneCity.length > 0 ? ` · ${zoneCity} time` : ""}
              </Text>
              <View style={styles.timeWrap}>
                {timeChoices.map((min) => {
                  const selected = selectedMinute === min;
                  const slotRem = slotRemainingByMinute.get(min);
                  const full =
                    typeof slotRem === "number" && Number.isFinite(slotRem)
                      ? slotRem <= 0
                      : false;
                  const chip = experienceRemainingChipText(
                    typeof slotRem === "number" ? slotRem : null,
                  );
                  return (
                    <Pressable
                      key={min}
                      onPress={
                        full
                          ? undefined
                          : () => {
                              reserve.selectMinute(min);
                              // Block options stay on time step for "How long"; else party.
                              if (!isBlockOption) setStep("party");
                            }
                      }
                      disabled={full}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: full }}
                      accessibilityLabel={`${formatMinute(min)}${
                        chip !== null ? `, ${chip}` : ""
                      }`}
                      style={[
                        styles.timeChip,
                        { backgroundColor: palette.card, borderColor: palette.panelBorder },
                        selected
                          ? accentOutline(palette, { background: palette.accentWash, opaqueBackground: opaqueAccentWashColor(palette) })
                          : null,
                        full ? { opacity: 0.45 } : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.timeChipText,
                          { color: selected ? palette.accent : palette.primaryText },
                          fontStyle,
                        ]}
                      >
                        {formatMinute(min)}
                        {chip !== null ? ` · ${chip}` : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {isBlockOption && selectedMinute !== null ? (
                <>
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: palette.tertiaryText, marginTop: 16 },
                    ]}
                  >
                    HOW LONG
                  </Text>
                  <View style={styles.timeWrap} testID="issue-3281-experience-how-long">
                    {blockChoices.map((n) => {
                      const selected = selectedBlocks === n;
                      const label = experienceBlockLengthLabel(n, blockMinutes);
                      return (
                        <Pressable
                          key={n}
                          onPress={() => {
                            reserve.selectBlocks(n);
                            setStep("party");
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={label}
                          style={[
                            styles.timeChip,
                            {
                              backgroundColor: palette.card,
                              borderColor: palette.panelBorder,
                            },
                            selected
                              ? {
                                  ...accentOutline(palette, { background: palette.accentWash, opaqueBackground: opaqueAccentWashColor(palette) }),
                                }
                              : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.timeChipText,
                              {
                                color: selected
                                  ? palette.accent
                                  : palette.primaryText,
                              },
                              fontStyle,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          {/* ---- STEP 3: PARTY + RESERVE (wizard only) ---- */}
          {showPartyStep && selectedDate !== null ? (
            <>
              <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
                HOW MANY?
              </Text>
              <View
                style={[
                  styles.party,
                  { backgroundColor: palette.card, borderColor: palette.panelBorder },
                ]}
              >
                <View style={styles.partyTextCol}>
                  <Text style={[styles.partyLabel, { color: palette.primaryText }, fontStyle]}>
                    Party size
                  </Text>
                  <Text style={[styles.partySub, { color: palette.tertiaryText }]}>
                    {isGroupOption
                      ? `Up to ${partyMax} people`
                      : partyMax < MAX_PARTY
                        ? `Up to ${partyMax}`
                        : "How many in your group?"}
                  </Text>
                </View>
                <View style={styles.partyCtrl}>
                  <Pressable
                    onPress={() => reserve.setParty((p) => Math.max(1, p - 1))}
                    disabled={party <= 1}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease party size"
                    style={[
                      styles.partyBtn,
                      { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
                      party <= 1 ? styles.partyBtnDisabled : null,
                    ]}
                  >
                    <Text style={[styles.partyBtnText, { color: palette.primaryText }]}>−</Text>
                  </Pressable>
                  <Text style={[styles.partyCount, { color: palette.primaryText }, fontStyle]}>
                    {party}
                  </Text>
                  <Pressable
                    onPress={() => reserve.setParty((p) => Math.min(partyMax, p + 1))}
                    disabled={party >= partyMax}
                    accessibilityRole="button"
                    accessibilityLabel="Increase party size"
                    style={[
                      styles.partyBtn,
                      { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
                      party >= partyMax ? styles.partyBtnDisabled : null,
                    ]}
                  >
                    <Text style={[styles.partyBtnText, { color: palette.primaryText }]}>+</Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : null}

          {/* ---- Confirm Reserve ----
              Shown in slots mode (single list) and in the wizard's final "party"
              step. The {eventDateId, quantity} handoff is UNCHANGED (ORCH-1186
              Fix 4 preserves the exact checkout contract — only the path to it is
              now stepwise). ORCH-1153 BUG-4: the button lives INSIDE the
              ScrollView (last scroll child) so it's always reachable. */}
          {!isWizard || showPartyStep ? (
            <Pressable
              onPress={canConfirm ? handleConfirm : undefined}
              disabled={!canConfirm}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canConfirm }}
              accessibilityLabel={confirmLabel}
              style={[
                styles.confirm,
                canConfirm
                  ? accentFill(palette)
                  : { backgroundColor: palette.panelStrong, borderColor: palette.panelBorder, borderWidth: 1 },
              ]}
              testID="orch-1138-experience-reserve-confirm"
            >
              <Text
                style={[
                  styles.confirmText,
                  { color: canConfirm ? palette.accentText : palette.tertiaryText },
                  fontStyle,
                ]}
              >
                {confirmLabel}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  title: { flex: 1, fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  closeIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  backIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  crumb: { fontSize: 13, fontWeight: "800" },
  crumbSep: { fontSize: 13, fontWeight: "800" },
  scrollContent: { paddingBottom: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  optionCol: { gap: 10, marginBottom: 16 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  optionName: { flex: 1, fontSize: 15, fontWeight: "700" },
  optionUnit: { fontSize: 12, fontWeight: "700" },
  timeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
  },
  timeChipText: { fontSize: 13, fontWeight: "800" },
  party: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 20,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  partyTextCol: { flex: 1, minWidth: 0 },
  partyLabel: { fontSize: 14, fontWeight: "800" },
  partySub: { fontSize: 11, marginTop: 1 },
  partyCtrl: { flexDirection: "row", alignItems: "center", gap: 14 },
  partyBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  partyBtnDisabled: { opacity: 0.35 },
  partyBtnText: { fontSize: 22, fontWeight: "800", lineHeight: 24 },
  partyCount: {
    fontSize: 20,
    fontWeight: "900",
    minWidth: 22,
    textAlign: "center",
  },
  confirm: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 12,
    marginBottom: 12,
  },
  confirmText: { fontSize: 16, fontWeight: "900" },
});

export default ExperienceReservePicker;
