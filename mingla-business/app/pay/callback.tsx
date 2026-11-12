/**
 * /pay/callback — #4402 safety net for Paystack's dashboard-default return.
 *
 * Paystack sends a payer here when a payment was started without its own
 * return URL (creator hires before #4402, and any stray dashboard-default
 * return). The installment pay-link page (`[token].tsx`) used to catch this
 * path with token "callback" and tell a host who had just paid that something
 * went wrong. This static route wins over `[token]`.
 *
 * - A creator-hire reference (`ghold_` / `gtop_`): ask the server to check
 *   and record it, then open that contract page (which keeps checking).
 * - Anything else, or no session: a neutral page. It never says the payment
 *   failed.
 *
 * Public `/pay/` route: anon-tolerant, so no useAuth here. The service is
 * loaded on demand so this page adds almost nothing to the web bundle.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { SafeScreen } from "../../src/components/ui/SafeScreen";
import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";

// The same shape gig-hire initializes (supabase/functions/_shared/gigPaymentCapture.ts).
const GIG_REFERENCE = /^(ghold|gtop)_[0-9a-f]{32}_v[1-9][0-9]{0,5}$/;

const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default function PayCallback(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const reference = one(params.reference) || one(params.trxref);
  const isGig = GIG_REFERENCE.test(reference);
  const [routing, setRouting] = useState(isGig);

  useEffect(() => {
    if (!isGig) return;
    let live = true;
    void (async () => {
      try {
        const { confirmGigReference } = await import(
          "../../src/services/gigHireService"
        );
        const answer = await confirmGigReference({ reference });
        const brandId = answer.brand_id;
        const contractId = answer.contract_id;
        if (live && brandId && contractId) {
          router.replace(
            `/brand/${brandId}/creators/contract/${contractId}?reference=${encodeURIComponent(reference)}` as never,
          );
          return;
        }
      } catch {
        // Fall through to the neutral page: the webhook and the 15-minute
        // reconcile record the payment whatever happens here.
      }
      if (live) setRouting(false);
    })();
    return () => {
      live = false;
    };
  }, [isGig, reference, router]);

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
      <View style={styles.content}>
        {routing ? (
          <>
            <ActivityIndicator accessibilityLabel="Opening your offer" />
            <Text style={styles.body}>Opening your offer…</Text>
          </>
        ) : (
          <>
            <Text style={styles.title} accessibilityRole="header">
              Payment received. You can close this tab.
            </Text>
            <Text style={styles.body}>
              Open Mingla Business to see where it stands.
            </Text>
          </>
        )}
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.discover },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
