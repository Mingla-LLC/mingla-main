/**
 * BrandStripeCountryPicker — country selection for Stripe Connect onboarding.
 *
 * Per B2a Path C V3 SPEC §6 + DEC-122 + I-PROPOSED-T (canonical 34-country allowlist).
 *
 * UX shape:
 *   - Inline trigger: a Pressable row showing the currently-selected country
 *     (default = brand's billing_country if set, else "GB"). Tapping opens a Sheet.
 *   - Sheet body: 34 countries from `useBrandStripeCountries`, search-filtered,
 *     each row showing display name + currency hint. Tap to select + auto-close.
 *
 * Mounted inside BrandOnboardView's "idle" state ABOVE the prereq card.
 * Selected country is passed to `useStartBrandStripeOnboarding` mutation
 * (Sub-C partial wired the optional `country` field on that hook).
 *
 * States: loading (spinner row) | error (retry CTA) | populated.
 *
 * Accessibility: trigger has accessibilityLabel = "Country: {selected}, tap to change".
 * Each country row has accessibilityLabel = "{country} ({currency})".
 *
 * Per I-38 (touch targets ≥ 44pt) + I-39 (accessibilityLabel on Pressable).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import * as Haptics from "expo-haptics";

import { Sheet } from "../ui/Sheet";
import { PayoutCountryTriggerRow } from "./PayoutCountryTriggerRow";
import { Spinner } from "../ui/Spinner";
import {
  spacing,
  radius,
  typography,
  text as textTokens,
  accent,
  semantic,
  glass,
} from "../../constants/designSystem";
import { useBrandStripeCountries } from "../../hooks/useBrandStripeCountries";
import {
  getStripeSupportedCountry,
  type StripeSupportedCountry,
} from "../../constants/stripeSupportedCountries";

interface BrandStripeCountryPickerProps {
  /** Currently selected ISO 3166-1 alpha-2 code. Default to "GB" if null. */
  value: string | null;
  /** Fired when the user picks a different country. */
  onChange: (countryCode: string) => void;
  /** Disable interaction (e.g., during a submit). */
  disabled?: boolean;
  /** Optional helper copy below the picker. */
  helperText?: string | null;
  /** Optional warning/locked copy below the picker. */
  warningText?: string | null;
  /**
   * Non-Stripe payout regions shown as a separate top section (e.g. Nigeria →
   * Paystack). Kept out of the Stripe allowlist so the Stripe-country invariant
   * is preserved; selecting one fires onChange(code) like any other row.
   */
  extraOptions?: ReadonlyArray<{
    code: string;
    name: string;
    currency: string;
    sublabel?: string;
  }>;
  /** Open the country sheet immediately on mount (e.g. returning from a region's
   * own onboarding to re-pick). */
  defaultOpen?: boolean;
  /**
   * Bank-first invite presentation: renders the selected payout destination as
   * a confirmation row with a quiet Change affordance instead of leading with
   * the full country picker.
   */
  presentation?: "operation-picker" | "payout-confirm";
}

export function BrandStripeCountryPicker(
  props: BrandStripeCountryPickerProps,
): React.ReactElement {
  const countriesQuery = useBrandStripeCountries();
  return (
    <PayoutCountryPickerView
      {...props}
      countriesQuery={{
        data: countriesQuery.data,
        isLoading: countriesQuery.isLoading,
        isError: countriesQuery.isError,
        refetch: countriesQuery.refetch,
      }}
    />
  );
}

/** The country list a picker renders, however it was obtained. */
export interface PayoutCountryPickerCountries {
  data: readonly StripeSupportedCountry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export interface PayoutCountryPickerViewProps
  extends BrandStripeCountryPickerProps {
  countriesQuery: PayoutCountryPickerCountries;
}

/**
 * The picker itself, with the country list handed in: the trigger row plus the
 * country sheet. `BrandStripeCountryPicker` feeds it from the query hook.
 */
export function PayoutCountryPickerView({
  value,
  onChange,
  disabled = false,
  helperText = null,
  warningText = null,
  extraOptions = [],
  defaultOpen = false,
  presentation = "operation-picker",
  countriesQuery,
}: PayoutCountryPickerViewProps): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  const selectedCode = value ?? "GB";
  const selected = getStripeSupportedCountry(selectedCode);
  const selectedExtra =
    extraOptions.find((option) => option.code === selectedCode) ?? null;

  const handleOpen = useCallback((): void => {
    if (disabled) return;
    void Haptics.selectionAsync();
    setOpen(true);
  }, [disabled]);

  const handleClose = useCallback((): void => {
    setOpen(false);
  }, []);

  const selectedName =
    selected?.displayName ?? selectedExtra?.name ?? selectedCode;
  const selectedCurrency =
    selected?.defaultCurrency ?? selectedExtra?.currency ?? null;
  const triggerLabel = selectedCurrency !== null
    ? `${selectedName} · ${selectedCurrency}`
    : `Country: ${selectedCode}`;
  const payoutConfirm = presentation === "payout-confirm";

  return (
    <View style={styles.wrap}>
      <PayoutCountryTriggerRow
        onPress={handleOpen}
        disabled={disabled}
        accessibilityLabel={
          payoutConfirm
            ? `Payout country: ${selectedName}, tap to change`
            : `Country: ${selectedName}, tap to change`
        }
        label={payoutConfirm ? "PAYOUTS IN" : "Where will you operate?"}
        valueText={triggerLabel}
        actionText={payoutConfirm ? "Change" : "›"}
        actionKind={payoutConfirm ? "link" : "chevron"}
        helperText={helperText}
        warningText={warningText}
      />

      <PayoutCountrySheet
        visible={open}
        onClose={handleClose}
        onPick={onChange}
        selectedCode={selectedCode}
        extraOptions={extraOptions}
        countriesQuery={countriesQuery}
      />
    </View>
  );
}

export interface PayoutCountrySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fired with the picked ISO code; the sheet closes itself. */
  onPick: (countryCode: string) => void;
  /** Currently selected ISO code, or null when nothing is chosen. */
  selectedCode: string | null;
  extraOptions?: BrandStripeCountryPickerProps["extraOptions"];
  countriesQuery: PayoutCountryPickerCountries;
}

/**
 * The searchable country sheet on its own, so a host with its own trigger row
 * (the #3645 payout-country field) can open the very same list.
 */
export function PayoutCountrySheet({
  visible,
  onClose,
  onPick,
  selectedCode,
  extraOptions = [],
  countriesQuery,
}: PayoutCountrySheetProps): React.ReactElement {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (visible) setSearch("");
  }, [visible]);

  const handlePick = useCallback(
    (code: string): void => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onPick(code);
      onClose();
    },
    [onClose, onPick],
  );

  // Unified, alphabetically-sorted list: Stripe countries + any extra (Paystack)
  // regions interleaved by name (not pinned to the top).
  const allRows = useMemo(() => {
    const stripe = (countriesQuery.data ?? []).map((c) => ({
      code: c.country,
      name: c.displayName,
      currency: c.defaultCurrency,
      sublabel: undefined as string | undefined,
    }));
    const extras = extraOptions.map((o) => ({
      code: o.code,
      name: o.name,
      currency: o.currency,
      sublabel: o.sublabel,
    }));
    return [...stripe, ...extras].sort((a, b) => a.name.localeCompare(b.name));
  }, [countriesQuery.data, extraOptions]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return allRows;
    return allRows.filter(
      (r) =>
        r.code.toLowerCase().includes(needle) ||
        r.name.toLowerCase().includes(needle) ||
        r.currency.toLowerCase().includes(needle),
    );
  }, [allRows, search]);

  return (
      <Sheet visible={visible} onClose={onClose} snapPoint="full">
        <View style={styles.sheetWrap}>
          <Text style={styles.sheetTitle}>Pick your country</Text>
          <Text style={styles.sheetBody}>
            Choose where your business is registered. Payouts go to a bank
            account in this country.
          </Text>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by country or currency"
            placeholderTextColor={textTokens.tertiary}
            style={styles.search}
            accessibilityLabel="Search countries"
            autoCorrect={false}
            autoCapitalize="characters"
          />

          {countriesQuery.isLoading ? (
            <View style={styles.statusRow}>
              <Spinner size={24} color={accent.warm} />
              <Text style={styles.statusText}>Loading countries…</Text>
            </View>
          ) : null}

          {countriesQuery.isError ? (
            <View style={styles.statusRow}>
              <Text style={styles.statusError}>
                Couldn{"'"}t load countries. Tap below to retry.
              </Text>
              <Pressable
                onPress={(): void => {
                  void countriesQuery.refetch();
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry loading countries"
                style={styles.retryBtn}
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {countriesQuery.data && filtered.length === 0 ? (
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>
                No matches for {"\""}{search}{"\""}.
              </Text>
            </View>
          ) : null}

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {filtered.map((r) => {
              const isSelected = r.code === selectedCode;
              return (
                <Pressable
                  key={r.code}
                  onPress={(): void => handlePick(r.code)}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name} (${r.currency})`}
                  accessibilityState={{ selected: isSelected }}
                  style={({ pressed }) => [
                    styles.row,
                    pressed ? styles.rowPressed : null,
                    isSelected ? styles.rowSelected : null,
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <Text style={styles.rowCode}>{r.code}</Text>
                    <View>
                      <Text style={styles.rowName}>{r.name}</Text>
                      {r.sublabel != null ? (
                        <Text style={styles.rowSublabel}>{r.sublabel}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowCurrency}>{r.currency}</Text>
                    {isSelected ? <Text style={styles.rowCheck}>✓</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  sheetWrap: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  sheetTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
  },
  sheetBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    paddingBottom: spacing.sm,
  },
  search: {
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  statusText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  statusError: {
    fontSize: typography.bodySm.fontSize,
    color: semantic.error,
    flex: 1,
  },
  retryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: accent.tint,
    minHeight: 44,
    justifyContent: "center",
  },
  retryBtnText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
    fontWeight: "600",
  },
  list: {
    flex: 1,
    marginTop: spacing.xs,
  },
  listContent: {
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 56,
    borderWidth: 1,
    borderColor: "transparent",
  },
  rowPressed: {
    backgroundColor: glass.tint.profileBase,
  },
  rowSelected: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  rowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowCode: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: textTokens.tertiary,
    letterSpacing: 1.2,
    minWidth: 28,
  },
  rowName: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    fontWeight: "500",
  },
  rowSublabel: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 1,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowCurrency: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: textTokens.secondary,
    letterSpacing: 0.8,
  },
  rowCheck: {
    fontSize: 18,
    color: accent.warm,
    fontWeight: "700",
    minWidth: 20,
    textAlign: "center",
  },
});

export default BrandStripeCountryPicker;
