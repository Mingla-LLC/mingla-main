/**
 * TripCreatorStep4Pricing — Step 4 of TripCreatorWizard.
 *
 * META-ORCH-1174 Leg B2 [MULTI-PACKAGE AUTHORING]: a trip may now offer
 * MULTIPLE packages (e.g. Standard / Premium / VIP). The step renders an
 * inline list of package rows with Add package / Remove package (soft cap 6,
 * min 1 — DEC-E). Per-package fields (DEC-G): name, price (major units),
 * optional description, per-package capacity/spots (DEC-D), and an optional
 * per-package payment plan (Pay-over-time — reuses the existing
 * PaymentPlanEditor → tier_metadata.installments shape). Free packages
 * (price 0) are allowed alongside paid ones (DEC-I).
 *
 * Each package persists as its own trip_pricing_tiers / ticket_types row via
 * the B1 service fns (updateTripPricing / createTripPricingTier /
 * removeTripPricingTier). The single-package trip is just N=1 — the legacy
 * call shape is preserved.
 *
 * Currency is auto-derived from the event (set at create time from
 * brand.default_currency) and shown read-only — the
 * tg_enforce_event_ticket_currency trigger (ORCH-0769) rejects any
 * ticket_types.currency that doesn't match events.currency, so the wizard
 * never sends a user-typed currency.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_META-ORCH-1174_LEGB_MULTITIER.md §C/§D.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { PaymentPlanEditor, type TripInstallmentSchedule } from "./PaymentPlanEditor";
import { useRouter } from "expo-router";

import { WhoCoversCostsSection } from "../pricing/LazyWhoCoversCostsSection";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useBrandTaxRegistration } from "../../hooks/useBrandTaxRegistration";
// META-ORCH-1174 Leg B2 — soft cap (DEC-E) lives in the pure validator module
// (RN-free) so the wizard + edit-published path + tests share one source.
import { MAX_TRIP_PACKAGES } from "./tripPackagesValidation";
import { PayoutCountryInlinePrompt } from "../brand/PayoutCountryInlinePrompt";
import { pricesClearedNotice } from "../../utils/draftFollowsBrandCurrency";
import { featureFlags, isFeatureEnabled } from "../../config/featureFlags";
import {
  convertLegacyPlanToV2,
  DEFAULT_TRIP_PAYMENT_PLAN_V2,
  isTripPaymentPlanV2,
  TRIP_PLAN_V2_EDITOR_RUNTIME,
  type TripPaymentPlanV2,
} from "./tripPlanV2EditorModel";

// issue #3281 S3 — the Add-ons card loads only when EXPO_PUBLIC_FF_EXTRAS_ENABLED
// is on, so flag-off editors and the Host web boot carry none of it.
const LazyAddOnsEntry = React.lazy(() => import("../addOns/AddOnsEntry"));

// #4522 — one lazy owner for the complete v2 editor feature. Its preview is a
// static child inside that chunk; there is no nested lazy boundary.
const LazyPaymentPlanEditorV2 = React.lazy(() =>
  import("./PaymentPlanEditorV2").then((module) => ({
    default: module.PaymentPlanEditorV2,
  }))
);

export { MAX_TRIP_PACKAGES };

/**
 * META-ORCH-1174 Leg B2 — one authored package (pricing tier). The optional
 * `ticketTypeId` is PRESENT when the package already exists server-side
 * (seeded by createTripDraft, or persisted by a prior autosave) and ABSENT
 * for a row the operator just added in the UI (autosave will create it and
 * adopt the returned id). `soldCount` is server-derived per package for the
 * post-sale price lock (edit-published path).
 */
export interface Step4Package {
  /** Stable client-side key for list rendering (UUID-ish). Never persisted. */
  key: string;
  /** Server tier id — null until the package has been persisted. */
  ticketTypeId: string | null;
  name: string;
  priceMajor: string; // displayed string (decimal, e.g. "50.00")
  description: string; // optional marketing line; "" = none
  /** Per-package capacity/spots (DEC-D). null = not yet set. */
  capacity: number | null;
  /** Optional per-package payment plan (DEC-F). null = pay-in-full. */
  paymentPlan: TripInstallmentSchedule | TripPaymentPlanV2 | null;
  /** True once ≥1 buyer has booked THIS package — locks price + plan. */
  soldCount: number;
  /**
   * Issue #3645 — this package's price was cleared because the brand's currency
   * changed. While the price field is empty the package is "no price yet",
   * not free.
   */
  priceNeedsReentry?: boolean;
}

export interface Step4Draft {
  /**
   * META-ORCH-1174 Leg B2 — N packages. Always ≥1 (the seeded primary
   * package). packages[0] is the legacy "primary" tier (the one createTripDraft
   * seeded); additional packages are authored here.
   */
  packages: Step4Package[];
  /**
   * Read-only currency mirror of the event currency (set at create time from
   * brand.default_currency). NOT editable by the operator — the trigger
   * requires ticket_types.currency to match events.currency, and
   * events.currency is locked at create time.
   */
  currency: string;
  /**
   * ORCH-1006 — per-offering all-in pricing switches. Each NULL = inherit the
   * brand default; explicit boolean = override. Persisted to events.pass_* via
   * setTripPricingSwitches when the trip is unsold. Trip-wide (not per-package).
   */
  pricingSwitches: {
    passTax: boolean | null;
    passMinglaFee: boolean | null;
    passServiceFee: boolean | null;
  };
  /** #4522 — the first v2 plan is copied to every package by the server. */
  sharePaymentPlan?: boolean;
}

export interface TripCreatorStep4PricingProps {
  draft: Step4Draft;
  onChange: (patch: Partial<Step4Draft>) => void;
  disabled?: boolean;
  /**
   * #3645 — true when the trip is paid (or has a payment plan) and the brand
   * cannot take payments yet. Shows an informational card: the draft saves, and
   * a bank is only needed to publish. No button here — the stop, and the
   * "Connect bank" button, are on the Review step.
   */
  needsBankToPublish?: boolean;
  /** False/unknown keeps saved schedules visible but suspended and read-only. */
  paymentPlansAvailable: boolean;
  tripStartAt: string | null;
  timeZone: string | null;
  /** Keeps saved v2 plans visible while a caller's persistence path is read-only. */
  v2PlanAuthoringLocked?: boolean;
  v2PlanAuthoringLockedReason?: string;
  /** Published trips may edit existing packages but this RPC cannot add/delete them. */
  allowPackageStructureChanges?: boolean;
  /** Published package capacity is not part of the atomic live-trip command. */
  allowCapacityChange?: boolean;
  /** The live command preserves, but cannot toggle, the stored shared-plan bit. */
  showSharePaymentPlanControl?: boolean;
  /**
   * issue #3281 S3 — the saved trip's id: shows the Add-ons card when
   * EXPO_PUBLIC_FF_EXTRAS_ENABLED is on. Omitted: nothing changes.
   */
  addOnsEventId?: string | null;
}

export const TRIP_PAYMENT_PLAN_UNAVAILABLE_COPY =
  "Payment plans aren't available with this payment setup. Your saved schedule is kept, but buyers can't select it.";

/** #3645 — locked copy for the pricing step's "keep building" card. */
export const TRIP_PRICING_KEEP_BUILDING_TITLE = "You can keep building";
export const TRIP_PRICING_KEEP_BUILDING_BODY =
  "This trip saves as a draft. You'll need a bank connected before you publish it with a price.";

const INPUT_BORDER = color.lineStrong;
const INPUT_BG = color.fill.inset;

let _pkgKeySeq = 0;
/** Generate a stable client-side list key for a freshly-added package row. */
export function makePackageKey(): string {
  _pkgKeySeq += 1;
  return `pkg-${Date.now().toString(36)}-${_pkgKeySeq}`;
}

/** Default payment plan when a package's Pay-over-time toggle flips on. */
const DEFAULT_PAYMENT_PLAN: TripInstallmentSchedule = {
  deposit_pct: 25,
  installments: [
    { ordinal: 1, pct: 50, days_after_booking: 30 },
    { ordinal: 2, pct: 25, days_after_booking: 60 },
  ],
};

/**
 * META-ORCH-1174 Leg B2 — per-package authoring card. Owns one package's
 * name / price / description / capacity / optional payment plan. Emits a
 * partial patch up to the parent via onPatch; removal via onRemove.
 */
interface PackageCardProps {
  pkg: Step4Package;
  index: number;
  currency: string;
  disabled?: boolean;
  paymentPlansAvailable: boolean;
  tripStartAt: string | null;
  timeZone: string | null;
  packageCount: number;
  sharePaymentPlan: boolean;
  onSharePaymentPlanChange: (next: boolean) => void;
  v2PlanAuthoringLocked: boolean;
  v2PlanAuthoringLockedReason?: string;
  allowCapacityChange: boolean;
  showSharePaymentPlanControl: boolean;
  /** Whether a Remove control is shown (false when only 1 package remains). */
  canRemove: boolean;
  onPatch: (patch: Partial<Step4Package>) => void;
  onRemove: () => void;
}

const PackageCard: React.FC<PackageCardProps> = ({
  pkg,
  index,
  currency,
  disabled,
  paymentPlansAvailable,
  tripStartAt,
  timeZone,
  packageCount,
  sharePaymentPlan,
  onSharePaymentPlanChange,
  v2PlanAuthoringLocked,
  v2PlanAuthoringLockedReason,
  allowCapacityChange,
  showSharePaymentPlanControl,
  canRemove,
  onPatch,
  onRemove,
}) => {
  const [confirmRemovePlanOpen, setConfirmRemovePlanOpen] = useState(false);
  const priceCents = Math.round((parseFloat(pkg.priceMajor) || 0) * 100);
  const priceAwaitingReentry =
    pkg.priceNeedsReentry === true && pkg.priceMajor.trim().length === 0;
  const planEnabled = pkg.paymentPlan !== null;
  let v2Plan: TripPaymentPlanV2 | null = null;
  let legacyPlan: TripInstallmentSchedule | null = null;
  if (pkg.paymentPlan !== null) {
    if (isTripPaymentPlanV2(pkg.paymentPlan)) {
      v2Plan = pkg.paymentPlan;
    } else {
      legacyPlan = pkg.paymentPlan;
    }
  }
  // Post-sale price lock — the server's `tier_price_change_with_sales` refund
  // gate rejects any price change on a sold package; this removes the editable
  // affordance for clarity.
  const priceLocked = pkg.soldCount > 0;
  const planLocked = pkg.soldCount > 0;
  const planSuspended = !paymentPlansAvailable;
  const sharedFollower = sharePaymentPlan && index > 0;
  const rollbackLocked = v2Plan !== null && !featureFlags.tripPlanV2;
  const stagedAuthoringLocked = featureFlags.tripPlanV2 && v2PlanAuthoringLocked;

  const handleTogglePlan = useCallback(
    (next: boolean) => {
      if (next === planEnabled) return;
      if (
        planLocked ||
        planSuspended ||
        sharedFollower ||
        rollbackLocked ||
        stagedAuthoringLocked
      ) return;
      if (next) {
        onPatch({
          paymentPlan: featureFlags.tripPlanV2
            ? {
                ...DEFAULT_TRIP_PAYMENT_PLAN_V2,
                deposit: { ...DEFAULT_TRIP_PAYMENT_PLAN_V2.deposit },
                flex: { enabled: false },
              }
            : {
                ...DEFAULT_PAYMENT_PLAN,
                installments: DEFAULT_PAYMENT_PLAN.installments.map((row) => ({ ...row })),
              },
        });
        return;
      }
      // Toggle-off destroys a configured schedule → confirm.
      setConfirmRemovePlanOpen(true);
    },
    [
      onPatch,
      planEnabled,
      planLocked,
      planSuspended,
      sharedFollower,
      rollbackLocked,
      stagedAuthoringLocked,
    ],
  );

  const handleConfirmRemovePlan = useCallback(() => {
    setConfirmRemovePlanOpen(false);
    onPatch({ paymentPlan: null });
  }, [onPatch]);

  return (
    <View style={styles.packageCard} testID={`trip-step4-package-${index}`}>
      <View style={styles.packageHeader}>
        <Text style={styles.packageHeaderTitle}>
          {pkg.name.trim().length > 0 ? pkg.name : `Package ${index + 1}`}
        </Text>
        {canRemove ? (
          <Pressable
            onPress={onRemove}
            disabled={disabled === true}
            accessibilityRole="button"
            accessibilityLabel={`Remove package ${index + 1}`}
            style={styles.packageRemoveBtn}
            testID={`trip-step4-package-remove-${index}`}
          >
            <Icon name="trash" size={16} color={color.danger} />
            <Text style={styles.packageRemoveText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Package name</Text>
        <TextInput
          value={pkg.name}
          onChangeText={(v) => onPatch({ name: v })}
          placeholder="e.g. Standard, VIP, Double occupancy"
          placeholderTextColor={color.text3}
          editable={disabled !== true}
          accessibilityLabel={`Package ${index + 1} name`}
          style={styles.textInput}
          testID={`trip-step4-package-name-${index}`}
        />
      </View>

      <View style={styles.priceRow}>
        <View style={[styles.fieldGroup, { flex: 2 }]}>
          <Text style={styles.fieldLabel}>Price per spot</Text>
          {priceLocked ? (
            <View
              style={styles.readonlyField}
              testID={`trip-step4-price-readonly-${index}`}
            >
              <Text style={styles.readonlyValue}>{pkg.priceMajor || "—"}</Text>
            </View>
          ) : (
            <TextInput
              value={pkg.priceMajor}
              onChangeText={(v) => {
                // Allow digits + single decimal point only.
                const clean = v.replace(/[^0-9.]/g, "");
                const parts = clean.split(".");
                const normalized =
                  parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : clean;
                onPatch({ priceMajor: normalized });
              }}
              placeholder="0.00"
              placeholderTextColor={color.text3}
              keyboardType="decimal-pad"
              editable={disabled !== true}
              accessibilityLabel={`Package ${index + 1} price per spot`}
              style={styles.textInput}
              testID={`trip-step4-price-${index}`}
            />
          )}
        </View>
        <View style={[styles.fieldGroup, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Currency</Text>
          <View
            style={styles.readonlyField}
            testID={`trip-step4-currency-readonly-${index}`}
          >
            <Text style={styles.readonlyValue}>{currency.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      {/* Issue #3645 — a price cleared by a currency change is not "free". */}
      {!priceLocked && priceAwaitingReentry ? (
        <Text
          style={styles.freeHint}
          accessibilityRole="alert"
          testID={`trip-step4-price-reentry-${index}`}
        >
          {"Your brand's currency changed. Enter this package's price again."}
        </Text>
      ) : null}

      {/* Free-package hint — price 0 is allowed (DEC-I). */}
      {!priceLocked && priceCents === 0 && !priceAwaitingReentry ? (
        <Text style={styles.freeHint} testID={`trip-step4-free-hint-${index}`}>
          Free package — buyers reserve a spot at no charge.
        </Text>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Spots in this package</Text>
        {allowCapacityChange ? (
          <TextInput
            value={pkg.capacity === null ? "" : String(pkg.capacity)}
            onChangeText={(v) => {
              const digits = v.replace(/[^0-9]/g, "");
              onPatch({
                capacity: digits.length > 0 ? parseInt(digits, 10) : null,
              });
            }}
            placeholder="e.g. 20"
            placeholderTextColor={color.text3}
            keyboardType="number-pad"
            editable={disabled !== true}
            accessibilityLabel={`Package ${index + 1} spots`}
            style={styles.textInput}
            testID={`trip-step4-capacity-${index}`}
          />
        ) : (
          <View
            style={styles.readonlyField}
            testID={`trip-step4-capacity-readonly-${index}`}
          >
            <Text style={styles.readonlyValue}>{pkg.capacity ?? "No limit"}</Text>
          </View>
        )}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Description (optional)</Text>
        <TextInput
          value={pkg.description}
          onChangeText={(v) => onPatch({ description: v })}
          placeholder="What's included in this package"
          placeholderTextColor={color.text3}
          editable={disabled !== true}
          multiline
          accessibilityLabel={`Package ${index + 1} description`}
          style={[styles.textInput, styles.descriptionInput]}
          testID={`trip-step4-description-${index}`}
        />
      </View>

      {priceLocked ? (
        <Text
          style={styles.lockedHint}
          testID={`trip-step4-price-locked-hint-${index}`}
        >
          Existing travelers are protected at the price they paid. Refund all{" "}
          {pkg.soldCount} buyer{pkg.soldCount === 1 ? "" : "s"} before changing
          this price (or add a new package at the new price).
        </Text>
      ) : null}

      {/* Per-package payment plan toggle + editor (DEC-F). */}
      <View style={styles.paymentPlanSection}>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={`Package ${index + 1} payment plan toggle`}
          accessibilityState={{
            checked: planEnabled,
            disabled:
              disabled === true ||
              planLocked ||
              planSuspended ||
              sharedFollower ||
              rollbackLocked ||
              stagedAuthoringLocked,
          }}
          onPress={() => {
            if (
              disabled === true ||
              planLocked ||
              planSuspended ||
              sharedFollower ||
              rollbackLocked ||
              stagedAuthoringLocked
            ) return;
            handleTogglePlan(!planEnabled);
          }}
          style={styles.paymentPlanToggleRow}
        >
          <View style={styles.paymentPlanToggleLeft}>
            <Text style={styles.paymentPlanTitle}>Payment plan</Text>
            <Text style={styles.paymentPlanSubtitle}>
              {planSuspended
                ? TRIP_PAYMENT_PLAN_UNAVAILABLE_COPY
                : rollbackLocked
                  ? "The new plan editor is switched off. Your saved plan is kept."
                  : stagedAuthoringLocked
                    ? v2PlanAuthoringLockedReason ?? "Your saved plan is kept."
                    : planLocked
                      ? "Locked — at least one buyer has booked under this schedule."
                      : planEnabled
                        ? "Buyer pays a deposit at booking; remaining installments auto-charge on schedule."
                        : "Collect a deposit at booking, then auto-charge installments on a schedule you set."}
            </Text>
          </View>
          <Switch
            value={planEnabled}
            onValueChange={handleTogglePlan}
            disabled={
              disabled === true ||
              planLocked ||
              planSuspended ||
              sharedFollower ||
              rollbackLocked ||
              stagedAuthoringLocked
            }
            trackColor={{ false: color.fill.step, true: color.accent }}
            thumbColor={color.paper}
            ios_backgroundColor={color.fill.step}
            accessibilityLabel={`Package ${index + 1} payment plan switch`}
          />
        </Pressable>
        {legacyPlan !== null && featureFlags.tripPlanV2 ? (
          <View style={styles.legacyPlanCard} testID={`trip-plan-v1-summary-${index}`}>
            <Text style={styles.paymentPlanTitle}>
              This package uses the older percent plan.
            </Text>
            <Text style={styles.paymentPlanSubtitle}>
              {legacyPlan.deposit_pct}% deposit, then {legacyPlan.installments.length}{" "}
              installment{legacyPlan.installments.length === 1 ? "" : "s"}.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                onPatch({ paymentPlan: convertLegacyPlanToV2(legacyPlan) })
              }
              disabled={
                planLocked ||
                planSuspended ||
                sharedFollower ||
                disabled === true ||
                stagedAuthoringLocked
              }
              style={styles.convertPlanButton}
              testID={`trip-plan-v1-convert-${index}`}
            >
              <Text style={styles.convertPlanButtonText}>
                Switch to the new plan setup
              </Text>
            </Pressable>
          </View>
        ) : legacyPlan !== null ? (
          <PaymentPlanEditor
            value={legacyPlan}
            onChange={(next) => onPatch({ paymentPlan: next })}
            totalAmountCents={priceCents}
            currency={currency}
            locked={planLocked || planSuspended || sharedFollower}
            lockedReason={
              planSuspended
                ? TRIP_PAYMENT_PLAN_UNAVAILABLE_COPY
                : sharedFollower
                  ? "Using the payment plan from the first package."
                  : undefined
            }
          />
        ) : v2Plan !== null ? (
          <React.Suspense
            fallback={
              <View style={styles.planSkeleton} testID="trip-plan-v2-loading">
                <Text style={styles.paymentPlanSubtitle}>Loading payment plan…</Text>
              </View>
            }
          >
            <LazyPaymentPlanEditorV2
              value={v2Plan}
              onChange={(next) => onPatch({ paymentPlan: next })}
              totalAmountMinor={priceCents}
              currency={currency}
              tripStartAt={tripStartAt}
              timeZone={timeZone}
              locked={
                planLocked ||
                planSuspended ||
                sharedFollower ||
                rollbackLocked ||
                stagedAuthoringLocked
              }
              lockedReason={
                planSuspended
                  ? TRIP_PAYMENT_PLAN_UNAVAILABLE_COPY
                  : sharedFollower
                    ? "Using the payment plan from the first package."
                    : rollbackLocked
                      ? "The new plan editor is switched off. Your saved plan is kept."
                      : stagedAuthoringLocked
                        ? v2PlanAuthoringLockedReason ?? "Your saved plan is kept."
                        : undefined
              }
              packageCount={packageCount}
              sharePaymentPlan={sharePaymentPlan}
              onSharePaymentPlanChange={onSharePaymentPlanChange}
              showShareControl={showSharePaymentPlanControl && index === 0}
              model={TRIP_PLAN_V2_EDITOR_RUNTIME}
            />
          </React.Suspense>
        ) : null}
      </View>

      <ConfirmDialog
        visible={confirmRemovePlanOpen}
        title="Remove payment plan?"
        description="This package will revert to single payment. Your current schedule will be discarded."
        confirmLabel="Remove plan"
        variant="simple"
        destructive
        onConfirm={handleConfirmRemovePlan}
        onClose={() => setConfirmRemovePlanOpen(false)}
      />
    </View>
  );
};

export const TripCreatorStep4Pricing: React.FC<TripCreatorStep4PricingProps> = ({
  draft,
  onChange,
  disabled,
  needsBankToPublish = false,
  paymentPlansAvailable,
  tripStartAt,
  timeZone,
  v2PlanAuthoringLocked = false,
  v2PlanAuthoringLockedReason,
  allowPackageStructureChanges = true,
  allowCapacityChange = true,
  showSharePaymentPlanControl = true,
  addOnsEventId = null,
}) => {
  const brand = useCurrentBrand();
  const router = useRouter();
  const taxRegistration = useBrandTaxRegistration(brand?.id ?? null);
  const [confirmRemovePkgKey, setConfirmRemovePkgKey] = useState<string | null>(
    null,
  );

  const packages = draft.packages;
  const pricesAwaitingReentry = packages.some(
    (p) => p.priceNeedsReentry === true && p.priceMajor.trim().length === 0,
  );
  const canAdd =
    allowPackageStructureChanges && packages.length < MAX_TRIP_PACKAGES;
  const canRemoveAny = allowPackageStructureChanges && packages.length > 1;

  // Live preview base for the WhoCoversCosts section = MIN package price
  // (the "From" price buyers see). 0 when no priced packages.
  const previewBaseCents = useMemo(() => {
    const prices = packages
      .map((p) => Math.round((parseFloat(p.priceMajor) || 0) * 100))
      .filter((c) => c > 0);
    return prices.length > 0 ? Math.min(...prices) : 0;
  }, [packages]);

  // Any sold package locks the trip-wide pricing switches (post-sale lock).
  const anySold = useMemo(
    () => packages.some((p) => p.soldCount > 0),
    [packages],
  );

  const patchPackage = useCallback(
    (key: string, patch: Partial<Step4Package>) => {
      // The approved multi-package default is shared. Turn it on only when a
      // brand-new v2 plan is first enabled on the primary package; converting
      // a legacy package never overwrites distinct legacy plans implicitly.
      const defaultsNewPlanToShared =
        featureFlags.tripPlanV2 &&
        packages.length > 1 &&
        key === packages[0]?.key &&
        packages[0]?.paymentPlan === null &&
        patch.paymentPlan !== null &&
        patch.paymentPlan !== undefined &&
        isTripPaymentPlanV2(patch.paymentPlan);
      const isSharedPlanChange =
        (draft.sharePaymentPlan === true || defaultsNewPlanToShared) &&
        key === packages[0]?.key &&
        Object.prototype.hasOwnProperty.call(patch, "paymentPlan");
      onChange({
        ...(defaultsNewPlanToShared ? { sharePaymentPlan: true } : {}),
        packages: packages.map((p) =>
          p.key === key
            ? { ...p, ...patch }
            : isSharedPlanChange
              ? { ...p, paymentPlan: patch.paymentPlan ?? null }
              : p,
        ),
      });
    },
    [draft.sharePaymentPlan, onChange, packages],
  );

  const handleSharePaymentPlanChange = useCallback(
    (next: boolean): void => {
      const firstPlan = packages[0]?.paymentPlan ?? null;
      onChange({
        sharePaymentPlan: next,
        ...(next
          ? {
              packages: packages.map((pkg, index) =>
                index === 0 ? pkg : { ...pkg, paymentPlan: firstPlan }
              ),
            }
          : {}),
      });
    },
    [onChange, packages],
  );

  const handleAddPackage = useCallback(() => {
    if (!canAdd) return;
    onChange({
      packages: [
        ...packages,
        {
          key: makePackageKey(),
          ticketTypeId: null,
          name: "",
          priceMajor: "",
          description: "",
          // Seed capacity from the primary package so the operator has a
          // sensible default; freely editable per-package (DEC-D).
          capacity: packages[0]?.capacity ?? null,
          paymentPlan:
            draft.sharePaymentPlan === true
              ? packages[0]?.paymentPlan ?? null
              : null,
          soldCount: 0,
        },
      ],
    });
  }, [canAdd, draft.sharePaymentPlan, onChange, packages]);

  const handleRequestRemove = useCallback(
    (key: string) => {
      const pkg = packages.find((p) => p.key === key);
      if (pkg === undefined) return;
      // A never-persisted, untouched package removes silently; otherwise confirm.
      const isEmpty =
        pkg.ticketTypeId === null &&
        pkg.name.trim().length === 0 &&
        pkg.priceMajor.trim().length === 0 &&
        pkg.description.trim().length === 0 &&
        pkg.paymentPlan === null;
      if (isEmpty) {
        onChange({ packages: packages.filter((p) => p.key !== key) });
        return;
      }
      setConfirmRemovePkgKey(key);
    },
    [onChange, packages],
  );

  const handleConfirmRemovePackage = useCallback(() => {
    if (confirmRemovePkgKey === null) return;
    onChange({
      packages: packages.filter((p) => p.key !== confirmRemovePkgKey),
    });
    setConfirmRemovePkgKey(null);
  }, [confirmRemovePkgKey, onChange, packages]);

  return (
    <View style={styles.host}>
      <Text style={styles.helper}>
        Offer one or more packages (e.g. Standard, Premium, VIP). Each package
        has its own price, spots, and optional payment plan. Free packages are
        allowed alongside paid ones.
      </Text>

      {/* Issue #3645 — the brand's currency changed and these prices were
          cleared. Stays until every cleared package has a price again. */}
      {pricesAwaitingReentry && draft.currency.trim().length > 0 ? (
        <Text
          style={styles.freeHint}
          accessibilityRole="alert"
          testID="trip-step4-prices-cleared-notice"
        >
          {pricesClearedNotice(draft.currency)}
        </Text>
      ) : null}

      {packages.map((pkg, index) => (
        <PackageCard
          key={pkg.key}
          pkg={pkg}
          index={index}
          currency={draft.currency}
          disabled={disabled}
          paymentPlansAvailable={paymentPlansAvailable}
          tripStartAt={tripStartAt}
          timeZone={timeZone}
          packageCount={packages.length}
          sharePaymentPlan={draft.sharePaymentPlan === true}
          onSharePaymentPlanChange={handleSharePaymentPlanChange}
          v2PlanAuthoringLocked={v2PlanAuthoringLocked}
          v2PlanAuthoringLockedReason={v2PlanAuthoringLockedReason}
          allowCapacityChange={allowCapacityChange}
          showSharePaymentPlanControl={showSharePaymentPlanControl}
          canRemove={canRemoveAny}
          onPatch={(patch) => patchPackage(pkg.key, patch)}
          onRemove={() => handleRequestRemove(pkg.key)}
        />
      ))}

      {allowPackageStructureChanges ? (
        <Pressable
          onPress={handleAddPackage}
          disabled={disabled === true || !canAdd}
          accessibilityRole="button"
          accessibilityLabel="Add package"
          accessibilityState={{ disabled: disabled === true || !canAdd }}
          style={[styles.addPackageBtn, !canAdd && styles.addPackageBtnDisabled]}
          testID="trip-step4-add-package"
        >
          <Icon
            name="plus"
            size={18}
            color={canAdd ? color.accent : color.text3}
          />
          <Text
            style={[
              styles.addPackageText,
              !canAdd && styles.addPackageTextDisabled,
            ]}
          >
            {canAdd
              ? "Add package"
              : `Up to ${MAX_TRIP_PACKAGES} packages per trip`}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.footnote} testID="trip-step4-package-structure-locked">
          Package capacity and package count stay fixed after publishing.
        </Text>
      )}

      {/* issue #3281 S3 — dark unless EXPO_PUBLIC_FF_EXTRAS_ENABLED is on. */}
      {isFeatureEnabled("extras") ? (
        <React.Suspense fallback={null}>
          <LazyAddOnsEntry eventId={addOnsEventId} offering="trip" currency={draft.currency} />
        </React.Suspense>
      ) : null}

      <Text style={styles.footnote}>
        Currency comes from your brand setup and can&apos;t be changed here.
      </Text>

      {/* #3645 — a package price on a brand with no currency asks for the
          payout country here, in place. */}
      <PayoutCountryInlinePrompt
        brand={brand}
        priced={previewBaseCents > 0}
        testID="trip-pricing-payout-country-prompt"
      />

      {/* #3645 — paid, no bank yet: reassure, do not block. */}
      {needsBankToPublish ? (
        <View
          style={styles.keepBuildingCard}
          accessibilityRole="text"
          testID="trip-pricing-keep-building-card"
        >
          <Text style={styles.keepBuildingTitle}>
            {TRIP_PRICING_KEEP_BUILDING_TITLE}
          </Text>
          <Text style={styles.keepBuildingBody}>
            {TRIP_PRICING_KEEP_BUILDING_BODY}
          </Text>
        </View>
      ) : null}

      {brand !== null ? (
        <WhoCoversCostsSection
          format="trip"
          overrides={draft.pricingSwitches}
          defaults={{
            passTax: brand.defaultPassTax ?? false,
            passMinglaFee: brand.defaultPassMinglaFee ?? false,
            passServiceFee: brand.defaultPassServiceFee ?? false,
          }}
          onChange={(next) => onChange({ pricingSwitches: next })}
          previewBaseCents={previewBaseCents}
          currency={draft.currency}
          effectiveTakeRateBps={brand.takeRateBpsOverride ?? DEFAULT_TAKE_RATE_BPS}
          paymentProvider={brand.paymentProvider}
          paymentCountry={brand.paymentCountry}
          locked={anySold}
          onEditDefaults={() =>
            router.push(`/brand/${brand.id}/pricing-defaults` as never)
          }
          vatRegistered={taxRegistration.data?.hasActiveRegistration === true}
          onSetupVat={() => router.push("/connect-tax-registrations" as never)}
        />
      ) : null}

      <ConfirmDialog
        visible={confirmRemovePkgKey !== null}
        title="Remove this package?"
        description="Travelers will no longer be able to book it. This can't be undone for a saved package."
        confirmLabel="Remove package"
        cancelLabel="Keep package"
        variant="simple"
        destructive
        onConfirm={handleConfirmRemovePackage}
        onClose={() => setConfirmRemovePkgKey(null)}
        testID="trip-step4-remove-package-dialog"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: space[4],
    paddingTop: space[2],
  },
  helper: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
  packageCard: {
    gap: space[4],
    padding: space[4],
    borderRadius: radiusTokens.lg,
    backgroundColor: color.fill.tableHead,
    borderWidth: 1,
    borderColor: color.line,
  },
  packageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  packageHeaderTitle: {
    flex: 1,
    fontSize: type.body.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  packageRemoveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: space[2],
  },
  packageRemoveText: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.danger,
  },
  fieldGroup: {
    gap: space[1],
  },
  fieldLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "600",
    color: color.text2,
  },
  textInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: color.text1,
    fontSize: type.body.fontSize,
  },
  descriptionInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  readonlyField: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.md,
    backgroundColor: color.fill.tableHead,
    borderWidth: 1,
    borderColor: color.line,
    justifyContent: "center",
  },
  readonlyValue: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  priceRow: {
    flexDirection: "row",
    gap: space[2],
  },
  freeHint: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    fontStyle: "italic",
  },
  footnote: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    fontStyle: "italic",
  },
  // #3645 — informational "keep building" card (neutral glass, not a warning).
  keepBuildingCard: {
    padding: space[4],
    borderRadius: radiusTokens.lg,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    gap: 2,
  },
  keepBuildingTitle: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  keepBuildingBody: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight * 1.35,
    color: color.text2,
  },
  lockedHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.accent,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    backgroundColor: color.accentTint,
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  addPackageBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    minHeight: 48,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  addPackageBtnDisabled: {
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tableHead,
  },
  addPackageText: {
    fontSize: type.body.fontSize,
    fontWeight: "700",
    color: color.accent,
  },
  addPackageTextDisabled: {
    color: color.text3,
  },
  // Payment plan section styles (ORCH-0873 lineage).
  paymentPlanSection: {
    gap: space[4],
  },
  paymentPlanToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tableHead,
    minHeight: 56,
  },
  paymentPlanToggleLeft: {
    flex: 1,
    paddingRight: space[4],
  },
  paymentPlanTitle: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  paymentPlanSubtitle: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
  legacyPlanCard: {
    gap: space[3],
    padding: space[4],
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  convertPlanButton: {
    alignSelf: "flex-start",
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  convertPlanButtonText: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
    color: color.accentText,
  },
  planSkeleton: {
    minHeight: 180,
    justifyContent: "center",
    alignItems: "center",
    padding: space[4],
    borderRadius: radiusTokens.md,
    backgroundColor: color.fill.inset,
  },
});

export default TripCreatorStep4Pricing;
