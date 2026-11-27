/**
 * #4490 P4-2 — the Private hire editor (`ed-hire-times`, `ed-hire`,
 * `ed-hire-terms`, `ed-hire-book`) in the offer wizard frame the Entry and
 * Group package editors use.
 *
 * Steps: Spaces · Times · Price · Extras · Deposit and terms · How guests
 * book · Review. Continue saves the step (a draft until Publish). Every write
 * carries the version the host last saw; "someone else saved first" offers a
 * reload. Refusals are plain words, never codes.
 *
 * A hire takes a whole space or a named combination for a session, with
 * setup time before and cleanup time after. Each price row is one place and
 * one group size; its largest group can't be more than the place holds. New
 * hires default to Request first (the venue answers before anything is held).
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { DESKTOP_WIZARD_FORM_MAX_WIDTH, DESKTOP_WIZARD_RAIL_WIDTH } from "../../../../constants/desktopLayout";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { venueFeatureKeys } from "../../../../hooks/venueFeatureKeys";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import { useVenueSpaceCombinations, useVenueSpaces } from "../../../../hooks/useVenueSpaces";
import {
  manageVenueHire,
  manageVenuePackage,
  manageVenueOffer,
  policyPayload,
  toVenueOfferError,
  VenueOfferError,
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
import { Chip, Segmented } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Skeleton } from "../../../ui/Skeleton";
import { Stepper, StepperFooter, type StepperStep } from "../../../ui/Stepper";
import { TimeField } from "../../../ui/TimeField";
import { useScrollToTopOnChange } from "../../../ui/useScrollToTopOnChange";
import { WeekdayChips } from "../../../ui/WeekdayChips";
import { revealFocusedFieldWithin } from "../../offers/revealFocusedField";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import {
  ADVANCE_OPTIONS,
  BUFFER_OPTIONS,
  HIRE_BALANCE_DUE,
  HIRE_CHARGES,
  HIRE_REFUND_PRESETS,
  HIRE_STEPS,
  NOTICE_OPTIONS,
  PAY_WINDOWS,
  REPLY_WINDOWS,
  SESSION_PRESETS,
  bookingPayload,
  chosenPlaces,
  emptyHireRow,
  hireDepositLine,
  hireDraftFrom,
  hireErrorCopy,
  hireLadder,
  hirePlaces,
  hirePriceLine,
  hireReadinessLine,
  hireReviewItems,
  hireStepIssue,
  modeLine,
  parsePlaceKey,
  rowIssues,
  rowPayload,
  sessionFromPreset,
  sessionIssue,
  sessionsPayload,
  hireChangeRulesPayload,
  FLEX_MAX_OPTIONS,
  FLEX_MIN_OPTIONS,
  FLEX_STEP_OPTIONS,
  flexIssue,
  flexOpenMinutes,
  flexPayload,
  minutesWords,
  sameFlex,
  spacesPayload,
  layoutsPayload,
  termsPayload,
  type HireDraft,
  type HirePlace,
  type HireStepId,
} from "./hireModel";
import { draftKey, offerErrorCopy, refundSummary, vatLine } from "./offersModel";
import { weekdaysSummary } from "../../../ui/fieldModels";
import { useBrandHours } from "../../../../hooks/useBrandHours";
import { openingHoursDefault } from "../hoursModel";
import { CHANGE_CUTOFFS, ONLINE_PAYMENTS_OFF, extrasPayload } from "./packageModel";
import { ExtrasEditor } from "./ExtrasEditor";
import { VENUE_LAYOUTS } from "@mingla/brand-rendering/venueOffers/layoutModel";
import { writeVenueOfferToCache } from "./venueOfferCache";

const RAIL_MIN_WIDTH = 1280;
const COLUMN_OPTION_CARD = { flexBasis: "auto" as const, flexGrow: 0 };
const MAX_ROWS = 24;
const MAX_SESSIONS = 6;

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorText(code: string, detail: string | null): string {
  return hireErrorCopy(code, detail) ?? offerErrorCopy(code, detail);
}

export interface HireEditorProps {
  brandId: string | null;
  venueId: string | null;
  venueName: string;
  /** null = a new private hire offer. */
  offerId: string | null;
  onClose: (result?: { published: boolean; name: string }) => void;
  /** Settings (Terms and tax, features). */
  onOpenSettings?: () => void;
  /** The venue's Spaces (to add a space or switch on "Can be hired"). */
  onOpenSpaces?: () => void;
  /** Brand payments setup (shown when the brand can't take payments online). */
  onOpenPayments?: () => void;
  /** [TRANSITIONAL] blocked on #4514 — shared offer-form attach row; exits when #4514 ships it. */
  questionsSource?: React.ReactNode;
}

export const HireEditor = forwardRef<VenueModuleLeaveHandle, HireEditorProps>(function HireEditor(
  { brandId, venueId, venueName, offerId, onClose, onOpenSettings, onOpenSpaces, onOpenPayments, questionsSource },
  ref,
): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const { width } = useWindowDimensions();
  const railLayout = isWideDesktop && width >= RAIL_MIN_WIDTH;
  const queryClient = useQueryClient();
  const currency = useBrandCurrency(brandId);
  const offersQuery = useVenueOffers(brandId, venueId);
  const spacesQuery = useVenueSpaces(brandId, venueId);
  const combosQuery = useVenueSpaceCombinations(brandId, venueId);

  const [currentOfferId, setCurrentOfferId] = useState<string | null>(offerId);
  const [savedOffer, setSavedOffer] = useState<VenueOffer | null>(null);
  const [draft, setDraft] = useState<HireDraft | null>(null);
  const [base, setBase] = useState<HireDraft | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const scrollRef = useScrollToTopOnChange(stepIndex);
  const [furthest, setFurthest] = useState(offerId === null ? 0 : HIRE_STEPS.length - 1);
  const [showErrors, setShowErrors] = useState<Partial<Record<HireStepId, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; stale: boolean; reasons: string[] } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);

  const state = offersQuery.data;
  const listOffer = state?.offers.find((o) => o.id === currentOfferId) ?? null;
  const offer = savedOffer !== null && savedOffer.id === currentOfferId ? savedOffer : listOffer;
  const canCollectOnline = offer?.canCollectOnline ?? state?.canCollectOnline ?? true;
  const places = useMemo(
    () => hirePlaces(spacesQuery.data ?? [], combosQuery.data ?? []),
    [spacesQuery.data, combosQuery.data],
  );
  const settings = state?.settings ?? null;

  // #4490 N66: a new hire's first session and days follow the venue's
  // opening hours (an event space open 10:00–17:00 starts there, not 12:00–00:00).
  const hoursQuery = useBrandHours(brandId, venueId);
  useEffect(() => {
    if (draft !== null || state === undefined) return;
    if (offerId !== null && listOffer === null) return;
    if (listOffer === null && hoursQuery.isLoading) return;
    const next = hireDraftFrom(listOffer);
    const opening = listOffer === null ? openingHoursDefault(hoursQuery.data) : null;
    if (opening !== null) {
      next.weekdays = opening.weekdays;
      next.sessions = [{ ...next.sessions[0], label: "Full day", startTime: opening.open, endTime: opening.close }];
    }
    setDraft(next);
    setBase(clone(next));
  }, [draft, hoursQuery.data, hoursQuery.isLoading, listOffer, offerId, state]);

  const step = HIRE_STEPS[stepIndex];
  const dirty = draft !== null && base !== null && JSON.stringify(draft) !== JSON.stringify(base);
  const issueFor = useCallback(
    (id: HireStepId): string | null => (draft === null ? null : hireStepIssue(id, draft, places)),
    [draft, places],
  );

  const patch = useCallback((next: Partial<HireDraft>): void => {
    setDraft((d) => (d === null ? d : { ...d, ...next }));
    setSavedNote(null);
  }, []);

  const refreshLists = useCallback((): void => {
    if (brandId === null || venueId === null) return;
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.offers(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.calendarAll(brandId, venueId) });
  }, [brandId, queryClient, venueId]);

  // ------------------------------------------------------------- saving
  const saveStep = useCallback(
    async (id: HireStepId): Promise<VenueOffer | null> => {
      if (draft === null || venueId === null) return null;
      let current = offer;
      if (id === "spaces") {
        const name = draft.name.trim();
        const summary = draft.summary.trim();
        if (current === null) {
          current = await manageVenueOffer({
            venueId,
            action: "create_draft",
            payload: { kind: "private_hire", name, summary },
          });
          setCurrentOfferId(current.id);
        } else if (current.name !== name || current.summary !== summary) {
          current = await manageVenueOffer({
            venueId,
            action: "update",
            payload: { offerId: current.id, name, summary },
            expectedVersion: current.version,
          });
        }
      }
      if (current === null) throw new VenueOfferError("offer_not_found");
      const id0 = current.id;
      const hire = current.hire;

      if (id === "spaces") {
        // Price rows on a place the host took away go first (the server refuses otherwise).
        const keep = new Set([...draft.spaceIds.map((s) => `s:${s}`), ...draft.combinationIds.map((c) => `c:${c}`)]);
        for (const row of hire?.rows ?? []) {
          const key = row.spaceId !== null ? `s:${row.spaceId}` : `c:${row.combinationId ?? ""}`;
          if (keep.has(key)) continue;
          current = await manageVenueOffer({
            venueId,
            action: "archive_price_option",
            payload: { offerId: id0, optionId: row.optionId },
            expectedVersion: current.version,
          });
        }
        const savedSpaces = [...(hire?.spaces ?? []).map((s) => s.id)].sort();
        const wantSpaces = new Set<string>(draft.spaceIds);
        for (const c of places.filter((p) => p.kind === "combination" && draft.combinationIds.includes(p.id))) {
          const combo = (combosQuery.data ?? []).find((x) => x.id === c.id);
          for (const part of combo?.spaceIds ?? []) wantSpaces.add(part);
        }
        const sameSpaces =
          JSON.stringify(savedSpaces) === JSON.stringify([...wantSpaces].sort()) &&
          JSON.stringify([...(hire?.combinations ?? []).map((c) => c.id)].sort()) === JSON.stringify([...draft.combinationIds].sort());
        if (!sameSpaces) {
          current = await manageVenueHire({ venueId, action: "set_spaces", payload: { offerId: id0, ...spacesPayload(draft) }, expectedVersion: current.version });
        }
        if (JSON.stringify(hire?.layouts ?? []) !== JSON.stringify(draft.layouts)) {
          current = await manageVenueHire({
            venueId,
            action: "set_layouts",
            payload: { offerId: id0, ...layoutsPayload(draft) },
            expectedVersion: current.version,
          });
        }
        setDraft((d) => (d === null ? d : { ...d, rows: d.rows.filter((r) => r.place === null || keep.has(r.place)) }));
      }

      if (id === "times") {
        const savedSessions = JSON.stringify(
          (hire?.sessions ?? []).map((s) => ({ label: s.label, startTime: s.startTime, endTime: s.endTime })).sort((a, b) => a.startTime.localeCompare(b.startTime) || a.label.localeCompare(b.label)),
        );
        const want = sessionsPayload(draft);
        const wantSessions = JSON.stringify(
          (want.sessions as Array<{ label: string; startTime: string; endTime: string }>)
            .slice()
            .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.label.localeCompare(b.label)),
        );
        const sameDays = JSON.stringify(hire?.sessions[0]?.weekdays ?? []) === JSON.stringify(want.weekdays);
        if (savedSessions !== wantSessions || !sameDays) {
          current = await manageVenueHire({ venueId, action: "set_sessions", payload: { offerId: id0, ...want }, expectedVersion: current.version });
        }
        if (!sameFlex(hire?.hoursYouSet ?? null, draft)) {
          current = await manageVenueHire({ venueId, action: "set_flexible", payload: { offerId: id0, ...flexPayload(draft) }, expectedVersion: current.version });
        }
        if ((hire?.setupMinutes ?? -1) !== draft.setupMinutes || (hire?.cleanupMinutes ?? -1) !== draft.cleanupMinutes) {
          current = await manageVenueHire({
            venueId,
            action: "set_terms",
            payload: { offerId: id0, setupMinutes: draft.setupMinutes, cleanupMinutes: draft.cleanupMinutes },
            expectedVersion: current.version,
          });
        }
        if ((current.minNoticeMinutes ?? 0) !== draft.minNoticeMinutes || (current.maxAdvanceDays ?? null) !== draft.maxAdvanceDays) {
          current = await manageVenueOffer({
            venueId,
            action: "update",
            payload: { offerId: id0, minNoticeMinutes: draft.minNoticeMinutes, maxAdvanceDays: draft.maxAdvanceDays },
            expectedVersion: current.version,
          });
        }
      }

      if (id === "price") {
        if ((hire?.charge ?? null) !== draft.charge) {
          current = await manageVenueHire({ venueId, action: "set_terms", payload: { offerId: id0, hireCharge: draft.charge }, expectedVersion: current.version });
        }
        const chosen = chosenPlaces(draft, places);
        const before = current.hire?.rows ?? [];
        const kept = new Set<string>();
        const ids: Record<string, string> = {};
        for (const [i, row] of draft.rows.entries()) {
          const payload = rowPayload(row, draft, chosen, i);
          const saved = row.optionId === null ? undefined : before.find((r) => r.optionId === row.optionId);
          const { spaceId, combinationId } = parsePlaceKey(row.place);
          const same =
            saved !== undefined &&
            saved.name === payload.name &&
            saved.spaceId === spaceId &&
            saved.combinationId === combinationId &&
            saved.unit === payload.unit &&
            saved.guestMin === row.guestMin &&
            saved.guestMax === row.guestMax &&
            saved.priceMinor === row.priceMinor &&
            JSON.stringify(saved.weekdays) === JSON.stringify(payload.weekdays);
          if (row.optionId !== null) kept.add(row.optionId);
          if (same) continue;
          const beforeIds = new Set((current.hire?.rows ?? []).map((r) => r.optionId));
          current = await manageVenueHire({ venueId, action: "set_price_row", payload: { offerId: id0, ...payload }, expectedVersion: current.version });
          if (row.optionId === null) {
            const fresh = (current.hire?.rows ?? []).find((r) => !beforeIds.has(r.optionId));
            if (fresh !== undefined) {
              ids[row.key] = fresh.optionId;
              kept.add(fresh.optionId);
            }
          }
        }
        for (const row of before) {
          if (kept.has(row.optionId)) continue;
          current = await manageVenueOffer({
            venueId,
            action: "archive_price_option",
            payload: { offerId: id0, optionId: row.optionId },
            expectedVersion: current.version,
          });
        }
        if (Object.keys(ids).length > 0) {
          setDraft((d) => (d === null ? d : { ...d, rows: d.rows.map((r) => (ids[r.key] !== undefined ? { ...r, optionId: ids[r.key] } : r)) }));
        }
      }

      if (id === "extras") {
        const wantExtra = draft.extraGuestOn ? draft.extraGuestMinor : null;
        const wantOvertime = draft.overtimeOn ? draft.overtimeMinorPerHour : null;
        if ((hire?.extraGuestMinor ?? null) !== wantExtra || (hire?.overtimeMinorPerHour ?? null) !== wantOvertime) {
          current = await manageVenueHire({
            venueId,
            action: "set_terms",
            payload: { offerId: id0, extraGuestMinor: wantExtra, overtimeMinorPerHour: wantOvertime },
            expectedVersion: current.version,
          });
        }
        const wanted = extrasPayload(draft);
        const saved = current.extras.map((extra) => ({
          id: extra.id,
          name: extra.name,
          priceMinor: extra.priceMinor,
          per: extra.per,
        }));
        if (JSON.stringify(wanted) !== JSON.stringify(saved)) {
          current = await manageVenueHire({
            venueId,
            action: "set_extras",
            payload: { offerId: id0, extras: wanted },
            expectedVersion: current.version,
          });
          const fresh = current;
          setDraft((value) =>
            value === null
              ? value
              : { ...value, extras: value.extras.map((extra, index) => ({ ...extra, id: fresh.extras[index]?.id ?? extra.id })) },
          );
        }
      }

      if (id === "terms") {
        const t = termsPayload(draft);
        const d = current.deposit;
        const sameTerms =
          d !== null &&
          d.kind === t.depositKind &&
          (t.depositKind === "none" || (d.value === t.depositValue && d.balanceDueDaysBefore === t.balanceDueDaysBefore)) &&
          (hire?.damageDepositMinor ?? 0) === (draft.damageDepositMinor ?? 0);
        if (!sameTerms) {
          current = await manageVenueHire({
            venueId,
            action: "set_terms",
            payload: {
              offerId: id0,
              depositKind: t.depositKind,
              ...(t.depositKind !== "none" ? { depositValue: t.depositValue, balanceDueDaysBefore: t.balanceDueDaysBefore } : {}),
              damageDepositMinor: t.damageDepositMinor,
            },
            expectedVersion: current.version,
          });
        }
        const ladder = hireLadder(draft);
        const policyChanged = current.policy === null || JSON.stringify(current.policy.refundLadder) !== JSON.stringify(ladder);
        if (policyChanged) {
          current = await manageVenueOffer({
            venueId,
            action: "set_policy",
            payload: { offerId: id0, ...policyPayload(ladder, null) },
            expectedVersion: current.version,
          });
        }
        // #4490 P4 follow-up: what guests may change online (after the policy: a new policy starts without rules).
        const rule = current.policy?.dateChangeRule ?? null;
        const want = hireChangeRulesPayload(draft);
        const sameRule =
          (rule?.allowedUntilMinutesBefore ?? null) === want.allowedUntilMinutesBefore &&
          (rule?.maxChanges ?? null) === want.maxChanges &&
          ((rule?.feeBps ?? null) === want.feeBps || (want.feeBps === null && (rule?.feeBps ?? 0) === 0)) &&
          (rule?.guestChangeUntilMinutesBefore ?? null) === want.guestChangeUntilMinutesBefore;
        if (!sameRule) {
          current = await manageVenuePackage({ venueId, action: "set_change_rules", payload: { offerId: id0, ...want }, expectedVersion: current.version });
        }
      }

      if (id === "book") {
        const h = current.hire;
        if (
          h === null ||
          h.bookingMode !== draft.mode ||
          h.requestResponseHours !== draft.requestResponseHours ||
          h.approvedPaymentMinutes !== draft.approvedPaymentMinutes
        ) {
          current = await manageVenueHire({ venueId, action: "set_booking", payload: { offerId: id0, ...bookingPayload(draft) }, expectedVersion: current.version });
        }
      }
      setSavedOffer(current);
      return current;
    },
    [combosQuery.data, draft, offer, places, venueId],
  );

  const runSave = useCallback(
    async (id: HireStepId): Promise<boolean> => {
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
          text: errorText(err.code, err.detail),
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

  const goTo = useCallback((index: number): void => {
    setError(null);
    setStepIndex(index);
    setFurthest((f) => Math.max(f, index));
  }, []);

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
        writeVenueOfferToCache(queryClient, brandId, venueId, published);
        refreshLists();
        onClose({ published: true, name: published.name });
      } catch (e) {
        const err = toVenueOfferError(e);
        setError({ text: errorText(err.code, err.detail), stale: err.code === "stale_write", reasons: err.reasons });
        refreshLists();
      } finally {
        setSaving(false);
      }
      return;
    }
    if (issueFor(step.id) !== null) {
      setShowErrors((s) => ({ ...s, [step.id]: true }));
      return;
    }
    const ok = await runSave(step.id);
    if (ok) goTo(stepIndex + 1);
  }, [brandId, draft, goTo, issueFor, offer, onClose, queryClient, refreshLists, runSave, step.id, stepIndex, venueId]);

  const handleReload = useCallback((): void => {
    setError(null);
    setSavedOffer(null);
    setDraft(null);
    setBase(null);
    void offersQuery.refetch();
  }, [offersQuery]);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useImperativeHandle(
    ref,
    (): VenueModuleLeaveHandle => ({
      isDirty: () => dirtyRef.current,
      changedLabels: () => [HIRE_STEPS[stepIndex]?.label ?? "Private hire"],
      isValid: () => issueFor(HIRE_STEPS[stepIndex]?.id ?? "spaces") === null && HIRE_STEPS[stepIndex]?.id !== "review",
      save: async () => {
        const ok = await runSave(HIRE_STEPS[stepIndex]?.id ?? "spaces");
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
  if ((offersQuery.isError && state === undefined) || (spacesQuery.isError && spacesQuery.data === undefined)) {
    return (
      <CenteredState title="Couldn't load this offer" body="Check your connection and try again." tone="error" testID="hire-editor-error">
        <Button
          label="Try again"
          variant="secondary"
          size="md"
          onPress={() => {
            void offersQuery.refetch();
            void spacesQuery.refetch();
            void combosQuery.refetch();
          }}
        />
        <Button label="Back to offers" variant="ghost" size="md" onPress={() => onClose()} />
      </CenteredState>
    );
  }
  if (draft === null || spacesQuery.data === undefined) {
    if (state !== undefined && offerId !== null && listOffer === null) {
      return (
        <CenteredState title="This offer was removed" body="It may have been archived by someone else." testID="hire-editor-missing">
          <Button label="Back to offers" variant="secondary" size="md" onPress={() => onClose()} />
        </CenteredState>
      );
    }
    return (
      <View style={styles.loading} testID="hire-editor-loading" accessibilityLabel="Loading private hire">
        <Skeleton height={28} width="40%" />
        <Skeleton height={120} radius="md" />
        <Skeleton height={120} radius="md" />
      </View>
    );
  }

  const chosen = chosenPlaces(draft, places);
  const steps: StepperStep[] = HIRE_STEPS.map((s, i) => {
    const issue = issueFor(s.id);
    const shown = showErrors[s.id] === true && issue !== null;
    const stepState: StepperStep["state"] =
      i === stepIndex ? (shown ? "error" : "current") : shown ? "error" : i < furthest || (i <= furthest && i < stepIndex) ? (issue === null ? "done" : "todo") : "todo";
    return {
      id: s.id,
      label: s.label,
      state: stepState,
      firstError: stepState === "error" && issue !== null ? issue : undefined,
      description:
        s.id === "spaces"
          ? chosen.length > 0
            ? `${chosen.length} ${chosen.length === 1 ? "space" : "spaces"}`
            : undefined
          : s.id === "price"
            ? hirePriceLine(draft, currency)
            : s.id === "book"
              ? draft.mode === "request"
                ? "Request first"
                : "Book instantly"
              : undefined,
    };
  });
  const stepErrors = showErrors[step.id] === true;
  const continueLabel = step.id === "review" ? (offer?.status === "live" ? "Done" : "Publish") : saving ? "Saving" : "Continue";
  const continueDisabled = saving || (stepErrors && issueFor(step.id) !== null) || (step.id === "review" && offer === null);

  const header = (
    <View style={styles.titleRow}>
      <View style={styles.titleText}>
        <Text style={styles.eyebrow}>{offer === null ? "New private hire" : offer.status === "live" ? "Live private hire" : "Draft private hire"}</Text>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {draft.name.trim().length > 0 ? draft.name.trim() : "Private hire"}
        </Text>
      </View>
      <View style={styles.titleActions}>
        {savedNote !== null && !dirty ? <Text style={styles.saved} accessibilityLiveRegion="polite">{savedNote}</Text> : null}
        {dirty ? <Text style={styles.saved}>Unsaved changes</Text> : null}
        <Button label="Close" variant="ghost" size="sm" leadingIcon="close" onPress={requestClose} testID="hire-editor-close" />
      </View>
    </View>
  );

  const firstReasonStep = error !== null && error.reasons.length > 0 ? hireReadinessLine(error.reasons[0]).step : null;
  const errorBanner =
    error !== null ? (
      <Banner
        tone="danger"
        title={error.reasons.length > 0 ? "Not ready to publish yet" : "Couldn't save"}
        body={error.reasons.length > 0 ? error.reasons.map((r) => hireReadinessLine(r).text).join(" ") : error.text}
        action={
          error.stale
            ? { label: "Reload", onPress: handleReload, testID: "hire-editor-reload" }
            : firstReasonStep !== null
              ? {
                  label: `Go to ${HIRE_STEPS.find((s) => s.id === firstReasonStep)?.label ?? "step"}`,
                  onPress: () => goTo(HIRE_STEPS.findIndex((s) => s.id === firstReasonStep)),
                }
              : undefined
        }
        testID="hire-editor-error-banner"
      />
    ) : null;

  const stepProps = { draft, patch, showErrors: stepErrors, disabled: saving, currency };
  const form = (
    <View style={styles.form} ref={revealFocusedFieldWithin}>
      {step.id === "spaces" ? <SpacesStep {...stepProps} places={places} onOpenSpaces={onOpenSpaces} /> : null}
      {step.id === "times" ? <TimesStep {...stepProps} /> : null}
      {step.id === "price" ? (
        <PriceStep
          {...stepProps}
          places={chosen}
          vatWords={settings !== null ? vatLine(settings.vatMode, settings.vatRateBps) : null}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
      {step.id === "extras" ? <ExtrasStep {...stepProps} /> : null}
      {step.id === "terms" ? <TermsStep {...stepProps} /> : null}
      {step.id === "book" ? <BookStep {...stepProps} venueName={venueName} questionsSource={questionsSource} /> : null}
      {step.id === "review" ? (
        <ReviewStep
          draft={draft}
          offer={offer}
          places={places}
          currency={currency}
          canCollectOnline={canCollectOnline}
          onGoTo={(id) => goTo(HIRE_STEPS.findIndex((s) => s.id === id))}
          onOpenSettings={onOpenSettings}
          onOpenPayments={onOpenPayments}
        />
      ) : null}
      {errorBanner}
    </View>
  );

  const footer = (
    <StepperFooter
      previousLabel={stepIndex > 0 ? HIRE_STEPS[stepIndex - 1].label : undefined}
      onBack={stepIndex > 0 ? () => goTo(stepIndex - 1) : undefined}
      backDisabled={saving}
      continueLabel={continueLabel}
      onContinue={() => void handleContinue()}
      continueDisabled={continueDisabled}
      continueLoading={saving}
      continueTestID="hire-editor-continue"
      wide={isWideDesktop}
      testID="hire-editor-footer"
    />
  );

  const stepIssue = issueFor(step.id);
  const overlays = leaveOpen ? (
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
        errorMessage={stepIssue !== null ? "These changes can't be saved yet. Keep editing to fix them." : error !== null ? error.text : null}
        saveTestID="hire-editor-leave-save"
        discardTestID="hire-editor-leave-discard"
        keepTestID="hire-editor-leave-keep"
        testID="hire-editor-leave-dialog"
      />
    </React.Suspense>
  ) : null;

  const stepper = (
    <Stepper
      steps={steps}
      currentIndex={stepIndex}
      layout={railLayout ? "list" : "chips"}
      furthestValidIndex={furthest}
      onStepPress={(i) => {
        if (i <= furthest && !saving) goTo(i);
      }}
      sheetTitle={railLayout ? undefined : "Steps"}
      testID="hire-editor-steps"
    />
  );

  if (railLayout) {
    return (
      <View style={styles.wideHost} testID="hire-editor">
        {overlays}
        {header}
        <View style={styles.wideBody}>
          <View style={styles.rail}>{stepper}</View>
          <ScrollView ref={scrollRef} style={styles.wideScroll} contentContainerStyle={styles.wideScrollContent} keyboardShouldPersistTaps="handled" testID="hire-editor-scroll">
            {form}
          </ScrollView>
        </View>
        {footer}
      </View>
    );
  }
  return (
    <View style={styles.phoneHost} testID="hire-editor">
      {overlays}
      {header}
      {stepper}
      <ScrollView ref={scrollRef} style={styles.phoneScroll} contentContainerStyle={styles.phoneScrollContent} keyboardShouldPersistTaps="handled" testID="hire-editor-scroll">
        {form}
      </ScrollView>
      {footer}
    </View>
  );
});

// =================================================================== steps

interface StepProps {
  draft: HireDraft;
  patch: (next: Partial<HireDraft>) => void;
  showErrors: boolean;
  disabled: boolean;
  currency: string | null;
}

function StepHead({ title, sub }: { title: string; sub?: string }): React.ReactElement {
  return (
    <View style={styles.stepHead}>
      <Text style={styles.stepTitle} accessibilityRole="header">{title}</Text>
      {sub !== undefined ? <Text style={styles.stepSub}>{sub}</Text> : null}
    </View>
  );
}

function SpacesStep({ draft, patch, showErrors, disabled, places, onOpenSpaces }: StepProps & { places: HirePlace[]; onOpenSpaces?: () => void }): React.ReactElement {
  const issue = hireStepIssue("spaces", draft, places);
  const chosen = chosenPlaces(draft, places);
  const toggle = (p: HirePlace): void => {
    if (p.kind === "space") {
      patch({ spaceIds: draft.spaceIds.includes(p.id) ? draft.spaceIds.filter((x) => x !== p.id) : [...draft.spaceIds, p.id] });
    } else {
      patch({
        combinationIds: draft.combinationIds.includes(p.id) ? draft.combinationIds.filter((x) => x !== p.id) : [...draft.combinationIds, p.id],
      });
    }
  };
  const spaces = places.filter((p) => p.kind === "space");
  const combos = places.filter((p) => p.kind === "combination");
  return (
    <View style={styles.stepBody} testID="hire-step-spaces">
      <StepHead title="Spaces" sub="Which spaces guests can hire, alone or together." />
      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <Input
          value={draft.name}
          onChangeText={(name) => patch({ name: name.slice(0, 120) })}
          placeholder="e.g. Private hire, Hire the venue"
          accessibilityLabel="Offer name"
          disabled={disabled}
          error={showErrors && draft.name.trim().length === 0 ? "Name this offer" : null}
          testID="hire-name"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>In one line</Text>
        <Input
          value={draft.summary}
          onChangeText={(summary) => patch({ summary: summary.slice(0, 300) })}
          placeholder="e.g. Weddings, birthdays and company days, with the space to yourselves"
          accessibilityLabel="Offer in one line"
          disabled={disabled}
          testID="hire-summary"
        />
        <Text style={styles.hint}>Guests see this under the name. {300 - draft.summary.length} characters left.</Text>
      </View>
      {places.length === 0 ? (
        <View style={styles.subCard} testID="hire-no-spaces">
          <Text style={styles.rowTitle}>Add your spaces first</Text>
          <Text style={styles.hint}>A hire takes a whole space. Add the rooms and areas of your venue, with how many each fits.</Text>
          {onOpenSpaces !== undefined ? (
            <View>
              <Button label="Open Spaces" variant="secondary" size="md" onPress={onOpenSpaces} testID="hire-open-spaces" />
            </View>
          ) : null}
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>Spaces</Text>
          <View style={styles.options}>
            {spaces.map((p) => (
              <OptionCard
                key={p.key}
                label={p.name}
                helper={p.hirable ? p.detail : `${p.detail} · Switch on “Can be hired” in Spaces first`}
                selected={draft.spaceIds.includes(p.id)}
                onPress={() => toggle(p)}
                disabled={disabled || (!p.hirable && !draft.spaceIds.includes(p.id))}
                testID={`hire-place-${p.id}`}
                multiple
                style={COLUMN_OPTION_CARD}
              />
            ))}
          </View>
          {combos.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Spaces together</Text>
              <View style={styles.options}>
                {combos.map((p) => (
                  <OptionCard
                    key={p.key}
                    label={p.name}
                    helper={p.hirable ? p.detail : `${p.detail} · every part must be “Can be hired”`}
                    selected={draft.combinationIds.includes(p.id)}
                    onPress={() => toggle(p)}
                    disabled={disabled || (!p.hirable && !draft.combinationIds.includes(p.id))}
                    testID={`hire-place-${p.id}`}
                    multiple
                    style={COLUMN_OPTION_CARD}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Text style={styles.hint}>
            A booking holds the whole space. Hiring spaces together blocks every space inside, and a hire of one part blocks the combination.
          </Text>
          <View style={styles.field} testID="hire-layouts">
            <Text style={styles.sectionLabel}>Layouts guests can pick</Text>
            <Text style={styles.hint}>Guests see these after they pick a space. Add capacities in Spaces first.</Text>
            <View style={styles.chips}>
              {VENUE_LAYOUTS.map((layout) => {
                const selected = draft.layouts.includes(layout.key);
                const supported = chosen.length > 0 && chosen.every((place) => place.layoutCapacities[layout.key] !== undefined);
                return (
                  <Chip
                    key={layout.key}
                    label={layout.label}
                    selected={selected}
                    disabled={disabled || (!supported && !selected)}
                    onPress={() => patch({ layouts: selected ? draft.layouts.filter((value) => value !== layout.key) : [...draft.layouts, layout.key] })}
                    testID={`hire-layout-${layout.key}`}
                  />
                );
              })}
            </View>
          </View>
          {onOpenSpaces !== undefined ? (
            <View>
              <Button label="Add or change spaces" variant="ghost" size="sm" leadingIcon="plus" onPress={onOpenSpaces} testID="hire-manage-spaces" />
            </View>
          ) : null}
        </>
      )}
      {showErrors && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
    </View>
  );
}

function TimesStep({ draft, patch, showErrors, disabled }: StepProps): React.ReactElement {
  const issue = hireStepIssue("times", draft, []);
  const presetsLeft = SESSION_PRESETS.filter((p) => !draft.sessions.some((s) => s.label.trim().toLowerCase() === p.label.toLowerCase()));
  return (
    <View style={styles.stepBody} testID="hire-step-times">
      <StepHead title="Times" sub="When a space can be hired." />
      {draft.sessions.map((s, i) => {
        const sIssue = showErrors ? sessionIssue(s, draft.sessions) : null;
        return (
          <View key={s.key} style={styles.subCard} testID={`hire-session-${i}`}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>Session {i + 1}</Text>
              {draft.sessions.length > 1 ? (
                <Button
                  label="Remove"
                  variant="ghost"
                  size="sm"
                  onPress={() => patch({ sessions: draft.sessions.filter((x) => x.key !== s.key) })}
                  disabled={disabled}
                  accessibilityLabel={`Remove ${s.label || `session ${i + 1}`}`}
                  testID={`hire-session-${i}-remove`}
                />
              ) : null}
            </View>
            <Input
              value={s.label}
              onChangeText={(label) => patch({ sessions: draft.sessions.map((x) => (x.key === s.key ? { ...x, label: label.slice(0, 40) } : x)) })}
              placeholder="e.g. Full day, Evening"
              accessibilityLabel={`Session ${i + 1} name`}
              disabled={disabled}
              testID={`hire-session-${i}-label`}
            />
            <View style={styles.inlineRow}>
              <View style={styles.grow}>
                <TimeField
                  label="Starts"
                  value={s.startTime}
                  onChangeValue={(startTime) => patch({ sessions: draft.sessions.map((x) => (x.key === s.key ? { ...x, startTime } : x)) })}
                  accessibilityLabel={`${s.label || "Session"} starts`}
                  disabled={disabled}
                  hasError={sIssue !== null && sIssue.includes("start")}
                  testID={`hire-session-${i}-start`}
                />
              </View>
              <View style={styles.grow}>
                <TimeField
                  label="Ends"
                  value={s.endTime}
                  onChangeValue={(endTime) => patch({ sessions: draft.sessions.map((x) => (x.key === s.key ? { ...x, endTime } : x)) })}
                  accessibilityLabel={`${s.label || "Session"} ends`}
                  disabled={disabled}
                  hasError={sIssue !== null && sIssue.includes("start")}
                  testID={`hire-session-${i}-end`}
                />
              </View>
            </View>
            {s.endTime <= s.startTime && s.endTime !== s.startTime ? (
              <Text style={styles.hint}>{s.endTime === "00:00" ? "Until midnight." : `Ends at ${s.endTime} the next day.`}</Text>
            ) : null}
            {sIssue !== null ? <Text style={styles.error}>{sIssue}</Text> : null}
          </View>
        );
      })}
      {draft.sessions.length < MAX_SESSIONS ? (
        <View style={styles.addRow}>
          {presetsLeft.map((p) => (
            <Button
              key={p.key}
              label={`Add ${p.label.toLowerCase()}`}
              variant="secondary"
              size="sm"
              leadingIcon="plus"
              onPress={() => patch({ sessions: [...draft.sessions, sessionFromPreset(p.key)] })}
              disabled={disabled}
              testID={`hire-add-session-${p.key}`}
            />
          ))}
          <Button
            label="Add your own"
            variant="ghost"
            size="sm"
            leadingIcon="plus"
            onPress={() => patch({ sessions: [...draft.sessions, { key: draftKey("session"), label: "", startTime: "10:00", endTime: "14:00" }] })}
            disabled={disabled}
            testID="hire-add-session-own"
          />
        </View>
      ) : null}
      <Banner tone="info" title="One booking per space, per session" body="A second request for the same space waits in line. A combined space blocks every space inside it." />
      <FlexCard draft={draft} patch={patch} showErrors={showErrors} disabled={disabled} />
      <WeekdayChips label="Days it can be hired" value={draft.weekdays} onChange={(weekdays) => patch({ weekdays })} disabled={disabled} showSummary testID="hire-days" />
      <View style={styles.inlineRow}>
        <View style={styles.grow}>
          <SelectSheet label="Setup time before" value={draft.setupMinutes} options={BUFFER_OPTIONS} onChange={(setupMinutes) => patch({ setupMinutes })} disabled={disabled} testID="hire-setup" />
        </View>
        <View style={styles.grow}>
          <SelectSheet label="Cleanup time after" value={draft.cleanupMinutes} options={BUFFER_OPTIONS} onChange={(cleanupMinutes) => patch({ cleanupMinutes })} disabled={disabled} testID="hire-cleanup" />
        </View>
      </View>
      <Text style={styles.hint}>Setup and cleanup block the space too, so nobody else books it then. Guests don&apos;t see these times.</Text>
      <View style={styles.inlineRow}>
        <View style={styles.grow}>
          <SelectSheet label="Book at least" value={draft.minNoticeMinutes} options={NOTICE_OPTIONS} onChange={(minNoticeMinutes) => patch({ minNoticeMinutes })} disabled={disabled} testID="hire-notice" />
        </View>
        <View style={styles.grow}>
          <SelectSheet label="Book up to" value={draft.maxAdvanceDays} options={ADVANCE_OPTIONS} onChange={(maxAdvanceDays) => patch({ maxAdvanceDays })} disabled={disabled} testID="hire-advance" />
        </View>
      </View>
      {showErrors && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
    </View>
  );
}

/** #4490 P4 follow-up: "Hours you set" — besides the sessions, guests pick a start and a length inside these hours. */
function FlexCard({ draft, patch, showErrors, disabled }: Omit<StepProps, "currency">): React.ReactElement {
  const issue = showErrors ? flexIssue(draft) : null;
  const open = flexOpenMinutes(draft.flexStart, draft.flexEnd);
  return (
    <View style={styles.subCard} testID="hire-flex">
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>Hours you set</Text>
          <Text style={styles.hint}>Guests can also pick their own start and length, inside these hours. Price these places per hour in the next step.</Text>
        </View>
        <BrandSwitch value={draft.flexOn} onValueChange={(flexOn) => patch({ flexOn })} disabled={disabled} accessibilityLabel="Hours you set" testID="hire-flex-toggle" />
      </View>
      {draft.flexOn ? (
        <>
          <View style={styles.inlineRow}>
            <View style={styles.grow}>
              <TimeField label="From" value={draft.flexStart} onChangeValue={(flexStart) => patch({ flexStart })} accessibilityLabel="Hours you set, from" disabled={disabled} hasError={issue !== null && draft.flexStart === draft.flexEnd} testID="hire-flex-start" />
            </View>
            <View style={styles.grow}>
              <TimeField label="Until" value={draft.flexEnd} onChangeValue={(flexEnd) => patch({ flexEnd })} accessibilityLabel="Hours you set, until" disabled={disabled} hasError={issue !== null && draft.flexStart === draft.flexEnd} testID="hire-flex-end" />
            </View>
          </View>
          {draft.flexStart !== draft.flexEnd ? (
            <Text style={styles.hint}>
              {minutesWords(open)} a day{draft.flexEnd < draft.flexStart && draft.flexEnd !== "00:00" ? `, until ${draft.flexEnd} the next day` : ""}. Same days as the sessions.
            </Text>
          ) : null}
          <View style={styles.inlineRow}>
            <View style={styles.grow}>
              <SelectSheet label="Shortest booking" value={draft.flexMinMinutes} options={FLEX_MIN_OPTIONS} onChange={(flexMinMinutes) => patch({ flexMinMinutes })} disabled={disabled} testID="hire-flex-min" />
            </View>
            <View style={styles.grow}>
              <SelectSheet label="Longest booking" value={draft.flexMaxMinutes} options={FLEX_MAX_OPTIONS} onChange={(flexMaxMinutes) => patch({ flexMaxMinutes })} disabled={disabled} testID="hire-flex-max" />
            </View>
          </View>
          <SelectSheet label="Start times" value={draft.flexStep} options={FLEX_STEP_OPTIONS} onChange={(flexStep) => patch({ flexStep })} disabled={disabled} testID="hire-flex-step" />
          {issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function PriceStep({
  draft,
  patch,
  showErrors,
  disabled,
  currency,
  places,
  vatWords,
  onOpenSettings,
}: StepProps & { places: HirePlace[]; vatWords: string | null; onOpenSettings?: () => void }): React.ReactElement {
  const issue = hireStepIssue("price", draft, places);
  const charge = HIRE_CHARGES.find((c) => c.key === draft.charge) ?? HIRE_CHARGES[0];
  const placeOptions = places.map((p) => ({ value: p.key, label: `${p.name} (fits ${p.capacity.toLocaleString("en-GB")})` }));
  const addWeekend = (): void => {
    const next = draft.rows.flatMap((r) => {
      if (r.weekdays.length > 0) return [r];
      return [
        { ...r, weekdays: [0, 1, 2, 3] },
        // #4490 N68: the weekend row starts with no price, so the weekday fee
        // is never carried over silently; the host types the weekend price.
        { ...r, key: draftKey("hire-row"), optionId: null, weekdays: [4, 5, 6], priceMinor: null },
      ];
    });
    patch({ rows: next.slice(0, MAX_ROWS) });
  };
  return (
    <View style={styles.stepBody} testID="hire-step-price">
      <StepHead title="Price" sub="One row per space and group size." />
      <Text style={styles.label}>Charge</Text>
      <Segmented
        options={HIRE_CHARGES.map((c) => ({ key: c.key, label: c.label }))}
        value={draft.charge}
        onChange={(chargeKey) => patch({ charge: chargeKey })}
        accessibilityLabel="How the hire is charged"
        testID="hire-charge"
      />
      <Text style={styles.hint}>{charge.helper}</Text>
      {places.length === 0 ? <Text style={styles.error}>Pick spaces in the Spaces step first.</Text> : null}
      {draft.rows.map((row, i) => {
        const place = places.find((p) => p.key === row.place) ?? null;
        const ri = rowIssues(row, places);
        const cap = place?.capacity ?? 100000;
        return (
          <View key={row.key} style={styles.subCard} testID={`hire-row-${i}`}>
            <View style={styles.rowHead}>
              <Text style={styles.rowTitle}>{place?.name ?? `Row ${i + 1}`}</Text>
              <Button
                label="Remove"
                variant="ghost"
                size="sm"
                onPress={() => patch({ rows: draft.rows.filter((r) => r.key !== row.key) })}
                disabled={disabled}
                accessibilityLabel={`Remove row ${i + 1}`}
                testID={`hire-row-${i}-remove`}
              />
            </View>
            <SelectSheet
              label="Space"
              value={row.place}
              options={placeOptions}
              onChange={(next) => {
                const p = places.find((x) => x.key === next);
                patch({
                  rows: draft.rows.map((r) =>
                    r.key === row.key
                      ? { ...r, place: next, guestMax: p !== undefined ? Math.min(Math.max(r.guestMax, r.guestMin), p.capacity) : r.guestMax, guestMin: p !== undefined ? Math.min(r.guestMin, p.capacity) : r.guestMin }
                      : r,
                  ),
                });
              }}
              placeholder="Pick a space"
              disabled={disabled}
              hasError={showErrors && ri.place !== null}
              testID={`hire-row-${i}-place`}
            />
            <NumberStepperPair>
              <NumberStepper
                label="Smallest group"
                value={row.guestMin}
                min={1}
                max={Math.max(1, cap)}
                // #4490 N8: a smallest group above the largest raises the largest
                // (it used to clamp the typed 250 down to 100 silently).
                onChange={(guestMin) =>
                  patch({ rows: draft.rows.map((r) => (r.key === row.key ? { ...r, guestMin, guestMax: Math.max(guestMin, r.guestMax) } : r)) })
                }
                testID={`hire-row-${i}-min`}
              />
              <NumberStepper
                label="Largest group"
                value={row.guestMax}
                min={Math.max(1, row.guestMin)}
                max={cap}
                onChange={(guestMax) => patch({ rows: draft.rows.map((r) => (r.key === row.key ? { ...r, guestMax } : r)) })}
                testID={`hire-row-${i}-max`}
              />
            </NumberStepperPair>
            {place !== null ? <Text style={styles.hint}>{place.name} holds {place.capacity.toLocaleString("en-GB")}.</Text> : null}
            {showErrors && ri.guests !== null ? <Text style={styles.error}>{ri.guests}</Text> : null}
            {draft.flexOn || row.perHour ? (
              <View style={styles.switchRow}>
                <View style={styles.grow}>
                  <Text style={styles.switchTitle}>Price per hour</Text>
                  <Text style={styles.hint}>The price times the hours booked (a session counts its own length).</Text>
                </View>
                <BrandSwitch
                  value={row.perHour}
                  onValueChange={(perHour) => patch({ rows: draft.rows.map((r) => (r.key === row.key ? { ...r, perHour } : r)) })}
                  disabled={disabled}
                  accessibilityLabel={`Row ${i + 1} priced per hour`}
                  testID={`hire-row-${i}-per-hour`}
                />
              </View>
            ) : null}
            <MoneyField
              label={`${row.perHour ? "Per hour" : charge.column}${row.weekdays.length > 0 && row.weekdays.length < 7 ? ` · ${weekdaysSummary(row.weekdays)}` : ""}`}
              valueMinor={row.priceMinor}
              onChangeMinor={(priceMinor) => patch({ rows: draft.rows.map((r) => (r.key === row.key ? { ...r, priceMinor } : r)) })}
              currency={currency}
              disabled={disabled}
              error={showErrors && ri.price !== null ? ri.price : null}
              testID={`hire-row-${i}-price`}
            />
            <View style={styles.switchRow}>
              <View style={styles.grow}>
                <Text style={styles.switchTitle}>Only on some days</Text>
                <Text style={styles.hint}>For a different price on weekends.</Text>
              </View>
              <BrandSwitch
                value={row.weekdays.length > 0}
                onValueChange={(on) => patch({ rows: draft.rows.map((r) => (r.key === row.key ? { ...r, weekdays: on ? [4, 5, 6] : [] } : r)) })}
                disabled={disabled}
                accessibilityLabel={`Row ${i + 1} only on some days`}
                testID={`hire-row-${i}-days-toggle`}
              />
            </View>
            {row.weekdays.length > 0 ? (
              <WeekdayChips
                value={row.weekdays}
                onChange={(weekdays) => patch({ rows: draft.rows.map((r) => (r.key === row.key ? { ...r, weekdays: weekdays.length === 0 ? r.weekdays : weekdays } : r)) })}
                disabled={disabled}
                showSummary
                testID={`hire-row-${i}-days`}
              />
            ) : null}
          </View>
        );
      })}
      <View style={styles.addRow}>
        <Button
          label="Add a row"
          variant="secondary"
          size="sm"
          leadingIcon="plus"
          onPress={() => {
            const unused = places.find((p) => !draft.rows.some((r) => r.place === p.key)) ?? places[0] ?? null;
            const row = emptyHireRow(unused?.key ?? null);
            patch({ rows: [...draft.rows, { ...row, guestMax: unused !== null ? Math.max(1, Math.min(unused.capacity, 100)) : 1 }] });
          }}
          disabled={disabled || draft.rows.length >= MAX_ROWS || places.length === 0}
          testID="hire-add-row"
        />
        {draft.rows.some((r) => r.weekdays.length === 0) ? (
          <Button label="Different price on weekends" variant="ghost" size="sm" leadingIcon="calendar" onPress={addWeekend} disabled={disabled} testID="hire-weekend-rows" />
        ) : null}
      </View>
      {vatWords !== null ? (
        <View style={styles.noteRow}>
          <Text style={[styles.hint, styles.grow]}>{vatWords}. VAT is set for the whole venue.</Text>
          {onOpenSettings !== undefined ? <Button label="Open Terms and tax" variant="secondary" size="sm" onPress={onOpenSettings} testID="hire-open-terms" /> : null}
        </View>
      ) : null}
      {showErrors && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
    </View>
  );
}

function ExtrasStep({ draft, patch, showErrors, disabled, currency }: StepProps): React.ReactElement {
  return (
    <View style={styles.stepBody} testID="hire-step-extras">
      <StepHead title="Extras" sub="What guests can add on top, priced up front." />
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>Guests above the range</Text>
          <Text style={styles.hint}>Let a group go above a row&apos;s largest size, up to what the space holds.</Text>
        </View>
        <BrandSwitch value={draft.extraGuestOn} onValueChange={(extraGuestOn) => patch({ extraGuestOn })} disabled={disabled} accessibilityLabel="Guests above the range" testID="hire-extra-guests-toggle" />
      </View>
      {draft.extraGuestOn ? (
        <MoneyField
          label="Per extra guest"
          valueMinor={draft.extraGuestMinor}
          onChangeMinor={(extraGuestMinor) => patch({ extraGuestMinor })}
          currency={currency}
          disabled={disabled}
          error={showErrors && (draft.extraGuestMinor === null || draft.extraGuestMinor <= 0) ? "Enter the price per extra guest" : null}
          testID="hire-extra-guest-price"
        />
      ) : null}
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>Running over</Text>
          <Text style={styles.hint}>Guests can book extra hours past the session&apos;s end, up to 12.</Text>
        </View>
        <BrandSwitch value={draft.overtimeOn} onValueChange={(overtimeOn) => patch({ overtimeOn })} disabled={disabled} accessibilityLabel="Running over" testID="hire-overtime-toggle" />
      </View>
      {draft.overtimeOn ? (
        <MoneyField
          label="Per hour"
          valueMinor={draft.overtimeMinorPerHour}
          onChangeMinor={(overtimeMinorPerHour) => patch({ overtimeMinorPerHour })}
          currency={currency}
          disabled={disabled}
          error={showErrors && (draft.overtimeMinorPerHour === null || draft.overtimeMinorPerHour <= 0) ? "Enter the price per hour" : null}
          testID="hire-overtime-price"
        />
      ) : null}
      <ExtrasEditor
        title="Paid extras"
        helper="Paid add-ons, like a cake table, food, drinks or staff. Guests tick the ones they want."
        extras={draft.extras}
        onChange={(extras) => patch({ extras })}
        currency={currency}
        disabled={disabled}
        showErrors={showErrors}
        testIDPrefix="hire-paid-extra"
        addTestID="hire-add-paid-extra"
      />
    </View>
  );
}

function TermsStep({ draft, patch, showErrors, disabled, currency }: StepProps): React.ReactElement {
  const issue = hireStepIssue("terms", draft, []);
  const ladder = hireLadder(draft);
  return (
    <View style={styles.stepBody} testID="hire-step-terms">
      <StepHead title="Deposit and terms" sub="What holds the date, and what happens if plans change." />
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>A deposit holds the date</Text>
          <Text style={styles.hint}>Off: the guest pays everything to hold the date.</Text>
        </View>
        <BrandSwitch value={draft.depositOn} onValueChange={(depositOn) => patch({ depositOn })} disabled={disabled} accessibilityLabel="A deposit holds the date" testID="hire-deposit-toggle" />
      </View>
      {draft.depositOn ? (
        <View style={styles.subCard}>
          <Segmented
            options={[
              { key: "percent", label: "A percentage" },
              { key: "fixed", label: "An amount" },
            ]}
            value={draft.depositKind}
            onChange={(depositKind) => patch({ depositKind })}
            accessibilityLabel="Deposit type"
            testID="hire-deposit-kind"
          />
          {draft.depositKind === "percent" ? (
            <NumberStepper label="Deposit (% of the total)" value={draft.depositPercent} min={1} max={99} onChange={(depositPercent) => patch({ depositPercent })} testID="hire-deposit-percent" />
          ) : (
            <MoneyField
              label="Deposit amount"
              valueMinor={draft.depositFixedMinor}
              onChangeMinor={(depositFixedMinor) => patch({ depositFixedMinor })}
              currency={currency}
              disabled={disabled}
              error={showErrors && (draft.depositFixedMinor === null || draft.depositFixedMinor <= 0) ? "Enter the deposit" : null}
              testID="hire-deposit-fixed"
            />
          )}
          <SelectSheet label="Balance due" value={draft.balanceDueDaysBefore} options={HIRE_BALANCE_DUE} onChange={(balanceDueDaysBefore) => patch({ balanceDueDaysBefore })} disabled={disabled} testID="hire-balance-due" />
          <Text style={styles.hint}>{hireDepositLine(draft, currency)}. We remind the guest before the rest is due.</Text>
        </View>
      ) : null}
      <MoneyField
        label="Damage deposit"
        valueMinor={draft.damageDepositMinor}
        onChangeMinor={(damageDepositMinor) => patch({ damageDepositMinor })}
        currency={currency}
        disabled={disabled}
        testID="hire-damage-deposit"
      />
      <Text style={styles.hint}>Optional. Taken with the balance, kept apart from the price, and refunded in full if the booking is cancelled. Leave empty for none.</Text>

      <Text style={styles.sectionLabel}>If the guest cancels</Text>
      <Segmented
        options={HIRE_REFUND_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
        value={draft.refundPreset}
        onChange={(refundPreset) =>
          patch({
            refundPreset,
            customLadder:
              refundPreset === "custom" && draft.customLadder.length === 0 ? hireLadder({ refundPreset: "standard", customLadder: [] }) : draft.customLadder,
          })
        }
        accessibilityLabel="Cancellation terms"
        testID="hire-refund-preset"
      />
      {draft.refundPreset === "custom" ? (
        <View style={styles.subCard}>
          {draft.customLadder.map((rung, i) => (
            <View key={`rung-${i}`} style={styles.rungRow}>
              <NumberStepperPair>
                <NumberStepper
                  label="Days before"
                  value={Math.round(rung.minMinutesBefore / 1440)}
                  min={0}
                  max={365}
                  onChange={(d) => patch({ customLadder: draft.customLadder.map((r, j) => (j === i ? { ...r, minMinutesBefore: d * 1440 } : r)) })}
                  testID={`hire-rung-${i}-days`}
                />
                <NumberStepper
                  label="% they get back"
                  value={Math.round(rung.refundBps / 100)}
                  min={0}
                  max={100}
                  onChange={(pct) => patch({ customLadder: draft.customLadder.map((r, j) => (j === i ? { ...r, refundBps: pct * 100 } : r)) })}
                  testID={`hire-rung-${i}-pct`}
                />
              </NumberStepperPair>
              {draft.customLadder.length > 1 ? (
                <Button style={styles.rungRemove} label="Remove" variant="ghost" size="sm" onPress={() => patch({ customLadder: draft.customLadder.filter((_, j) => j !== i) })} disabled={disabled} />
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
                onPress={() => patch({ customLadder: [...draft.customLadder, { minMinutesBefore: 0, refundBps: 0 }] })}
                disabled={disabled}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.subCard} testID="hire-refund-words">
        <Text style={styles.hint}>{refundSummary(ladder)}. The damage deposit always comes back.</Text>
      </View>
      <Text style={styles.sectionLabel}>Changes guests can make</Text>
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>Change their numbers</Text>
          <Text style={styles.hint}>Within the place&apos;s group sizes; they pay the difference or get some back under your refund rules.</Text>
        </View>
        <BrandSwitch value={draft.guestChangeOn} onValueChange={(guestChangeOn) => patch({ guestChangeOn })} disabled={disabled} accessibilityLabel="Guests can change their numbers" testID="hire-guest-change" />
      </View>
      {draft.guestChangeOn ? (
        <SelectSheet label="Up to" value={draft.guestChangeCutoffMinutes} options={CHANGE_CUTOFFS} onChange={(guestChangeCutoffMinutes) => patch({ guestChangeCutoffMinutes })} disabled={disabled} testID="hire-guest-cutoff" />
      ) : null}
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>Move to another day</Text>
          <Text style={styles.hint}>Only when the same space is free then, setup and cleanup included.</Text>
        </View>
        <BrandSwitch value={draft.dateChange} onValueChange={(dateChange) => patch({ dateChange })} disabled={disabled} accessibilityLabel="Guests can move to another day" testID="hire-date-change" />
      </View>
      {draft.dateChange ? (
        <View style={styles.subCard}>
          <SelectSheet label="Up to" value={draft.moveCutoffMinutes} options={CHANGE_CUTOFFS} onChange={(moveCutoffMinutes) => patch({ moveCutoffMinutes })} disabled={disabled} testID="hire-move-cutoff" />
          <NumberStepperPair>
            <NumberStepper label="How many times" value={draft.maxChanges} min={1} max={5} onChange={(maxChanges) => patch({ maxChanges })} testID="hire-max-changes" />
            <NumberStepper label="Fee (% of the booking)" value={draft.changeFeePercent} min={0} max={100} onChange={(changeFeePercent) => patch({ changeFeePercent })} testID="hire-change-fee" />
          </NumberStepperPair>
        </View>
      ) : null}
      <Text style={styles.hint}>
        The terms are saved on each booking, so later changes here never change a deal already made. Anything else is agreed with you.
      </Text>
      {showErrors && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
    </View>
  );
}

function BookStep({
  draft,
  patch,
  disabled,
  venueName,
  questionsSource,
}: StepProps & { venueName: string; questionsSource?: React.ReactNode }): React.ReactElement {
  return (
    <View style={styles.stepBody} testID="hire-step-book">
      <StepHead title="How guests book" />
      {questionsSource}
      <View style={styles.options}>
        <OptionCard
          label="Request first"
          helper="You check the date, adjust the quote, then approve. Nothing is held until you do."
          icon="inbox"
          selected={draft.mode === "request"}
          onPress={() => patch({ mode: "request" })}
          disabled={disabled}
          testID="hire-mode-request"
          style={COLUMN_OPTION_CARD}
        />
        <OptionCard
          label="Book instantly"
          helper="The guest pays the deposit and the date is theirs."
          icon="flash"
          selected={draft.mode === "instant"}
          onPress={() => patch({ mode: "instant" })}
          disabled={disabled}
          testID="hire-mode-instant"
          style={COLUMN_OPTION_CARD}
        />
      </View>
      <View style={styles.inlineRow}>
        {draft.mode === "request" ? (
          <View style={styles.grow}>
            <SelectSheet label="You reply within" value={draft.requestResponseHours} options={REPLY_WINDOWS} onChange={(requestResponseHours) => patch({ requestResponseHours })} disabled={disabled} testID="hire-reply-within" />
          </View>
        ) : null}
        <View style={styles.grow}>
          <SelectSheet label="Guest pays the deposit within" value={draft.approvedPaymentMinutes} options={PAY_WINDOWS} onChange={(approvedPaymentMinutes) => patch({ approvedPaymentMinutes })} disabled={disabled} testID="hire-pay-within" />
        </View>
      </View>
      <Text style={styles.hint}>
        Applies to every request at {venueName}. {draft.mode === "request" ? "If you don't reply in time, the request closes and the guest is told. " : ""}
        The space is on hold for the guest until they pay.
      </Text>
      <Text style={styles.sectionLabel}>Guests are asked</Text>
      <View style={styles.subCard}>
        <Text style={styles.hint}>What&apos;s the occasion? · Anything {venueName} should know? · Would they like to see the space first?</Text>
      </View>
      <Text style={styles.hint}>{modeLine(draft)}.</Text>
    </View>
  );
}

function ReviewStep({
  draft,
  offer,
  places,
  currency,
  canCollectOnline,
  onGoTo,
  onOpenSettings,
  onOpenPayments,
}: {
  draft: HireDraft;
  offer: VenueOffer | null;
  places: HirePlace[];
  currency: string | null;
  canCollectOnline: boolean;
  onGoTo: (id: HireStepId) => void;
  onOpenSettings?: () => void;
  onOpenPayments?: () => void;
}): React.ReactElement {
  const reasons = offer?.readiness ?? [];
  const paymentsOff = !canCollectOnline || (offer?.warnings ?? []).includes("online_payments_off");
  return (
    <View style={styles.stepBody} testID="hire-step-review">
      <StepHead title="Review" />
      {offer?.status === "live" ? (
        <Banner tone="ok" title="Live" body="Guests can ask for this now. Changes you saved are already live." />
      ) : reasons.length === 0 ? (
        <Banner tone="ok" title="Ready to publish" body="Guests can ask for a date on your venue page, with no account needed." testID="hire-review-ready" />
      ) : (
        <View style={styles.readiness} testID="hire-review-not-ready">
          <Banner tone="warning" title="Not ready to publish yet" body="Finish these first:" />
          {reasons.map((r) => {
            const line = hireReadinessLine(r);
            return (
              <View key={r} style={styles.readinessRow}>
                <Text style={[styles.hint, styles.grow]}>{line.text}</Text>
                {line.step !== null ? (
                  <Button label={`Go to ${HIRE_STEPS.find((s) => s.id === line.step)?.label ?? "step"}`} variant="secondary" size="sm" onPress={() => onGoTo(line.step as HireStepId)} />
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
          body={ONLINE_PAYMENTS_OFF}
          action={onOpenPayments !== undefined ? { label: "Set up payments", onPress: onOpenPayments, testID: "hire-review-payments" } : undefined}
          testID="hire-review-payments-off"
        />
      ) : null}
      <View style={styles.reviewList} testID="hire-review-summary">
        {hireReviewItems(draft, places, currency).map((item) => (
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
  sectionLabel: { ...type.label, color: color.text3, marginTop: space[3] },
  hint: { ...type.caption, color: color.text3 },
  error: { ...type.caption, color: color.errorText },
  options: { gap: space[2] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  inlineRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap", alignItems: "flex-end" },
  grow: { flex: 1, minWidth: 140 },
  subCard: { gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" },
  rowTitle: { ...type.row, color: color.text1 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  addRow: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2] },
  switchTitle: { ...type.row, color: color.text1 },
  rungRow: { gap: space[1] },
  rungRemove: { alignSelf: "flex-end" },
  readiness: { gap: space[2] },
  readinessRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  reviewList: { gap: space[2] },
  reviewRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap" },
  reviewLabel: { ...type.small, color: color.text2, width: 160 },
  reviewValue: { ...type.small, color: color.text1, fontWeight: "600", flex: 1, minWidth: 180 },
});
