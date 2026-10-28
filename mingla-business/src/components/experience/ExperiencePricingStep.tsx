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

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
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
} from "./experienceWizardTypes";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
import {
  priceDecimals,
  priceFallbackDecimals,
} from "@mingla/offering-rendering/priceDecimals";
import { ExtraGuestsField } from "../ui/ExtraGuestsField";
import { HIDE_REMAINING_LOCKED_SUB } from "../../constants/guestListPrivacy";

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
      : stops.reduce((sum, s) => sum + num(s.priceMajor), 0);

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
        name: `Option ${prev.length + 1}`,
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

  const summaryCopy = (): string => {
    const t = formatSummaryTotal(resolvedTotalMajor);
    const stopWord = n === 1 ? "stop" : "stops";
    if (isFree || resolvedTotalMajor === 0) {
      return `Free for buyers — they get ${n === 1 ? "this experience" : `all ${n} ${stopWord}`} in one booking.`;
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

      {pricingMode === "whole" ? (
        <>
          <ToggleRow
            label="This experience is free"
            value={isFree}
            onToggle={() => setIsFree(!isFree)}
          />
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
                  <Icon name="plus" size={18} color={accent.warm} />
                  <Text style={styles.addPriceText}>Add another price</Text>
                </Pressable>
              ) : null}
              {showErrors &&
              num(defaultOption?.priceMajor ?? wholePriceMajor) <= 0 &&
              !isFree ? (
                <Text style={styles.inlineError}>
                  Set a price, or mark the experience free.
                </Text>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
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
        <Icon name="ticket" size={18} color={accent.warm} />
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

      <GlassCard
        variant="base"
        radius="lg"
        padding={spacing.md}
        testID="experience-pricing-refund-card"
      >
        <RefundPolicyEditor
          offeringType="experience"
          value={refundPolicy}
          onChange={setRefundPolicy}
        />
      </GlassCard>
      <Text style={styles.refundHelper} testID="experience-pricing-refund-helper">
        {isFree || resolvedTotalMajor === 0 ? REFUND_HELPER_FREE : REFUND_HELPER_PAID}
      </Text>
      {liveSoldCount > 0 ? (
        <GlassCard
          variant="base"
          radius="lg"
          padding={spacing.md}
          style={styles.refundSalesBanner}
          testID="experience-pricing-refund-sales-banner"
        >
          <View style={styles.refundSalesRow}>
            <Icon
              name="bell"
              size={20}
              color={semantic.warning}
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
  const unitError =
    showErrors &&
    option.priceBasis === "group" &&
    (option.groupMax < 2 || option.groupMax > 50)
      ? "Group size must be 2–50 people."
      : showErrors &&
          option.priceBasis === "block" &&
          option.maxBlocks < option.minBlocks
        ? "Longest booking must be at least the shortest."
        : undefined;

  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={spacing.md}
      style={option.isHidden ? styles.optionHidden : undefined}
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
              color={semantic.error}
            />
          </Pressable>
        ) : null}
      </View>

      {index > 0 ? (
        <>
          <Text style={styles.fieldLabel}>Name</Text>
          <Input
            variant="text"
            value={option.name}
            onChangeText={(v) => onPatch(cid, { name: v })}
            placeholder="e.g. Private hire"
            accessibilityLabel={`Price ${index + 1} name`}
          />
        </>
      ) : null}

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
            value={String(option.groupMax)}
            onChangeText={(v) => {
              const parsed = parseInt(v.replace(/[^\d]/g, ""), 10);
              onPatch(cid, {
                groupMax: Number.isFinite(parsed)
                  ? Math.min(50, Math.max(2, parsed))
                  : 2,
              });
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
          <View style={styles.basisToggle} accessibilityRole="tablist">
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
                  style={[styles.basisSeg, active && styles.basisSegActive]}
                >
                  <Text
                    style={[
                      styles.basisSegText,
                      active && styles.basisSegTextActive,
                    ]}
                  >
                    {m}m
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
  stepBody: { gap: spacing.md },
  toggleRowDisabled: { opacity: 0.6 },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  modeToggle: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    padding: spacing.xxs,
  },
  modeSeg: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  modeSegActive: {
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  modeSegText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
    textAlign: "center",
  },
  modeSegTextActive: { color: textTokens.primary },
  modeSegDisabled: { opacity: 0.4 },
  modeSegTextDisabled: { color: textTokens.tertiary },
  helper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  scopeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  scopeChip: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
  },
  scopeChipSelected: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  scopeChipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  scopeChipTextSelected: { color: textTokens.primary },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  optionTitle: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
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
    gap: spacing.xs,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    padding: spacing.xxs,
  },
  basisSeg: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
  },
  basisSegActive: {
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  basisSegText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  basisSegTextActive: { color: textTokens.primary },
  addPriceCta: {
    minHeight: 48,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: accent.border,
  },
  addPriceText: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  unhideCta: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  pressed: { opacity: 0.7 },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  sectionLabel: {
    fontSize: typography.labelCap.fontSize,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  perStopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  miniBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  miniBadgeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  perStopName: { flex: 1, fontSize: typography.body.fontSize, color: textTokens.primary },
  perStopPrice: { width: 120 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
  },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalLabel: { fontSize: typography.body.fontSize, color: textTokens.secondary },
  totalValue: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: accent.warm,
  },
  toggleRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleLabel: { flex: 1, fontSize: typography.body.fontSize, color: textTokens.primary },
  toggleLabelCol: { flex: 1, marginRight: spacing.sm },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileElevated,
    padding: 3,
    justifyContent: "center",
  },
  toggleTrackOn: { backgroundColor: accent.warm },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: textTokens.inverse,
  },
  toggleThumbOn: { alignSelf: "flex-end" },
  summaryCard: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  summaryText: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.primary,
  },
  inlineError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
  refundHelper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: -spacing.xs,
  },
  refundSalesBanner: {
    borderColor: semantic.warning,
    borderWidth: 1,
    backgroundColor: semantic.warningTint,
  },
  refundSalesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  refundSalesText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
});

export default ExperiencePricingStep;
