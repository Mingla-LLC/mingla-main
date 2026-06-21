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
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { PaymentPlanEditor, type TripInstallmentSchedule } from "./PaymentPlanEditor";
import { useRouter } from "expo-router";

import { WhoCoversCostsSection } from "../pricing/WhoCoversCostsSection";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useBrandTaxRegistration } from "../../hooks/useBrandTaxRegistration";
// META-ORCH-1174 Leg B2 — soft cap (DEC-E) lives in the pure validator module
// (RN-free) so the wizard + edit-published path + tests share one source.
import { MAX_TRIP_PACKAGES } from "./tripPackagesValidation";

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
  paymentPlan: TripInstallmentSchedule | null;
  /** True once ≥1 buyer has booked THIS package — locks price + plan. */
  soldCount: number;
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
}

export interface TripCreatorStep4PricingProps {
  draft: Step4Draft;
  onChange: (patch: Partial<Step4Draft>) => void;
  disabled?: boolean;
}

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

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
  canRemove,
  onPatch,
  onRemove,
}) => {
  const [confirmRemovePlanOpen, setConfirmRemovePlanOpen] = useState(false);
  const priceCents = Math.round((parseFloat(pkg.priceMajor) || 0) * 100);
  const planEnabled = pkg.paymentPlan !== null;
  // Post-sale price lock — the server's `tier_price_change_with_sales` refund
  // gate rejects any price change on a sold package; this removes the editable
  // affordance for clarity.
  const priceLocked = pkg.soldCount > 0;
  const planLocked = pkg.soldCount > 0;

  const handleTogglePlan = useCallback(
    (next: boolean) => {
      if (next === planEnabled) return;
      if (planLocked) return;
      if (next) {
        onPatch({ paymentPlan: { ...DEFAULT_PAYMENT_PLAN } });
        return;
      }
      // Toggle-off destroys a configured schedule → confirm.
      setConfirmRemovePlanOpen(true);
    },
    [onPatch, planEnabled, planLocked],
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
            <Icon name="trash" size={16} color={semantic.error} />
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
          placeholderTextColor={textTokens.tertiary}
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
              placeholderTextColor={textTokens.tertiary}
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

      {/* Free-package hint — price 0 is allowed (DEC-I). */}
      {!priceLocked && priceCents === 0 ? (
        <Text style={styles.freeHint} testID={`trip-step4-free-hint-${index}`}>
          Free package — buyers reserve a spot at no charge.
        </Text>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Spots in this package</Text>
        <TextInput
          value={pkg.capacity === null ? "" : String(pkg.capacity)}
          onChangeText={(v) => {
            const digits = v.replace(/[^0-9]/g, "");
            onPatch({
              capacity: digits.length > 0 ? parseInt(digits, 10) : null,
            });
          }}
          placeholder="e.g. 20"
          placeholderTextColor={textTokens.tertiary}
          keyboardType="number-pad"
          editable={disabled !== true}
          accessibilityLabel={`Package ${index + 1} spots`}
          style={styles.textInput}
          testID={`trip-step4-capacity-${index}`}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Description (optional)</Text>
        <TextInput
          value={pkg.description}
          onChangeText={(v) => onPatch({ description: v })}
          placeholder="What's included in this package"
          placeholderTextColor={textTokens.tertiary}
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
            disabled: disabled === true || planLocked,
          }}
          onPress={() => {
            if (disabled === true || planLocked) return;
            handleTogglePlan(!planEnabled);
          }}
          style={styles.paymentPlanToggleRow}
        >
          <View style={styles.paymentPlanToggleLeft}>
            <Text style={styles.paymentPlanTitle}>Payment plan</Text>
            <Text style={styles.paymentPlanSubtitle}>
              {planLocked
                ? "Locked — at least one buyer has booked under this schedule."
                : planEnabled
                  ? "Buyer pays a deposit at booking; remaining installments auto-charge on schedule."
                  : "Collect a deposit at booking, then auto-charge installments on a schedule you set."}
            </Text>
          </View>
          <Switch
            value={planEnabled}
            onValueChange={handleTogglePlan}
            disabled={disabled === true || planLocked}
            trackColor={{ false: "rgba(255,255,255,0.16)", true: accent.warm }}
            thumbColor="#ffffff"
            ios_backgroundColor="rgba(255,255,255,0.16)"
            accessibilityLabel={`Package ${index + 1} payment plan switch`}
          />
        </Pressable>
        {planEnabled || planLocked ? (
          <PaymentPlanEditor
            value={pkg.paymentPlan}
            onChange={(next) => onPatch({ paymentPlan: next })}
            totalAmountCents={priceCents}
            currency={currency}
            locked={planLocked}
          />
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
}) => {
  const brand = useCurrentBrand();
  const router = useRouter();
  const taxRegistration = useBrandTaxRegistration(brand?.id ?? null);
  const [confirmRemovePkgKey, setConfirmRemovePkgKey] = useState<string | null>(
    null,
  );

  const packages = draft.packages;
  const canAdd = packages.length < MAX_TRIP_PACKAGES;
  const canRemoveAny = packages.length > 1;

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
      onChange({
        packages: packages.map((p) =>
          p.key === key ? { ...p, ...patch } : p,
        ),
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
          paymentPlan: null,
          soldCount: 0,
        },
      ],
    });
  }, [canAdd, onChange, packages]);

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

      {packages.map((pkg, index) => (
        <PackageCard
          key={pkg.key}
          pkg={pkg}
          index={index}
          currency={draft.currency}
          disabled={disabled}
          canRemove={canRemoveAny}
          onPatch={(patch) => patchPackage(pkg.key, patch)}
          onRemove={() => handleRequestRemove(pkg.key)}
        />
      ))}

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
          color={canAdd ? accent.warm : textTokens.tertiary}
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

      <Text style={styles.footnote}>
        Currency comes from your brand setup and can&apos;t be changed here.
      </Text>

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
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  packageCard: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  packageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  packageHeaderTitle: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  packageRemoveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  packageRemoveText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: semantic.error,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
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
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  descriptionInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  readonlyField: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
  },
  readonlyValue: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  priceRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  freeHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  footnote: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  lockedHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: accent.warm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(235, 120, 37, 0.08)",
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.32)",
  },
  addPackageBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: 48,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: accent.warm,
    backgroundColor: "rgba(235, 120, 37, 0.06)",
  },
  addPackageBtnDisabled: {
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  addPackageText: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: accent.warm,
  },
  addPackageTextDisabled: {
    color: textTokens.tertiary,
  },
  // Payment plan section styles (ORCH-0873 lineage).
  paymentPlanSection: {
    gap: spacing.md,
  },
  paymentPlanToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    minHeight: 56,
  },
  paymentPlanToggleLeft: {
    flex: 1,
    paddingRight: spacing.md,
  },
  paymentPlanTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  paymentPlanSubtitle: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
});

// Reference the imported semantic token to keep tree-shaking honest in case
// of future styling additions.
void semantic;

export default TripCreatorStep4Pricing;
