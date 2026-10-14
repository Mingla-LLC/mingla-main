/**
 * BrandPayoutCountryField — #3645: the one place a brand's payout country, and
 * therefore its currency, is chosen outside the bank screens.
 *
 * A brand has NO currency until the organiser picks a country here (or connects
 * a bank). Nothing is preselected and nothing is written on mount.
 *
 *   - Any card-rail country: `brands.default_currency` is set to that country's
 *     currency. Nothing else on the brand moves.
 *   - Nigeria: the brand is put on the Nigerian payout rail with the same
 *     `select_provider` call the bank screens make, which also sets naira.
 *   - Leaving Nigeria: `clear_provider`, then the new currency.
 *   - A brand that already has a payment account cannot change country here;
 *     the row is disabled and says why, in the same words as the bank screen.
 *
 * Rendered by brand creation (the Payouts step) and by the inline "choose your
 * payout country" prompt a creator shows when a price is entered on a brand
 * with no currency.
 *
 * The country list is the canonical constant, handed to the country sheet
 * directly, so this field needs no query client of its own. The sheet (and its
 * animation code) loads only when the row is tapped.
 */

import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { QueryClientContext, type QueryClient } from "@tanstack/react-query";

import { Button } from "../ui/Button";
import { PayoutCountryTriggerRow } from "./PayoutCountryTriggerRow";
import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { STRIPE_SUPPORTED_COUNTRIES } from "../../constants/stripeSupportedCountries";
import { useAuth } from "../../context/AuthContext";
import { brandKeys } from "../../hooks/brandKeys";
import { useUpdateBrand } from "../../hooks/useBrands";
import {
  clearPaystackProvider,
  selectPaystackProvider,
} from "../../services/brandPaystackService";
import { joinBrandDescription } from "../../services/brandMapping";
import type { Brand } from "../../types/brand";
import {
  NIGERIA_BANK_CONNECT_RAIL,
  resolveBankConnectRailForCountry,
  resolveSavedPayoutCountry,
  type BankConnectRail,
} from "../../utils/bankConnectRail";
import { currencyCodeOrNull } from "../../utils/currency";
import {
  describePayoutCountrySwitchFailure,
  PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
  PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY,
  type PayoutCountrySwitchFailure,
} from "../../utils/payoutCountrySwitchCopy";

export const PAYOUT_COUNTRY_FIELD_COPY = {
  label: "PAYOUT COUNTRY",
  empty: "Choose a country",
  emptyWithCurrency: (currency: string): string =>
    `Choose a country · prices in ${currency}`,
  helper:
    "Where your bank account is. This sets the currency for your prices.",
  chosen: (currency: string): string =>
    `Prices on this brand are in ${currency}.`,
  saving: "Updating your payout country…",
  retry: "Try again",
} as const;

// Nigeria sits outside the card-rail allowlist, so it is handed to the picker
// as an extra row, exactly as the bank screens do.
const NIGERIA_PICKER_OPTIONS = [
  {
    code: NIGERIA_BANK_CONNECT_RAIL.countryCode,
    name: NIGERIA_BANK_CONNECT_RAIL.displayName,
    currency: NIGERIA_BANK_CONNECT_RAIL.currency,
    sublabel: "Bank transfer",
  },
] as const;
const NO_EXTRA_OPTIONS = [] as const;

// The same searchable country sheet the bank screens open.
const LazyPayoutCountrySheet = React.lazy(async () => {
  const module = await import("./BrandStripeCountryPicker");
  return { default: module.PayoutCountrySheet };
});

const STATIC_COUNTRIES = {
  data: STRIPE_SUPPORTED_COUNTRIES,
  isLoading: false,
  isError: false,
  refetch: (): undefined => undefined,
} as const;

// A host that replaces the query library wholesale (older render suites do)
// has no context object to read; the field then simply skips the refresh.
const hasQueryClientContext = QueryClientContext !== undefined;
const useOptionalQueryClient: () => QueryClient | null = hasQueryClientContext
  ? (): QueryClient | null => useContext(QueryClientContext) ?? null
  : (): null => null;

export interface BrandPayoutCountryFieldProps {
  brand: Brand;
  /** Country of the brand's card-rail account, when a status query knows it. */
  cardAccountCountry?: string | null;
  /** True when a status query has found a card-rail account for this brand. */
  cardAccountExists?: boolean;
  /** The saved brand after a successful pick. */
  onBrandChanged?: (brand: Brand) => void;
  /** The country now chosen (after a successful pick). */
  onCountryChosen?: (rail: BankConnectRail) => void;
  /**
   * A pick has been sent and its outcome is not known yet. Whatever the host
   * was told about the previous country stops being true from here: the server
   * may move the brand off its rail and then fail part-way. `onCountryChosen`
   * follows only if the whole pick succeeds.
   */
  onCountryPickStarted?: () => void;
  /** True while a pick is being saved. */
  onPendingChange?: (pending: boolean) => void;
  /** Open the country list straight away (the inline prompt). */
  defaultOpen?: boolean;
  /** Replaces the default helper line shown before a country is chosen. */
  helperText?: string;
  testID?: string;
}

export function BrandPayoutCountryField({
  brand,
  cardAccountCountry = null,
  cardAccountExists = false,
  onBrandChanged,
  onCountryChosen,
  onCountryPickStarted,
  onPendingChange,
  defaultOpen = false,
  helperText,
  testID = "brand-payout-country-field",
}: BrandPayoutCountryFieldProps): React.ReactElement {
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const updateBrandMutation = useUpdateBrand();
  // Optional on purpose: the field works without a query client (the picker
  // list is static); with one, the brand caches are refreshed after a pick.
  const queryClient = useOptionalQueryClient();

  const [pickedRail, setPickedRail] = useState<BankConnectRail | null>(null);
  const [pending, setPending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(defaultOpen);
  // The sheet loads on first open and then stays mounted, so closing it can
  // animate out.
  const [sheetLoaded, setSheetLoaded] = useState(defaultOpen);
  const openSheet = useCallback((): void => {
    setSheetLoaded(true);
    setSheetOpen(true);
  }, []);
  const [failure, setFailure] = useState<
    (PayoutCountrySwitchFailure & { countryCode: string }) | null
  >(null);
  // `pending` is one render behind; this is set the moment a pick is sent.
  const inFlightRef = useRef(false);
  // What this field last asked the server for. A FAILED move to Nigeria still
  // counts: the server may have moved the brand before failing.
  const requestedNigeriaRef = useRef<boolean | null>(null);

  const savedRail = useMemo(
    () =>
      resolveSavedPayoutCountry({
        paymentProvider: brand.paymentProvider,
        cardAccountCountry,
        defaultCurrency: brand.defaultCurrency,
        addressCountryCode: brand.countryCode,
      }),
    [
      brand.countryCode,
      brand.defaultCurrency,
      brand.paymentProvider,
      cardAccountCountry,
    ],
  );
  const chosenRail = pickedRail ?? savedRail;
  const savedCurrency = currencyCodeOrNull(brand.defaultCurrency);

  // A brand with a card payment account keeps its country; so does one whose
  // Nigerian bank is already connected (the server refuses that switch).
  const hasCardAccount =
    cardAccountExists ||
    (brand.stripeStatus ?? "not_connected") !== "not_connected";
  const hasNigerianBank =
    typeof brand.paystackSubaccountCode === "string" &&
    brand.paystackSubaccountCode.trim().length > 0;
  const lockedCopy = hasCardAccount
    ? PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY
    : hasNigerianBank
      ? PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY
      : null;

  const setPendingBoth = useCallback(
    (next: boolean): void => {
      setPending(next);
      onPendingChange?.(next);
    },
    [onPendingChange],
  );

  const refreshBrandCaches = useCallback((): void => {
    if (queryClient === null) return;
    void queryClient.invalidateQueries({ queryKey: brandKeys.detail(brand.id) });
    void queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
  }, [brand.id, queryClient]);

  const handlePick = useCallback(
    (countryCode: string): void => {
      if (lockedCopy !== null || inFlightRef.current) return;
      const rail = resolveBankConnectRailForCountry(countryCode);
      if (rail === null) return;
      inFlightRef.current = true;
      setFailure(null);
      setPendingBoth(true);
      // #3645 — the previous pick is no longer a fact the host can be told.
      onCountryPickStarted?.();

      const wantsNigeria = rail.provider === "paystack";
      const onNigeriaRail = requestedNigeriaRef.current ??
        (brand.paymentProvider?.trim().toLowerCase() === "paystack");

      void (async (): Promise<void> => {
        try {
          let nextBrand: Brand;
          if (wantsNigeria) {
            requestedNigeriaRef.current = true;
            // The server puts the brand on the Nigerian rail and sets naira.
            await selectPaystackProvider(brand.id);
            nextBrand = {
              ...brand,
              paymentProvider: "paystack",
              paymentCountry: rail.countryCode,
              defaultCurrency: rail.currency,
            };
          } else {
            if (onNigeriaRail) {
              await clearPaystackProvider(brand.id);
              requestedNigeriaRef.current = false;
            }
            if (accountId === null) {
              throw new Error("payout_country_no_account");
            }
            nextBrand = await updateBrandMutation.mutateAsync({
              brandId: brand.id,
              accountId,
              patch: { defaultCurrency: rail.currency },
              existingDescription: joinBrandDescription(
                brand.tagline,
                brand.bio,
              ),
            });
          }
          refreshBrandCaches();
          setPickedRail(rail);
          onBrandChanged?.(nextBrand);
          onCountryChosen?.(rail);
        } catch (error) {
          // #3645 — a pick can fail AFTER the server moved the brand (the
          // provider was cleared, then saving the currency failed). Read the
          // brand again so nothing keeps describing the rail it left.
          refreshBrandCaches();
          setFailure({
            ...describePayoutCountrySwitchFailure(error),
            countryCode: rail.countryCode,
          });
        } finally {
          inFlightRef.current = false;
          setPendingBoth(false);
        }
      })();
    },
    [
      accountId,
      brand,
      lockedCopy,
      onBrandChanged,
      onCountryChosen,
      onCountryPickStarted,
      refreshBrandCaches,
      setPendingBoth,
      updateBrandMutation,
    ],
  );

  const helper = chosenRail !== null
    ? PAYOUT_COUNTRY_FIELD_COPY.chosen(chosenRail.currency)
    : helperText ?? PAYOUT_COUNTRY_FIELD_COPY.helper;

  const pickerDisabled = pending || lockedCopy !== null;
  const emptyLabel = savedCurrency !== null
    ? PAYOUT_COUNTRY_FIELD_COPY.emptyWithCurrency(savedCurrency)
    : PAYOUT_COUNTRY_FIELD_COPY.empty;

  return (
    <View style={styles.wrap} testID={testID}>
      <PayoutCountryTriggerRow
        testID={`${testID}-trigger`}
        onPress={(): void => {
          if (!pickerDisabled) openSheet();
        }}
        disabled={pickerDisabled}
        accessibilityLabel={
          chosenRail !== null
            ? `Payout country: ${chosenRail.displayName}, tap to change`
            : "Payout country: not chosen, tap to choose"
        }
        label={PAYOUT_COUNTRY_FIELD_COPY.label}
        valueText={
          chosenRail !== null
            ? `${chosenRail.displayName} · ${chosenRail.currency}`
            : emptyLabel
        }
        actionText={chosenRail !== null ? "Change" : "Choose"}
        actionKind="link"
        helperText={lockedCopy === null ? helper : null}
        warningText={lockedCopy}
      />
      {sheetLoaded ? (
        <React.Suspense fallback={null}>
          <LazyPayoutCountrySheet
            visible={sheetOpen && !pickerDisabled}
            onClose={(): void => setSheetOpen(false)}
            onPick={handlePick}
            selectedCode={chosenRail?.countryCode ?? null}
            // Nigeria is not offered to a brand that cannot move onto its rail.
            extraOptions={
              hasCardAccount ? NO_EXTRA_OPTIONS : NIGERIA_PICKER_OPTIONS
            }
            countriesQuery={STATIC_COUNTRIES}
          />
        </React.Suspense>
      ) : null}
      {pending ? (
        <View
          style={styles.statusRow}
          accessibilityRole="progressbar"
          accessibilityLabel="Updating your payout country"
          testID={`${testID}-saving`}
        >
          <ActivityIndicator size="small" color={accent.warm} />
          <Text style={styles.statusText}>
            {PAYOUT_COUNTRY_FIELD_COPY.saving}
          </Text>
        </View>
      ) : null}
      {failure !== null && !pending ? (
        <View
          style={styles.failure}
          accessibilityRole="alert"
          testID={`${testID}-error`}
        >
          <Text style={styles.failureText}>{failure.message}</Text>
          {failure.retryable ? (
            <Button
              label={PAYOUT_COUNTRY_FIELD_COPY.retry}
              onPress={(): void => handlePick(failure.countryCode)}
              variant="secondary"
              size="sm"
              accessibilityLabel="Try updating your payout country again"
              testID={`${testID}-retry`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  failure: {
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  failureText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: semantic.error,
  },
});

export default BrandPayoutCountryField;
