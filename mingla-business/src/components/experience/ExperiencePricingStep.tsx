/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 5
 * Step 4 — PRICING (whole-experience vs per-stop).
 *
 * Authoritative design: DESIGN_META-ORCH-1059_WIZARD_STOPS_PRICING.md §4.
 * A two-mode toggle: "One price for the whole experience" vs "Price each stop."
 * issue #3281 R2 — whole mode also supports multiple price options with a unit
 * (person | group | block). Per-stop prices remain person-only itemised breakdown.
 * WhoCoversCostsSection (the 3 pass/absorb switches) is kept VERBATIM.
 *
 * issue #3284 [refund terms] — a REFUND POLICY card follows WhoCoversCostsSection
 * (money stays together; display settings stay last): the shared
 * RefundPolicyEditor with experience presets, the honesty helper, and — in live
 * edit once someone has booked — a read-only warning that terms cannot be made
 * worse. Identical in create, draft-edit and live-edit; the wizard owns the value
 * and writes it through the gated refund-terms owner.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
// issue #3284 [bundle budget] — the editor loads in its own chunk (ORCH-1083);
// never import ./RefundPolicyEditor statically here.
import { LazyRefundPolicyEditor as RefundPolicyEditor } from "../trip/LazyRefundPolicyEditor";
import type { RefundPolicy } from "../../services/refundPolicyService";
import { WhoCoversCostsSection } from "../pricing/LazyWhoCoversCostsSection";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import type { PricingSwitchOverrides } from "../../services/pricingSwitchesService";
import type {
  ExperienceBlockMinutes,
  ExperiencePriceBasis,
  ExperiencePriceOptionDraft,
  ExperiencePricingMode,
  ExperienceStopDraft,
} from "./experienceWizardTypes";
import {
  EXPERIENCE_BLOCK_MINUTES,
  emptyPriceOption,
  priceOptionNameIssue,
  experienceBlockPillLabel,
  perStopTotalMinor,
} from "./experienceWizardTypes";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
import {
  priceDecimals,
  priceFallbackDecimals,
} from "@mingla/offering-rendering/priceDecimals";
import { ExtraGuestsField } from "../ui/ExtraGuestsField";
import { HIDE_REMAINING_LOCKED_SUB } from "../../constants/guestListPrivacy";

import { isFeatureEnabled } from "../../config/featureFlags";

// issue #3281 S3 — the Add-ons card loads only when EXPO_PUBLIC_FF_EXTRAS_ENABLED
// is on, so flag-off editors and the Host web boot carry none of it.
const LazyAddOnsEntry = React.lazy(() => import("../addOns/AddOnsEntry"));

const MAX_PRICE_OPTIONS = 8;

export interface ExperiencePricingStepProps {
  currencySymbol: string;
  /** null when the brand has no currency yet (#3645): previews show no symbol. */
  currency: string | null;
  pricingMode: ExperiencePricingMode;
  setPricingMode: (m: ExperiencePricingMode) => void;
  stops: ExperienceStopDraft[];
  setStops: React.Dispatch<React.SetStateAction<ExperienceStopDraft[]>>;
  wholePriceMajor: string;
  setWholePriceMajor: (v: string) => void;
  /** issue #3281 R2 — sellable price options (1..N). */
  priceOptions: ExperiencePriceOptionDraft[];
  setPriceOptions: React.Dispatch<
    React.SetStateAction<ExperiencePriceOptionDraft[]>
  >;
  isFree: boolean;
  setIsFree: (v: boolean) => void;
  capacity: string;
  setCapacity: (v: string) => void;
  unlimited: boolean;
  setUnlimited: (v: boolean) => void;
  /** issue #3281 R3 — total | per_day | per_start (default total). */
  capacityScope?: "total" | "per_day" | "per_start";
  setCapacityScope?: (v: "total" | "per_day" | "per_start") => void;
  pricingSwitches: PricingSwitchOverrides;
  setPricingSwitches: (s: PricingSwitchOverrides) => void;
  brandDefaults: {
    passTax: boolean;
    passMinglaFee: boolean;
    passServiceFee: boolean;
  };
  takeRateBps: number;
  paymentProvider?: "stripe" | "paystack" | null;
  paymentCountry?: string | null;
  vatRegistered: boolean;
  onEditDefaults: () => void;
  onSetupVat: () => void;
  showErrors: boolean;
  privateGuestList: boolean;
  setPrivateGuestList: (v: boolean) => void;
  hideRemainingCount: boolean;
  setHideRemainingCount: (v: boolean) => void;
  /** issue #3827 going-box — guests on the host's own list (0..5000). */
  extraGuestCount: number;
  setExtraGuestCount: (n: number) => void;
  refundPolicy: RefundPolicy | null;
  setRefundPolicy: (policy: RefundPolicy | null) => void;
  liveSoldCount?: number;
  /**
   * issue #3281 S3 — the saved experience's id: shows the Add-ons card when
   * EXPO_PUBLIC_FF_EXTRAS_ENABLED is on. Omitted: nothing changes.
   */
  addOnsEventId?: string | null;
}

const REFUND_HELPER_PAID =
  "Guests see these terms before they book. You issue refunds from Orders — Mingla doesn't refund automatically yet.";
const REFUND_HELPER_FREE =
  "This experience is free, so guests won't see this unless you add a price.";
const refundSalesBannerCopy = (n: number): string =>
  `${n} guest${n === 1 ? "" : "s"} already booked under these terms. More-generous refunds or an extra tier save instantly — but you can't make terms worse for them here.`;

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) && v >= 0 ? v : 0;
};

export const ExperiencePricingStep: React.FC<ExperiencePricingStepProps> = ({
  currencySymbol,
  currency,
  pricingMode,
  setPricingMode,
  stops,
  setStops,
  wholePriceMajor,
  setWholePriceMajor,
  priceOptions,
  setPriceOptions,
  isFree,
  setIsFree,
  capacity,
  setCapacity,
  unlimited,
  setUnlimited,
  capacityScope = "total",
  setCapacityScope,
  pricingSwitches,
  setPricingSwitches,
  brandDefaults,
  takeRateBps,
  paymentProvider,
  paymentCountry,
  vatRegistered,
  onEditDefaults,
  onSetupVat,
  showErrors,
  privateGuestList,
  setPrivateGuestList,
  hideRemainingCount,
  setHideRemainingCount,
  extraGuestCount,
  setExtraGuestCount,
  refundPolicy,
  setRefundPolicy,
  liveSoldCount = 0,
  addOnsEventId = null,
}) => {
  const n = stops.length;
  // Q1 (#3827) — locked on while private (an older private experience saved
  // before this rule keeps an unlocked switch in its real state).
  const hideRemainingLocked = privateGuestList && hideRemainingCount;
  const defaultOption = priceOptions[0];
  const hasNonPersonOption = priceOptions.some(
    (o) => !o.isHidden && o.priceBasis !== "person",
  );
  const perStopAllowed = !hasNonPersonOption;

  const resolvedTotalMajor = isFree
    ? 0
    : pricingMode === "whole"
      ? num(defaultOption?.priceMajor ?? wholePriceMajor)
      : // #3645 bundle 2A — the server's per-stop sum: each stop rounded to
        // minor units first. The summary, Total and costs preview all read it.
        perStopTotalMinor(stops) / 100;

  const updateStopPrice = (i: number, v: string): void => {
    setStops((prev) => prev.map((s, idx) => (idx === i ? { ...s, priceMajor: v } : s)));
  };

  const patchOption = (
    clientId: string,
    patch: Partial<ExperiencePriceOptionDraft>,
  ): void => {
    setPriceOptions((prev) =>
      prev.map((o) => (o.clientId === clientId ? { ...o, ...patch } : o)),
    );
    if (
      defaultOption !== undefined &&
      clientId === defaultOption.clientId &&
      patch.priceMajor !== undefined
    ) {
      setWholePriceMajor(patch.priceMajor);
    }
    if (
      patch.priceBasis !== undefined &&
      patch.priceBasis !== "person" &&
      pricingMode === "per_stop"
    ) {
      setPricingMode("whole");
    }
  };

  const addPriceOption = (): void => {
    if (priceOptions.length >= MAX_PRICE_OPTIONS) return;
    setPriceOptions((prev) => [
      ...prev,
      emptyPriceOption({
        // #4490 — the host names every price; no "Option N" stand-in.
        name: "",
        priceMajor: "",
        priceBasis: "person",
        capacity: unlimited ? null : parseInt(capacity, 10) || null,
      }),
    ]);
  };

  const removeOrHideOption = (clientId: string): void => {
    setPriceOptions((prev) => {
      if (prev.length <= 1) return prev;
      const target = prev.find((o) => o.clientId === clientId);
      if (target === undefined) return prev;
      if (target.soldCount > 0) {
        return prev.map((o) =>
          o.clientId === clientId ? { ...o, isHidden: true } : o,
        );
      }
      const next = prev.filter((o) => o.clientId !== clientId);
      // Removing the lead option promotes the next — mirror its price into
      // wholePriceMajor so save/reopen stays coherent (#3281 Copilot).
      if (prev[0]?.clientId === clientId && next[0] !== undefined) {
        setWholePriceMajor(next[0].priceMajor);
      }
      return next;
    });
  };

  const formatSummaryTotal = (major: number): string => {
    const code = (currency ?? "").trim().toUpperCase();
    if (code.length === 3) {
      try {
        return withCurrencyGlyph(
          new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: code,
            ...priceDecimals(major),
          }).format(major),
          code,
        );
      } catch {
        return `${currencySymbol}${major.toFixed(priceFallbackDecimals(major))}`;
      }
    }
    const decimals = priceFallbackDecimals(major);
    return `${currencySymbol}${major.toFixed(decimals)}`;
  };

  // #3645 bundle 2A — paid but resolving to 0 minor units, exactly as the
  // server sums it (per stop: each stop rounded first).
  const unpriced =
    !isFree &&
    Math.round(resolvedTotalMajor * 100) <= 0;

  const summaryCopy = (): string => {
    const t = formatSummaryTotal(resolvedTotalMajor);
    const stopWord = n === 1 ? "stop" : "stops";
    if (isFree) {
      return `Free for buyers — they get ${n === 1 ? "this experience" : `all ${n} ${stopWord}`} in one booking.`;
    }
    // #3645 bundle 2A — a paid experience at 0 is not free: only the free
    // switch makes it free (the server refuses it otherwise).
    if (unpriced) {
      return pricingMode === "per_stop"
        ? "No price yet. Give at least one stop a price, or mark the experience free."
        : "No price yet. Set a price, or mark the experience free.";
    }
    if (priceOptions.filter((o) => !o.isHidden).length > 1) {
      return `From ${t}. Buyers pick a price, then book the whole experience.`;
    }
    if (pricingMode === "whole") {
      return `Buyers pay ${t} for ${n === 1 ? "this experience" : `all ${n} ${stopWord}`} — one booking.`;
    }
    return `Stops add up to ${t}. Buyers pay it once — one booking, the whole experience. They can't buy stops separately.`;
  };

  return (
    <View style={styles.stepBody}>
      <Text style={styles.title}>Pricing</Text>

      <View style={styles.modeToggle} accessibilityRole="tablist">
        <Pressable
          onPress={() => setPricingMode("whole")}
          accessibilityRole="tab"
          accessibilityState={{ selected: pricingMode === "whole" }}
          accessibilityLabel="One price for the whole experience"
          style={[styles.modeSeg, pricingMode === "whole" && styles.modeSegActive]}
        >
          <Text style={[styles.modeSegText, pricingMode === "whole" && styles.modeSegTextActive]}>
            One price for the whole experience
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (!perStopAllowed) return;
            setPricingMode("per_stop");
          }}
          accessibilityRole="tab"
          accessibilityState={{
            selected: pricingMode === "per_stop",
            disabled: !perStopAllowed,
          }}
          accessibilityLabel="Price each stop"
          style={[
            styles.modeSeg,
            pricingMode === "per_stop" && styles.modeSegActive,
            !perStopAllowed && styles.modeSegDisabled,
          ]}
        >
          <Text
            style={[
              styles.modeSegText,
              pricingMode === "per_stop" && styles.modeSegTextActive,
              !perStopAllowed && styles.modeSegTextDisabled,
            ]}
          >
            Price each stop
          </Text>
        </Pressable>
      </View>
      {!perStopAllowed ? (
        <Text style={styles.helper}>
          Group and time-block prices use one price for the whole experience.
        </Text>
      ) : null}

      {/* #3645 bundle 2A — the free switch shows in both modes: in per-stop
          mode, stops left at 0 no longer make the experience free. */}
      <ToggleRow
        label="This experience is free"
        value={isFree}
        onToggle={() => setIsFree(!isFree)}
      />

      {pricingMode === "whole" ? (
        <>
          {!isFree ? (
            <>
              {priceOptions.map((opt, idx) => (
                <PriceOptionRow
                  key={opt.clientId}
                  option={opt}
                  index={idx}
                  canRemove={priceOptions.length > 1}
                  currencySymbol={currencySymbol}
                  showErrors={showErrors}
                  onPatch={patchOption}
                  onRemoveOrHide={removeOrHideOption}
                />
              ))}
              {priceOptions.length < MAX_PRICE_OPTIONS ? (
                <Pressable
                  onPress={addPriceOption}
                  accessibilityRole="button"
                  accessibilityLabel="Add another price"
                  style={({ pressed }) => [
                    styles.addPriceCta,
                    pressed && styles.pressed,
                  ]}
                  testID="experience-pricing-add-price"
                >
                  <Icon name="plus" size={18} color={color.accent} />
                  <Text style={styles.addPriceText}>Add another price</Text>
                </Pressable>
              ) : null}
              {/* #3645 bundle 2A — the same minor-unit rule the server and the
                  summary use: a price that rounds to 0 is no price. */}
              {showErrors && unpriced ? (
                <Text style={styles.inlineError}>
                  Set a price, or mark the experience free.
                </Text>
              ) : null}
            </>
          ) : null}
        </>
      ) : isFree ? null : (
        <>
          <Text style={styles.sectionLabel}>PER-STOP PRICES</Text>
          {stops.map((s, i) => (
            <View key={s.clientId} style={styles.perStopRow}>
              <View style={styles.miniBadge}>
                <Text style={styles.miniBadgeText}>{i + 1}</Text>
              </View>
              <Text style={styles.perStopName} numberOfLines={1}>
                {s.placeName.trim().length > 0 ? s.placeName : `Stop ${i + 1}`}
              </Text>
              <View style={styles.perStopPrice}>
                <Input
                  variant="number"
                  value={s.priceMajor}
                  onChangeText={(v) => updateStopPrice(i, v)}
                  placeholder="0.00"
                  accessibilityLabel={`Price for stop ${i + 1}`}
                />
              </View>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatSummaryTotal(resolvedTotalMajor)}</Text>
          </View>
          {showErrors && unpriced ? (
            <Text style={styles.inlineError} testID="experience-pricing-per-stop-unpriced">
              Give at least one stop a price, or mark the experience free.
            </Text>
          ) : null}
        </>
      )}

      <ToggleRow
        label="Unlimited spots"
        value={unlimited}
        onToggle={() => setUnlimited(!unlimited)}
      />
      {!unlimited ? (
        <>
          <Text style={styles.fieldLabel}>Spots</Text>
          {setCapacityScope !== undefined ? (
            <View style={styles.scopeRow}>
              {(
                [
                  ["total", "In total"],
                  ["per_day", "Per day"],
                  ["per_start", "Per start time"],
                ] as const
              ).map(([value, label]) => {
                const selected = capacityScope === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setCapacityScope(value)}
                    style={[
                      styles.scopeChip,
                      selected ? styles.scopeChipSelected : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        styles.scopeChipText,
                        selected ? styles.scopeChipTextSelected : null,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Input
            variant="number"
            value={capacity}
            onChangeText={setCapacity}
            placeholder="20"
            accessibilityLabel="Spots available"
          />
          <Text style={styles.helper}>
            {capacityScope === "per_start"
              ? "How many can run at the same start time."
              : capacityScope === "per_day"
                ? "How many can book each day (needs one start per day)."
                : "How many spots for the whole experience."}
          </Text>
          {showErrors && (parseInt(capacity, 10) || 0) <= 0 ? (
            <Text style={styles.inlineError}>
              Enter how many spots are available, or choose Unlimited.
            </Text>
          ) : null}
        </>
      ) : null}

      <View style={styles.summaryCard}>
        <Icon name="ticket" size={18} color={color.accent} />
        <Text style={styles.summaryText}>{summaryCopy()}</Text>
      </View>

      <WhoCoversCostsSection
        format="experience"
        overrides={pricingSwitches}
        defaults={brandDefaults}
        onChange={setPricingSwitches}
        previewBaseCents={Math.round(resolvedTotalMajor * 100)}
        currency={currency}
        effectiveTakeRateBps={takeRateBps}
        paymentProvider={paymentProvider}
        paymentCountry={paymentCountry}
        onEditDefaults={onEditDefaults}
        vatRegistered={vatRegistered}
        onSetupVat={onSetupVat}
      />

      {/* issue #3281 S3 — dark unless EXPO_PUBLIC_FF_EXTRAS_ENABLED is on. */}
      {isFeatureEnabled("extras") ? (
        <React.Suspense fallback={null}>
          <LazyAddOnsEntry eventId={addOnsEventId} offering="experience" currency={currency} />
        </React.Suspense>
      ) : null}
      <GlassCard
        variant="base"
        radius="lg"
        padding={space[4]}
        testID="experience-pricing-refund-card"
      >
        <RefundPolicyEditor
          offeringType="experience"
          value={refundPolicy}
          onChange={setRefundPolicy}
        />
      </GlassCard>
      <Text style={styles.refundHelper} testID="experience-pricing-refund-helper">
        {isFree ? REFUND_HELPER_FREE : REFUND_HELPER_PAID}
      </Text>
      {liveSoldCount > 0 ? (
        <GlassCard
          variant="base"
          radius="lg"
          padding={space[4]}
          style={styles.refundSalesBanner}
          testID="experience-pricing-refund-sales-banner"
        >
          <View style={styles.refundSalesRow}>
            <Icon
              name="bell"
              size={20}
              color={color.warning}
              strokeWidth={2}
            />
            <Text style={styles.refundSalesText}>
              {refundSalesBannerCopy(liveSoldCount)}
            </Text>
          </View>
        </GlassCard>
      ) : null}

      <Text style={styles.sectionLabel}>GUEST PRIVACY</Text>
      <ToggleRow
        label="Private guest list"
        // issue #3827 going-box — private hides the whole booked box.
        sub="Hide who's booked and how many. Only you see the list."
        value={privateGuestList}
        onToggle={() => setPrivateGuestList(!privateGuestList)}
        testID="experience-pricing-private-guestlist"
      />
      {/* issue #3827 going-box — guests on the host's own list. */}
      <ExtraGuestsField
        value={extraGuestCount}
        privateGuestList={privateGuestList}
        onChange={setExtraGuestCount}
        noun="booked"
        testID="experience-pricing-extra-guests"
      />
      <ToggleRow
        label="Hide remaining count"
        sub={
          hideRemainingLocked
            ? HIDE_REMAINING_LOCKED_SUB
            : 'Don\'t show "X spots left" or how full it is.'
        }
        value={hideRemainingCount}
        onToggle={() => setHideRemainingCount(!hideRemainingCount)}
        // Q1 (#3827) — locked on while the guest list is private.
        disabled={hideRemainingLocked}
        testID="experience-pricing-hide-count"
      />
    </View>
  );
};

interface PriceOptionRowProps {
  option: ExperiencePriceOptionDraft;
  index: number;
  canRemove: boolean;
  currencySymbol: string;
  showErrors: boolean;
  onPatch: (
    clientId: string,
    patch: Partial<ExperiencePriceOptionDraft>,
  ) => void;
  onRemoveOrHide: (clientId: string) => void;
}

const BASIS_OPTIONS: readonly {
  id: ExperiencePriceBasis;
  label: string;
}[] = [
  { id: "person", label: "Person" },
  { id: "group", label: "Group" },
  { id: "block", label: "Block" },
];

const PriceOptionRow: React.FC<PriceOptionRowProps> = ({
  option,
  index,
  canRemove,
  currencySymbol,
  showErrors,
  onPatch,
  onRemoveOrHide,
}) => {
  const cid = option.clientId;
  const priceLocked = option.soldCount > 0;
  // #4490 — the group size field keeps what the host typed (no clamp while
  // typing, no 50 cap); the number it stands for is validated instead.
  const [groupText, setGroupText] = useState<string>(String(option.groupMax));
  const unitError =
    showErrors &&
    option.priceBasis === "group" &&
    !(Number.isFinite(option.groupMax) && option.groupMax >= 2)
      ? "Group size must be at least 2 people."
      : showErrors &&
          option.priceBasis === "block" &&
          option.maxBlocks < option.minBlocks
        ? "Longest booking must be at least the shortest."
        : undefined;

  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={space[4]}
      style={option.isHidden ? styles.optionHidden : undefined}
      contentStyle={styles.optionContent}
      testID={`experience-price-option-${index}`}
    >
      <View style={styles.optionHeader}>
        <Text style={styles.optionTitle}>
          {option.name.trim().length > 0 ? option.name : `Price ${index + 1}`}
          {option.isHidden ? " (hidden)" : ""}
        </Text>
        {canRemove ? (
          <Pressable
            onPress={() => onRemoveOrHide(cid)}
            accessibilityRole="button"
            accessibilityLabel={
              option.soldCount > 0 ? "Hide price" : "Remove price"
            }
            hitSlop={8}
            style={styles.optionRemove}
          >
            <Icon
              name={option.soldCount > 0 ? "eye" : "trash"}
              size={18}
              color={color.danger}
            />
          </Pressable>
        ) : null}
      </View>

      {/* #4490 — every price is named by the host, the first one too. */}
      <Text style={styles.fieldLabel}>Name</Text>
      <Input
        variant="text"
        value={option.name}
        onChangeText={(v) => onPatch(cid, { name: v })}
        placeholder="e.g. Private hire"
        accessibilityLabel={`Price ${index + 1} name`}
        error={showErrors ? priceOptionNameIssue(option) : null}
        testID={`experience-price-option-${index}-name`}
      />

      <Text style={styles.fieldLabel}>Price</Text>
      <Input
        variant="number"
        value={option.priceMajor}
        onChangeText={(v) => onPatch(cid, { priceMajor: v })}
        placeholder="0.00"
        accessibilityLabel={
          index === 0 ? "Whole experience price" : `Price for option ${index + 1}`
        }
        leadingIcon="ticket"
        disabled={priceLocked}
      />
      {priceLocked ? (
        <Text style={styles.helper}>
          {option.soldCount} booking{option.soldCount === 1 ? "" : "s"} — price
          and unit are locked. You can hide this option.
        </Text>
      ) : (
        <Text style={styles.helper}>
          {currencySymbol.trim().length > 0
            ? `Buyers see ${currencySymbol} amounts.`
            : "Your currency is set when you choose a payout country."}
        </Text>
      )}

      <Text style={styles.fieldLabel}>Unit</Text>
      <View style={styles.basisToggle} accessibilityRole="tablist">
        {BASIS_OPTIONS.map((b) => {
          const active = option.priceBasis === b.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => {
                if (priceLocked) return;
                onPatch(cid, { priceBasis: b.id });
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active, disabled: priceLocked }}
              accessibilityLabel={`${b.label} price`}
              style={[styles.basisSeg, active && styles.basisSegActive]}
            >
              <Text
                style={[
                  styles.basisSegText,
                  active && styles.basisSegTextActive,
                ]}
              >
                {b.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {option.priceBasis === "group" ? (
        <>
          <Text style={styles.fieldLabel}>Up to N people</Text>
          <Input
            variant="number"
            value={groupText}
            onChangeText={(v) => {
              const digits = v.replace(/[^\d]/g, "");
              setGroupText(digits);
              const parsed = parseInt(digits, 10);
              onPatch(cid, { groupMax: Number.isFinite(parsed) ? parsed : 0 });
            }}
            placeholder="4"
            accessibilityLabel="Maximum people per group"
            disabled={priceLocked}
          />
          <Text style={styles.helper}>Buyers book one group of up to this many.</Text>
        </>
      ) : null}

      {option.priceBasis === "block" ? (
        <>
          <Text style={styles.fieldLabel}>Block length</Text>
          <View style={styles.blockToggle} accessibilityRole="tablist">
            {EXPERIENCE_BLOCK_MINUTES.map((m) => {
              const active = option.blockMinutes === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    if (priceLocked) return;
                    onPatch(cid, {
                      blockMinutes: m as ExperienceBlockMinutes,
                    });
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active, disabled: priceLocked }}
                  accessibilityLabel={`${m} minute blocks`}
                  style={[styles.blockSeg, active && styles.basisSegActive]}
                >
                  <Text
                    style={[
                      styles.basisSegText,
                      active && styles.basisSegTextActive,
                    ]}
                  >
                    {experienceBlockPillLabel(m)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.fieldLabel}>Shortest booking (blocks)</Text>
          <Input
            variant="number"
            value={String(option.minBlocks)}
            onChangeText={(v) => {
              const parsed = parseInt(v.replace(/[^\d]/g, ""), 10) || 1;
              onPatch(cid, { minBlocks: Math.max(1, parsed) });
            }}
            placeholder="1"
            accessibilityLabel="Shortest booking in blocks"
            disabled={priceLocked}
          />
          <Text style={styles.fieldLabel}>Longest booking (blocks)</Text>
          <Input
            variant="number"
            value={String(option.maxBlocks)}
            onChangeText={(v) => {
              const parsed = parseInt(v.replace(/[^\d]/g, ""), 10) || 1;
              onPatch(cid, { maxBlocks: Math.max(1, parsed) });
            }}
            placeholder="4"
            accessibilityLabel="Longest booking in blocks"
            disabled={priceLocked}
          />
        </>
      ) : null}

      {option.isHidden ? (
        <Pressable
          onPress={() => onPatch(cid, { isHidden: false })}
          accessibilityRole="button"
          accessibilityLabel="Show this price again"
          style={styles.unhideCta}
        >
          <Text style={styles.addPriceText}>Show this price again</Text>
        </Pressable>
      ) : null}

      {unitError !== undefined ? (
        <Text style={styles.inlineError}>{unitError}</Text>
      ) : null}
    </GlassCard>
  );
};

interface ToggleRowProps {
  label: string;
  sub?: string;
  value: boolean;
  onToggle: () => void;
  /** issue #3827 going-box (Q1) — a locked switch shows its state, ignores taps. */
  disabled?: boolean;
  testID?: string;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  sub,
  value,
  onToggle,
  disabled = false,
  testID,
}) => (
  <Pressable
    onPress={disabled ? undefined : onToggle}
    accessibilityRole="switch"
    accessibilityState={{ checked: value, disabled }}
    accessibilityLabel={label}
    disabled={disabled}
    style={[styles.toggleRow, disabled && styles.toggleRowDisabled]}
    testID={testID}
  >
    {sub !== undefined ? (
      <View style={styles.toggleLabelCol}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSub}>{sub}</Text>
      </View>
    ) : (
      <Text style={styles.toggleLabel}>{label}</Text>
    )}
    <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
      <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  stepBody: { gap: space[4] },
  toggleRowDisabled: { opacity: 0.6 },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  modeToggle: {
    flexDirection: "row",
    gap: space[1],
    backgroundColor: color.fill.inset,
    borderRadius: radius.md,
    padding: 2,
  },
  modeSeg: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: space[2],
  },
  modeSegActive: {
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  modeSegText: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text2,
    textAlign: "center",
  },
  modeSegTextActive: { color: color.text1 },
  modeSegDisabled: { opacity: 0.4 },
  modeSegTextDisabled: { color: color.text3 },
  // #4420 journey: the price card stacked label, field, helper and the next
  // label with no space between them.
  optionContent: {
    gap: space[2],
  },
  helper: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
  },
  scopeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
    marginBottom: space[1],
  },
  scopeChip: {
    minHeight: 36,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
  scopeChipSelected: {
    backgroundColor: color.accentLine,
    borderColor: color.accentLine,
  },
  scopeChipText: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text2,
  },
  scopeChipTextSelected: { color: color.text1 },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space[1],
  },
  optionTitle: {
    flex: 1,
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  optionRemove: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  optionHidden: { opacity: 0.55 },
  basisToggle: {
    flexDirection: "row",
    gap: space[1],
    backgroundColor: color.fill.inset,
    borderRadius: radius.md,
    padding: 2,
  },
  basisSeg: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: space[1],
  },
  basisSegActive: {
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  // #4490 — ten block lengths wrap onto a second row on a phone.
  blockToggle: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
    backgroundColor: color.fill.inset,
    borderRadius: radius.md,
    padding: 2,
  },
  blockSeg: {
    minWidth: 56,
    flexGrow: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: space[1],
  },
  basisSegText: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text2,
  },
  basisSegTextActive: { color: color.text1 },
  addPriceCta: {
    minHeight: 48,
    flexDirection: "row",
    gap: space[2],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.accentLine,
  },
  addPriceText: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
  unhideCta: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space[1],
  },
  pressed: { opacity: 0.7 },
  fieldLabel: {
    fontSize: type.caption.fontSize,
    fontWeight: "500",
    color: color.text2,
  },
  sectionLabel: {
    fontSize: type.label.fontSize,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: color.text3,
  },
  perStopRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  miniBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
    alignItems: "center",
    justifyContent: "center",
  },
  miniBadgeText: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
  perStopName: { flex: 1, fontSize: type.body.fontSize, color: color.text1 },
  perStopPrice: { width: 120 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line,
  },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalLabel: { fontSize: type.body.fontSize, color: color.text2 },
  totalValue: {
    fontSize: type.h1.fontSize,
    fontWeight: type.h1.fontWeight,
    color: color.accent,
  },
  toggleRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleLabel: { flex: 1, fontSize: type.body.fontSize, color: color.text1 },
  toggleLabelCol: { flex: 1, marginRight: space[2] },
  toggleSub: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: { backgroundColor: color.accent },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: color.textStrong,
  },
  toggleThumbOn: { alignSelf: "flex-end" },
  summaryCard: {
    flexDirection: "row",
    gap: space[2],
    alignItems: "center",
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  summaryText: {
    flex: 1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text1,
  },
  inlineError: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.danger,
    marginTop: 2,
  },
  refundHelper: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: -space[1],
  },
  refundSalesBanner: {
    borderColor: color.warning,
    borderWidth: 1,
    backgroundColor: color.warningTint,
  },
  refundSalesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  refundSalesText: {
    flex: 1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text1,
  },
});

export default ExperiencePricingStep;
