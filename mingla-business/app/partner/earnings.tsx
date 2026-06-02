/**
 * /partner/earnings — Mingla partner earnings screen. ORCH-1052.
 *
 * Visible only to flagged Mingla partners (creator_accounts.partner_enabled =
 * true). Surfaces:
 *  - Partner Stripe Connect status (not connected → CTA, onboarding → resume,
 *    active → managed)
 *  - Placeholder for the partner_splits table (data ships in ORCH-1054)
 *
 * Non-partners hit a friendly empty state directing them to support.
 */

import React, { useCallback } from "react";
import {
  ActivityIndicator,
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

import {
  usePartnerStripeStatus,
  useStartPartnerStripeOnboarding,
} from "../../src/hooks/usePartnerStripe";
import {
  colors,
  accent,
  spacing,
  radius,
  typography,
} from "../../src/constants/designSystem";

const RETURN_DEEP_LINK = "mingla-business://partner-onboarding-complete";

export default function PartnerEarningsScreen(): React.ReactElement {
  const router = useRouter();
  const statusQuery = usePartnerStripeStatus();
  const startOnboarding = useStartPartnerStripeOnboarding();

  const handleStartOnboarding = useCallback(async () => {
    if (!statusQuery.data) return;
    const country = statusQuery.data.partner_country ?? "GB";
    try {
      const result = await startOnboarding.mutateAsync({
        country,
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
  }, [statusQuery, startOnboarding]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen
        options={{
          title: "Partner earnings",
          headerBackTitleVisible: false,
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Partner earnings</Text>

        {statusQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={accent.warm} />
          </View>
        ) : statusQuery.error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t load partner status</Text>
            <Text style={styles.errorBody}>{statusQuery.error.message}</Text>
            <Pressable
              accessibilityLabel="Retry"
              style={styles.secondaryBtn}
              onPress={() => statusQuery.refetch()}
            >
              <Text style={styles.secondaryBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : statusQuery.data?.partner_enabled === false ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Not a Mingla partner yet</Text>
            <Text style={styles.emptyBody}>
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
          </View>
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
            />
            <View style={styles.splitsCard}>
              <Text style={styles.cardTitle}>Splits</Text>
              <Text style={styles.cardBody}>
                Your earnings will appear here once your first partnered event
                sells. We’re wiring the split pipeline in the next release.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusBlock(props: {
  status: string;
  country: string | null;
  externalCurrencies: string[];
  onStart: () => void;
  starting: boolean;
  startError: string | null;
}): React.ReactElement {
  const { status, country, externalCurrencies, onStart, starting, startError } =
    props;

  if (status === "active") {
    return (
      <View style={styles.statusCardActive}>
        <Text style={styles.cardTitle}>Payouts ready</Text>
        <Text style={styles.cardBody}>
          Your partner Stripe account is active
          {country ? ` (${country})` : ""}.
          {externalCurrencies.length > 0
            ? ` We can settle in ${externalCurrencies.join(", ").toUpperCase()}.`
            : ""}
        </Text>
      </View>
    );
  }

  if (status === "restricted") {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.cardTitle}>Stripe needs more info</Text>
        <Text style={styles.cardBody}>
          Open your partner Stripe to finish the requirements Stripe is
          waiting on.
        </Text>
        <Pressable
          accessibilityLabel="Resume Stripe onboarding"
          style={styles.primaryBtn}
          onPress={onStart}
          disabled={starting}
        >
          <Text style={styles.primaryBtnText}>
            {starting ? "Opening…" : "Resume onboarding"}
          </Text>
        </Pressable>
        {startError ? <Text style={styles.errorBody}>{startError}</Text> : null}
      </View>
    );
  }

  if (status === "onboarding") {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.cardTitle}>Finish setting up payouts</Text>
        <Text style={styles.cardBody}>
          You started Stripe onboarding. Pick up where you left off.
        </Text>
        <Pressable
          accessibilityLabel="Resume Stripe onboarding"
          style={styles.primaryBtn}
          onPress={onStart}
          disabled={starting}
        >
          <Text style={styles.primaryBtnText}>
            {starting ? "Opening…" : "Resume onboarding"}
          </Text>
        </Pressable>
        {startError ? <Text style={styles.errorBody}>{startError}</Text> : null}
      </View>
    );
  }

  // not_connected
  return (
    <View style={styles.statusCard}>
      <Text style={styles.cardTitle}>Connect partner Stripe</Text>
      <Text style={styles.cardBody}>
        Mingla pays partners through Stripe Connect. Set up your payout
        account once — your bank details go directly to Stripe, never to
        Mingla.
      </Text>
      <Pressable
        accessibilityLabel="Connect Stripe"
        style={styles.primaryBtn}
        onPress={onStart}
        disabled={starting}
      >
        <Text style={styles.primaryBtnText}>
          {starting ? "Opening…" : "Connect Stripe"}
        </Text>
      </Pressable>
      {startError ? <Text style={styles.errorBody}>{startError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background ?? "#FAFAFA" },
  scroll: { padding: spacing.lg ?? 16, gap: spacing.md ?? 12 },
  center: { paddingVertical: 48, alignItems: "center" },
  h1: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.text ?? "#0F172A",
    marginBottom: spacing.md ?? 12,
  },
  statusCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  statusCardActive: {
    backgroundColor: "#F0FDF4",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  splitsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  errorCard: {
    backgroundColor: "#FEF2F2",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text ?? "#0F172A",
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 22,
    color: "#475569",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text ?? "#0F172A",
  },
  emptyBody: { fontSize: 15, lineHeight: 22, color: "#475569" },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#7F1D1D",
  },
  errorBody: { fontSize: 14, color: "#7F1D1D" },
  link: { color: accent.warm ?? "#eb7825", textDecorationLine: "underline" },
  primaryBtn: {
    backgroundColor: accent.warm ?? "#eb7825",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.md ?? 8,
    alignItems: "center",
    marginTop: spacing.sm ?? 8,
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.md ?? 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    marginTop: spacing.sm ?? 8,
  },
  secondaryBtnText: { color: "#0F172A", fontSize: 15, fontWeight: "500" },
});
