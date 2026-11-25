/**
 * #4490 P2-4 — the Entry editor (`ed-entry`, `ed-entry-err`, `ed-entry-cap`,
 * `ed-entry-review`) in the offer wizard frame (B §3 "Offer editor frame").
 *
 * Steps: Basics · Price options · Capacity · Rules · Review. Continue saves the
 * step to the server (a draft until Publish), so nothing is lost between steps;
 * the leave guard covers the step being edited. Desktop: a clickable step list,
 * the form at the wizard width and "Guests will see" at ≥1280. Phone: step
 * chips, one column, a pinned Back / Continue.
 *
 * Every write is `issue_4490_manage_offer` / `issue_4490_manage_capacity_pool`
 * with the version the host last saw; "someone else saved first" offers a
 * reload. Server refusals are plain words (offerErrorCopy), never codes.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../../constants/designSystem";
import {
  DESKTOP_WIZARD_FORM_MAX_WIDTH,
  DESKTOP_WIZARD_RAIL_WIDTH,
} from "../../../../constants/desktopLayout";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useBrandHours } from "../../../../hooks/useBrandHours";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { venueFeatureKeys } from "../../../../hooks/venueFeatureKeys";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import {
  manageCapacityPool,
  manageVenueOffer,
  policyPayload,
  toVenueOfferError,
  VenueOfferError,
} from "../../../../services/venueOffersService";
import type { BrandHourEntry } from "../../../../types/brand";
import type { VenueCapacityPool, VenueOffer, VenueOffersState } from "../../../../types/venueOffers";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { DayDateField } from "../../../ui/DayDateField";
import { DurationSelect } from "../../../ui/DurationSelect";
import { weekdaysSummary } from "../../../ui/fieldModels";
import { Input } from "../../../ui/Input";
import { NumberStepper, NumberStepperPair } from "../../../ui/NumberStepper";
import { OptionCard } from "../../../ui/OptionCard";
import { SelectSheet } from "../../../ui/SelectSheet";
import { useScrollToTopOnChange } from "../../../ui/useScrollToTopOnChange";
import { revealFocusedFieldWithin } from "../../offers/revealFocusedField";
import { Skeleton } from "../../../ui/Skeleton";
import { Stepper, StepperFooter, type StepperStep } from "../../../ui/Stepper";
import { TimeField } from "../../../ui/TimeField";
import { WeekdayChips } from "../../../ui/WeekdayChips";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import {
  ENTRY_STEPS,
  ENTRY_STYLES,
  REFUND_PRESETS,
  dateChangeForDraft,
  dateChangeSummary,
  emptyOptionDraft,
  entryDraftFrom,
  entryStepIssue,
  entryStyleLabel,
  ladderForDraft,
  money,
  multiDayPassSummary,
  offerErrorCopy,
  optionChanged,
  optionDraftFrom,
  optionNameOrDefault,
  optionPayload,
  readinessLine,
  refundSummary,
  schedulePayload,
  shouldSaveEntryStepBeforeNavigation,
  timeRangeLabel,
  timedDayTotal,
  timedSessionPreview,
  timedSessionStarts,
  vatLine,
  type EntryDraft,
  type EntryStepId,
} from "./offersModel";
import { PriceOptionCard } from "./PriceOptionCard";

/** The step rail needs room beside the venue rail: below this the chips layout is used. */
const RAIL_MIN_WIDTH = 1280;
/** "Guests will see" needs room for rail + form + preview (B §8 Q4, adjusted for the venue rail). */
const PREVIEW_MIN_WIDTH = 1560;

const DATE_CHANGE_CUTOFFS = [
  { value: 0, label: "Until it starts" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 360, label: "6 hours before" },
  { value: 720, label: "12 hours before" },
  { value: 1440, label: "24 hours before" },
  { value: 2880, label: "48 hours before" },
];

/** Opening hours → the schedule a new Entry starts with. */
function hoursDefaults(hours: readonly BrandHourEntry[] | null): { open: string; close: string; weekdays: number[] } {
  const open = (hours ?? []).filter((h) => !h.isClosed && h.openTime !== null && h.closeTime !== null);
  if (open.length === 0) return { open: "10:00", close: "22:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
  const hhmm = (t: string | null): string => (t ?? "").slice(0, 5);
  const opens = open.map((h) => hhmm(h.openTime)).sort();
  // The latest close; a close at or before the open runs past midnight.
  const closes = open.map((h) => hhmm(h.closeTime));
  const pastMidnight = closes.find((c) => c <= (opens[0] ?? "00:00"));
  return {
    open: opens[0] ?? "10:00",
    close: pastMidnight ?? [...closes].sort().reverse()[0] ?? "22:00",
    weekdays: open.map((h) => h.weekday).sort((a, b) => a - b),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// OptionCard is row-only (flexBasis 0); stacked in a column it must size to its content.
const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

const COLUMN_OPTION_CARD = { flexBasis: "auto" as const, flexGrow: 0 };

export interface EntryEditorProps {
  brandId: string | null;
  venueId: string | null;
  venueName: string;
  /** null = a new Entry offer. */
  offerId: string | null;
  /** Close the editor (after publish, or the host chose to leave). */
  onClose: (result?: { published: boolean; name: string }) => void;
  /** Open Settings (VAT lives in Terms and tax; the Entry switch in features). */
  onOpenSettings?: () => void;
  /** #4490 F4 — brand payments setup, offered when the brand can't take payments online. */
  onOpenPayments?: () => void;
}

export const EntryEditor = forwardRef<VenueModuleLeaveHandle, EntryEditorProps>(function EntryEditor(
  { brandId, venueId, venueName, offerId, onClose, onOpenSettings, onOpenPayments },
  ref,
): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const { width } = useWindowDimensions();
  const railLayout = isWideDesktop && width >= RAIL_MIN_WIDTH;
  const showPreview = railLayout && width >= PREVIEW_MIN_WIDTH;
  const queryClient = useQueryClient();
  const currency = useBrandCurrency(brandId);
  const offersQuery = useVenueOffers(brandId, venueId);
  const hoursQuery = useBrandHours(brandId, venueId);

  const [currentOfferId, setCurrentOfferId] = useState<string | null>(offerId);
  /** The server's latest answer for this offer (fresher than the list read). */
  const [savedOffer, setSavedOffer] = useState<VenueOffer | null>(null);
  const [savedPool, setSavedPool] = useState<VenueCapacityPool | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [base, setBase] = useState<EntryDraft | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  // #4490 F3: every step opens at the top, never part-way down where the last one was.
  const scrollRef = useScrollToTopOnChange(stepIndex);
  const [furthest, setFurthest] = useState(offerId === null ? 0 : ENTRY_STEPS.length - 1);
  const [showErrors, setShowErrors] = useState<Partial<Record<EntryStepId, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; stale: boolean; reasons: string[] } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // #4490: leaving the editor with unsaved work asks first (Close in the header and
  // the shell's own section switch both end here).
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);

  const state: VenueOffersState | undefined = offersQuery.data;
  const listOffer = state?.offers.find((o) => o.id === currentOfferId) ?? null;
  const offer = savedOffer !== null && savedOffer.id === currentOfferId ? savedOffer : listOffer;
  const pools = state?.pools ?? [];
  const pool =
    savedPool ??
    pools.find((p) => p.id === offer?.poolId) ??
    // One day limit is shared by Entry and group packages: reuse the venue's.
    pools[0] ??
    null;
  const otherOffersOnPool = (state?.offers ?? []).filter((o) => o.id !== currentOfferId && o.poolId !== null && o.poolId === pool?.id);
  const settings = state?.settings ?? null;

  // Seed the draft once the reads answer (a new offer seeds from the hours).
  useEffect(() => {
    if (draft !== null || state === undefined || hoursQuery.isLoading) return;
    if (offerId !== null && listOffer === null) return;
    const defaults = hoursDefaults(hoursQuery.data ?? null);
    const next = entryDraftFrom({
      offer: listOffer,
      pool,
      defaultOpen: defaults.open,
      defaultClose: defaults.close,
      defaultWeekdays: defaults.weekdays,
    });
    if (listOffer === null) next.options = [emptyOptionDraft()];
    setDraft(next);
    setBase(clone(next));
  }, [draft, hoursQuery.data, hoursQuery.isLoading, listOffer, offerId, pool, state]);

  const step = ENTRY_STEPS[stepIndex];
  const dirty = draft !== null && base !== null && JSON.stringify(draft) !== JSON.stringify(base);
  const issueFor = useCallback((id: EntryStepId): string | null => (draft === null ? null : entryStepIssue(id, draft)), [draft]);

  const patch = useCallback((next: Partial<EntryDraft>): void => {
    setDraft((d) => (d === null ? d : { ...d, ...next }));
    setSavedNote(null);
  }, []);

  const refreshLists = useCallback((): void => {
    if (brandId === null || venueId === null) return;
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.offers(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayAll(brandId, venueId) });
  }, [brandId, queryClient, venueId]);

  // ------------------------------------------------------------- saving
  const saveStep = useCallback(
    async (id: EntryStepId): Promise<VenueOffer | null> => {
      if (draft === null || venueId === null) return null;
      let current = offer;
      if (id === "basics") {
        if (current === null) {
          current = await manageVenueOffer({
            venueId,
            action: "create_draft",
            payload: {
              kind: "entry",
              name: draft.name.trim(),
              summary: draft.summary.trim(),
              entryStyle: draft.style,
              ...(draft.style === "timed_session" ? { sessionCapacity: draft.sessionCapacity } : {}),
            },
          });
          setCurrentOfferId(current.id);
        } else if (
          current.name !== draft.name.trim() ||
          (current.summary ?? "") !== draft.summary.trim() ||
          current.entryStyle !== draft.style ||
          (draft.style === "timed_session" && current.sessionCapacity !== draft.sessionCapacity)
        ) {
          current = await manageVenueOffer({
            venueId,
            action: "update",
            payload: {
              offerId: current.id,
              name: draft.name.trim(),
              summary: draft.summary.trim(),
              entryStyle: draft.style,
              ...(draft.style === "timed_session" ? { sessionCapacity: draft.sessionCapacity } : {}),
            },
            expectedVersion: current.version,
          });
        }
      }
      if (current === null) throw new VenueOfferError("offer_not_found");
      if (id === "prices") {
        for (let i = 0; i < draft.options.length; i += 1) {
          const option = draft.options[i];
          const saved = current.options.find((o) => o.id === option.id);
          if (!optionChanged(option, saved, i)) continue;
          current = await manageVenueOffer({
            venueId,
            action: "upsert_price_option",
            payload: { offerId: current.id, ...optionPayload(option, i) },
            expectedVersion: current.version,
          });
        }
        const keep = new Set(draft.options.map((o) => o.id).filter((x): x is string => x !== null));
        for (const removed of current.options.filter((o) => !keep.has(o.id))) {
          // Only options that were saved before and are gone from the draft.
          if (draft.options.some((o) => o.id === removed.id)) continue;
          if ((offer?.options ?? []).some((o) => o.id === removed.id)) {
            current = await manageVenueOffer({
              venueId,
              action: "archive_price_option",
              payload: { offerId: current.id, optionId: removed.id },
              expectedVersion: current.version,
            });
          }
        }
        const fresh = current;
        setDraft((d) => (d === null ? d : { ...d, options: fresh.options.map(optionDraftFrom) }));
      }
      if (id === "capacity") {
        // #4490 fix 2 (N82): guests per session is asked here, once.
        if (draft.style === "timed_session" && current.sessionCapacity !== draft.sessionCapacity) {
          current = await manageVenueOffer({
            venueId,
            action: "update",
            payload: { offerId: current.id, sessionCapacity: draft.sessionCapacity },
            expectedVersion: current.version,
          });
        }
        let nextPool = pool;
        if (nextPool === null) {
          nextPool = await manageCapacityPool({
            venueId,
            action: "create",
            name: `${venueName.trim().slice(0, 60) || "Venue"} day`,
            dailyLimit: draft.dailyLimit,
            keptForWalkIns: draft.keptForWalkIns,
          });
        } else if (nextPool.dailyLimit !== draft.dailyLimit || nextPool.keptForWalkIns !== draft.keptForWalkIns) {
          nextPool = await manageCapacityPool({
            venueId,
            action: "update",
            poolId: nextPool.id,
            dailyLimit: draft.dailyLimit,
            keptForWalkIns: draft.keptForWalkIns,
            expectedVersion: nextPool.version,
          });
        }
        setSavedPool(nextPool);
        if (current.poolId !== nextPool.id) {
          current = await manageVenueOffer({
            venueId,
            action: "set_pool",
            payload: { offerId: current.id, poolId: nextPool.id },
            expectedVersion: current.version,
          });
        }
        const sched = schedulePayload(draft);
        const s = current.schedule;
        const same =
          s !== null &&
          s.mode === sched.mode &&
          JSON.stringify(s.weekdays) === JSON.stringify(sched.weekdays) &&
          s.startTime === sched.startTime &&
          s.endTime === sched.endTime &&
          (s.endDate ?? "") === (typeof sched.endDate === "string" ? sched.endDate : "") &&
          (sched.mode !== "sessions" ||
            (s.sessionMinutes === sched.sessionMinutes && s.sessionEveryMinutes === sched.sessionEveryMinutes));
        if (!same) {
          current = await manageVenueOffer({
            venueId,
            action: "set_schedule",
            payload: { offerId: current.id, ...sched },
            expectedVersion: current.version,
          });
        }
      }
      if (id === "rules") {
        const ladder = ladderForDraft(draft);
        const change = dateChangeForDraft(draft);
        const p = current.policy;
        const same =
          p !== null &&
          JSON.stringify(p.refundLadder) === JSON.stringify(ladder) &&
          (p.dateChangeRule?.allowedUntilMinutesBefore ?? null) === (change?.allowedUntilMinutesBefore ?? null);
        if (!same) {
          current = await manageVenueOffer({
            venueId,
            action: "set_policy",
            payload: { offerId: current.id, ...policyPayload(ladder, change) },
            expectedVersion: current.version,
          });
        }
      }
      setSavedOffer(current);
      return current;
    },
    [draft, offer, pool, venueId, venueName],
  );

  const runSave = useCallback(
    async (id: EntryStepId): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        await saveStep(id);
        setDraft((d) => {
          if (d !== null) setBase(clone(d));
          return d;
        });
        setSavedNote("Saved");
        refreshLists();
        return true;
      } catch (e) {
        const err = toVenueOfferError(e);
        setError({
          text: offerErrorCopy(err.code, err.detail),
          stale: err.code === "stale_write" || err.code === "offer_invalid_transition",
          reasons: err.reasons,
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [refreshLists, saveStep],
  );

  const goTo = useCallback(
    (index: number): void => {
      setError(null);
      setStepIndex(index);
      setFurthest((f) => Math.max(f, index));
    },
    [],
  );

  const navigateToStep = useCallback(
    async (index: number): Promise<void> => {
      const next = ENTRY_STEPS[index];
      if (next === undefined || index === stepIndex) return;
      if (shouldSaveEntryStepBeforeNavigation(dirty, step.id, next.id)) {
        const issue = issueFor(step.id);
        if (issue !== null) {
          setShowErrors((s) => ({ ...s, [step.id]: true }));
          return;
        }
        const ok = await runSave(step.id);
        if (!ok) return;
      }
      goTo(index);
    },
    [dirty, goTo, issueFor, runSave, step.id, stepIndex],
  );

  const handleContinue = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    if (step.id === "review") {
      if (offer === null) return;
      if (offer.status === "live") {
        onClose({ published: false, name: offer.name });
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const published = await manageVenueOffer({
          venueId: venueId as string,
          action: "publish",
          payload: { offerId: offer.id },
          expectedVersion: offer.version,
        });
        setSavedOffer(published);
        refreshLists();
        onClose({ published: true, name: published.name });
      } catch (e) {
        const err = toVenueOfferError(e);
        setError({
          text: offerErrorCopy(err.code, err.detail),
          stale: err.code === "stale_write",
          reasons: err.reasons,
        });
        refreshLists();
      } finally {
        setSaving(false);
      }
      return;
    }
    const issue = issueFor(step.id);
    if (issue !== null) {
      setShowErrors((s) => ({ ...s, [step.id]: true }));
      return;
    }
    const ok = await runSave(step.id);
    if (ok) goTo(stepIndex + 1);
  }, [draft, goTo, issueFor, offer, onClose, refreshLists, runSave, step.id, stepIndex, venueId]);

  const handleReload = useCallback((): void => {
    setError(null);
    setSavedOffer(null);
    setSavedPool(null);
    setDraft(null);
    setBase(null);
    void offersQuery.refetch();
  }, [offersQuery]);

  // ------------------------------------------------- leave handle (shell)
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useImperativeHandle(
    ref,
    (): VenueModuleLeaveHandle => ({
      isDirty: () => dirtyRef.current,
      changedLabels: () => [ENTRY_STEPS[stepIndex]?.label ?? "Entry"],
      isValid: () => issueFor(ENTRY_STEPS[stepIndex]?.id ?? "basics") === null && ENTRY_STEPS[stepIndex]?.id !== "review",
      save: async () => {
        const ok = await runSave(ENTRY_STEPS[stepIndex]?.id ?? "basics");
        if (!ok) throw new Error("save_failed");
      },
      discard: () => {
        if (base !== null) setDraft(clone(base));
      },
    }),
    [base, issueFor, runSave, stepIndex],
  );

  const requestClose = useCallback((): void => {
    if (dirtyRef.current) {
      setLeaveOpen(true);
      return;
    }
    onClose();
  }, [onClose]);

  // ----------------------------------------------------------- states
  if (offersQuery.isError && state === undefined) {
    return (
      <CenteredState title="Couldn't load this offer" body="Check your connection and try again." tone="error" testID="entry-editor-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void offersQuery.refetch()} />
        <Button label="Back to offers" variant="ghost" size="md" onPress={() => onClose()} />
      </CenteredState>
    );
  }
  if (draft === null) {
    if (state !== undefined && offerId !== null && listOffer === null) {
      return (
        <CenteredState title="This offer was removed" body="It may have been archived by someone else." testID="entry-editor-missing">
          <Button label="Back to offers" variant="secondary" size="md" onPress={() => onClose()} />
        </CenteredState>
      );
    }
    return (
      <View style={styles.loading} testID="entry-editor-loading" accessibilityLabel="Loading offer">
        <Skeleton height={28} width="40%" />
        <Skeleton height={120} radius="md" />
        <Skeleton height={120} radius="md" />
      </View>
    );
  }

  // -------------------------------------------------------- the steps
  const steps: StepperStep[] = ENTRY_STEPS.map((s, i) => {
    const issue = issueFor(s.id);
    const stepState: StepperStep["state"] =
      i === stepIndex
        ? showErrors[s.id] === true && issue !== null
          ? "error"
          : "current"
        : showErrors[s.id] === true && issue !== null
          ? "error"
          : i < furthest || (i <= furthest && i < stepIndex)
            ? issue === null ? "done" : "todo"
            : "todo";
    return {
      id: s.id,
      label: s.label,
      state: stepState,
      firstError: stepState === "error" && issue !== null ? issue : undefined,
      description: stepSummary(s.id, draft, currency),
    };
  });
  const continueLabel =
    step.id === "review" ? (offer?.status === "live" ? "Done" : "Publish") : saving ? "Saving" : "Continue";
  const stepErrors = showErrors[step.id] === true;
  const continueDisabled =
    saving ||
    (stepErrors && issueFor(step.id) !== null) ||
    (step.id === "review" && offer === null);

  const header = (
    <View style={styles.titleRow}>
      <View style={styles.titleText}>
        <Text style={styles.eyebrow}>{offer === null ? "New offer" : offer.status === "live" ? "Live offer" : "Draft offer"}</Text>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {draft.name.trim().length > 0 ? draft.name.trim() : "Entry"}
        </Text>
      </View>
      <View style={styles.titleActions}>
        {savedNote !== null && !dirty ? <Text style={styles.saved} accessibilityLiveRegion="polite">{savedNote}</Text> : null}
        {dirty ? <Text style={styles.saved}>Unsaved changes</Text> : null}
        <Button label="Close" variant="ghost" size="sm" leadingIcon="close" onPress={requestClose} testID="entry-editor-close" />
      </View>
    </View>
  );

  const errorBanner =
    error !== null ? (
      <Banner
        tone="danger"
        title={error.reasons.length > 0 ? "Not ready to publish yet" : "Couldn't save"}
        body={error.reasons.length > 0 ? error.reasons.map((r) => readinessLine(r).text).join(" ") : error.text}
        action={
          error.stale
            ? { label: "Reload", onPress: handleReload, testID: "entry-editor-reload" }
            : error.reasons.length > 0 && readinessLine(error.reasons[0]).step !== null
              ? {
                  label: `Go to ${ENTRY_STEPS.find((s) => s.id === readinessLine(error.reasons[0]).step)?.label ?? "step"}`,
                  onPress: () => goTo(ENTRY_STEPS.findIndex((s) => s.id === readinessLine(error.reasons[0]).step)),
                }
              : undefined
        }
        testID="entry-editor-error-banner"
      />
    ) : null;

  const form = (
    <View style={styles.form} ref={revealFocusedFieldWithin}>
      {step.id === "basics" ? <BasicsStep draft={draft} patch={patch} showErrors={stepErrors} disabled={saving} /> : null}
      {step.id === "prices" ? (
        <PricesStep
          draft={draft}
          patch={patch}
          showErrors={stepErrors}
          disabled={saving}
          currency={currency}
          vatText={settings === null ? null : vatLine(settings.vatMode, settings.vatRateBps)}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
      {step.id === "capacity" ? (
        <CapacityStep
          draft={draft}
          patch={patch}
          showErrors={stepErrors}
          disabled={saving}
          sharedWith={otherOffersOnPool.map((o) => o.name)}
        />
      ) : null}
      {step.id === "rules" ? <RulesStep draft={draft} patch={patch} showErrors={stepErrors} disabled={saving} /> : null}
      {step.id === "review" ? (
        <ReviewStep
          draft={draft}
          offer={offer}
          currency={currency}
          vatText={settings === null ? null : vatLine(settings.vatMode, settings.vatRateBps)}
          onGoTo={(id) => goTo(ENTRY_STEPS.findIndex((s) => s.id === id))}
          onOpenSettings={onOpenSettings}
          paymentsOff={state?.canCollectOnline === false || (offer?.warnings ?? []).includes("online_payments_off")}
          onOpenPayments={onOpenPayments}
        />
      ) : null}
      {errorBanner}
    </View>
  );

  const preview = (
    <View style={styles.preview} testID="entry-editor-preview">
      <Text style={styles.previewLabel}>Guests will see</Text>
      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>{draft.name.trim().length > 0 ? draft.name.trim() : "Entry"}</Text>
        {draft.options.length === 0 ? <Text style={styles.hint}>Add a price to see it here.</Text> : null}
        {draft.options.map((o) => (
          <View key={o.key} style={styles.previewRow}>
            <View style={styles.grow}>
              <Text style={styles.previewName}>{o.name.trim().length > 0 ? o.name.trim() : "Unnamed price"}</Text>
              <Text style={styles.hint}>
                {weekdaysSummary(o.weekdays)}
                {o.limitHours && timeRangeLabel(o.startTime || null, o.endTime || null) !== null
                  ? ` · ${timeRangeLabel(o.startTime, o.endTime)}`
                  : ""}
                {o.idCheck ? ` · bring your ${o.idLabel.trim().length > 0 ? o.idLabel.trim() : "ID"}` : ""}
                {o.multiDay ? ` · ${multiDayPassSummary(o.passDays, o.passWindowDays)}` : ""}
              </Text>
            </View>
            <Text style={styles.previewPrice}>{o.free ? "Free" : o.priceMinor === null ? "—" : money(o.priceMinor, currency)}</Text>
          </View>
        ))}
      </View>
      {settings !== null ? <Text style={styles.hint}>{vatLine(settings.vatMode, settings.vatRateBps)}</Text> : null}
    </View>
  );

  const footer = (
    <StepperFooter
      previousLabel={stepIndex > 0 ? ENTRY_STEPS[stepIndex - 1].label : undefined}
      onBack={stepIndex > 0 ? () => void navigateToStep(stepIndex - 1) : undefined}
      backDisabled={saving}
      continueLabel={continueLabel}
      onContinue={() => void handleContinue()}
      continueDisabled={continueDisabled}
      continueLoading={saving}
      continueTestID="entry-editor-continue"
      wide={isWideDesktop}
      testID="entry-editor-footer"
    />
  );

  const stepIssue = issueFor(step.id);
  const leaveDialog = leaveOpen ? (
    <React.Suspense fallback={null}>
      <LazyConfirmDialog
        visible
        variant="leave"
        title="Save your changes?"
        description={`You changed ${step.label}. If you leave without saving, those changes are gone.`}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => {
          setLeaveOpen(false);
          onClose();
        }}
        onDiscard={() => {
          setLeaveOpen(false);
          onClose();
        }}
        onSave={async () => {
          setLeaveSaving(true);
          const ok = step.id === "review" ? false : await runSave(step.id);
          setLeaveSaving(false);
          if (ok) {
            setLeaveOpen(false);
            onClose();
          }
        }}
        saveDisabled={stepIssue !== null || step.id === "review"}
        confirmLoading={leaveSaving}
        errorMessage={
          stepIssue !== null
            ? "These changes can't be saved yet. Keep editing to fix them."
            : error !== null
              ? error.text
              : null
        }
        saveTestID="entry-editor-leave-save"
        discardTestID="entry-editor-leave-discard"
        keepTestID="entry-editor-leave-keep"
        testID="entry-editor-leave-dialog"
      />
    </React.Suspense>
  ) : null;

  if (railLayout) {
    return (
      <View style={styles.wideHost} testID="entry-editor">
        {leaveDialog}
        {header}
        <View style={styles.wideBody}>
          <View style={styles.rail}>
            <Stepper
              steps={steps}
              currentIndex={stepIndex}
              layout="list"
              furthestValidIndex={furthest}
              onStepPress={(i) => {
                if (i <= furthest && !saving) void navigateToStep(i);
              }}
              testID="entry-editor-steps"
            />
          </View>
          <ScrollView ref={scrollRef} style={styles.wideScroll} contentContainerStyle={styles.wideScrollContent} keyboardShouldPersistTaps="handled" testID="entry-editor-scroll">
            {form}
          </ScrollView>
          {showPreview ? preview : null}
        </View>
        {footer}
      </View>
    );
  }
  return (
    <View style={styles.phoneHost} testID="entry-editor">
      {leaveDialog}
      {header}
      <Stepper
        steps={steps}
        currentIndex={stepIndex}
        layout="chips"
        furthestValidIndex={furthest}
        onStepPress={(i) => {
          if (i <= furthest && !saving) void navigateToStep(i);
        }}
        sheetTitle="Steps"
        testID="entry-editor-steps"
      />
      <ScrollView ref={scrollRef} style={styles.phoneScroll} contentContainerStyle={styles.phoneScrollContent} keyboardShouldPersistTaps="handled" testID="entry-editor-scroll">
        {form}
      </ScrollView>
      {footer}
    </View>
  );
});

function stepSummary(id: EntryStepId, draft: EntryDraft, currency: string | null): string | undefined {
  if (id === "basics") return draft.name.trim().length > 0 ? `${entryStyleLabel(draft.style)}` : undefined;
  if (id === "prices") {
    const n = draft.options.length;
    if (n === 0) return undefined;
    const first = draft.options[0];
    return n === 1 ? (first.free ? "Free" : first.priceMinor !== null ? money(first.priceMinor, currency) : "1 price") : `${n} prices`;
  }
  if (id === "capacity") return draft.dailyLimit > 0 ? `${draft.dailyLimit.toLocaleString("en-GB")} a day` : undefined;
  if (id === "rules") return REFUND_PRESETS.find((p) => p.key === draft.refundPreset)?.label ?? undefined;
  return undefined;
}

// =================================================================== steps

interface StepProps {
  draft: EntryDraft;
  patch: (next: Partial<EntryDraft>) => void;
  showErrors: boolean;
  disabled: boolean;
}

function StepHead({ title, sub }: { title: string; sub?: string }): React.ReactElement {
  return (
    <View style={styles.stepHead}>
      <Text style={styles.stepTitle} accessibilityRole="header">{title}</Text>
      {sub !== undefined ? <Text style={styles.stepSub}>{sub}</Text> : null}
    </View>
  );
}

function BasicsStep({ draft, patch, showErrors, disabled }: StepProps): React.ReactElement {
  return (
    <View style={styles.stepBody} testID="entry-step-basics">
      <StepHead title="Basics" sub="What guests buy to get in." />
      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <Input
          value={draft.name}
          onChangeText={(name) => patch({ name: name.slice(0, 120) })}
          placeholder="e.g. Entry, Day pass, Open play"
          accessibilityLabel="Offer name"
          disabled={disabled}
          error={showErrors && draft.name.trim().length === 0 ? "Name this offer" : null}
          testID="entry-name"
        />
      </View>
      {/* #4490 fix 2 (N80) — the one line guests read under the name. */}
      <View style={styles.field}>
        <Text style={styles.label}>One line for guests (optional)</Text>
        <Input
          value={draft.summary}
          onChangeText={(summary) => patch({ summary: summary.slice(0, 140) })}
          placeholder="e.g. All-day play for kids under 12, socks on"
          accessibilityLabel="One line for guests"
          disabled={disabled}
          testID="entry-summary"
        />
        <Text style={styles.hint}>Shown on your venue page under the name. {draft.summary.length}/140</Text>
      </View>
      <Text style={styles.label}>How it works</Text>
      <View style={styles.options}>
        {ENTRY_STYLES.map((s) => (
          <OptionCard
            key={s.key}
            label={s.label}
            helper={s.helper}
            selected={draft.style === s.key}
            onPress={() => patch({
              style: s.key,
              options: s.key === "timed_session"
                ? draft.options.map((option) => ({ ...option, multiDay: false }))
                : draft.options,
            })}
            disabled={disabled}
            testID={`entry-style-${s.key}`}
            style={COLUMN_OPTION_CARD}
          />
        ))}
      </View>
      {draft.style === "timed_session" ? (
        <Text style={styles.hint}>You set the session times and how many fit in each on Capacity.</Text>
      ) : null}
    </View>
  );
}

function PricesStep({
  draft,
  patch,
  showErrors,
  disabled,
  currency,
  vatText,
  onOpenSettings,
}: StepProps & { currency: string | null; vatText: string | null; onOpenSettings?: () => void }): React.ReactElement {
  return (
    <View style={styles.stepBody} testID="entry-step-prices">
      <StepHead title="Price options" sub="One for each kind of guest. You name them." />
      {draft.options.length === 0 ? (
        <Text style={[styles.hint, showErrors ? styles.error : null]}>Add at least one price option.</Text>
      ) : null}
      {draft.options.map((option, index) => (
        <PriceOptionCard
          key={option.key}
          index={index}
          option={option}
          currency={currency}
          dailyLimit={draft.dailyLimit}
          entryStyle={draft.style}
          showErrors={showErrors}
          canRemove={draft.options.length > 1}
          disabled={disabled}
          onChange={(next) => patch({ options: draft.options.map((o) => (o.key === option.key ? next : o)) })}
          onRemove={() => patch({ options: draft.options.filter((o) => o.key !== option.key) })}
        />
      ))}
      <View>
        <Button
          label="Add a price option"
          variant="secondary"
          size="md"
          leadingIcon="plus"
          onPress={() => patch({ options: [...draft.options, emptyOptionDraft()] })}
          disabled={disabled || draft.options.length >= 12}
          testID="entry-add-option"
        />
      </View>
      {vatText !== null ? (
        <View style={styles.noteRow}>
          <Text style={styles.hint}>{vatText}. VAT is set for the whole venue in Settings › Terms and tax.</Text>
          {onOpenSettings !== undefined ? (
            <Button label="Open Terms and tax" variant="secondary" size="md" onPress={onOpenSettings} testID="entry-open-terms" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function CapacityStep({ draft, patch, showErrors, disabled, sharedWith }: StepProps & { sharedWith: string[] }): React.ReactElement {
  const maxGuests = Math.max(0, ...draft.options.map((o) => o.guestMax));
  const issue = entryStepIssue("capacity", draft);
  const timed = draft.style === "timed_session";
  const starts = timed ? timedSessionStarts(draft) : [];
  const preview = timed ? timedSessionPreview(draft) : null;
  const dayTotal = timed ? timedDayTotal(draft) : draft.dailyLimit;
  const today = new Date().toISOString().slice(0, 10);
  // #4490 fix 2 (N82): a timed offer's day total is derived (sessions × guests
  // per session); it is shown, never asked.
  // A day pool shared with other Entry offers is never changed by itself:
  // then its limit stays a field of its own (it covers them too).
  const ownPool = sharedWith.length === 0;
  useEffect(() => {
    if (!timed || !ownPool || dayTotal === draft.dailyLimit) return;
    patch({ dailyLimit: dayTotal, keptForWalkIns: Math.min(draft.keptForWalkIns, dayTotal) });
  }, [timed, ownPool, dayTotal, draft.dailyLimit, draft.keptForWalkIns, patch]);

  return (
    <View style={styles.stepBody} testID="entry-step-capacity">
      <StepHead title="Capacity" sub="When it's on sale and how many can come." />

      <Text style={styles.sectionLabel}>When it&apos;s on sale</Text>
      <WeekdayChips
        label="Days"
        value={draft.scheduleWeekdays}
        onChange={(scheduleWeekdays) => patch({ scheduleWeekdays })}
        disabled={disabled}
        showSummary
        testID="entry-schedule-days"
      />
      <View style={styles.inlineRow}>
        <View style={styles.grow}>
          <TimeField
            label={timed ? "First session starts" : "Opens"}
            value={draft.startTime}
            onChangeValue={(startTime) => patch({ startTime })}
            accessibilityLabel={timed ? "First session starts" : "Entry opens"}
            disabled={disabled}
            hasError={showErrors && !/^\d{2}:\d{2}$/.test(draft.startTime)}
            testID="entry-opens"
          />
        </View>
        <View style={styles.grow}>
          <TimeField
            label={timed ? "Last session ends by" : "Closes"}
            value={draft.endTime}
            onChangeValue={(endTime) => patch({ endTime })}
            accessibilityLabel={timed ? "Last session ends by" : "Entry closes"}
            disabled={disabled}
            hasError={showErrors && !/^\d{2}:\d{2}$/.test(draft.endTime)}
            testID="entry-closes"
          />
        </View>
      </View>
      {draft.endTime !== "" && draft.startTime !== "" && draft.endTime <= draft.startTime ? (
        <Text style={styles.hint}>{timed ? "The last session ends the next day." : "Closes the next day."}</Text>
      ) : null}
      {timed ? (
        <View style={styles.subCard} testID="entry-sessions-group">
          <Text style={styles.switchTitle}>Sessions</Text>
          <Text style={styles.hint}>
            How long one group stays, and how often a new group can start. Starting every 30 minutes with 1-hour sessions
            means two groups are in at once.
          </Text>
          <View style={styles.inlineRow}>
            <View style={styles.grow}>
              <DurationSelect
                label="Each session lasts"
                value={draft.sessionMinutes}
                onChange={(sessionMinutes) => patch({ sessionMinutes })}
                min={15}
                max={720}
                disabled={disabled}
                testID="entry-session-length"
              />
            </View>
            <View style={styles.grow}>
              <DurationSelect
                label="A new one starts every"
                value={draft.sessionEveryMinutes}
                onChange={(sessionEveryMinutes) => patch({ sessionEveryMinutes })}
                min={15}
                max={720}
                disabled={disabled}
                testID="entry-session-every"
              />
            </View>
          </View>
          <Text style={styles.previewLine} testID="entry-session-preview" accessibilityLiveRegion="polite">
            {preview ?? "No session fits between the first start and the last end. Move the times or shorten the session."}
          </Text>
        </View>
      ) : null}

      <View style={styles.field}>
        <DayDateField
          label="Runs until (optional)"
          value={draft.endDate}
          onChangeValue={(endDate) => patch({ endDate })}
          accessibilityLabel="Runs until"
          min={today}
          today={today}
          placeholder="No end date"
          error={showErrors && draft.endDate !== "" && draft.endDate < today ? "Pick today or a later day" : null}
          disabled={disabled}
          testID="entry-runs-until"
        />
        <View style={styles.inlineRow}>
          <Text style={[styles.hint, styles.grow]}>
            {draft.endDate === "" ? "On sale with no end date." : "Not on sale after this day."}
          </Text>
          {draft.endDate !== "" ? (
            <Button label="No end date" variant="ghost" size="sm" onPress={() => patch({ endDate: "" })} disabled={disabled} testID="entry-runs-until-clear" />
          ) : null}
        </View>
      </View>

      <Text style={styles.sectionLabel}>How many</Text>
      {timed ? (
        <>
          <NumberStepper
            label="Guests per session"
            value={draft.sessionCapacity}
            min={1}
            max={100000}
            onChange={(sessionCapacity) => patch({ sessionCapacity })}
            testID="entry-session-capacity"
          />
          <Text style={styles.hint} testID="entry-day-total">
            {starts.length > 0
              ? `Up to ${dayTotal.toLocaleString("en-GB")} guests a day (${starts.length} ${starts.length === 1 ? "session" : "sessions"} × ${draft.sessionCapacity}).`
              : "Set the session times to see the day's total."}
          </Text>
          {!ownPool ? (
            <>
              <NumberStepper
                label="Guests per day, all Entry together"
                value={draft.dailyLimit}
                min={0}
                max={100000}
                onChange={(dailyLimit) => patch({ dailyLimit, keptForWalkIns: Math.min(draft.keptForWalkIns, dailyLimit) })}
                testID="entry-daily-limit"
              />
              <Text style={styles.hint}>{`Shared with ${sharedWith.join(", ")}: changing it changes theirs too.`}</Text>
            </>
          ) : null}
        </>
      ) : (
        <>
          <NumberStepper
            label="Guests per day"
            value={draft.dailyLimit}
            min={0}
            max={100000}
            onChange={(dailyLimit) =>
              patch({ dailyLimit, keptForWalkIns: Math.min(draft.keptForWalkIns, dailyLimit) })
            }
            testID="entry-daily-limit"
          />
          <Text style={styles.hint}>
            Counts every Entry price together.
            {sharedWith.length > 0 ? ` Shared with ${sharedWith.join(", ")}: changing it changes theirs too.` : ""}
          </Text>
        </>
      )}
      <NumberStepper
        label="Kept for walk-ins"
        value={draft.keptForWalkIns}
        min={0}
        max={Math.max(0, draft.dailyLimit)}
        onChange={(keptForWalkIns) => patch({ keptForWalkIns })}
        testID="entry-kept-walk-ins"
      />
      <Text style={styles.hint}>Only sold at the gate, so online sales never lock out walk-ups.</Text>
      {showErrors && maxGuests > draft.dailyLimit && draft.dailyLimit > 0 ? (
        <Text style={styles.error}>A price allows {maxGuests} guests on one booking. Raise the day limit or lower that price&apos;s most guests.</Text>
      ) : null}
      {showErrors && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
    </View>
  );
}

function RulesStep({ draft, patch, showErrors, disabled }: StepProps): React.ReactElement {
  const issue = entryStepIssue("rules", draft);
  return (
    <View style={styles.stepBody} testID="entry-step-rules">
      <StepHead title="Rules" sub="What happens if guests can't come." />
      <Text style={styles.label}>Refunds</Text>
      <View style={styles.options}>
        {REFUND_PRESETS.map((p) => (
          <OptionCard
            key={p.key}
            label={p.label}
            helper={p.helper}
            selected={draft.refundPreset === p.key}
            onPress={() => patch({ refundPreset: p.key })}
            disabled={disabled}
            testID={`entry-refund-${p.key}`}
            style={COLUMN_OPTION_CARD}
          />
        ))}
      </View>
      {draft.refundPreset === "custom" ? (
        <View style={styles.subCard}>
          {draft.customLadder.map((rung, i) => (
            <View key={`rung-${i}`} style={styles.rungRow}>
              <NumberStepperPair>
                <NumberStepper
                  label="Hours before it starts"
                  value={Math.round(rung.minMinutesBefore / 60)}
                  min={0}
                  max={720}
                  onChange={(h) =>
                    patch({
                      customLadder: draft.customLadder.map((r, j) => (j === i ? { ...r, minMinutesBefore: h * 60 } : r)),
                    })
                  }
                  testID={`entry-rung-${i}-hours`}
                />
                <NumberStepper
                  label="% they get back"
                  value={Math.round(rung.refundBps / 100)}
                  min={0}
                  max={100}
                  onChange={(pct) =>
                    patch({ customLadder: draft.customLadder.map((r, j) => (j === i ? { ...r, refundBps: pct * 100 } : r)) })
                  }
                  testID={`entry-rung-${i}-pct`}
                />
              </NumberStepperPair>
              {draft.customLadder.length > 1 ? (
                <Button
                  style={styles.rungRemove}
                  label="Remove"
                  variant="ghost"
                  size="sm"
                  onPress={() => patch({ customLadder: draft.customLadder.filter((_, j) => j !== i) })}
                  disabled={disabled}
                />
              ) : null}
            </View>
          ))}
          {draft.customLadder.length < 4 ? (
            <View>
              <Button
                label="Add a rule"
                variant="ghost"
                size="sm"
                leadingIcon="plus"
                onPress={() => patch({ customLadder: [...draft.customLadder, { minMinutesBefore: 0, refundBps: 5000 }] })}
                disabled={disabled}
              />
            </View>
          ) : null}
          <Text style={styles.hint}>{refundSummary(ladderForDraft(draft))}</Text>
        </View>
      ) : null}
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>Guests can move to another day</Text>
          <Text style={styles.hint}>Once, free of charge, if there&apos;s room that day.</Text>
        </View>
        <BrandSwitch
          value={draft.dateChange}
          onValueChange={(dateChange) => patch({ dateChange })}
          disabled={disabled}
          accessibilityLabel="Guests can move to another day"
          testID="entry-date-change"
        />
      </View>
      {draft.dateChange ? (
        <SelectSheet
          label="Up to"
          value={draft.dateChangeCutoffMinutes}
          options={DATE_CHANGE_CUTOFFS}
          onChange={(dateChangeCutoffMinutes) => patch({ dateChangeCutoffMinutes })}
          disabled={disabled}
          testID="entry-date-change-cutoff"
        />
      ) : null}
      {showErrors && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
    </View>
  );
}

function ReviewStep({
  draft,
  offer,
  currency,
  vatText,
  onGoTo,
  onOpenSettings,
  paymentsOff = false,
  onOpenPayments,
}: {
  draft: EntryDraft;
  offer: VenueOffer | null;
  currency: string | null;
  vatText: string | null;
  onGoTo: (id: EntryStepId) => void;
  onOpenSettings?: () => void;
  paymentsOff?: boolean;
  onOpenPayments?: () => void;
}): React.ReactElement {
  const reasons = offer?.readiness ?? [];
  const items = [
    // #4490 fix 2 (N77): each price says which ID, its own hours and the
    // most guests on one booking.
    ...draft.options.map((o, i) => ({
      key: o.key,
      label: optionNameOrDefault(o.name, i),
      value: [
        o.free ? "Free" : o.priceMinor === null ? "—" : money(o.priceMinor, currency),
        weekdaysSummary(o.weekdays),
        ...(o.limitHours ? [timeRangeLabel(o.startTime, o.endTime) ?? ""] : []),
        `up to ${o.guestMax} on one booking`,
        ...(o.idCheck ? [`${o.idLabel.trim() || "ID"} checked at the gate`] : []),
        ...(o.multiDay ? [multiDayPassSummary(o.passDays, o.passWindowDays)] : []),
        ...(o.busyRules.length > 0 ? [`${o.busyRules.length} busy-time ${o.busyRules.length === 1 ? "price" : "prices"}`] : []),
      ]
        .filter((x) => x.length > 0)
        .join(" · "),
    })),
    {
      key: "limit",
      label: draft.style === "timed_session" ? "Guests" : "Guests per day",
      value:
        draft.style === "timed_session"
          ? `${draft.sessionCapacity.toLocaleString("en-GB")} per session · up to ${draft.dailyLimit.toLocaleString("en-GB")} a day · ${draft.keptForWalkIns.toLocaleString("en-GB")} kept for walk-ins`
          : `${draft.dailyLimit.toLocaleString("en-GB")} · ${draft.keptForWalkIns.toLocaleString("en-GB")} kept for walk-ins`,
    },
    {
      key: "when",
      label: "On sale",
      // #4490 N58: the days it really sells: the on-sale days that at least one
      // price is sold on (a Mon–Fri price on an every-day schedule reads Mon to Fri).
      value: `${weekdaysSummary(
        draft.scheduleWeekdays.filter((d) =>
          draft.options.some((o) => o.weekdays.length === 0 || o.weekdays.includes(d)),
        ),
      )} · ${timeRangeLabel(draft.startTime, draft.endTime) ?? ""}${
        draft.style === "timed_session" ? ` · ${timedSessionPreview(draft) ?? "no session fits"}` : ""
      }${draft.endDate !== "" ? ` · until ${draft.endDate.slice(8, 10)}/${draft.endDate.slice(5, 7)}/${draft.endDate.slice(0, 4)}` : ""}`,
    },
    { key: "sold", label: "Sold", value: draft.keptForWalkIns > 0 ? "Online and at the gate" : "Online" },
    { key: "refunds", label: "Refunds", value: refundSummary(ladderForDraft(draft)) },
    { key: "move", label: "Changing day", value: dateChangeSummary(dateChangeForDraft(draft)) },
    ...(vatText !== null ? [{ key: "vat", label: "VAT", value: vatText }] : []),
  ];
  return (
    <View style={styles.stepBody} testID="entry-step-review">
      <StepHead title="Review" />
      {offer?.status === "live" ? (
        <Banner tone="ok" title="Live" body="Guests can buy this now. Changes you saved are already live." />
      ) : reasons.length === 0 ? (
        <Banner
          tone="ok"
          title="Ready to publish"
          body="Guests can buy entry on your venue page and in the Explorer app."
          testID="entry-review-ready"
        />
      ) : (
        <View style={styles.readiness} testID="entry-review-not-ready">
          <Banner tone="warning" title="Not ready to publish yet" body="Finish these first:" />
          {reasons.map((r) => {
            const line = readinessLine(r);
            return (
              <View key={r} style={styles.readinessRow}>
                <Text style={[styles.hint, styles.grow]}>{line.text}</Text>
                {line.step !== null ? (
                  <Button
                    label={`Go to ${ENTRY_STEPS.find((s) => s.id === line.step)?.label ?? "step"}`}
                    variant="secondary"
                    size="sm"
                    onPress={() => onGoTo(line.step as EntryStepId)}
                  />
                ) : r === "feature_off" && onOpenSettings !== undefined ? (
                  <Button label="Open Settings" variant="secondary" size="md" onPress={onOpenSettings} />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {paymentsOff ? (
        <Banner
          tone="warning"
          title="Online payments aren't set up"
          body="Guests can't pay online until your brand's payments are set up. You can still publish; guests see entry as sold at the gate only."
          action={onOpenPayments !== undefined ? { label: "Set up payments", onPress: onOpenPayments, testID: "entry-review-payments" } : undefined}
          testID="entry-review-payments-off"
        />
      ) : null}
      <View style={styles.reviewList} testID="entry-review-summary">
        {items.map((item) => (
          <View key={item.key} style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>{item.label}</Text>
            <Text style={styles.reviewValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[3], padding: space[4] },
  wideHost: { flex: 1, minHeight: 0 },
  wideBody: { flex: 1, minHeight: 0, flexDirection: "row", gap: space[5], paddingHorizontal: space[4] },
  rail: { width: DESKTOP_WIZARD_RAIL_WIDTH, paddingTop: space[2] },
  wideScroll: { flex: 1, minWidth: 0 },
  wideScrollContent: { paddingBottom: space[10], maxWidth: DESKTOP_WIZARD_FORM_MAX_WIDTH, width: "100%" },
  phoneHost: { flex: 1, minHeight: 0, gap: space[2] },
  phoneScroll: { flex: 1 },
  phoneScrollContent: { paddingHorizontal: space[4], paddingBottom: space[10] },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[2],
    flexWrap: "wrap",
  },
  titleText: { flex: 1, minWidth: 200, gap: 2 },
  titleActions: { flexDirection: "row", alignItems: "center", gap: space[2] },
  eyebrow: { ...type.label, color: color.text3 },
  title: { ...type.h1, color: color.text1 },
  saved: { ...type.caption, color: color.text3 },
  form: { gap: space[4], paddingTop: space[2] },
  stepBody: { gap: space[3] },
  stepHead: { gap: space[1], marginBottom: space[1] },
  stepTitle: { ...type.h2, color: color.text1 },
  stepSub: { ...type.small, color: color.text2 },
  field: { gap: space[1] },
  label: { ...type.small, color: color.text2 },
  sectionLabel: { ...type.label, color: color.text3, marginTop: space[2] },
  hint: { ...type.caption, color: color.text3 },
  previewLine: { ...type.small, color: color.text1, fontWeight: "600" },
  error: { ...type.caption, color: color.errorText },
  options: { gap: space[2] },
  inlineRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 140 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2] },
  switchTitle: { ...type.row, color: color.text1 },
  subCard: { gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  rungRow: { gap: space[1] },
  rungRemove: { alignSelf: "flex-end" },
  noteRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  readiness: { gap: space[2] },
  reviewList: { gap: space[2] },
  reviewRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap" },
  reviewLabel: { ...type.small, color: color.text2, width: 140 },
  reviewValue: { ...type.small, color: color.text1, fontWeight: "600", flex: 1, minWidth: 180 },
  readinessRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  preview: { width: 300, gap: space[2], paddingTop: space[2] },
  previewLabel: { ...type.label, color: color.text3 },
  previewCard: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  previewTitle: { ...type.h2, color: color.text1 },
  previewRow: { flexDirection: "row", gap: space[2], alignItems: "flex-start" },
  previewName: { ...type.row, color: color.text1 },
  previewPrice: { ...type.row, color: color.text1 },
});
