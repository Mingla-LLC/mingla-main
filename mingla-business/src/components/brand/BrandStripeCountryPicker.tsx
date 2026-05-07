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

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { Sheet } from "../ui/Sheet";
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
import { getStripeSupportedCountry } from "../../constants/stripeSupportedCountries";

interface BrandStripeCountryPickerProps {
  /** Currently selected ISO 3166-1 alpha-2 code. Default to "GB" if null. */
  value: string | null;
  /** Fired when the user picks a different country. */
  onChange: (countryCode: string) => void;
  /** Disable interaction (e.g., during a submit). */
  disabled?: boolean;
}

export function BrandStripeCountryPicker({
  value,
  onChange,
  disabled = false,
}: BrandStripeCountryPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const countriesQuery = useBrandStripeCountries();

  const selectedCode = value ?? "GB";
  const selected = getStripeSupportedCountry(selectedCode);

  const handleOpen = useCallback((): void => {
    if (disabled) return;
    void Haptics.selectionAsync();
    setSearch("");
    setOpen(true);
  }, [disabled]);

  const handleClose = useCallback((): void => {
    setOpen(false);
  }, []);

  const handlePick = useCallback(
    (code: string): void => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onChange(code);
      setOpen(false);
    },
    [onChange],
  );

  const filtered = useMemo(() => {
    const list = countriesQuery.data ?? [];
    if (search.trim().length === 0) return list;
    const needle = search.trim().toLowerCase();
    return list.filter(
      (c) =>
        c.country.toLowerCase().includes(needle) ||
        c.displayName.toLowerCase().includes(needle) ||
        c.defaultCurrency.toLowerCase().includes(needle),
    );
  }, [countriesQuery.data, search]);

  const triggerLabel = selected
    ? `${selected.displayName} · ${selected.defaultCurrency}`
    : `Country: ${selectedCode}`;

  return (
    <>
      <Pressable
        onPress={handleOpen}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Country: ${selected?.displayName ?? selectedCode}, tap to change`}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.trigger,
          pressed && !disabled ? styles.triggerPressed : null,
          disabled ? styles.triggerDisabled : null,
        ]}
      >
        <View style={styles.triggerRow}>
          <Text style={styles.triggerLabel}>Where will you operate?</Text>
          <Text style={styles.triggerValue}>{triggerLabel}</Text>
        </View>
        <Text style={styles.triggerChevron}>›</Text>
      </Pressable>

      <Sheet visible={open} onClose={handleClose} snapPoint="full">
        <View style={styles.sheetWrap}>
          <Text style={styles.sheetTitle}>Pick your country</Text>
          <Text style={styles.sheetBody}>
            Choose where your business is registered. Stripe payouts route to
            this country's banking system.
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
                Couldn't load countries. Tap below to retry.
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
              <Text style={styles.statusText}>No matches for "{search}".</Text>
            </View>
          ) : null}

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {filtered.map((c) => {
              const isSelected = c.country === selectedCode;
              return (
                <Pressable
                  key={c.country}
                  onPress={(): void => handlePick(c.country)}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.displayName} (${c.defaultCurrency})`}
                  accessibilityState={{ selected: isSelected }}
                  style={({ pressed }) => [
                    styles.row,
                    pressed ? styles.rowPressed : null,
                    isSelected ? styles.rowSelected : null,
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <Text style={styles.rowCode}>{c.country}</Text>
                    <Text style={styles.rowName}>{c.displayName}</Text>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowCurrency}>{c.defaultCurrency}</Text>
                    {isSelected ? <Text style={styles.rowCheck}>✓</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minHeight: 56,
  },
  triggerPressed: {
    opacity: 0.85,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerRow: {
    flex: 1,
    flexDirection: "column",
    gap: 2,
  },
  triggerLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  triggerValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    fontWeight: "600",
  },
  triggerChevron: {
    fontSize: 24,
    color: textTokens.tertiary,
    paddingLeft: spacing.sm,
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
