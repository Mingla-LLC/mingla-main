/**
 * #4490 P3-2 — the Group package editor (`ed-pkg-price`, `ed-pkg`,
 * `ed-pkg-where`) in the offer wizard frame the Entry editor uses.
 *
 * Steps: Basics · Price and group size · What's included · Where and how
 * long · Deposit and rules · Review. Continue saves the step (a draft until
 * Publish). Every write carries the version the host last saw; "someone else
 * saved first" offers a reload. Refusals are plain words, never codes.
 *
 * No 50-guest cap: the largest group is bounded by the venue's day limit,
 * which packages share with Entry (a P3 package uses any open space).
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { DESKTOP_WIZARD_FORM_MAX_WIDTH, DESKTOP_WIZARD_RAIL_WIDTH } from "../../../../constants/desktopLayout";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { venueFeatureKeys } from "../../../../hooks/venueFeatureKeys";
import { useVenueOffers } from "../../../../hooks/useVenueOffers";
import {
  manageCapacityPool,
  manageVenueOffer,
  manageVenuePackage,
  policyPayload,
  toVenueOfferError,
  VenueOfferError,
} from "../../../../services/venueOffersService";
import type { InclusionKind, VenueCapacityPool, VenueOffer } from "../../../../types/venueOffers";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { ChipInput } from "../../../ui/ChipInput";
import { DurationSelect } from "../../../ui/DurationSelect";
import { Input } from "../../../ui/Input";
import { LeadTimeSelect } from "../../../ui/LeadTimeSelect";
import { MoneyField } from "../../../ui/MoneyField";
import { NumberStepper, NumberStepperPair } from "../../../ui/NumberStepper";
import { OptionCard } from "../../../ui/OptionCard";
import { Pill, Segmented } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Skeleton } from "../../../ui/Skeleton";
import { Stepper, StepperFooter, type StepperStep } from "../../../ui/Stepper";
import { TimeField } from "../../../ui/TimeField";
import { useScrollToTopOnChange } from "../../../ui/useScrollToTopOnChange";
import { WeekdayChips } from "../../../ui/WeekdayChips";
import { revealFocusedFieldWithin } from "../../offers/revealFocusedField";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import { MenuItemPicker } from "./MenuItemPicker";
import { REFUND_PRESETS, offerErrorCopy, refundSummary } from "./offersModel";
import {
  BALANCE_DUE_OPTIONS,
  CHANGE_CUTOFFS,
  ONLINE_PAYMENTS_OFF,
  PACKAGE_CHARGES,
  PACKAGE_STEPS,
  START_EVERY_OPTIONS,
  changeRulesPayload,
  depositChoiceLabel,
  emptyTier,
  extrasPayload,
  groupCap,
  inclusionIssue,
  inclusionsPayload,
  ladderFor,
  newInclusion,
  optionWriteChanged,
  packageDraftFrom,
  packageOptionWrites,
  packageReadinessLine,
  packageStepIssue,
  paymentPayload,
  priceLine,
  reviewItems,
  staffRoleFor,
  startTimesFor,
  tierIssues,
  type InclusionDraft,
  type PackageDraft,
  type PackageStepId,
} from "./packageModel";
import { ExtrasEditor } from "./ExtrasEditor";

const RAIL_MIN_WIDTH = 1280;
const COLUMN_OPTION_CARD = { flexBasis: "auto" as const, flexGrow: 0 };
const MAX_INCLUSIONS = 30;
const MAX_TIERS = 6;

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

const INCLUSION_KIND_LABEL: Record<InclusionKind, string> = {
  item: "Included",
  menu_item: "From your menu",
  staff: "Staff",
  perk: "A perk",
  choice: "Guests choose one",
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface PackageEditorProps {
  brandId: string | null;
  venueId: string | null;
  venueName: string;
  /** null = a new group package. */
  offerId: string | null;
  onClose: (result?: { published: boolean; name: string }) => void;
  onOpenSettings?: () => void;
  /** Brand payments setup (shown when the brand can't take payments online). */
  onOpenPayments?: () => void;
  /** The venue's Menu (from the menu picker's empty state). */
  onOpenMenu?: () => void;
  /** [TRANSITIONAL] blocked on #4514 — shared offer-form attach row; exits when #4514 ships it. */
  questionsSource?: React.ReactNode;
}

export const PackageEditor = forwardRef<VenueModuleLeaveHandle, PackageEditorProps>(function PackageEditor(
  { brandId, venueId, venueName, offerId, onClose, onOpenSettings, onOpenPayments, onOpenMenu, questionsSource },
  ref,
): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const { width } = useWindowDimensions();
  const railLayout = isWideDesktop && width >= RAIL_MIN_WIDTH;
  const queryClient = useQueryClient();
  const currency = useBrandCurrency(brandId);
  const offersQuery = useVenueOffers(brandId, venueId);

  const [currentOfferId, setCurrentOfferId] = useState<string | null>(offerId);
  const [savedOffer, setSavedOffer] = useState<VenueOffer | null>(null);
  const [savedPool, setSavedPool] = useState<VenueCapacityPool | null>(null);
  const [draft, setDraft] = useState<PackageDraft | null>(null);
  const [base, setBase] = useState<PackageDraft | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const scrollRef = useScrollToTopOnChange(stepIndex);
  const [furthest, setFurthest] = useState(offerId === null ? 0 : PACKAGE_STEPS.length - 1);
  const [showErrors, setShowErrors] = useState<Partial<Record<PackageStepId, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; stale: boolean; reasons: string[] } | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);
  /** Menu picker: a new inclusion, or the key of the row whose item is being changed. */
  const [menuPick, setMenuPick] = useState<{ replaceKey: string | null } | null>(null);

  const state = offersQuery.data;
  const listOffer = state?.offers.find((o) => o.id === currentOfferId) ?? null;
  const offer = savedOffer !== null && savedOffer.id === currentOfferId ? savedOffer : listOffer;
  const pools = state?.pools ?? [];
  const pool = savedPool ?? pools.find((p) => p.id === offer?.poolId) ?? pools[0] ?? null;
  const sharedWith = (state?.offers ?? []).filter((o) => o.id !== currentOfferId && o.poolId !== null && o.poolId === pool?.id && o.status !== "archived");
  const canCollectOnline = offer?.canCollectOnline ?? state?.canCollectOnline ?? true;

  useEffect(() => {
    if (draft !== null || state === undefined) return;
    if (offerId !== null && listOffer === null) return;
    const next = packageDraftFrom({ offer: listOffer, pool });
    setDraft(next);
    setBase(clone(next));
  }, [draft, listOffer, offerId, pool, state]);

  const step = PACKAGE_STEPS[stepIndex];
  const dirty = draft !== null && base !== null && JSON.stringify(draft) !== JSON.stringify(base);
  const issueFor = useCallback(
    (id: PackageStepId): string | null => (draft === null ? null : packageStepIssue(id, draft, pool)),
    [draft, pool],
  );

  const patch = useCallback((next: Partial<PackageDraft>): void => {
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
    async (id: PackageStepId): Promise<VenueOffer | null> => {
      if (draft === null || venueId === null) return null;
      let current = offer;
      const name = draft.name.trim();
      const summary = draft.summary.trim();
      if (id === "basics") {
        if (current === null) {
          current = await manageVenueOffer({
            venueId,
            action: "create_draft",
            payload: { kind: "group_package", name, summary },
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
      const offerId0 = current.id;

      if (id === "price") {
        const before = new Set(current.options.map((o) => o.id));
        const writes = packageOptionWrites(draft, current.options);
        for (const write of writes) {
          const saved = write.optionId === null ? undefined : current.options.find((o) => o.id === write.optionId);
          if (!optionWriteChanged(write, saved)) continue;
          current = await manageVenueOffer({
            venueId,
            action: "upsert_price_option",
            payload: { offerId: offerId0, ...write.payload },
            expectedVersion: current.version,
          });
        }
        // Group sizes the host removed (or a switch away from "by group size").
        const keep = new Set(writes.map((w) => w.optionId).filter((x): x is string => x !== null));
        for (const option of [...current.options]) {
          if (!before.has(option.id) || keep.has(option.id)) continue;
          current = await manageVenueOffer({
            venueId,
            action: "archive_price_option",
            payload: { offerId: offerId0, optionId: option.id },
            expectedVersion: current.version,
          });
        }
        const fresh = current;
        setDraft((d) =>
          d === null
            ? d
            : {
                ...d,
                tiers: d.tiers.map((t) => ({
                  ...t,
                  id: fresh.options.find((o) => o.guestMin === t.guestMin && o.guestMax === t.guestMax)?.id ?? t.id,
                })),
              },
        );
      }

      if (id === "included") {
        const nextIncl = JSON.stringify(inclusionsPayload(draft));
        const nextExtras = JSON.stringify(extrasPayload(draft));
        const savedIncl = JSON.stringify(
          inclusionsPayload({ ...packageDraftFrom({ offer: current, pool }) }),
        );
        const savedExtras = JSON.stringify(extrasPayload({ ...packageDraftFrom({ offer: current, pool }) }));
        if (nextIncl !== savedIncl || nextExtras !== savedExtras || (current.staffRoleLabel ?? null) !== staffRoleFor(draft)) {
          current = await manageVenuePackage({
            venueId,
            action: "set_package",
            payload: {
              offerId: offerId0,
              inclusions: inclusionsPayload(draft),
              extras: extrasPayload(draft),
              staffRoleLabel: staffRoleFor(draft),
            },
            expectedVersion: current.version,
          });
          const fresh = current;
          // New extras get their id from the server (bookings point at it).
          setDraft((d) =>
            d === null ? d : { ...d, extras: d.extras.map((e, i) => ({ ...e, id: fresh.extras[i]?.id ?? e.id })) },
          );
        }
      }

      if (id === "where") {
        let nextPool = pool;
        if (nextPool === null) {
          nextPool = await manageCapacityPool({
            venueId,
            action: "create",
            name: `${venueName.trim().slice(0, 60) || "Venue"} day`,
            dailyLimit: draft.dailyLimit,
            keptForWalkIns: 0,
          });
        }
        setSavedPool(nextPool);
        if (current.poolId !== nextPool.id) {
          current = await manageVenueOffer({
            venueId,
            action: "set_pool",
            payload: { offerId: offerId0, poolId: nextPool.id },
            expectedVersion: current.version,
          });
        }
        const times = startTimesFor(draft.firstStart, draft.lastStart, draft.startEvery);
        const sameTimes =
          JSON.stringify([...current.startTimes].sort()) === JSON.stringify(times) &&
          current.durationMinutes === draft.durationMinutes &&
          JSON.stringify(current.schedule?.weekdays ?? []) === JSON.stringify([...draft.weekdays].sort((a, b) => a - b));
        if (!sameTimes) {
          current = await manageVenuePackage({
            venueId,
            action: "set_start_times",
            payload: {
              offerId: offerId0,
              startTimes: times,
              durationMinutes: draft.durationMinutes,
              weekdays: [...draft.weekdays].sort((a, b) => a - b),
            },
            expectedVersion: current.version,
          });
        }
        if ((current.minNoticeMinutes ?? 0) !== draft.minNoticeMinutes) {
          current = await manageVenueOffer({
            venueId,
            action: "update",
            payload: { offerId: offerId0, minNoticeMinutes: draft.minNoticeMinutes },
            expectedVersion: current.version,
          });
        }
      }

      if (id === "rules") {
        const pay = paymentPayload(draft);
        const d = current.deposit;
        const samePay =
          d !== null &&
          d.kind === pay.depositKind &&
          (pay.depositKind === "none" || (d.value === pay.depositValue && d.balanceDueDaysBefore === pay.balanceDueDaysBefore));
        if (!samePay) {
          current = await manageVenuePackage({
            venueId,
            action: "set_payment",
            payload: { offerId: offerId0, ...pay },
            expectedVersion: current.version,
          });
        }
        const ladder = ladderFor(draft);
        const policyChanged =
          current.policy === null || JSON.stringify(current.policy.refundLadder) !== JSON.stringify(ladder);
        if (policyChanged) {
          current = await manageVenueOffer({
            venueId,
            action: "set_policy",
            payload: { offerId: offerId0, ...policyPayload(ladder, null) },
            expectedVersion: current.version,
          });
        }
        const rule = current.policy?.dateChangeRule ?? null;
        const want = changeRulesPayload(draft);
        const sameRule =
          !policyChanged &&
          rule !== null &&
          (rule.allowedUntilMinutesBefore ?? null) === want.allowedUntilMinutesBefore &&
          (rule.maxChanges ?? null) === want.maxChanges &&
          ((rule.feeBps ?? null) === want.feeBps || (want.feeBps === null && rule.feeBps === 0)) &&
          (rule.guestChangeUntilMinutesBefore ?? null) === want.guestChangeUntilMinutesBefore;
        if (!sameRule) {
          current = await manageVenuePackage({
            venueId,
            action: "set_change_rules",
            payload: { offerId: offerId0, ...want },
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
    async (id: PackageStepId): Promise<boolean> => {
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
        refreshLists();
        onClose({ published: true, name: published.name });
      } catch (e) {
        const err = toVenueOfferError(e);
        setError({ text: offerErrorCopy(err.code, err.detail), stale: err.code === "stale_write", reasons: err.reasons });
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
  }, [draft, goTo, issueFor, offer, onClose, refreshLists, runSave, step.id, stepIndex, venueId]);

  const handleReload = useCallback((): void => {
    setError(null);
    setSavedOffer(null);
    setSavedPool(null);
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
      changedLabels: () => [PACKAGE_STEPS[stepIndex]?.label ?? "Group package"],
      isValid: () => issueFor(PACKAGE_STEPS[stepIndex]?.id ?? "basics") === null && PACKAGE_STEPS[stepIndex]?.id !== "review",
      save: async () => {
        const ok = await runSave(PACKAGE_STEPS[stepIndex]?.id ?? "basics");
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
      <CenteredState title="Couldn't load this package" body="Check your connection and try again." tone="error" testID="package-editor-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void offersQuery.refetch()} />
        <Button label="Back to offers" variant="ghost" size="md" onPress={() => onClose()} />
      </CenteredState>
    );
  }
  if (draft === null) {
    if (state !== undefined && offerId !== null && listOffer === null) {
      return (
        <CenteredState title="This package was removed" body="It may have been archived by someone else." testID="package-editor-missing">
          <Button label="Back to offers" variant="secondary" size="md" onPress={() => onClose()} />
        </CenteredState>
      );
    }
    return (
      <View style={styles.loading} testID="package-editor-loading" accessibilityLabel="Loading package">
        <Skeleton height={28} width="40%" />
        <Skeleton height={120} radius="md" />
        <Skeleton height={120} radius="md" />
      </View>
    );
  }

  const cap = groupCap(pool, draft);
  const steps: StepperStep[] = PACKAGE_STEPS.map((s, i) => {
    const issue = issueFor(s.id);
    const shown = showErrors[s.id] === true && issue !== null;
    const stepState: StepperStep["state"] =
      i === stepIndex ? (shown ? "error" : "current") : shown ? "error" : i < furthest || (i <= furthest && i < stepIndex) ? (issue === null ? "done" : "todo") : "todo";
    return {
      id: s.id,
      label: s.label,
      state: stepState,
      firstError: stepState === "error" && issue !== null ? issue : undefined,
      description: s.id === "price" ? priceLine(draft, currency) : undefined,
    };
  });
  const stepErrors = showErrors[step.id] === true;
  const continueLabel = step.id === "review" ? (offer?.status === "live" ? "Done" : "Publish") : saving ? "Saving" : "Continue";
  const continueDisabled = saving || (stepErrors && issueFor(step.id) !== null) || (step.id === "review" && offer === null);

  const header = (
    <View style={styles.titleRow}>
      <View style={styles.titleText}>
        <Text style={styles.eyebrow}>{offer === null ? "New group package" : offer.status === "live" ? "Live group package" : "Draft group package"}</Text>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {draft.name.trim().length > 0 ? draft.name.trim() : "Group package"}
        </Text>
      </View>
      <View style={styles.titleActions}>
        {savedNote !== null && !dirty ? <Text style={styles.saved} accessibilityLiveRegion="polite">{savedNote}</Text> : null}
        {dirty ? <Text style={styles.saved}>Unsaved changes</Text> : null}
        <Button label="Close" variant="ghost" size="sm" leadingIcon="close" onPress={requestClose} testID="package-editor-close" />
      </View>
    </View>
  );

  const firstReasonStep = error !== null && error.reasons.length > 0 ? packageReadinessLine(error.reasons[0]).step : null;
  const errorBanner =
    error !== null ? (
      <Banner
        tone="danger"
        title={error.reasons.length > 0 ? "Not ready to publish yet" : "Couldn't save"}
        body={error.reasons.length > 0 ? error.reasons.map((r) => packageReadinessLine(r).text).join(" ") : error.text}
        action={
          error.stale
            ? { label: "Reload", onPress: handleReload, testID: "package-editor-reload" }
            : firstReasonStep !== null
              ? {
                  label: `Go to ${PACKAGE_STEPS.find((s) => s.id === firstReasonStep)?.label ?? "step"}`,
                  onPress: () => goTo(PACKAGE_STEPS.findIndex((s) => s.id === firstReasonStep)),
                }
              : undefined
        }
        testID="package-editor-error-banner"
      />
    ) : null;

  const stepProps = { draft, patch, showErrors: stepErrors, disabled: saving };
  const form = (
    <View style={styles.form} ref={revealFocusedFieldWithin}>
      {step.id === "basics" ? <BasicsStep {...stepProps} /> : null}
      {step.id === "price" ? <PriceStep {...stepProps} cap={cap} currency={currency} /> : null}
      {step.id === "included" ? (
        <IncludedStep {...stepProps} currency={currency} onAddFromMenu={(replaceKey) => setMenuPick({ replaceKey })} />
      ) : null}
      {step.id === "where" ? <WhereStep {...stepProps} pool={pool} sharedWith={sharedWith.map((o) => o.name)} /> : null}
      {step.id === "rules" ? <RulesStep {...stepProps} currency={currency} questionsSource={questionsSource} /> : null}
      {step.id === "review" ? (
        <ReviewStep
          draft={draft}
          offer={offer}
          pool={pool}
          currency={currency}
          canCollectOnline={canCollectOnline}
          onGoTo={(id) => goTo(PACKAGE_STEPS.findIndex((s) => s.id === id))}
          onOpenSettings={onOpenSettings}
          onOpenPayments={onOpenPayments}
        />
      ) : null}
      {errorBanner}
    </View>
  );

  const footer = (
    <StepperFooter
      previousLabel={stepIndex > 0 ? PACKAGE_STEPS[stepIndex - 1].label : undefined}
      onBack={stepIndex > 0 ? () => goTo(stepIndex - 1) : undefined}
      backDisabled={saving}
      continueLabel={continueLabel}
      onContinue={() => void handleContinue()}
      continueDisabled={continueDisabled}
      continueLoading={saving}
      continueTestID="package-editor-continue"
      wide={isWideDesktop}
      testID="package-editor-footer"
    />
  );

  const stepIssue = issueFor(step.id);
  const overlays = (
    <>
      {leaveOpen ? (
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
            saveTestID="package-editor-leave-save"
            discardTestID="package-editor-leave-discard"
            keepTestID="package-editor-leave-keep"
            testID="package-editor-leave-dialog"
          />
        </React.Suspense>
      ) : null}
      <MenuItemPicker
        visible={menuPick !== null}
        brandId={brandId}
        venueId={venueId}
        currency={currency}
        onClose={() => setMenuPick(null)}
        onOpenMenu={
          onOpenMenu !== undefined
            ? () => {
                setMenuPick(null);
                onOpenMenu();
              }
            : undefined
        }
        onPick={(item) => {
          const replaceKey = menuPick?.replaceKey ?? null;
          setMenuPick(null);
          if (replaceKey !== null) {
            patch({
              inclusions: draft.inclusions.map((i) => (i.key === replaceKey ? { ...i, label: item.name, menuItemId: item.id } : i)),
            });
          } else {
            patch({ inclusions: [...draft.inclusions, newInclusion("menu_item", item.name, item.id)] });
          }
        }}
      />
    </>
  );

  if (railLayout) {
    return (
      <View style={styles.wideHost} testID="package-editor">
        {overlays}
        {header}
        <View style={styles.wideBody}>
          <View style={styles.rail}>
            <Stepper
              steps={steps}
              currentIndex={stepIndex}
              layout="list"
              furthestValidIndex={furthest}
              onStepPress={(i) => {
                if (i <= furthest && !saving) goTo(i);
              }}
              testID="package-editor-steps"
            />
          </View>
          <ScrollView ref={scrollRef} style={styles.wideScroll} contentContainerStyle={styles.wideScrollContent} keyboardShouldPersistTaps="handled" testID="package-editor-scroll">
            {form}
          </ScrollView>
        </View>
        {footer}
      </View>
    );
  }
  return (
    <View style={styles.phoneHost} testID="package-editor">
      {overlays}
      {header}
      <Stepper
        steps={steps}
        currentIndex={stepIndex}
        layout="chips"
        furthestValidIndex={furthest}
        onStepPress={(i) => {
          if (i <= furthest && !saving) goTo(i);
        }}
        sheetTitle="Steps"
        testID="package-editor-steps"
      />
      <ScrollView ref={scrollRef} style={styles.phoneScroll} contentContainerStyle={styles.phoneScrollContent} keyboardShouldPersistTaps="handled" testID="package-editor-scroll">
        {form}
      </ScrollView>
      {footer}
    </View>
  );
});

// =================================================================== steps

interface StepProps {
  draft: PackageDraft;
  patch: (next: Partial<PackageDraft>) => void;
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
    <View style={styles.stepBody} testID="package-step-basics">
      <StepHead title="Basics" sub="A deal for groups: a set price, what's included and a start time." />
      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <Input
          value={draft.name}
          onChangeText={(name) => patch({ name: name.slice(0, 120) })}
          placeholder="e.g. Squad, Birthday party, Office outing"
          accessibilityLabel="Package name"
          disabled={disabled}
          error={showErrors && draft.name.trim().length === 0 ? "Name this package" : null}
          testID="package-name"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>In one line</Text>
        <Input
          value={draft.summary}
          onChangeText={(summary) => patch({ summary: summary.slice(0, 300) })}
          placeholder="e.g. 3 hours of games, food and a host for your group"
          accessibilityLabel="Package in one line"
          disabled={disabled}
          testID="package-summary"
        />
        <Text style={styles.hint}>Guests see this under the name. {300 - draft.summary.length} characters left.</Text>
      </View>
    </View>
  );
}

function PriceStep({ draft, patch, showErrors, disabled, cap, currency }: StepProps & { cap: number; currency: string | null }): React.ReactElement {
  const issues = tierIssues(draft, cap);
  const issue = packageStepIssue("price", draft, null);
  const setCharge = (charge: PackageDraft["charge"]): void => {
    if (charge === "by_size" && draft.tiers.length < 2) {
      const mid = Math.max(draft.guestMin, Math.min(draft.guestMax - 1, Math.floor((draft.guestMin + draft.guestMax) / 2)));
      patch({
        charge,
        tiers: [
          { ...emptyTier(draft.guestMin, mid), priceMinor: draft.priceMinor },
          emptyTier(mid + 1, Math.max(mid + 1, draft.guestMax)),
        ],
      });
      return;
    }
    if (charge !== "by_size" && draft.charge === "by_size" && draft.tiers.length > 0) {
      const sorted = [...draft.tiers].sort((a, b) => a.guestMin - b.guestMin);
      patch({ charge, guestMin: sorted[0].guestMin, guestMax: sorted[sorted.length - 1].guestMax, priceMinor: sorted[0].priceMinor });
      return;
    }
    patch({ charge });
  };
  return (
    <View style={styles.stepBody} testID="package-step-price">
      <StepHead title="Price and group size" sub="How the group pays, and how small or big a group can be." />
      <Text style={styles.label}>Charge</Text>
      <View style={styles.options}>
        {PACKAGE_CHARGES.map((c) => (
          <OptionCard
            key={c.key}
            label={c.label}
            helper={c.helper}
            selected={draft.charge === c.key}
            onPress={() => setCharge(c.key)}
            disabled={disabled}
            testID={`package-charge-${c.key}`}
            style={COLUMN_OPTION_CARD}
          />
        ))}
      </View>
      {draft.charge !== "by_size" ? (
        <>
          <MoneyField
            label={draft.charge === "per_group" ? "Price for the group" : "Price per guest"}
            valueMinor={draft.priceMinor}
            onChangeMinor={(priceMinor) => patch({ priceMinor })}
            currency={currency}
            disabled={disabled}
            error={showErrors && (draft.priceMinor === null || draft.priceMinor <= 0) ? "Enter a price" : null}
            testID="package-price"
          />
          <NumberStepperPair>
            <NumberStepper
              label="Smallest group"
              value={draft.guestMin}
              min={1}
              max={Math.max(1, cap)}
              // #4490 N8: raising the smallest past the largest raises the largest too.
              onChange={(guestMin) => patch({ guestMin, guestMax: Math.max(guestMin, draft.guestMax) })}
              testID="package-guest-min"
            />
            <NumberStepper
              label="Largest group"
              value={draft.guestMax}
              min={Math.max(1, draft.guestMin)}
              max={cap}
              onChange={(guestMax) => patch({ guestMax })}
              testID="package-guest-max"
            />
          </NumberStepperPair>
          <Text style={styles.hint}>
            Up to {cap.toLocaleString("en-GB")} guests: the most the venue takes in a day. For a bigger group, raise the day limit in Availability &amp; pricing.
          </Text>
        </>
      ) : (
        <View style={styles.subCard} testID="package-tiers">
          {[...draft.tiers]
            .sort((a, b) => a.guestMin - b.guestMin)
            .map((tier) => {
              const tIssue = showErrors ? issues.find((x) => x.key === tier.key)?.text ?? null : null;
              const update = (next: Partial<typeof tier>): void =>
                patch({ tiers: draft.tiers.map((t) => (t.key === tier.key ? { ...t, ...next } : t)) });
              return (
                <View key={tier.key} style={styles.tierRow} testID={`package-tier-${tier.key}`}>
                  <NumberStepperPair>
                    <NumberStepper label="From" value={tier.guestMin} min={1} max={cap} onChange={(guestMin) => update({ guestMin, guestMax: Math.max(guestMin, tier.guestMax) })} />
                    <NumberStepper label="To" value={tier.guestMax} min={tier.guestMin} max={cap} onChange={(guestMax) => update({ guestMax })} />
                  </NumberStepperPair>
                  <MoneyField
                    label={`Per guest for ${tier.guestMin} to ${tier.guestMax}`}
                    valueMinor={tier.priceMinor}
                    onChangeMinor={(priceMinor) => update({ priceMinor })}
                    currency={currency}
                    disabled={disabled}
                    error={tIssue}
                  />
                  {draft.tiers.length > 2 ? (
                    <View>
                      <Button label="Remove this size" variant="ghost" size="sm" onPress={() => patch({ tiers: draft.tiers.filter((t) => t.key !== tier.key) })} disabled={disabled} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          {draft.tiers.length < MAX_TIERS ? (
            <View>
              <Button
                label="Add a group size"
                variant="secondary"
                size="md"
                leadingIcon="plus"
                onPress={() => {
                  const top = Math.max(0, ...draft.tiers.map((t) => t.guestMax));
                  patch({ tiers: [...draft.tiers, emptyTier(Math.min(cap, top + 1), Math.min(cap, top + 10))] });
                }}
                disabled={disabled || Math.max(0, ...draft.tiers.map((t) => t.guestMax)) >= cap}
                testID="package-add-tier"
              />
            </View>
          ) : null}
          <Text style={styles.hint}>The price that fits the group&apos;s size applies to every guest. Sizes can&apos;t overlap.</Text>
        </View>
      )}
      {showErrors && issue !== null && draft.charge !== "by_size" && draft.priceMinor !== null && draft.priceMinor > 0 ? (
        <Text style={styles.error}>{issue}</Text>
      ) : null}
      {showErrors && draft.charge === "by_size" && draft.tiers.length < 2 ? <Text style={styles.error}>Add at least two group sizes, or charge per guest</Text> : null}
    </View>
  );
}

function IncludedStep({
  draft,
  patch,
  showErrors,
  disabled,
  currency,
  onAddFromMenu,
}: StepProps & { currency: string | null; onAddFromMenu: (replaceKey: string | null) => void }): React.ReactElement {
  const move = (index: number, delta: -1 | 1): void => {
    const next = [...draft.inclusions];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ inclusions: next });
  };
  const update = (key: string, next: Partial<InclusionDraft>): void =>
    patch({ inclusions: draft.inclusions.map((i) => (i.key === key ? { ...i, ...next } : i)) });
  const full = draft.inclusions.length >= MAX_INCLUSIONS;
  return (
    <View style={styles.stepBody} testID="package-step-included">
      <StepHead title="What's included" sub="Everything the price covers, in the order guests read it." />
      {draft.inclusions.length === 0 ? <Text style={styles.hint}>Nothing yet. Add food from your menu, a host, a perk or a choice guests make.</Text> : null}
      {draft.inclusions.map((item, index) => {
        const issue = showErrors ? inclusionIssue(item) : null;
        return (
          <View key={item.key} style={styles.subCard} testID={`package-inclusion-${index}`}>
            <View style={styles.rowHead}>
              <Pill variant="draft">{INCLUSION_KIND_LABEL[item.kind]}</Pill>
              <View style={styles.rowActions}>
                <Button label="Up" variant="ghost" size="sm" leadingIcon="chevU" onPress={() => move(index, -1)} disabled={disabled || index === 0} accessibilityLabel={`Move ${item.label || "this"} up`} />
                <Button label="Down" variant="ghost" size="sm" leadingIcon="chevD" onPress={() => move(index, 1)} disabled={disabled || index === draft.inclusions.length - 1} accessibilityLabel={`Move ${item.label || "this"} down`} />
                <Button label="Remove" variant="ghost" size="sm" onPress={() => patch({ inclusions: draft.inclusions.filter((i) => i.key !== item.key) })} disabled={disabled} accessibilityLabel={`Remove ${item.label || "this"}`} />
              </View>
            </View>
            {item.kind === "menu_item" ? (
              <>
                <View style={styles.noteRow}>
                  <Text style={[styles.rowTitle, styles.grow]}>{item.label || "No item picked"}</Text>
                  <Button label="Change" variant="secondary" size="sm" onPress={() => onAddFromMenu(item.key)} disabled={disabled} />
                </View>
                <View style={styles.inlineRow}>
                  <View style={styles.grow}>
                    <NumberStepper label="How many" value={item.menuQty} min={1} max={20} onChange={(menuQty) => update(item.key, { menuQty })} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.label}>For</Text>
                    <Segmented
                      options={[
                        { key: "guest", label: "Each guest" },
                        { key: "booking", label: "The group" },
                      ]}
                      value={item.qtyPer}
                      onChange={(qtyPer) => update(item.key, { qtyPer })}
                      accessibilityLabel="How it's counted"
                    />
                  </View>
                </View>
              </>
            ) : item.kind === "staff" ? (
              <>
                <Input
                  value={item.label}
                  onChangeText={(label) => update(item.key, { label: label.slice(0, 80) })}
                  placeholder="e.g. A Games Master, A host, A waiter"
                  accessibilityLabel="Staff role"
                  disabled={disabled}
                  error={issue}
                />
                <NumberStepper label="1 for every N guests" value={item.staffRatio} min={1} max={1000} onChange={(staffRatio) => update(item.key, { staffRatio })} />
              </>
            ) : item.kind === "choice" ? (
              <>
                <Input
                  value={item.label}
                  onChangeText={(label) => update(item.key, { label: label.slice(0, 80) })}
                  placeholder="e.g. Rice for the group"
                  accessibilityLabel="What guests choose"
                  disabled={disabled}
                  error={issue !== null && item.label.trim().length === 0 ? issue : null}
                />
                <ChipInput
                  label="Options"
                  helper="2 to 10. Guests pick one when they book."
                  values={item.options}
                  onChange={(options) => update(item.key, { options: options.slice(0, 10) })}
                  placeholder="Type an option, then Enter"
                  editable={!disabled}
                  testID={`package-choice-options-${index}`}
                />
                {issue !== null && item.label.trim().length > 0 ? <Text style={styles.error}>{issue}</Text> : null}
              </>
            ) : (
              <Input
                value={item.label}
                onChangeText={(label) => update(item.key, { label: label.slice(0, 80) })}
                placeholder="e.g. 3 hours of games, Party decorations"
                accessibilityLabel="What's included"
                disabled={disabled}
                error={issue}
              />
            )}
          </View>
        );
      })}
      <View style={styles.addRow}>
        <Button label="From your menu" variant="secondary" size="sm" leadingIcon="plus" onPress={() => onAddFromMenu(null)} disabled={disabled || full} testID="package-add-menu" />
        <Button label="Staff" variant="secondary" size="sm" leadingIcon="plus" onPress={() => patch({ inclusions: [...draft.inclusions, newInclusion("staff")] })} disabled={disabled || full} testID="package-add-staff" />
        <Button label="A perk" variant="secondary" size="sm" leadingIcon="plus" onPress={() => patch({ inclusions: [...draft.inclusions, newInclusion("perk")] })} disabled={disabled || full} testID="package-add-perk" />
        <Button label="Guests choose one" variant="secondary" size="sm" leadingIcon="plus" onPress={() => patch({ inclusions: [...draft.inclusions, newInclusion("choice")] })} disabled={disabled || full} testID="package-add-choice" />
      </View>

      <ExtrasEditor
        title="Extras guests can add"
        helper="Paid add-ons, like a cake table or an extra hour. Guests tick the ones they want."
        extras={draft.extras}
        onChange={(extras) => patch({ extras })}
        currency={currency}
        disabled={disabled}
        showErrors={showErrors}
        testIDPrefix="package-extra"
        addTestID="package-add-extra"
      />
    </View>
  );
}

function WhereStep({ draft, patch, showErrors, disabled, pool, sharedWith }: StepProps & { pool: VenueCapacityPool | null; sharedWith: string[] }): React.ReactElement {
  const times = startTimesFor(draft.firstStart, draft.lastStart, draft.startEvery);
  const issue = packageStepIssue("where", draft, pool);
  return (
    <View style={styles.stepBody} testID="package-step-where">
      <StepHead title="Where and how long" sub="When groups can start, and for how long." />
      <View style={styles.subCard}>
        <Text style={styles.rowTitle}>Any open space</Text>
        <Text style={styles.hint}>
          {pool !== null
            ? `Each group counts against the venue's ${pool.dailyLimit.toLocaleString("en-GB")} guests a day${sharedWith.length > 0 ? `, shared with ${sharedWith.join(", ")}` : ""}. Change the day limit in Entry or Availability & pricing.`
            : "Groups count against the venue's day limit. Set it here; Entry will share it."}
        </Text>
        {pool === null ? (
          <NumberStepper label="Guests a day" value={draft.dailyLimit} min={1} max={100000} onChange={(dailyLimit) => patch({ dailyLimit })} testID="package-daily-limit" />
        ) : null}
      </View>
      <WeekdayChips label="Days" value={draft.weekdays} onChange={(weekdays) => patch({ weekdays })} disabled={disabled} showSummary testID="package-days" />
      <DurationSelect
        label="Each booking lasts"
        value={draft.durationMinutes}
        onChange={(durationMinutes) => patch({ durationMinutes })}
        min={30}
        max={720}
        disabled={disabled}
        testID="package-duration"
      />
      <Text style={styles.label}>Start times</Text>
      <Text style={styles.hint}>How far apart groups can start. Separate from how long each booking lasts.</Text>
      <Segmented
        options={START_EVERY_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
        value={String(draft.startEvery)}
        onChange={(key) => patch({ startEvery: Number(key) })}
        accessibilityLabel="Time between start times"
        testID="package-start-every"
      />
      <View style={styles.inlineRow}>
        <View style={styles.grow}>
          <TimeField
            label="First start"
            value={draft.firstStart}
            onChangeValue={(firstStart) => patch({ firstStart })}
            accessibilityLabel="First start time"
            disabled={disabled}
            hasError={showErrors && times.length === 0}
            testID="package-first-start"
          />
        </View>
        <View style={styles.grow}>
          <TimeField
            label="Last start"
            value={draft.lastStart}
            onChangeValue={(lastStart) => patch({ lastStart })}
            accessibilityLabel="Last start time"
            disabled={disabled}
            hasError={showErrors && times.length === 0}
            testID="package-last-start"
          />
        </View>
      </View>
      <View style={styles.chips} testID="package-start-times">
        {times.length === 0 ? (
          <Text style={styles.hint}>Pick a first and a last start time.</Text>
        ) : (
          times.map((t) => (
            <View key={t} style={styles.timeChip}>
              <Text style={styles.timeChipText}>{t}</Text>
            </View>
          ))
        )}
      </View>
      {times.length > 1 && draft.startEvery < draft.durationMinutes ? (
        <Text style={styles.hint} testID="package-start-overlap">
          {"A new group can start before the last one ends. That's fine when you have room for both."}
        </Text>
      ) : null}
      <LeadTimeSelect
        label="Book at least"
        value={draft.minNoticeMinutes}
        onChange={(minNoticeMinutes) => patch({ minNoticeMinutes })}
        includeNone
        disabled={disabled}
        testID="package-notice"
      />
      <Text style={styles.hint}>Days closer than this show as booked out online, so you have time to prepare.</Text>
      {showErrors && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
    </View>
  );
}

function RulesStep({
  draft,
  patch,
  showErrors,
  disabled,
  currency,
  questionsSource,
}: StepProps & { currency: string | null; questionsSource?: React.ReactNode }): React.ReactElement {
  const issue = packageStepIssue("rules", draft, null);
  const choice = depositChoiceLabel(draft, currency);
  return (
    <View style={styles.stepBody} testID="package-step-rules">
      <StepHead title="Deposit and rules" sub="What guests pay up front, and what happens if plans change." />
      {questionsSource}
      <Text style={styles.label}>Deposit</Text>
      <Segmented
        options={[
          { key: "none", label: "No deposit" },
          { key: "percent", label: "A percentage" },
          { key: "fixed", label: "An amount" },
        ]}
        value={draft.depositKind}
        onChange={(depositKind) => patch({ depositKind })}
        accessibilityLabel="Deposit"
        testID="package-deposit-kind"
      />
      {draft.depositKind === "percent" ? (
        <NumberStepper label="Deposit (%)" value={draft.depositPercent} min={1} max={99} onChange={(depositPercent) => patch({ depositPercent })} testID="package-deposit-percent" />
      ) : null}
      {draft.depositKind === "fixed" ? (
        <MoneyField
          label="Deposit amount"
          valueMinor={draft.depositFixedMinor}
          onChangeMinor={(depositFixedMinor) => patch({ depositFixedMinor })}
          currency={currency}
          disabled={disabled}
          error={showErrors && (draft.depositFixedMinor === null || draft.depositFixedMinor <= 0) ? "Enter the deposit amount" : null}
          testID="package-deposit-fixed"
        />
      ) : null}
      {draft.depositKind !== "none" ? (
        <>
          <SelectSheet
            label="The rest is due"
            value={draft.balanceDueDaysBefore}
            options={BALANCE_DUE_OPTIONS}
            onChange={(balanceDueDaysBefore) => patch({ balanceDueDaysBefore })}
            disabled={disabled}
            testID="package-balance-due"
          />
          <Text style={styles.hint}>
            Guests choose {choice ?? "the deposit"} or All now. We remind them before the rest is due and send a link to pay it. Booked too close to the due date, they pay it all.
          </Text>
        </>
      ) : (
        <Text style={styles.hint}>Guests pay the whole price when they book.</Text>
      )}

      <Text style={styles.sectionLabel}>Refunds</Text>
      <View style={styles.options}>
        {REFUND_PRESETS.map((p) => (
          <OptionCard
            key={p.key}
            label={p.label}
            helper={p.helper}
            selected={draft.refundPreset === p.key}
            onPress={() => patch({ refundPreset: p.key })}
            disabled={disabled}
            testID={`package-refund-${p.key}`}
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
                  label="Days before it starts"
                  value={Math.round(rung.minMinutesBefore / 1440)}
                  min={0}
                  max={365}
                  onChange={(d) => patch({ customLadder: draft.customLadder.map((r, j) => (j === i ? { ...r, minMinutesBefore: d * 1440 } : r)) })}
                  testID={`package-rung-${i}-days`}
                />
                <NumberStepper
                  label="% they get back"
                  value={Math.round(rung.refundBps / 100)}
                  min={0}
                  max={100}
                  onChange={(pct) => patch({ customLadder: draft.customLadder.map((r, j) => (j === i ? { ...r, refundBps: pct * 100 } : r)) })}
                  testID={`package-rung-${i}-pct`}
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
                onPress={() => patch({ customLadder: [...draft.customLadder, { minMinutesBefore: 0, refundBps: 5000 }] })}
                disabled={disabled}
              />
            </View>
          ) : null}
          <Text style={styles.hint}>{refundSummary(ladderFor(draft))}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Changes</Text>
      <SelectSheet
        label="Final numbers and extras by"
        value={draft.guestChangeCutoffMinutes}
        options={CHANGE_CUTOFFS}
        onChange={(guestChangeCutoffMinutes) => patch({ guestChangeCutoffMinutes })}
        disabled={disabled}
        testID="package-guest-cutoff"
      />
      <Text style={styles.hint}>Until then, guests can add people or extras and pay the difference, or remove people under your refund rules.</Text>
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchTitle}>Guests can move to another day</Text>
          <Text style={styles.hint}>If there&apos;s room on the new day.</Text>
        </View>
        <BrandSwitch value={draft.dateChange} onValueChange={(dateChange) => patch({ dateChange })} disabled={disabled} accessibilityLabel="Guests can move to another day" testID="package-date-change" />
      </View>
      {draft.dateChange ? (
        <View style={styles.subCard}>
          <SelectSheet
            label="Up to"
            value={draft.moveCutoffMinutes}
            options={CHANGE_CUTOFFS}
            onChange={(moveCutoffMinutes) => patch({ moveCutoffMinutes })}
            disabled={disabled}
            testID="package-move-cutoff"
          />
          <NumberStepperPair>
            <NumberStepper label="How many times" value={draft.maxChanges} min={1} max={5} onChange={(maxChanges) => patch({ maxChanges })} testID="package-max-changes" />
            <NumberStepper label="Fee (% of the booking)" value={draft.changeFeePercent} min={0} max={100} onChange={(changeFeePercent) => patch({ changeFeePercent })} testID="package-change-fee" />
          </NumberStepperPair>
        </View>
      ) : null}
      {showErrors && issue !== null ? <Text style={styles.error}>{issue}</Text> : null}
    </View>
  );
}

function ReviewStep({
  draft,
  offer,
  pool,
  currency,
  canCollectOnline,
  onGoTo,
  onOpenSettings,
  onOpenPayments,
}: {
  draft: PackageDraft;
  offer: VenueOffer | null;
  pool: VenueCapacityPool | null;
  currency: string | null;
  canCollectOnline: boolean;
  onGoTo: (id: PackageStepId) => void;
  onOpenSettings?: () => void;
  onOpenPayments?: () => void;
}): React.ReactElement {
  const reasons = offer?.readiness ?? [];
  const paymentsOff = !canCollectOnline || (offer?.warnings ?? []).includes("online_payments_off");
  return (
    <View style={styles.stepBody} testID="package-step-review">
      <StepHead title="Review" />
      {offer?.status === "live" ? (
        <Banner tone="ok" title="Live" body="Groups can book this now. Changes you saved are already live." />
      ) : reasons.length === 0 ? (
        <Banner tone="ok" title="Ready to publish" body="Groups can book it on your venue page, with no account needed." testID="package-review-ready" />
      ) : (
        <View style={styles.readiness} testID="package-review-not-ready">
          <Banner tone="warning" title="Not ready to publish yet" body="Finish these first:" />
          {reasons.map((r) => {
            const line = packageReadinessLine(r);
            return (
              <View key={r} style={styles.readinessRow}>
                <Text style={[styles.hint, styles.grow]}>{line.text}</Text>
                {line.step !== null ? (
                  <Button
                    label={`Go to ${PACKAGE_STEPS.find((s) => s.id === line.step)?.label ?? "step"}`}
                    variant="secondary"
                    size="sm"
                    onPress={() => onGoTo(line.step as PackageStepId)}
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
          body={ONLINE_PAYMENTS_OFF}
          action={onOpenPayments !== undefined ? { label: "Set up payments", onPress: onOpenPayments, testID: "package-review-payments" } : undefined}
          testID="package-review-payments-off"
        />
      ) : null}
      <View style={styles.reviewList} testID="package-review-summary">
        {reviewItems(draft, pool, currency).map((item) => (
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
  inlineRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap", alignItems: "flex-end" },
  grow: { flex: 1, minWidth: 140 },
  subCard: { gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  tierRow: { gap: space[2], paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: color.line },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" },
  rowActions: { flexDirection: "row", alignItems: "center", gap: space[1], flexWrap: "wrap" },
  rowTitle: { ...type.row, color: color.text1 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  addRow: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  timeChip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.full, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.inset },
  timeChipText: { ...type.small, color: color.text1, fontVariant: ["tabular-nums"] },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2] },
  switchTitle: { ...type.row, color: color.text1 },
  rungRow: { gap: space[1] },
  rungRemove: { alignSelf: "flex-end" },
  readiness: { gap: space[2] },
  readinessRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  reviewList: { gap: space[2] },
  reviewRow: { flexDirection: "row", gap: space[3], flexWrap: "wrap" },
  reviewLabel: { ...type.small, color: color.text2, width: 140 },
  reviewValue: { ...type.small, color: color.text1, fontWeight: "600", flex: 1, minWidth: 180 },
});
