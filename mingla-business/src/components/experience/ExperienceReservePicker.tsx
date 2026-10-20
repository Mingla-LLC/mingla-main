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

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  experienceBlockChoicesThatFit,
  experienceBlockLengthLabel,
  experienceBookedEndIso,
  experienceBookedStartIso,
  experiencePriceBasisLabel,
  experienceTimeChoices,
  experienceZoneCityLabel,
  experienceZoneDiffersFromViewer,
  formatExperienceMinute,
  type ExperienceOfferingTicket,
  type ThemePalette,
} from "@mingla/offering-rendering";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
import {
  priceDecimals,
  priceFallbackDecimals,
} from "@mingla/offering-rendering/priceDecimals";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/Icon";
import type { PublicExperienceDate } from "../../services/publicExperienceService";
import { ExperienceDayStep } from "./ExperienceDayStep";

export type ExperienceReserveMode = "slots" | "open-daily";

export interface ExperienceReserveSelection {
  /** The chosen occurrence's event_dates.id. */
  eventDateId: string;
  /** Party size (open-daily) → cart quantity. Always ≥1; 1 in slots mode. */
  quantity: number;
  /** issue #3281 — open-daily booked start instant (ISO), when a time was chosen. */
  startAt?: string;
  /** issue #3281 R2 — chosen price option (ticket_types.id). */
  ticketTypeId?: string;
  /** issue #3281 R2 — block hire end instant (ISO). */
  bookedEndAt?: string;
  /** issue #3281 R2 — party size for group options (may differ from quantity). */
  partySize?: number;
}

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
  onCancel: () => void;
  onConfirm: (selection: ExperienceReserveSelection) => void;
}

const SHEET_SNAP = "full" as const;
const MAX_PARTY = 12;

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
  if (remaining === null) return null;
  if (remaining <= 0) return "Sold out";
  if (remaining <= 10) return `${remaining} left`;
  return "Available";
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
  onCancel,
  onConfirm,
}) => {
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  const optionList = useMemo(
    () => (Array.isArray(options) ? options : []),
    [options],
  );
  const showOptionChoice = optionList.length > 1;
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [selectedDateId, setSelectedDateId] = useState<string | null>(null);
  // Open-daily: chosen time-within-window (minutes from midnight) + party size.
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<number | null>(null);
  const [party, setParty] = useState<number>(2);
  // ORCH-1186 Fix 4 — open-daily is now a 3-step TAP-TO-ADVANCE wizard. Init
  // "day"; reset to "day" each open. (Slots mode ignores `step` — single list.)
  const [step, setStep] = useState<"day" | "time" | "party">("day");

  // ORCH-1153 BUG-4 (Seth device, /exp date picker "dead"): reset the selection
  // whenever the sheet opens so a re-open starts clean (a stale selectedDateId
  // from a prior open could point at a date no longer in `dates` → selectedDate
  // resolves null → Reserve stays disabled even after a fresh tap). Mirrors the
  // consumer picker's expected fresh-open behavior.
  useEffect(() => {
    if (visible) {
      setSelectedOptionId(optionList[0]?.ticketTypeId ?? null);
      setSelectedDateId(null);
      setSelectedMinute(null);
      setSelectedBlocks(null);
      setParty(2);
      setStep("day");
    }
  }, [visible, optionList]);

  const selectedOption = useMemo(() => {
    if (optionList.length === 0) return null;
    return (
      optionList.find((o) => o.ticketTypeId === selectedOptionId) ??
      optionList[0] ??
      null
    );
  }, [optionList, selectedOptionId]);

  const selectedDate = useMemo(
    () => dates.find((d) => d.id === selectedDateId) ?? null,
    [dates, selectedDateId],
  );

  // Open-daily: free 30-min-step time choices BOUNDED by the occurrence window
  // in the EXPERIENCE zone (issue #3281 — never Date#getHours()).
  const timeChoices = useMemo<number[]>(() => {
    if (mode !== "open-daily" || selectedDate === null) return [];
    return experienceTimeChoices(
      selectedDate.startAt,
      selectedDate.endAt,
      timezone,
      30,
    );
  }, [mode, selectedDate, timezone]);

  const isBlockOption = selectedOption?.priceBasis === "block";
  const isGroupOption = selectedOption?.priceBasis === "group";
  const blockMinutes =
    typeof selectedOption?.blockMinutes === "number" &&
    selectedOption.blockMinutes > 0
      ? selectedOption.blockMinutes
      : 60;
  const minBlocks =
    typeof selectedOption?.minBlocks === "number" && selectedOption.minBlocks > 0
      ? selectedOption.minBlocks
      : 1;
  const maxBlocks =
    typeof selectedOption?.maxBlocks === "number" &&
    selectedOption.maxBlocks >= minBlocks
      ? selectedOption.maxBlocks
      : minBlocks;

  const blockChoices = useMemo<number[]>(() => {
    if (
      !isBlockOption ||
      mode !== "open-daily" ||
      selectedDate === null ||
      selectedMinute === null
    ) {
      return [];
    }
    return experienceBlockChoicesThatFit(
      selectedDate.startAt,
      selectedDate.endAt,
      timezone,
      selectedMinute,
      blockMinutes,
      minBlocks,
      maxBlocks,
      30,
    );
  }, [
    isBlockOption,
    mode,
    selectedDate,
    selectedMinute,
    timezone,
    blockMinutes,
    minBlocks,
    maxBlocks,
  ]);

  useEffect(() => {
    if (selectedMinute === null) {
      setSelectedBlocks(null);
      return;
    }
    if (!isBlockOption) {
      setSelectedBlocks(null);
      return;
    }
    if (blockChoices.length === 0) {
      setSelectedBlocks(null);
      return;
    }
    setSelectedBlocks((prev) =>
      prev !== null && blockChoices.includes(prev) ? prev : blockChoices[0],
    );
  }, [selectedMinute, isBlockOption, blockChoices]);

  const optionRemaining =
    selectedOption?.ticketsRemaining !== undefined
      ? selectedOption.ticketsRemaining
      : eventRemaining;
  const groupCap =
    isGroupOption &&
    typeof selectedOption?.groupMax === "number" &&
    selectedOption.groupMax >= 2
      ? selectedOption.groupMax
      : MAX_PARTY;
  const partyMax = Math.min(
    groupCap,
    optionRemaining === null ? groupCap : Math.max(1, optionRemaining),
  );

  useEffect(() => {
    setParty((p) => Math.min(Math.max(1, p), partyMax));
  }, [partyMax]);

  const activeUnitCents = useMemo((): number | null => {
    if (
      selectedOption !== null &&
      typeof selectedOption.priceAllInCents === "number" &&
      selectedOption.priceAllInCents > 0
    ) {
      return selectedOption.priceAllInCents;
    }
    if (
      selectedOption !== null &&
      typeof selectedOption.priceCents === "number" &&
      selectedOption.priceCents > 0
    ) {
      return selectedOption.priceCents;
    }
    return typeof unitAllInCents === "number" && unitAllInCents > 0
      ? unitAllInCents
      : null;
  }, [selectedOption, unitAllInCents]);

  const canConfirm =
    mode === "slots"
      ? selectedDate !== null &&
        (selectedDate.ticketsRemaining === null ||
          selectedDate.ticketsRemaining > 0)
      : selectedDate !== null &&
        selectedMinute !== null &&
        (!isBlockOption || selectedBlocks !== null);

  const handleConfirm = (): void => {
    if (selectedDate === null) return;
    const ticketTypeId = selectedOption?.ticketTypeId;
    if (mode === "slots") {
      onConfirm({
        eventDateId: selectedDate.id,
        quantity: 1,
        ...(ticketTypeId !== undefined ? { ticketTypeId } : {}),
      });
      return;
    }
    if (selectedMinute === null) return;
    const bookedIso = experienceBookedStartIso(
      selectedDate.startAt,
      selectedDate.endAt,
      timezone,
      selectedMinute,
      30,
    );
    // issue #3281 — never confirm open-daily without a resolvable start
    // (past / spring-forward gaps convert to null).
    if (bookedIso === null) return;
    let bookedEndAt: string | undefined;
    if (isBlockOption && selectedBlocks !== null) {
      const endIso = experienceBookedEndIso(
        bookedIso,
        blockMinutes,
        selectedBlocks,
      );
      if (endIso === null) return;
      bookedEndAt = endIso;
    }
    // person: quantity = party; group/block: one unit + partySize guests.
    const quantity = isGroupOption || isBlockOption ? 1 : party;
    onConfirm({
      eventDateId: selectedDate.id,
      quantity,
      startAt: bookedIso,
      partySize: party,
      ...(ticketTypeId !== undefined ? { ticketTypeId } : {}),
      ...(bookedEndAt !== undefined ? { bookedEndAt } : {}),
    });
  };

  const formatMinute = formatExperienceMinute;

  const zoneCity = experienceZoneCityLabel(timezone);
  const showZoneHint = experienceZoneDiffersFromViewer(timezone);

  const confirmLabel = useMemo((): string => {
    const blocks =
      isBlockOption && selectedBlocks !== null ? selectedBlocks : 1;
    const groupsOrPeople = isGroupOption || isBlockOption ? 1 : party;
    const unit = activeUnitCents;
    const code = (
      selectedOption?.currency ??
      currency ??
      ""
    )
      .trim()
      .toUpperCase();
    if (unit === null || code.length !== 3) return "Reserve →";
    const major = (unit * groupsOrPeople * blocks) / 100;
    try {
      const money = withCurrencyGlyph(
        new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: code,
          ...priceDecimals(major),
        }).format(major),
        code,
      );
      return `Reserve · ${money}`;
    } catch {
      return `Reserve · ${major.toFixed(priceFallbackDecimals(major))} ${code}`;
    }
  }, [
    isBlockOption,
    isGroupOption,
    selectedBlocks,
    party,
    activeUnitCents,
    selectedOption,
    currency,
  ]);

  const selectOption = (ticketTypeId: string): void => {
    setSelectedOptionId(ticketTypeId);
    setSelectedMinute(null);
    setSelectedBlocks(null);
    setParty(2);
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
                                  borderColor: palette.accent,
                                  backgroundColor: palette.accentWash,
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
                  setSelectedDateId(dateId);
                  setSelectedMinute(null);
                  setSelectedBlocks(null);
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
                  return (
                    <Pressable
                      key={min}
                      onPress={() => {
                        setSelectedMinute(min);
                        // Block options stay on time step for "How long"; else party.
                        if (!isBlockOption) setStep("party");
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={formatMinute(min)}
                      style={[
                        styles.timeChip,
                        { backgroundColor: palette.card, borderColor: palette.panelBorder },
                        selected
                          ? { borderColor: palette.accent, backgroundColor: palette.accentWash }
                          : null,
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
                            setSelectedBlocks(n);
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
                                  borderColor: palette.accent,
                                  backgroundColor: palette.accentWash,
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
                    onPress={() => setParty((p) => Math.max(1, p - 1))}
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
                    onPress={() => setParty((p) => Math.min(partyMax, p + 1))}
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
                  ? { backgroundColor: palette.accent }
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
