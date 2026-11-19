/**
 * #4490 P5-2 — the By the hour editor (`ed-hour`): one screen, not a wizard.
 *
 * What is booked (spaces the venue has, or N new units auto-named "Pool table
 * 1..n"), the price per hour and an optional busy-time price, the days and
 * hours, how long a booking can be (no 60-minute cap; steps of 15, 30 or 60
 * minutes), setup and cleanup buffers, "Release if nobody checks in", "Staff
 * can start a session", the refund rules, then Save draft / Publish with
 * what still stands in the way said in plain words. A booking is paid in full
 * when it is made (instant booking; no deposit on this kind).
 *
 * Every write carries the version the host last saw; "someone else saved
 * first" offers a reload. Refusals are plain words, never codes.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useTouchFloor } from "../../../../hooks/useTouchFloor";
import { venueFeatureKeys } from "../../../../hooks/venueFeatureKeys";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { useVenueSpaces } from "../../../../hooks/useVenueSpaces";
import {
  manageVenueHour,
  manageVenueOffer,
  policyPayload,
  toVenueOfferError,
} from "../../../../services/venueOffersService";
import type { VenueOffer } from "../../../../types/venueOffers";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { Input } from "../../../ui/Input";
import { MoneyField } from "../../../ui/MoneyField";
import { NumberStepper, NumberStepperPair } from "../../../ui/NumberStepper";
import { OptionCard } from "../../../ui/OptionCard";
import { useBrandHours } from "../../../../hooks/useBrandHours";
import { openingHoursDefault } from "../hoursModel";
import { Chip, Segmented } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Skeleton } from "../../../ui/Skeleton";
import { TimeField } from "../../../ui/TimeField";
import { WeekdayChips } from "../../../ui/WeekdayChips";
import { revealFocusedFieldWithin } from "../../offers/revealFocusedField";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import {
  HOUR_BUFFER_OPTIONS,
  HOUR_MOVE_CUTOFF_OPTIONS,
  HOUR_REFUND_PRESETS,
  RELEASE_OPTIONS,
  STEP_OPTIONS,
  hourDraftFrom,
  hourErrorCopy,
  hourHoursPayload,
  hourIssueList,
  hourIssues,
  hourLadder,
  hourLengthPayload,
  hourMoveRule,
  hourOptionPayload,
  hourPlacePayload,
  hourPriceFor,
  hourReadinessCopy,
  hourRulesPayload,
  maxLengthOptions,
  minLengthOptions,
  minutesLabel,
  type HourDraft,
} from "./hourModel";
import { money, offerErrorCopy } from "./offersModel";

const COLUMN_OPTION_CARD = { flexBasis: "auto" as const, flexGrow: 0 };

function errorText(code: string, detail: string | null): string {
  return hourErrorCopy(code) ?? offerErrorCopy(code, detail);
}

export interface HourEditorProps {
  brandId: string | null;
  venueId: string | null;
  venueName: string;
  offerId: string | null;
  onClose: (result?: { published: boolean; name: string }) => void;
  onOpenSpaces?: () => void;
  onOpenSettings?: () => void;
}

export const HourEditor = forwardRef<VenueModuleLeaveHandle, HourEditorProps>(function HourEditor(
  { brandId, venueId, venueName, offerId, onClose, onOpenSpaces, onOpenSettings },
  ref,
): React.ReactElement {
  const queryClient = useQueryClient();
  const touch = useTouchFloor();
  const currency = useBrandCurrency(brandId);
  const offersQuery = useVenueOffers(brandId, venueId);
  const spacesQuery = useVenueSpaces(brandId, venueId);
  const [currentId, setCurrentId] = useState<string | null>(offerId);
  const [savedOffer, setSavedOffer] = useState<VenueOffer | null>(null);
  const listOffer = offersQuery.data?.offers.find((o) => o.id === currentId) ?? null;
  const offer = savedOffer !== null && savedOffer.id === currentId ? savedOffer : listOffer;
  const [draft, setDraft] = useState<HourDraft>(() => hourDraftFrom(offer));
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(hourDraftFrom(offer)));
  const loadedFor = useRef<string | null>(offer?.id ?? null);
  useEffect(() => {
    // The offer arrives after mount when opened from the list.
    if (offer !== null && loadedFor.current !== offer.id) {
      loadedFor.current = offer.id;
      const d = hourDraftFrom(offer);
      setDraft(d);
      setBaseline(JSON.stringify(d));
    }
  }, [offer]);
  // #4490 N59: a new By the hour offer starts on the venue's opening days and
  // hours (Mon–Fri 08:00–20:00), not every day 09:00–21:00. Applied once,
  // before the host types, and kept as the baseline so it is not "unsaved".
  const hoursQuery = useBrandHours(brandId, venueId);
  const seededFromHours = useRef(false);
  useEffect(() => {
    if (seededFromHours.current || offerId !== null || currentId !== null) return;
    if (hoursQuery.data === undefined) return;
    seededFromHours.current = true;
    const opening = openingHoursDefault(hoursQuery.data);
    if (opening === null) return;
    const d = { ...hourDraftFrom(null), weekdays: opening.weekdays, opens: opening.open, closes: opening.close };
    if (JSON.stringify(draft) === baseline) {
      setDraft(d);
      setBaseline(JSON.stringify(d));
    }
  }, [baseline, currentId, draft, hoursQuery.data, offerId]);
  const dirty = JSON.stringify(draft) !== baseline;
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const savedPlaces = offer?.hour?.places.length ?? 0;
  const issues = hourIssues(draft, { savedPlaces });
  const issueList = hourIssueList(issues);
  const patch = (next: Partial<HourDraft>): void => {
    setDraft((d) => ({ ...d, ...next }));
    setError(null);
    setSaved(null);
  };

  const refresh = useCallback((): void => {
    if (brandId === null || venueId === null) return;
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.offers(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.spaces(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.calendarAll(brandId, venueId) });
  }, [brandId, queryClient, venueId]);

  /** Save every changed part, in order; returns the latest offer. */
  const persist = useCallback(async (): Promise<VenueOffer> => {
    if (venueId === null) throw new Error("venue_required");
    const before = offer === null ? null : hourDraftFrom(offer);
    const name = draft.name.trim();
    let current: VenueOffer;
    if (offer === null) {
      current = await manageVenueOffer({ venueId, action: "create_draft", payload: { kind: "by_the_hour", name, summary: draft.summary.trim() } });
      setCurrentId(current.id);
      loadedFor.current = current.id;
    } else if (offer.name !== name || offer.summary !== draft.summary.trim()) {
      current = await manageVenueOffer({ venueId, action: "update", payload: { offerId: offer.id, name, summary: draft.summary.trim() }, expectedVersion: offer.version });
    } else {
      current = offer;
    }
    const id = current.id;
    const optionId = current.options.find((o) => o.status === "active")?.id ?? current.options[0]?.id ?? null;
    const optionBefore = before === null ? null : JSON.stringify(hourOptionPayload(before, optionId));
    if (optionBefore !== JSON.stringify(hourOptionPayload(draft, optionId)) || optionId === null) {
      current = await manageVenueOffer({ venueId, action: "upsert_price_option", payload: { offerId: id, ...hourOptionPayload(draft, optionId) }, expectedVersion: current.version });
    }
    const placeChanged =
      before === null ||
      (draft.placeMode === "units" && savedPlaces === 0) ||
      (draft.placeMode === "spaces" &&
        (JSON.stringify([...draft.spaceIds].sort()) !== JSON.stringify([...before.spaceIds].sort()) || draft.allocation !== before.allocation));
    if (placeChanged && !(draft.placeMode === "units" && savedPlaces > 0)) {
      current = await manageVenueHour({ venueId, action: "set_place", payload: hourPlacePayload(draft, id), expectedVersion: current.version });
    }
    if (before === null || JSON.stringify(hourHoursPayload(before, id)) !== JSON.stringify(hourHoursPayload(draft, id)) || current.hour?.hours == null) {
      current = await manageVenueHour({ venueId, action: "set_hours", payload: hourHoursPayload(draft, id), expectedVersion: current.version });
    }
    if (before === null || JSON.stringify(hourLengthPayload(before, id)) !== JSON.stringify(hourLengthPayload(draft, id))) {
      current = await manageVenueHour({ venueId, action: "set_length", payload: hourLengthPayload(draft, id), expectedVersion: current.version });
    }
    if (before === null || JSON.stringify(hourRulesPayload(before, id)) !== JSON.stringify(hourRulesPayload(draft, id))) {
      current = await manageVenueHour({ venueId, action: "set_rules", payload: hourRulesPayload(draft, id), expectedVersion: current.version });
    }
    if (
      before === null ||
      before.refundPreset !== draft.refundPreset ||
      JSON.stringify(hourMoveRule(before)) !== JSON.stringify(hourMoveRule(draft)) ||
      current.policy === null
    ) {
      current = await manageVenueOffer({ venueId, action: "set_policy", payload: { offerId: id, ...policyPayload(hourLadder(draft), hourMoveRule(draft)) }, expectedVersion: current.version });
    }
    setSavedOffer(current);
    const next = hourDraftFrom(current);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    refresh();
    return current;
  }, [draft, offer, refresh, savedPlaces, venueId]);

  const run = async (publish: boolean): Promise<void> => {
    if (busy !== null) return;
    setShowErrors(true);
    if (issueList.length > 0) {
      setError(issueList[0] ?? null);
      return;
    }
    setBusy(publish ? "publish" : "save");
    setError(null);
    try {
      let current = await persist();
      if (publish) {
        current = await manageVenueOffer({ venueId: venueId ?? "", action: "publish", payload: { offerId: current.id }, expectedVersion: current.version });
        setSavedOffer(current);
        refresh();
        onClose({ published: true, name: current.name });
        return;
      }
      setSaved("Draft saved");
    } catch (e) {
      const err = toVenueOfferError(e);
      if (err.code === "stale_write") setStale(true);
      if (err.code === "offer_not_ready") {
        const words = (err.reasons.length > 0 ? err.reasons : [err.detail ?? ""]).map((r) => hourReadinessCopy(r) ?? offerErrorCopy("offer_not_ready", r));
        setError(`Not ready to publish yet. ${words.join(" ")}`);
      } else {
        setError(errorText(err.code, err.detail));
      }
    } finally {
      setBusy(null);
    }
  };

  useImperativeHandle(
    ref,
    (): VenueModuleLeaveHandle => ({
      isDirty: () => dirty,
      changedLabels: () => (dirty ? [draft.name.trim() || "By the hour"] : []),
      isValid: () => issueList.length === 0,
      save: async () => {
        await persist();
      },
      discard: () => {
        setDraft(JSON.parse(baseline) as HourDraft);
      },
    }),
  );

  if (offerId !== null && offer === null && offersQuery.isLoading) {
    return (
      <View style={styles.host}>
        <Skeleton height={32} width="40%" />
        <Skeleton height={200} radius="md" />
      </View>
    );
  }
  if (offerId !== null && offer === null && offersQuery.isError) {
    return (
      <CenteredState title="Couldn't load this offer" body="Check your connection and try again." tone="error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void offersQuery.refetch()} />
      </CenteredState>
    );
  }

  const step = draft.stepMinutes;
  const minOptions = minLengthOptions(step);
  const maxOptions = maxLengthOptions(step, draft.minMinutes);
  const exampleMinutes = Math.max(draft.minMinutes, 120);
  const exampleLine =
    draft.priceMinor !== null && draft.priceMinor > 0
      ? `${minutesLabel(exampleMinutes)} costs ${money(hourPriceFor(draft.priceMinor, exampleMinutes), currency)} before VAT. Part hours are charged by the minute.`
      : null;
  const status = offer?.status ?? "draft";
  const chipStyle = touch > 0 ? { minHeight: touch } : undefined;

  return (
    <View style={styles.host} testID="hour-editor">
      <View style={styles.head}>
        <Button label="Back to offers" variant="ghost" size="sm" onPress={() => onClose()} testID="hour-editor-back" />
        <Text style={styles.title} accessibilityRole="header">
          {offer === null ? "New: By the hour" : draft.name || "By the hour"}
        </Text>
        <Text style={styles.status}>{status === "live" ? "LIVE" : status === "paused" ? "PAUSED" : "DRAFT"}</Text>
      </View>
      {stale ? (
        <Banner
          tone="warning"
          title="Someone else saved this offer first"
          body="Reload to see their changes, then make yours again."
          action={{
            label: "Reload",
            onPress: () => {
              setStale(false);
              setSavedOffer(null);
              loadedFor.current = null;
              void offersQuery.refetch();
            },
            testID: "hour-editor-reload",
          }}
        />
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form} ref={revealFocusedFieldWithin}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What it's called</Text>
          <Input value={draft.name} onChangeText={(name) => patch({ name: name.slice(0, 80) })} placeholder="Pool table, Boardroom, Padel court" accessibilityLabel="Name" error={showErrors ? issues.name : null} testID="hour-editor-name" />
          <Input value={draft.summary} onChangeText={(summary) => patch({ summary: summary.slice(0, 140) })} placeholder="One line guests see (optional)" accessibilityLabel="One line guests see" testID="hour-editor-summary" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What guests book</Text>
          {savedPlaces > 0 ? (
            <Text style={styles.hint}>{`Now: ${offer?.hour?.places.map((p) => p.name).join(", ") ?? ""}`}</Text>
          ) : null}
          <Segmented
            options={[
              { key: "units", label: savedPlaces > 0 ? "Add units" : "New units" },
              { key: "spaces", label: "Spaces you have" },
            ]}
            value={draft.placeMode}
            onChange={(placeMode) => patch({ placeMode })}
            accessibilityLabel="What guests book"
            testID="hour-editor-place-mode"
          />
          {draft.placeMode === "units" ? (
            savedPlaces > 0 ? (
              <Text style={styles.hint}>
                {`These units already exist as spaces. Pick them under "Spaces you have" to change which ones are sold, or add more spaces in Spaces.`}
              </Text>
            ) : (
              <>
                <Input value={draft.unitName} onChangeText={(unitName) => patch({ unitName: unitName.slice(0, 50) })} placeholder="Pool table" accessibilityLabel="Unit name" error={showErrors ? issues.place : null} testID="hour-editor-unit-name" />
                <NumberStepperPair>
                  <NumberStepper label="How many" value={draft.unitCount} min={1} max={50} onChange={(unitCount) => patch({ unitCount })} testID="hour-editor-unit-count" />
                  <NumberStepper label="Guests each" value={draft.unitSeats} min={1} max={1000} onChange={(unitSeats) => patch({ unitSeats })} testID="hour-editor-unit-seats" />
                </NumberStepperPair>
                <Text style={styles.hint}>
                  {draft.unitName.trim().length > 0
                    ? draft.unitCount === 1
                      ? `Named ${draft.unitName.trim()} 1.`
                      : `Named ${draft.unitName.trim()} 1 to ${draft.unitCount}. A booking takes any one that's free.`
                    : "Each unit becomes a space you can see in Spaces."}
                </Text>
              </>
            )
          ) : spaces.length === 0 ? (
            <View style={styles.inline}>
              <Text style={styles.hint}>You have no spaces yet. Make units instead, or add a space first.</Text>
              {onOpenSpaces !== undefined ? <Button label="Open Spaces" variant="secondary" size="sm" onPress={onOpenSpaces} /> : null}
            </View>
          ) : (
            <>
              <View style={styles.chips} accessibilityLabel="Spaces">
                {spaces.map((s) => {
                  const on = draft.spaceIds.includes(s.id);
                  return (
                    <Chip
                      key={s.id}
                      label={s.name}
                      selected={on}
                      onPress={() => patch({ spaceIds: on ? draft.spaceIds.filter((x) => x !== s.id) : [...draft.spaceIds, s.id] })}
                      style={chipStyle}
                      testID={`hour-editor-space-${s.id}`}
                    />
                  );
                })}
              </View>
              {showErrors && issues.place !== null ? <Text style={styles.error}>{issues.place}</Text> : null}
              {draft.spaceIds.length > 1 ? (
                <Segmented
                  options={[
                    { key: "any_one", label: "Any one of them" },
                    { key: "all", label: "All together" },
                  ]}
                  value={draft.allocation}
                  onChange={(allocation) => patch({ allocation })}
                  accessibilityLabel="How the spaces are booked"
                  testID="hour-editor-allocation"
                />
              ) : null}
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Price</Text>
          <MoneyField label="Price per hour" valueMinor={draft.priceMinor} onChangeMinor={(priceMinor) => patch({ priceMinor })} currency={currency} error={showErrors ? issues.price : null} testID="hour-editor-price" />
          {exampleLine !== null ? <Text style={styles.hint}>{exampleLine}</Text> : null}
          {/* #4490 fix 2 (N80): smallest and largest group on one booking; the largest rises with the smallest. */}
          <NumberStepperPair>
            <NumberStepper
              label="Smallest group"
              value={draft.guestMin}
              min={1}
              max={1000}
              onChange={(guestMin) => patch({ guestMin, guestMax: Math.max(draft.guestMax, guestMin) })}
              testID="hour-editor-guest-min"
            />
            <NumberStepper
              label="Largest group"
              value={draft.guestMax}
              min={Math.max(1, draft.guestMin)}
              max={1000}
              onChange={(guestMax) => patch({ guestMax })}
              testID="hour-editor-guest-max"
            />
          </NumberStepperPair>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Busy-time price</Text>
              <Text style={styles.hint}>A different price per hour on busy days and times.</Text>
            </View>
            <BrandSwitch value={draft.busyOn} onValueChange={(busyOn) => patch({ busyOn })} accessibilityLabel="Busy-time price" testID="hour-editor-busy" />
          </View>
          {draft.busyOn ? (
            <View style={styles.inset}>
              <WeekdayChips value={draft.busy.weekdays} onChange={(weekdays) => patch({ busy: { ...draft.busy, weekdays } })} label="Days" testID="hour-editor-busy-days" />
              <View style={styles.row2}>
                <View style={styles.cell}>
                  <TimeField label="From" value={draft.busy.from} onChangeValue={(from) => patch({ busy: { ...draft.busy, from } })} accessibilityLabel="Busy time from" testID="hour-editor-busy-from" />
                </View>
                <View style={styles.cell}>
                  <TimeField label="Until" value={draft.busy.to} onChangeValue={(to) => patch({ busy: { ...draft.busy, to } })} accessibilityLabel="Busy time until" testID="hour-editor-busy-to" />
                </View>
              </View>
              <MoneyField label="Busy price per hour" valueMinor={draft.busy.amountMinor} onChangeMinor={(amountMinor) => patch({ busy: { ...draft.busy, amountMinor } })} currency={currency} error={showErrors ? issues.busy : null} testID="hour-editor-busy-price" />
            </View>
          ) : null}
          <Text style={styles.hint}>Guests pay in full when they book. VAT follows your venue's Terms and tax.</Text>
          {onOpenSettings !== undefined ? <Button label="Open Terms and tax" variant="secondary" size="sm" onPress={onOpenSettings} testID="hour-editor-terms" /> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>When it can be booked</Text>
          <WeekdayChips value={draft.weekdays} onChange={(weekdays) => patch({ weekdays })} label="Days" showSummary testID="hour-editor-days" />
          {showErrors && issues.days !== null ? <Text style={styles.error}>{issues.days}</Text> : null}
          <View style={styles.row2}>
            <View style={styles.cell}>
              <TimeField label="Opens" value={draft.opens} onChangeValue={(opens) => patch({ opens })} accessibilityLabel="Opens" hasError={showErrors && issues.hours !== null} testID="hour-editor-opens" />
            </View>
            <View style={styles.cell}>
              <TimeField label="Closes" value={draft.closes} onChangeValue={(closes) => patch({ closes })} accessibilityLabel="Closes" hasError={showErrors && issues.hours !== null} testID="hour-editor-closes" />
            </View>
          </View>
          {draft.closes.length > 0 && draft.opens.length > 0 && draft.closes < draft.opens ? <Text style={styles.hint}>Closes the next day.</Text> : null}
          {showErrors && issues.hours !== null ? <Text style={styles.error}>{issues.hours}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How long</Text>
          <Text style={styles.label}>Starts every</Text>
          <Segmented
            options={STEP_OPTIONS}
            value={String(draft.stepMinutes) as "15" | "30" | "60"}
            onChange={(k) => {
              const s = Number(k) as 15 | 30 | 60;
              patch({ stepMinutes: s, minMinutes: Math.max(s, Math.round(draft.minMinutes / s) * s) });
            }}
            accessibilityLabel="Starts every"
            testID="hour-editor-step"
          />
          <View style={styles.row2}>
            <View style={styles.cell}>
              <SelectSheet label="Shortest" value={draft.minMinutes} options={minOptions} onChange={(minMinutes) => patch({ minMinutes })} hasError={showErrors && issues.length !== null} testID="hour-editor-min" />
            </View>
            <View style={styles.cell}>
              <SelectSheet label="Longest" value={draft.maxMinutes ?? 0} options={maxOptions} onChange={(m) => patch({ maxMinutes: m === 0 ? null : m })} hasError={showErrors && issues.length !== null} testID="hour-editor-max" />
            </View>
          </View>
          {showErrors && issues.length !== null ? <Text style={styles.error}>{issues.length}</Text> : null}
          <View style={styles.row2}>
            <View style={styles.cell}>
              <SelectSheet label="Setup time before" value={draft.setupMinutes} options={HOUR_BUFFER_OPTIONS} onChange={(setupMinutes) => patch({ setupMinutes })} testID="hour-editor-setup" />
            </View>
            <View style={styles.cell}>
              <SelectSheet label="Cleanup time after" value={draft.cleanupMinutes} options={HOUR_BUFFER_OPTIONS} onChange={(cleanupMinutes) => patch({ cleanupMinutes })} testID="hour-editor-cleanup" />
            </View>
          </View>
          <Text style={styles.hint}>Setup and cleanup keep the place free around each booking. Guests don't see them.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>On the day</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Release if nobody checks in</Text>
              <Text style={styles.hint}>
                {draft.releaseOn ? `After ${minutesLabel(draft.releaseMinutes)} the time goes back on sale. No refund.` : "The booking holds the place for its whole time."}
              </Text>
            </View>
            <BrandSwitch value={draft.releaseOn} onValueChange={(releaseOn) => patch({ releaseOn })} accessibilityLabel="Release if nobody checks in" testID="hour-editor-release" />
          </View>
          {draft.releaseOn ? (
            <SelectSheet label="Release after" value={draft.releaseMinutes} options={RELEASE_OPTIONS} onChange={(releaseMinutes) => patch({ releaseMinutes })} testID="hour-editor-release-minutes" />
          ) : null}
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Staff can start a session at the venue</Text>
              <Text style={styles.hint}>For guests who walk up.</Text>
            </View>
            <BrandSwitch value={draft.staffCanStart} onValueChange={(staffCanStart) => patch({ staffCanStart })} accessibilityLabel="Staff can start a session at the venue" testID="hour-editor-staff-start" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>If a guest cancels</Text>
          <View style={styles.cards}>
            {HOUR_REFUND_PRESETS.map((p) => (
              <OptionCard
                key={p.key}
                label={p.label}
                helper={p.helper}
                selected={draft.refundPreset === p.key}
                onPress={() => patch({ refundPreset: p.key })}
                testID={`hour-editor-refund-${p.key}`}
                style={COLUMN_OPTION_CARD}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>If a guest wants another time</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Guests can move it themselves</Text>
              <Text style={styles.hint}>From their booking page, to any free time. The price difference is shown first.</Text>
            </View>
            <BrandSwitch value={draft.moveOn} onValueChange={(moveOn) => patch({ moveOn })} accessibilityLabel="Guests can move it themselves" testID="hour-editor-move" />
          </View>
          {draft.moveOn ? (
            <View style={styles.row2}>
              <View style={styles.cell}>
                <SelectSheet label="Up to" value={draft.moveCutoffMinutes} options={HOUR_MOVE_CUTOFF_OPTIONS} onChange={(moveCutoffMinutes) => patch({ moveCutoffMinutes })} testID="hour-editor-move-cutoff" />
              </View>
              <View style={styles.cell}>
                <NumberStepper label="Times per booking" value={draft.maxMoves} min={1} max={5} onChange={(maxMoves) => patch({ maxMoves })} testID="hour-editor-move-times" />
              </View>
            </View>
          ) : null}
        </View>

        {offer !== null && offer.readiness.length > 0 && !dirty ? (
          <Banner
            tone="info"
            title="Before it can go live"
            body={offer.readiness.map((r) => hourReadinessCopy(r) ?? offerErrorCopy("offer_not_ready", r)).join(" ")}
            testID="hour-editor-readiness"
          />
        ) : null}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        {error !== null ? (
          <Text style={styles.error} accessibilityRole="alert" testID="hour-editor-error">{error}</Text>
        ) : saved !== null ? (
          <Text style={styles.saved} accessibilityLiveRegion="polite">{saved}</Text>
        ) : dirty ? (
          <Text style={styles.hint}>Unsaved changes</Text>
        ) : (
          <Text style={styles.hint}>{`Sold at ${venueName}`}</Text>
        )}
        <View style={styles.footerButtons}>
          <Button label="Save draft" variant="secondary" size="md" onPress={() => void run(false)} loading={busy === "save"} disabled={busy !== null} testID="hour-editor-save" />
          <Button
            label={status === "live" ? "Save and keep live" : "Publish"}
            variant="primary"
            size="md"
            onPress={() => void run(true)}
            loading={busy === "publish"}
            disabled={busy !== null}
            testID="hour-editor-publish"
          />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  host: { flex: 1, gap: space[3] },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingTop: space[4] },
  title: { ...type.h1, color: color.text1, flexShrink: 1 },
  status: { ...type.label, color: color.text2 },
  scroll: { flex: 1 },
  content: { gap: space[4], paddingHorizontal: space[4], paddingBottom: space[8], width: "100%", maxWidth: 720, alignSelf: "center" },
  form: { gap: space[4] },
  section: { gap: space[3], padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.tile },
  sectionTitle: { ...type.row, color: color.text1 },
  label: { ...type.label, color: color.text2 },
  hint: { ...type.caption, color: color.text2 },
  error: { ...type.small, color: color.errorText },
  saved: { ...type.small, color: color.successText },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  cards: { gap: space[2] },
  row2: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  cell: { flexGrow: 1, flexBasis: 160 },
  inline: { gap: space[2], alignItems: "flex-start" },
  inset: { gap: space[3], paddingLeft: space[3], borderLeftWidth: 2, borderLeftColor: color.line },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44 },
  switchText: { flex: 1, gap: 2 },
  switchTitle: { ...type.row, color: color.text1 },
  footer: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    backgroundColor: color.canvas,
  },
  footerButtons: { flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "flex-end" },
});
