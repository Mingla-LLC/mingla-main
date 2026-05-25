/**
 * /stripe-onboarding-return — HTTPS relay for Stripe hosted onboarding.
 *
 * @deprecated ORCH-0954 / DEC-159 cuts new brands over to Mingla-hosted
 * embedded onboarding. Keep this relay for legacy TEST hosted Account Link
 * re-onboarding paths only.
 *
 * Stripe Accounts v2 account links require HTTPS return and refresh URLs.
 * Native app schemes such as `mingla-business://...` are not accepted by
 * Stripe directly, so the edge function points Stripe here and passes the
 * native deep link as `return_to`. This route then redirects the browser back
 * into the app.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — HTTPS-relay route that immediately redirects (window.location.href or router.replace) on mount; brief loader only, no operator-visible UI to bleed
import React, { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

const FALLBACK_ROUTE = "/" as const;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isAllowedReturnTo(value: string | null): value is string {
  if (value === null) return false;
  return (
    value.startsWith("mingla-business://") ||
    value.startsWith("https://business.usemingla.com/")
  );
}

export default function StripeOnboardingReturn(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    return_to?: string | string[];
    stripe_onboarding_refresh?: string | string[];
  }>();
  const returnTo = firstParam(params.return_to);

  useEffect(() => {
    if (!isAllowedReturnTo(returnTo)) {
      router.replace(FALLBACK_ROUTE);
      return;
    }

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = returnTo;
      return;
    }

    router.replace(FALLBACK_ROUTE);
  }, [returnTo, router]);

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Returning to Mingla Business...</Text>
      <Text style={styles.body}>
        If this page does not close automatically, reopen Mingla Business.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#0c0e12",
  },
  title: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    marginTop: 12,
    color: "rgba(255,255,255,0.72)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
