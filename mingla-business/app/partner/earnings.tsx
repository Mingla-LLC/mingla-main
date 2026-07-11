/**
 * /partner/earnings — Mingla partner earnings screen. ORCH-1052 + ORCH-1054.
 *
 * Visible only to flagged Mingla partners (creator_accounts.partner_enabled =
 * true). Surfaces:
 *  - Partner Stripe Connect status (not connected → CTA, onboarding → resume,
 *    active → managed)
 *  - ORCH-1054: live partner_splits ledger. Per-currency totals (no FX),
 *    per-month + per-brand breakdowns, status badges, empty state on no
 *    splits yet. Multi-currency safe — each currency renders in its own
 *    section.
 *
 * Non-partners hit a friendly empty state directing them to support.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
// ORCH-1081 — AsyncStorage for the one-time welcome-to-portfolio toast.
import AsyncStorage from "@react-native-async-storage/async-storage";
// ORCH-1331 — the screen gains its first text input (the NG bank form), so the
// scroll body rides the house KAV (ORCH-0892 primitive: react-native-keyboard-
// controller, NOT the RN one) — the account input + CTA are never covered.
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
// ORCH-1331 — success haptic on Paystack connect (native only).
import * as Haptics from "expo-haptics";

import {
  useDetachPartnerStripe,
  usePartnerStripeStatus,
  useRefreshPartnerAccountSession,
  useStartPartnerStripeOnboarding,
} from "../../src/hooks/usePartnerStripe";
// ORCH-1331 — Nigeria/Paystack payout rail (partner Transfer Recipient).
import {
  useDisconnectPartnerPaystack,
  usePartnerPaystackStatus,
} from "../../src/hooks/usePartnerPaystack";
import { PartnerPaystackOnboardForm } from "../../src/components/partner/PartnerPaystackOnboardForm";
import {
  usePartnerEarningsSummary,
  usePartnerSplits,
} from "../../src/hooks/usePartnerSplits";
// ORCH-1081 — partner_brand_links drives the "Ready to earn" nudge + the
// smarter splits empty-state copy.
import { usePartnerBrandLinks } from "../../src/hooks/usePartnerBrandLinks";
import type {
  PartnerSplitRow,
  PartnerSplitStatus,
} from "../../src/services/partnerSplitsService";
import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { BrandStripeCountryPicker } from "../../src/components/brand/BrandStripeCountryPicker";
import { getStripeSupportedCountry } from "../../src/constants/stripeSupportedCountries";

const RETURN_DEEP_LINK = "mingla-business://partner-onboarding-complete";

export default function PartnerEarningsScreen(): React.ReactElement {
  const router = useRouter();
  const statusQuery = usePartnerStripeStatus();
  const startOnboarding = useStartPartnerStripeOnboarding();
  const refreshSession = useRefreshPartnerAccountSession();
  const detachStripe = useDetachPartnerStripe();
  // ORCH-1331 — Paystack rail status + detach (Nigeria).
  const paystackQuery = usePartnerPaystackStatus();
  const disconnectPaystack = useDisconnectPartnerPaystack();

  // Country selection — pre-onboarding. Hydrates from persisted
  // partner_country if set, else null so the user MUST pick explicitly.
  // Locked once a Stripe account exists (Accounts v2 doesn't allow changing
  // country post-create).
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  useEffect(() => {
    if (
      typeof statusQuery.data?.partner_country === "string" &&
      statusQuery.data.partner_country.length > 0
    ) {
      setSelectedCountry(statusQuery.data.partner_country);
    }
  }, [statusQuery.data?.partner_country]);

  // ORCH-1331 — "‹ Choose a different country" re-opens the country sheet
  // immediately on return (the picker's defaultOpen affordance; design §1.4).
  const [reopenPickerOnReturn, setReopenPickerOnReturn] = useState(false);

  const stripeAccountStatus = statusQuery.data?.status ?? "not_connected";
  const paystackConnected = paystackQuery.data?.connected === true;
  // ORCH-1331 — either active rail locks the country choice (design §2 row 4).
  const countryLocked = stripeAccountStatus !== "not_connected" ||
    paystackConnected;

  const handleSelectCountry = useCallback((code: string): void => {
    setReopenPickerOnReturn(false);
    setSelectedCountry(code);
  }, []);

  const handleNgCancel = useCallback((): void => {
    setSelectedCountry(null);
    setReopenPickerOnReturn(true);
  }, []);

  const handleNgConnected = useCallback((): void => {
    if (Platform.OS !== "web") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  const handleDisconnectPaystack = useCallback((): void => {
    Alert.alert(
      "Disconnect bank?",
      "Your bank account will be unlinked from Mingla partner payouts. Splits already paid stay in your bank. You can reconnect anytime — with the same or a different account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await disconnectPaystack.mutateAsync();
              // Fresh, explicit choice on return (design §4.2).
              setSelectedCountry(null);
              await paystackQuery.refetch();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert("Couldn't disconnect", message);
            }
          },
        },
      ],
    );
  }, [disconnectPaystack, paystackQuery]);

  const handleStartOnboarding = useCallback(async () => {
    if (!statusQuery.data) return;
    if (selectedCountry === null) {
      console.warn("[partner/earnings] start tapped with no country selected");
      return;
    }
    try {
      const result = await startOnboarding.mutateAsync({
        country: selectedCountry,
        returnUrl: RETURN_DEEP_LINK,
      });
      if (Platform.OS === "web") {
        // Web: navigate inline.
        if (typeof window !== "undefined") {
          window.location.href = result.onboarding_url;
        }
      } else {
        // Native: open via expo-web-browser auth session.
        await WebBrowser.openAuthSessionAsync(
          result.onboarding_url,
          RETURN_DEEP_LINK,
        );
        // On return, refresh status.
        statusQuery.refetch();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[partner/earnings] onboarding launch failed:", message);
    }
  }, [statusQuery, startOnboarding, selectedCountry]);

  const handleManageStripe = useCallback(async () => {
    if (!statusQuery.data) return;
    try {
      const result = await refreshSession.mutateAsync("account_management");
      // Edge fn already builds the full URL with session + account_id +
      // return_to. The return_to it sets is the onboarding-complete deep
      // link, which iOS auth-session honors for dismissal — same effect.
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") {
          window.location.href = result.target_url;
        }
      } else {
        await WebBrowser.openAuthSessionAsync(
          result.target_url,
          RETURN_DEEP_LINK,
        );
        statusQuery.refetch();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[partner/earnings] manage launch failed:", message);
    }
  }, [statusQuery, refreshSession]);

  const handleDisconnectStripe = useCallback((): void => {
    Alert.alert(
      "Disconnect Stripe?",
      "Your partner Stripe account will be unlinked from Mingla. Already-paid splits remain on the existing account. You can reconnect anytime — possibly with a different country or business.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await detachStripe.mutateAsync();
              statusQuery.refetch();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert("Couldn't disconnect", message);
            }
          },
        },
      ],
    );
  }, [detachStripe, statusQuery]);

  // ORCH-1052 hotfix — modal presentation + explicit close button so the
  // screen is dismissable (was unreachable to back out of without crashing
  // the back-stack).
  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen
        options={{
          // Push (not modal). Modal pageSheet on iOS caused a compress-and-
          // restore animation when ASWebAuthenticationSession prepared its
          // consent dialog over the modal — visible as a swipe glitch right
          // before the iOS browser popup. We render our own header + close X
          // below, so swipe-down-to-dismiss isn't needed.
          headerShown: false,
        }}
      />
      {/* Canonical ChromeRow header — close (LEFT) → centered title → right
          spacer. Matches VenueCreatorWizard + the app/account/* screens. */}
      <View style={styles.header}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close partner earnings"
          testID="partner-earnings-close-button"
        />
        <View style={styles.headerMid}>
          <Text style={styles.headerTitle}>Earnings</Text>
        </View>
        <View style={styles.headerRightSlot} />
      </View>

      {/* ORCH-1081 — welcome-to-portfolio toast: fires once per (partner,
          brand_id) pair when the link first goes accepted. Tracks dismissal
          via AsyncStorage so it never replays. */}
      <PortfolioWelcomeToast />

      {/* ORCH-1331 — KAV host for the NG bank form's inputs (design §2 row 7);
          keyboardShouldPersistTaps so the Verify CTA fires on the first tap
          with the keyboard up; drag dismisses. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {statusQuery.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={accent.warm} />
            </View>
          ) : statusQuery.error ? (
            <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
              <Text style={styles.cardTitle}>Couldn't load partner status</Text>
              <Text style={styles.cardBody}>{statusQuery.error.message}</Text>
              <View style={{ marginTop: spacing.md }}>
                <Button
                  variant="secondary"
                  size="md"
                  label="Retry"
                  onPress={() => {
                    void statusQuery.refetch();
                  }}
                />
              </View>
            </GlassCard>
          ) : statusQuery.data?.partner_enabled === false ? (
            <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
              <Text style={styles.cardTitle}>Not a Mingla partner yet</Text>
              <Text style={styles.cardBody}>
                Mingla partners earn a share of every paid event they help bring
                in. Want in? Email{" "}
                <Text
                  style={styles.link}
                  onPress={() => Linking.openURL("mailto:partners@usemingla.com")}
                >
                  partners@usemingla.com
                </Text>
                .
              </Text>
            </GlassCard>
          ) : paystackQuery.isLoading ? (
            // ORCH-1331 — the paystack status joins the screen-level loading
            // gate AFTER the partner gate (non-partners never reach it).
            <View style={styles.center}>
              <ActivityIndicator color={accent.warm} />
            </View>
          ) : paystackQuery.error ? (
            // ORCH-1331 — joins the same screen-level error branch (design §4.1).
            <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
              <Text style={styles.cardTitle}>Couldn't load partner status</Text>
              <Text style={styles.cardBody}>{paystackQuery.error.message}</Text>
              <View style={{ marginTop: spacing.md }}>
                <Button
                  variant="secondary"
                  size="md"
                  label="Retry"
                  onPress={() => {
                    void paystackQuery.refetch();
                  }}
                />
              </View>
            </GlassCard>
          ) : (
            <>
              <StatusBlock
                status={statusQuery.data?.status ?? "not_connected"}
                country={statusQuery.data?.country ?? null}
                externalCurrencies={
                  statusQuery.data?.external_account_currencies ?? []
                }
                onStart={handleStartOnboarding}
                starting={startOnboarding.isPending}
                startError={startOnboarding.error?.message ?? null}
                selectedCountry={selectedCountry}
                onSelectCountry={handleSelectCountry}
                countryLocked={countryLocked}
                reopenPicker={reopenPickerOnReturn}
                onManage={handleManageStripe}
                managing={refreshSession.isPending}
                onDisconnect={handleDisconnectStripe}
                disconnecting={detachStripe.isPending}
                paystackConnected={paystackConnected}
                paystackBankName={paystackQuery.data?.bank_name ?? null}
                paystackAccountMasked={paystackQuery.data?.account_number_masked ??
                  null}
                paystackAccountName={paystackQuery.data?.account_name ?? null}
                onDisconnectPaystack={handleDisconnectPaystack}
                disconnectingPaystack={disconnectPaystack.isPending}
                onNgCancel={handleNgCancel}
                onNgConnected={handleNgConnected}
              />
              {/* ORCH-1081 — Ready-to-earn nudge. Visible only when the partner is
                  connected (status=active) AND has zero partner_brand_links. */}
              {statusQuery.data?.status === "active" ? <ReadyToEarnNudge /> : null}
              <PartnerSplitsSection />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * ORCH-1081 — Ready-to-earn nudge card. Renders only when the active partner
 * has ZERO partner_brand_links. CTA drives them to the brand-creation wizard
 * with partner_mode=client so step 1 lands with mode='client' already set.
 */
function ReadyToEarnNudge(): React.ReactElement | null {
  const router = useRouter();
  const linksQuery = usePartnerBrandLinks();
  if (linksQuery.isLoading) return null;
  const links = linksQuery.data ?? [];
  if (links.length > 0) return null;
  return (
    <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
      <Text style={styles.nudgeEyebrow}>✨ READY TO START EARNING?</Text>
      <Text style={styles.cardTitle}>Set up your first partner brand</Text>
      <Text style={styles.cardBody}>
        Partners earn 0.15% of every ticket sold on brands you help set up.
      </Text>
      <Text style={styles.nudgeStep}>① Create a brand for a venue you know</Text>
      <Text style={styles.nudgeStep}>② Build it out (events, cover, etc.)</Text>
      <Text style={styles.nudgeStep}>③ Invite the real owner</Text>
      <View style={{ marginTop: spacing.md }}>
        <Button
          variant="primary"
          size="md"
          fullWidth
          label="Set up your first partner brand"
          trailingIcon="chevR"
          onPress={() => router.push("/brand/new?partner_mode=client" as never)}
          accessibilityLabel="Set up your first partner brand"
        />
      </View>
    </GlassCard>
  );
}

/**
 * ORCH-1081 — Welcome-to-portfolio toast. On first /partner/earnings open
 * AFTER a partner_brand_links row went accepted, we surface a celebratory
 * dismissable toast. Dismissal is persisted per (link.id) so it never
 * replays — we treat each accepted link as a one-shot.
 */
const WELCOME_DISMISSED_KEY = "mingla-business:partner:portfolio:welcomeDismissed:v1";

function PortfolioWelcomeToast(): React.ReactElement | null {
  const linksQuery = usePartnerBrandLinks();
  const [showLink, setShowLink] = useState<{ id: string; brand: string } | null>(
    null,
  );
  const [dismissedIds, setDismissedIds] = useState<Set<string> | null>(null);

  // Load dismissed ids once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(WELCOME_DISMISSED_KEY);
        if (cancelled) return;
        if (raw === null) {
          setDismissedIds(new Set());
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setDismissedIds(new Set(parsed.filter((v): v is string => typeof v === "string")));
        } else {
          setDismissedIds(new Set());
        }
      } catch {
        if (!cancelled) setDismissedIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick the first un-dismissed accepted link.
  useEffect(() => {
    if (dismissedIds === null) return;
    const links = linksQuery.data ?? [];
    const accepted = links.find(
      (r) => r.accepted_at !== null && !dismissedIds.has(r.id),
    );
    if (accepted) {
      setShowLink({
        id: accepted.id,
        brand: accepted.brand?.name ?? "your brand",
      });
    }
  }, [linksQuery.data, dismissedIds]);

  const handleDismiss = useCallback((): void => {
    if (showLink === null || dismissedIds === null) return;
    const next = new Set(dismissedIds);
    next.add(showLink.id);
    setDismissedIds(next);
    setShowLink(null);
    void AsyncStorage.setItem(
      WELCOME_DISMISSED_KEY,
      JSON.stringify(Array.from(next)),
    ).catch(() => undefined);
  }, [showLink, dismissedIds]);

  if (showLink === null) return null;
  return (
    <View style={styles.welcomeToastWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss welcome message"
        onPress={handleDismiss}
        style={styles.welcomeToast}
      >
        <Text style={styles.welcomeToastText}>
          🎉 Welcome aboard, partner of {showLink.brand}. You'll see splits
          here once they connect payouts and sell their first ticket.
        </Text>
        <Text style={styles.welcomeToastClose}>Tap to dismiss</Text>
      </Pressable>
    </View>
  );
}

/**
 * ORCH-1054 — partner_splits live ledger UI.
 *
 * Renders:
 *  - per-currency totals (transferred + pending + reversed; no FX between
 *    currencies per I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY)
 *  - month + currency filter chips
 *  - per-split rows with status badge
 *  - empty state when the partner has no splits yet
 */
function PartnerSplitsSection(): React.ReactElement {
  const [currencyFilter, setCurrencyFilter] = useState<string | null>(null);
  const summaryQuery = usePartnerEarningsSummary();
  const splitsQuery = usePartnerSplits(
    currencyFilter ? { currency: currencyFilter } : {},
  );
  // ORCH-1081 — varies the empty-state copy depending on whether the partner
  // already has brands in flight.
  const linksQuery = usePartnerBrandLinks();

  const availableCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const bucket of summaryQuery.data?.totals_by_currency ?? []) {
      set.add(bucket.currency);
    }
    return Array.from(set).sort();
  }, [summaryQuery.data]);

  if (summaryQuery.isLoading) {
    return (
      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <Text style={styles.cardTitle}>Splits</Text>
        <ActivityIndicator color={accent.warm} />
      </GlassCard>
    );
  }

  if (summaryQuery.error) {
    return (
      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotMuted} />
          <Text style={styles.statusLabelMuted}>SPLITS UNAVAILABLE</Text>
        </View>
        <Text style={styles.cardTitle}>Couldn't load splits</Text>
        <Text style={styles.cardBody}>{summaryQuery.error.message}</Text>
      </GlassCard>
    );
  }

  const totals = summaryQuery.data?.totals_by_currency ?? [];
  const splits = splitsQuery.data ?? [];

  if (totals.length === 0) {
    // ORCH-1081 — copy varies based on partner_brand_links state.
    const links = linksQuery.data ?? [];
    const hasLinks = links.length > 0;
    const firstBrandName = hasLinks
      ? (links[0].brand?.name ?? "your brand")
      : null;
    const copy = hasLinks
      ? `Almost there. You've set up ${firstBrandName}. You'll see your first split as soon as their payouts are connected and tickets sell.`
      : "You'll see your first split as soon as a brand you set up makes a sale.";
    return (
      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <Text style={styles.cardTitle}>Splits</Text>
        <Text style={styles.cardBody}>{copy}</Text>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <Text style={styles.cardTitle}>Earnings by currency</Text>
        {totals.map((bucket) => (
          <View key={bucket.currency} style={styles.currencyRow}>
            <Text style={styles.currencyLabel}>
              {bucket.currency.toUpperCase()}
            </Text>
            <View style={styles.currencyValues}>
              <Text style={styles.currencyTransferred}>
                Paid {formatCents(bucket.transferred_cents, bucket.currency)}
              </Text>
              {bucket.pending_cents > 0 ? (
                <Text style={styles.currencyPending}>
                  Pending {formatCents(bucket.pending_cents, bucket.currency)}
                </Text>
              ) : null}
              {bucket.reversed_cents > 0 ? (
                <Text style={styles.currencyReversed}>
                  Reversed {formatCents(bucket.reversed_cents, bucket.currency)}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </GlassCard>

      {availableCurrencies.length > 1 ? (
        <View style={styles.filterRow}>
          <Pressable
            accessibilityLabel="Show all currencies"
            style={[
              styles.filterChip,
              currencyFilter === null && styles.filterChipActive,
            ]}
            onPress={() => setCurrencyFilter(null)}
          >
            <Text
              style={
                currencyFilter === null
                  ? styles.filterChipTextActive
                  : styles.filterChipText
              }
            >
              All
            </Text>
          </Pressable>
          {availableCurrencies.map((cur) => (
            <Pressable
              key={cur}
              accessibilityLabel={`Filter ${cur}`}
              style={[
                styles.filterChip,
                currencyFilter === cur && styles.filterChipActive,
              ]}
              onPress={() => setCurrencyFilter(cur)}
            >
              <Text
                style={
                  currencyFilter === cur
                    ? styles.filterChipTextActive
                    : styles.filterChipText
                }
              >
                {cur.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <Text style={styles.cardTitle}>Recent splits</Text>
        {splits.length === 0 ? (
          <Text style={styles.cardBody}>
            No splits in this filter. Try clearing the currency filter.
          </Text>
        ) : (
          splits.map((row) => <SplitRow key={row.id} row={row} />)
        )}
      </GlassCard>
    </>
  );
}

function SplitRow({ row }: { row: PartnerSplitRow }): React.ReactElement {
  return (
    <View style={styles.splitRow}>
      <View style={styles.splitRowLeft}>
        <Text style={styles.splitAmount}>
          {formatCents(row.partner_share_cents, row.transfer_currency)}
        </Text>
        <Text style={styles.splitMeta}>
          {new Date(row.created_at).toLocaleDateString()} · order {row.order_id.slice(0, 8)}
        </Text>
      </View>
      <StatusBadge status={row.status} />
    </View>
  );
}

function StatusBadge({ status }: { status: PartnerSplitStatus }): React.ReactElement {
  // ORCH-1052 hotfix — semantic-token alignment so badges read on dark canvas.
  const map: Record<PartnerSplitStatus, { label: string; color: string; bg: string }> = {
    transferred: { label: "Transferred", color: semantic.success, bg: semantic.successTint },
    pending: { label: "Pending", color: semantic.warning, bg: semantic.warningTint },
    blocked_currency_mismatch: { label: "Blocked — currency", color: semantic.error, bg: semantic.errorTint },
    blocked_no_stripe: { label: "Blocked — Stripe", color: semantic.error, bg: semantic.errorTint },
    // ORCH-1331 — Paystack rail: no active Transfer Recipient at sale time.
    blocked_no_paystack: { label: "Blocked — Paystack", color: semantic.error, bg: semantic.errorTint },
    failed: { label: "Failed", color: semantic.error, bg: semantic.errorTint },
    reversed: { label: "Reversed", color: textTokens.tertiary, bg: glass.tint.profileElevated },
    reversed_pending: { label: "Reversed (pending)", color: textTokens.tertiary, bg: glass.tint.profileElevated },
  };
  const cfg = map[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function StatusBlock(props: {
  status: string;
  country: string | null;
  externalCurrencies: string[];
  onStart: () => void;
  starting: boolean;
  startError: string | null;
  selectedCountry: string | null;
  onSelectCountry: (code: string) => void;
  countryLocked: boolean;
  /** ORCH-1331 — re-open the country sheet on mount (returning from the NG form). */
  reopenPicker: boolean;
  onManage: () => void;
  managing: boolean;
  onDisconnect: () => void;
  disconnecting: boolean;
  /** ORCH-1331 — Paystack rail state + actions. */
  paystackConnected: boolean;
  paystackBankName: string | null;
  paystackAccountMasked: string | null;
  paystackAccountName: string | null;
  onDisconnectPaystack: () => void;
  disconnectingPaystack: boolean;
  onNgCancel: () => void;
  onNgConnected: () => void;
}): React.ReactElement {
  const {
    status,
    country,
    externalCurrencies,
    onStart,
    starting,
    startError,
    selectedCountry,
    onSelectCountry,
    countryLocked,
    reopenPicker,
    onManage,
    managing,
    onDisconnect,
    disconnecting,
    paystackConnected,
    paystackBankName,
    paystackAccountMasked,
    paystackAccountName,
    onDisconnectPaystack,
    disconnectingPaystack,
    onNgCancel,
    onNgConnected,
  } = props;

  const selectedCountryMeta = selectedCountry
    ? getStripeSupportedCountry(selectedCountry)
    : null;
  const partnerCurrency = selectedCountryMeta?.defaultCurrency ?? null;
  const currencyHelper = partnerCurrency
    ? `Stripe will settle you in ${partnerCurrency}. You'll only be able to partner with brands that sell in ${partnerCurrency}; invitations in other currencies will be blocked.`
    : "Pick the country where you'll get paid out. Stripe locks this after onboarding, and you'll only be able to partner with brands selling in the matching currency.";

  if (status === "active") {
    return (
      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotSuccess} />
          <Text style={styles.statusLabelSuccess}>PAYOUTS READY</Text>
        </View>
        <Text style={styles.cardTitle}>You're earning</Text>
        <Text style={styles.cardBody}>
          Your partner Stripe account is active
          {country ? ` (${country})` : ""}.
          {externalCurrencies.length > 0
            ? ` We can settle in ${externalCurrencies.join(", ").toUpperCase()}.`
            : ""}
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <Button
            variant="primary"
            size="md"
            fullWidth
            label={managing ? "Opening…" : "Manage Stripe account"}
            loading={managing}
            disabled={managing || disconnecting}
            onPress={onManage}
            accessibilityLabel="Manage Stripe account"
          />
        </View>
        <View style={{ marginTop: spacing.md }}>
          <Button
            variant="secondary"
            size="md"
            fullWidth
            label={disconnecting ? "Disconnecting…" : "Disconnect Stripe"}
            labelStyle={{ color: semantic.error }}
            loading={disconnecting}
            disabled={disconnecting || managing}
            onPress={onDisconnect}
            accessibilityLabel="Disconnect Stripe"
          />
        </View>
      </GlassCard>
    );
  }

  // ORCH-1331 — PAYOUTS READY (Paystack). Same slot + card grammar as the
  // Stripe active card. Takes precedence over every Stripe branch except a
  // genuinely active Stripe account (mutually exclusive by backend 409s; if
  // both ever read true, the Stripe card above wins — defensive, unreachable).
  if (paystackConnected) {
    return (
      <GlassCard
        variant="elevated"
        radius="md"
        padding={spacing.lg}
        testID="partner-paystack-ready-card"
      >
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotSuccess} />
          <Text style={styles.statusLabelSuccess}>PAYOUTS READY</Text>
        </View>
        <Text style={styles.cardTitle}>You're earning</Text>
        <Text style={styles.cardBody}>
          Your partner payouts go to {paystackBankName ?? "your bank"}{" "}
          {paystackAccountMasked ?? ""} (NGN).
        </Text>
        <Text style={styles.paystackHolderRow}>
          Account holder: {paystackAccountName ?? "—"}
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <Button
            variant="secondary"
            size="md"
            fullWidth
            label={disconnectingPaystack ? "Disconnecting…" : "Disconnect bank"}
            labelStyle={{ color: semantic.error }}
            loading={disconnectingPaystack}
            disabled={disconnectingPaystack}
            onPress={onDisconnectPaystack}
            accessibilityLabel="Disconnect Nigerian bank account"
            testID="partner-paystack-disconnect"
          />
        </View>
      </GlassCard>
    );
  }

  if (status === "restricted") {
    return (
      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotWarning} />
          <Text style={styles.statusLabelWarning}>ACTION NEEDED</Text>
        </View>
        <Text style={styles.cardTitle}>Stripe needs more info</Text>
        <Text style={styles.cardBody}>
          Open your partner Stripe to finish the requirements Stripe is
          waiting on.
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <Button
            variant="primary"
            size="md"
            fullWidth
            label={starting ? "Opening…" : "Resume onboarding"}
            loading={starting}
            disabled={starting}
            onPress={onStart}
            accessibilityLabel="Resume Stripe onboarding"
          />
        </View>
        {startError ? (
          <View style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{startError}</Text>
          </View>
        ) : null}
      </GlassCard>
    );
  }

  if (status === "onboarding") {
    return (
      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotInfo} />
          <Text style={styles.statusLabelInfo}>IN PROGRESS</Text>
        </View>
        <Text style={styles.cardTitle}>Finish setting up payouts</Text>
        <Text style={styles.cardBody}>
          You started Stripe onboarding. Pick up where you left off.
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <Button
            variant="primary"
            size="md"
            fullWidth
            label={starting ? "Opening…" : "Resume onboarding"}
            loading={starting}
            disabled={starting}
            onPress={onStart}
            accessibilityLabel="Resume Stripe onboarding"
          />
        </View>
        {startError ? (
          <View style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{startError}</Text>
          </View>
        ) : null}
      </GlassCard>
    );
  }

  // ORCH-1331 — NG fork (design §1.4): picking Nigeria REPLACES the
  // not-connected card with the Paystack bank form; the picker is NOT
  // rendered in this state (its frozen trigger has no NG label — the form's
  // ghost back button returns to a re-opened country sheet instead).
  if (status === "not_connected" && selectedCountry === "NG" && !paystackConnected) {
    return (
      <PartnerPaystackOnboardForm
        onConnected={onNgConnected}
        onCancel={onNgCancel}
      />
    );
  }

  // not_connected
  const connectDisabled = starting || selectedCountry === null;
  return (
    <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
      <View style={styles.statusIndicatorRow}>
        <View style={styles.statusDotMuted} />
        <Text style={styles.statusLabelMuted}>NOT CONNECTED</Text>
      </View>
      <Text style={styles.cardTitle}>Connect partner Stripe</Text>
      <Text style={styles.cardBody}>
        Mingla pays partners through Stripe Connect. Set up your payout
        account once — your bank details go directly to Stripe, never to
        Mingla.
      </Text>
      <View style={styles.countryPickerWrap}>
        <BrandStripeCountryPicker
          value={selectedCountry}
          onChange={onSelectCountry}
          disabled={countryLocked || starting}
          helperText={currencyHelper}
          // ORCH-1331 — Nigeria rides the designed extraOptions slot; NG is
          // NEVER added to STRIPE_SUPPORTED_COUNTRIES (I-PROPOSED-T).
          extraOptions={[
            { code: "NG", name: "Nigeria", currency: "NGN", sublabel: "Paystack" },
          ]}
          // Returning from the NG form re-opens the sheet for a fresh pick.
          defaultOpen={reopenPicker}
        />
      </View>
      <View style={{ marginTop: spacing.md }}>
        <Button
          variant="primary"
          size="md"
          fullWidth
          label={
            starting
              ? "Opening…"
              : selectedCountry === null
                ? "Pick a country first"
                : "Connect bank"
          }
          loading={starting}
          disabled={connectDisabled}
          onPress={onStart}
          accessibilityLabel="Connect bank"
        />
      </View>
      {startError ? (
        <View style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>{startError}</Text>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  // ORCH-1052 hotfix — Mingla brand alignment. Dark canvas + white-alpha text
  // + accent.warm for primary actions + GlassCard for sections (used in JSX
  // instead of bespoke white cards). Mirrors account.tsx / brand screens.
  safe: { flex: 1, backgroundColor: canvas.discover },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },

  // Canonical ChromeRow header — close (LEFT) + centered title + right spacer.
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  headerMid: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  headerRightSlot: {
    width: 36,
  },

  // Card body content
  cardTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  cardBody: {
    ...typography.body,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  link: {
    color: accent.warm,
    textDecorationLine: "underline",
  },

  // Status indicator row (dot + label above title)
  statusIndicatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusDotSuccess: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: semantic.success,
  },
  statusDotWarning: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: semantic.warning,
  },
  statusDotInfo: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: semantic.info,
  },
  statusDotMuted: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: textTokens.tertiary,
  },
  statusLabelSuccess: { ...typography.labelCap, color: semantic.success },
  // ORCH-1331 — PAYOUTS READY (Paystack) holder caption.
  paystackHolderRow: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  statusLabelWarning: { ...typography.labelCap, color: semantic.warning },
  statusLabelInfo: { ...typography.labelCap, color: semantic.info },
  statusLabelMuted: { ...typography.labelCap, color: textTokens.tertiary },

  countryPickerWrap: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },

  // Inline error pill — shows under primary button when Stripe call fails
  inlineError: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: semantic.error,
  },
  inlineErrorText: {
    ...typography.bodySm,
    color: semantic.error,
  },

  // ORCH-1054 partner_splits ledger
  currencyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  currencyLabel: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  currencyValues: { alignItems: "flex-end" },
  currencyTransferred: {
    ...typography.bodyLg,
    color: semantic.success,
  },
  currencyPending: {
    ...typography.bodySm,
    color: semantic.warning,
  },
  currencyReversed: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  filterChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileBase,
  },
  filterChipActive: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  filterChipText: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  filterChipTextActive: {
    ...typography.caption,
    color: textTokens.inverse,
  },
  splitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  splitRowLeft: { flex: 1, paddingRight: spacing.sm },
  splitAmount: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  splitMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  badge: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.full,
  },
  badgeText: {
    ...typography.micro,
  },
  // ORCH-1081 — Ready-to-earn nudge typography.
  nudgeEyebrow: {
    ...typography.labelCap,
    color: accent.warm,
    marginBottom: spacing.xs,
  },
  nudgeStep: {
    ...typography.body,
    color: textTokens.secondary,
    marginTop: 4,
  },
  welcomeToastWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  welcomeToast: {
    backgroundColor: accent.tint,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: accent.border,
  },
  welcomeToastText: {
    ...typography.body,
    color: textTokens.primary,
  },
  welcomeToastClose: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: 4,
  },
});
