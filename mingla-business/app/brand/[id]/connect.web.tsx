/**
 * /brand/[id]/connect — bank-first partner setup entry (web).
 *
 * Loads the canonical brand row, pre-resolves Stripe vs Paystack, records the
 * approved Mingla Business clickwrap before minting a Stripe AccountSession,
 * then performs a same-tab navigation to the existing embedded Connect form.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { BrandPaystackOnboardView } from "../../../src/components/brand/BrandPaystackOnboardView";
import { BrandStripeCountryPicker } from "../../../src/components/brand/BrandStripeCountryPicker";
import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { Spinner } from "../../../src/components/ui/Spinner";
import {
  accent,
  canvas,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import {
  CURRENT_MINGLA_TOS_VERSION,
  useAcceptMinglaToS,
} from "../../../src/hooks/useMinglaToSAcceptance";
import { useStartBrandStripeOnboarding } from "../../../src/hooks/useStartBrandStripeOnboarding";
import { useBrand } from "../../../src/hooks/useBrands";
import {
  resolveBankConnectRail,
  startStripeWebBankConnect,
  type BankConnectProvider,
} from "../../../src/utils/bankConnectFunnel";

const TERMS_URL = "https://www.usemingla.com/terms-of-service/" as const;
const PAYSTACK_PICKER_OPTIONS = [
  {
    code: "NG",
    name: "Nigeria",
    currency: "NGN",
    sublabel: "Bank transfer via Paystack",
  },
] as const;

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim().length > 0 ? first : null;
}

export default function BrandBankConnectWebRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string | string[];
    provider?: string | string[];
  }>();
  const brandId = firstParam(params.id);
  const providerHint = firstParam(params.provider);
  const brandQuery = useBrand(brandId);
  const brand = brandQuery.data ?? null;
  const { user } = useAuth();
  const acceptTermsMutation = useAcceptMinglaToS();
  const onboardMutation = useStartBrandStripeOnboarding();
  const submitInProgressRef = useRef(false);
  const [selectedCountry, setSelectedCountry] = useState("GB");
  const [selectedProvider, setSelectedProvider] =
    useState<BankConnectProvider>("stripe");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canonicalRail = useMemo(
    () =>
      resolveBankConnectRail({
        countryCode: brand?.countryCode,
        paymentProvider: brand?.paymentProvider ?? providerHint,
      }),
    [brand?.countryCode, brand?.paymentProvider, providerHint],
  );

  useEffect(() => {
    if (brand === null) return;
    setSelectedCountry(canonicalRail.countryCode);
    setSelectedProvider(canonicalRail.provider);
  }, [
    brand,
    canonicalRail.countryCode,
    canonicalRail.provider,
  ]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (brandId !== null) {
      router.replace(`/brand/${brandId}/payments` as never);
      return;
    }
    router.replace("/(tabs)/account" as never);
  }, [brandId, router]);

  const handleCountryChange = useCallback((countryCode: string): void => {
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria uses Paystack and is deliberately outside the Stripe allowlist.
    const next = resolveBankConnectRail({
      countryCode,
      paymentProvider: countryCode.trim().toUpperCase() === "NG"
        ? "paystack"
        : "stripe",
    });
    setSelectedCountry(next.countryCode);
    setSelectedProvider(next.provider);
    setSubmitError(null);
  }, []);

  const handlePaystackConnected = useCallback((): void => {
    if (brandId === null) return;
    router.replace(`/brand/${brandId}/payments` as never);
  }, [brandId, router]);

  const handleStartStripe = useCallback(async (): Promise<void> => {
    if (
      brand === null ||
      user === null ||
      submitInProgressRef.current
    ) {
      return;
    }

    submitInProgressRef.current = true;
    setSubmitError(null);
    try {
      await startStripeWebBankConnect({
        brandId: brand.id,
        userId: user.id,
        country: selectedCountry,
        origin: window.location.origin,
        tosVersion: CURRENT_MINGLA_TOS_VERSION,
        acceptTerms: (input) => acceptTermsMutation.mutateAsync(input),
        mintOnboarding: (input) => onboardMutation.mutateAsync(input),
        assign: (url) => window.location.assign(url),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "We couldn't start bank setup. Check your connection and try again.";
      setSubmitError(message);
    } finally {
      submitInProgressRef.current = false;
    }
  }, [
    acceptTermsMutation,
    brand,
    onboardMutation,
    selectedCountry,
    user,
  ]);

  const handleOpenTerms = useCallback((): void => {
    Linking.openURL(TERMS_URL).catch(() => {
      setSubmitError(
        "We couldn't open the Business Terms. Please try again in a moment.",
      );
    });
  }, []);

  const loading =
    brandId !== null &&
    !brandQuery.isError &&
    (brandQuery.isLoading || !brandQuery.isFetched);

  if (loading) {
    return (
      <View style={styles.host}>
        <View style={styles.centeredState}>
          <Spinner size={48} color={accent.warm} />
          <Text style={styles.stateTitle}>Loading bank setup…</Text>
          <Text style={styles.stateBody}>
            We{"’"}re getting the payout details for this brand.
          </Text>
        </View>
      </View>
    );
  }

  if (brandQuery.isError) {
    return (
      <View style={styles.host}>
        <View style={styles.centeredState}>
          <Text style={styles.stateTitle}>Couldn{"’"}t load this brand</Text>
          <Text style={styles.stateBody}>
            Check your connection, then retry. Your bank setup has not started.
          </Text>
          <View style={styles.stateActions}>
            <Button
              label="Retry"
              onPress={(): void => {
                void brandQuery.refetch();
              }}
              variant="primary"
              size="lg"
              accessibilityLabel="Retry loading bank setup"
            />
            <Button
              label="Back"
              onPress={handleBack}
              variant="ghost"
              size="md"
              accessibilityLabel="Back from bank setup"
            />
          </View>
        </View>
      </View>
    );
  }

  if (brandId === null || brand === null) {
    return (
      <View style={styles.host}>
        <View style={styles.centeredState}>
          <Text style={styles.stateTitle}>Brand not found</Text>
          <Text style={styles.stateBody}>
            This brand may have been removed, or the bank setup link is invalid.
          </Text>
          <Button
            label="Back to account"
            onPress={handleBack}
            variant="secondary"
            size="lg"
            accessibilityLabel="Back to account"
          />
        </View>
      </View>
    );
  }

  if (user === null) {
    return (
      <View style={styles.host}>
        <View style={styles.centeredState}>
          <Text style={styles.stateTitle}>Sign in to add your bank</Text>
          <Text style={styles.stateBody}>
            Bank setup is private to this brand{"’"}s team. Sign in, then reopen
            this link.
          </Text>
          <Button
            label="Back"
            onPress={handleBack}
            variant="secondary"
            size="lg"
            accessibilityLabel="Back from bank setup"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <View style={styles.topBar}>
        <Button
          label="Back"
          onPress={handleBack}
          variant="ghost"
          size="sm"
          accessibilityLabel="Back from bank setup"
        />
        <Text style={styles.topBarTitle}>Add your bank</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.heroIcon}>
            <Icon name="bank" size={28} color={accent.warm} />
          </View>
          <Text style={styles.title}>Add your bank</Text>
          <Text style={styles.body}>
            This is how you get paid. Add it once and every sale settles to
            this account — tables, tickets or trips.
          </Text>

          <BrandStripeCountryPicker
            value={selectedCountry}
            onChange={handleCountryChange}
            extraOptions={PAYSTACK_PICKER_OPTIONS}
            presentation="payout-confirm"
          />

          {selectedProvider === "paystack" ? (
            <BrandPaystackOnboardView
              brandId={brand.id}
              brandName={brand.displayName}
              mode="create"
              onConnected={handlePaystackConnected}
              onCancel={(): void => handleCountryChange("GB")}
            />
          ) : (
            <>
              <GlassCard
                variant="base"
                padding={spacing.md}
                style={styles.prerequisites}
              >
                <Text style={styles.prereqLabel}>BEFORE YOU START, HAVE READY</Text>
                <Text style={styles.prereqItem}>
                  {"•"} Business name and tax ID
                </Text>
                <Text style={styles.prereqItem}>
                  {"•"} A bank account in your country
                </Text>
                <Text style={styles.prereqItem}>
                  {"•"} Photo of government ID
                </Text>
              </GlassCard>

              {submitError !== null ? (
                <View
                  style={styles.errorCard}
                  accessibilityRole="alert"
                  testID="bank-connect-error"
                >
                  <Text style={styles.errorText}>{submitError}</Text>
                </View>
              ) : null}

              <Button
                label={
                  acceptTermsMutation.isPending || onboardMutation.isPending
                    ? "Opening secure bank setup…"
                    : "Add bank details"
                }
                onPress={handleStartStripe}
                variant="primary"
                size="lg"
                fullWidth
                loading={
                  acceptTermsMutation.isPending || onboardMutation.isPending
                }
                disabled={
                  acceptTermsMutation.isPending || onboardMutation.isPending
                }
                accessibilityLabel="Add bank details and continue to secure Stripe setup"
                testID="bank-connect-primary"
              />

              <Pressable
                onPress={handleOpenTerms}
                accessibilityRole="link"
                accessibilityLabel="Open Mingla Business Terms"
                style={styles.legalPressable}
              >
                <Text style={styles.legal}>
                  By connecting your bank you agree to Mingla{"’"}s{" "}
                  <Text style={styles.legalLink}>Business Terms</Text>. Powered
                  by Stripe — your data is encrypted.
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  topBar: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  topBarSpacer: {
    width: 64,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    alignItems: "center",
  },
  content: {
    width: "100%",
    maxWidth: 640,
    gap: spacing.md,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  prerequisites: {
    width: "100%",
  },
  prereqLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  prereqItem: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    paddingVertical: spacing.xxs,
  },
  errorCard: {
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.errorTint,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  legalPressable: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  legal: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  legalLink: {
    color: textTokens.secondary,
    textDecorationLine: "underline",
  },
  centeredState: {
    flex: 1,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  stateTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateBody: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  stateActions: {
    gap: spacing.sm,
    alignItems: "center",
  },
});
