/**
 * ExperienceReservePicker (app-mobile) — ORCH-1138 Leg 3 rework (§4.C.6).
 *
 * The CONSUMER adaptive-reservation surface. ONE component, two modes:
 *
 *   mode="slots" — a recurring / multi-date experience with >1 bookable
 *     occurrence. Lists the upcoming occurrences (materialized event_dates),
 *     each with its "N left" / sold-out state; the buyer picks one →
 *     onConfirm({eventDateId, quantity:1}). (A one-off never reaches the picker
 *     — the screen auto-selects + goes straight to cart.)
 *
 *   mode="open-daily" — a daily/recurring "open daily within hours" experience.
 *     The buyer picks a DATE (from the materialized daily occurrences), then ANY
 *     time within that occurrence's [startAt, endAt] window (30-min step,
 *     presentation-only — every offered time is inside the authored window),
 *     then a PARTY size (= cart quantity, never a new line item — I-1). Reserve
 *     confirms with the chosen occurrence's eventDateId + party-size.
 *
 * PORTED from mingla-business/src/components/experience/ExperienceReservePicker.tsx
 * (NOT imported — 🔒 I-MOR-0827-PACKAGE-ISOLATION). Built on the consumer
 * BaseBottomSheet (the SOLE gorhom consumer; scroll structure preserved —
 * feedback_rn_sub_sheet_must_render_inside_parent). Palette-themed; Android
 * opaque-glass fallback via the page palette (no translucent glass).
 *
 * Selection-only — owns NO money. The party-size maps to the cart quantity; the
 * checkout request stays byte-identical (eventDateId + quantity only — I-1).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { BOTTOM_NAV_CONTENT_HEIGHT } from "../../hooks/useAppLayout";
import type { ExperienceOccurrence } from "./ExperienceOccurrencePicker";
import { ExperienceDayStep } from "./ExperienceDayStep";

export type ExperienceReserveMode = "slots" | "open-daily";

export interface ExperienceReserveSelection {
  /** The chosen occurrence's event_dates.id. */
  eventDateId: string;
  /** Party size (open-daily) → cart quantity. Always >=1; 1 in slots mode. */
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
  occurrences: ReadonlyArray<ExperienceOccurrence>;
  timezone: string;
  palette: ThemePalette;
  /** Bold loaded font family (theme) for headings/values. */
  fontFamily?: string;
  /** Event-level remaining caps the party-size stepper (open-daily). */
  eventRemaining: number | null;
  /** issue #3281 Round 1 — server all-in unit cents for "Reserve · {total}". */
  unitAllInCents?: number | null;
  currency?: string | null;
  /** issue #3281 R2 — sellable options; length > 1 → option row on day step. */
  options?: ReadonlyArray<ExperienceOfferingTicket>;
  onCancel: () => void;
  onConfirm: (selection: ExperienceReserveSelection) => void;
}

const SHEET_SNAP_POINTS = ["88%"];
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

function formatWindow(
  startAt: string,
  endAt: string,
  timezone: string,
): string {
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

export const ExperienceReservePicker: React.FC<
  ExperienceReservePickerProps
> = ({
  visible,
  mode,
  occurrences,
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
  const insets = useSafeAreaInsets();
  const fontStyle = fontFamily !== undefined ? { fontFamily } : null;
  const optionList = useMemo(
    () => (Array.isArray(options) ? options : []),
    [options],
  );
  const showOptionChoice = optionList.length > 1;
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [selectedDateId, setSelectedDateId] = useState<string | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<number | null>(null);
  const [party, setParty] = useState<number>(2);
  // ORCH-1186 Fix 4 — open-daily is now a 3-step TAP-TO-ADVANCE wizard. Init
  // "day"; reset to "day" each open. (Slots mode ignores `step` — single list.)
  const [step, setStep] = useState<"day" | "time" | "party">("day");

  // Reset the wizard + selection on each fresh open (parity with business).
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
    () => occurrences.find((o) => o.eventDateId === selectedDateId) ?? null,
    [occurrences, selectedDateId],
  );

  // Open-daily: 30-min-step time choices in the EXPERIENCE zone (#3281).
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
    if (selectedMinute === null || !isBlockOption) {
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
        (selectedDate.remaining === null || selectedDate.remaining > 0)
      : selectedDate !== null &&
        selectedMinute !== null &&
        (!isBlockOption || selectedBlocks !== null);

  const formatMinute = formatExperienceMinute;
  const zoneCity = experienceZoneCityLabel(timezone);
  const showZoneHint = experienceZoneDiffersFromViewer(timezone);

  const confirmLabel = useMemo((): string => {
    const blocks =
      isBlockOption && selectedBlocks !== null ? selectedBlocks : 1;
    const groupsOrPeople = isGroupOption || isBlockOption ? 1 : party;
    const unit = activeUnitCents;
    const code = (selectedOption?.currency ?? currency ?? "")
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

  const handleConfirm = (): void => {
    if (selectedDate === null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ticketTypeId = selectedOption?.ticketTypeId;
    if (mode === "slots") {
      onConfirm({
        eventDateId: selectedDate.eventDateId,
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
    const quantity = isGroupOption || isBlockOption ? 1 : party;
    onConfirm({
      eventDateId: selectedDate.eventDateId,
      quantity,
      startAt: bookedIso,
      partySize: party,
      ...(ticketTypeId !== undefined ? { ticketTypeId } : {}),
      ...(bookedEndAt !== undefined ? { bookedEndAt } : {}),
    });
  };

  // Android opaque-glass fallback (ANDROID-GLASS-OPAQUE): the sheet + cards use
  // the page palette's solid fills; no translucent blur on Android.
  const sheetBg = { backgroundColor: palette.page };

  // ORCH-1186 Fix 4 — wizard step machine (open-daily only). Slots mode keeps
  // the single date list (a single tap reserves, no wizard).
  const isWizard = mode === "open-daily";
  const showDayStep = !isWizard || step === "day";
  const showTimeStep = isWizard && step === "time";
  const showPartyStep = isWizard && step === "party";
  const chosenDayLabel =
    selectedDate !== null ? formatDayLabel(selectedDate.startAt, timezone) : null;
  const chosenTimeLabel =
    selectedMinute !== null ? formatMinute(selectedMinute) : null;

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onCancel}
      theme="dark"
      snapPoints={SHEET_SNAP_POINTS}
      backgroundStyle={{ ...styles.sheetBackground, ...sheetBg }}
      handleStyle={{
        ...styles.handleIndicator,
        backgroundColor: palette.panelBorder,
      }}
      accessibilityLabel={mode === "open-daily" ? "Reserve a time" : "Pick a date"}
      scrollMode="scroll"
      hidesBottomNav
      // ORCH-1194 — inline sibling (the #600 wrapInRNModal is reverted). The experience
      // detail is now inline (route-mounted), so this picker stays inline too.
      scrollProps={{
        contentContainerStyle: [
          styles.scrollContent,
          // ORCH-1186 Fix 3 — full-height brand fill: the content fills the sheet
          // edge-to-edge (flexGrow + palette.page) so no dark gap shows under a
          // short step. The gorhom `backgroundStyle` (palette.page) stays.
          { flexGrow: 1, backgroundColor: palette.page },
          {
            paddingBottom:
              BOTTOM_NAV_CONTENT_HEIGHT + Math.max(insets.bottom, 16) + 72,
          },
        ],
        showsVerticalScrollIndicator: false,
      }}
    >
      <View style={styles.headerRow}>
        {/* Back affordance — only past step 1 of the wizard. */}
        {isWizard && step !== "day" ? (
          <Pressable
            style={[styles.backIcon, { backgroundColor: palette.card }]}
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => setStep(step === "party" ? "time" : "day")}
          >
            <Icon name="chevron-back" size={20} color={palette.secondaryText} />
          </Pressable>
        ) : null}
        <Text
          style={[styles.headerTitle, { color: palette.primaryText }, fontStyle]}
        >
          {mode === "open-daily" ? "Reserve a time" : "Pick a date"}
        </Text>
        <Pressable
          style={[styles.closeIcon, { backgroundColor: palette.card }]}
          accessibilityLabel="Close"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onCancel}
        >
          <Icon name="close" size={20} color={palette.secondaryText} />
        </Pressable>
      </View>

      {/* ORCH-1186 Fix 4 — slim summary breadcrumb (chosen day · time). Tapping
          a crumb jumps back to that step so prior choices stay changeable. */}
      {isWizard && (chosenDayLabel !== null || step !== "day") ? (
        <View style={styles.breadcrumb} testID="orch-1186-consumer-experience-breadcrumb">
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

      {/* ---- STEP 1: OPTION (when multi) + DATE LIST ---- */}
      {showDayStep ? (
        <>
          {showOptionChoice ? (
            <>
              <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
                CHOOSE A PRICE
              </Text>
              <View
                accessibilityRole="radiogroup"
                style={styles.optionCol}
                testID="issue-3281-consumer-experience-option-choice"
              >
                {optionList.map((opt) => {
                  const selected =
                    selectedOption?.ticketTypeId === opt.ticketTypeId;
                  const unit = experiencePriceBasisLabel(
                    opt.priceBasis,
                    opt.blockMinutes,
                  );
                  return (
                    <Pressable
                      key={opt.ticketTypeId}
                      onPress={() => {
                        void Haptics.impactAsync(
                          Haptics.ImpactFeedbackStyle.Light,
                        );
                        selectOption(opt.ticketTypeId);
                      }}
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
            occurrences={occurrences}
            timezone={timezone}
            palette={palette}
            fontStyle={fontStyle}
            selectedDateId={selectedDateId}
            formatDayLabel={formatDayLabel}
            formatDateLabel={formatDateLabel}
            remainingChip={remainingChip}
            onSelectDate={(eventDateId) => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedDateId(eventDateId);
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
            CHOOSE A TIME ·{" "}
            {formatWindow(selectedDate.startAt, selectedDate.endAt, timezone)}
            {showZoneHint && zoneCity.length > 0 ? ` · ${zoneCity} time` : ""}
          </Text>
          <View style={styles.timeWrap}>
            {timeChoices.map((min) => {
              const selected = selectedMinute === min;
              return (
                <Pressable
                  key={min}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedMinute(min);
                    if (!isBlockOption) setStep("party");
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={formatMinute(min)}
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
                        color: selected ? palette.accent : palette.primaryText,
                      },
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
              <View
                style={styles.timeWrap}
                testID="issue-3281-consumer-experience-how-long"
              >
                {blockChoices.map((n) => {
                  const selected = selectedBlocks === n;
                  const label = experienceBlockLengthLabel(n, blockMinutes);
                  return (
                    <Pressable
                      key={n}
                      onPress={() => {
                        void Haptics.impactAsync(
                          Haptics.ImpactFeedbackStyle.Light,
                        );
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
              {
                backgroundColor: palette.card,
                borderColor: palette.panelBorder,
              },
            ]}
          >
            <View style={styles.partyTextCol}>
              <Text
                style={[
                  styles.partyLabel,
                  { color: palette.primaryText },
                  fontStyle,
                ]}
              >
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
                  {
                    backgroundColor: palette.accentWash,
                    borderColor: palette.panelBorder,
                  },
                  party <= 1 ? styles.partyBtnDisabled : null,
                ]}
              >
                <Text style={[styles.partyBtnText, { color: palette.primaryText }]}>
                  −
                </Text>
              </Pressable>
              <Text
                style={[
                  styles.partyCount,
                  { color: palette.primaryText },
                  fontStyle,
                ]}
              >
                {party}
              </Text>
              <Pressable
                onPress={() => setParty((p) => Math.min(partyMax, p + 1))}
                disabled={party >= partyMax}
                accessibilityRole="button"
                accessibilityLabel="Increase party size"
                style={[
                  styles.partyBtn,
                  {
                    backgroundColor: palette.accentWash,
                    borderColor: palette.panelBorder,
                  },
                  party >= partyMax ? styles.partyBtnDisabled : null,
                ]}
              >
                <Text style={[styles.partyBtnText, { color: palette.primaryText }]}>
                  +
                </Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : null}

      {/* ---- Confirm Reserve ----
          Slots mode (single list) or the wizard's final "party" step. The
          {eventDateId, quantity} handoff is UNCHANGED (ORCH-1186 Fix 4 keeps the
          exact checkout contract — only the path to it is now stepwise). */}
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
              : {
                  backgroundColor: palette.panelStrong,
                  borderColor: palette.panelBorder,
                  borderWidth: 1,
                },
          ]}
          testID="orch-1138-consumer-experience-reserve-confirm"
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
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    // ANDROID-GLASS-OPAQUE — clip + opaque fill (no translucent blur).
    ...Platform.select({ android: { overflow: "hidden" } }),
  },
  handleIndicator: { width: 44 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 12 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "900" },
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
    marginBottom: 16,
    flexWrap: "wrap",
  },
  crumb: { fontSize: 13, fontWeight: "800" },
  crumbSep: { fontSize: 13, fontWeight: "800" },
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
    marginTop: 24,
  },
  confirmText: { fontSize: 16, fontWeight: "900" },
});

export default ExperienceReservePicker;
