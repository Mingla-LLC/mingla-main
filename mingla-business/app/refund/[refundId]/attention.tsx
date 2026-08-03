import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SourceRefundAttentionForm } from "../../../src/components/refunds/SourceRefundAttentionForm";
import type { RefundBank } from "../../../src/components/refunds/SourceRefundAttentionForm";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { supabase } from "../../../src/services/supabase";

function fragmentAttentionToken(): string {
  if (typeof window === "undefined") return "";
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const attentionToken = fragment.get("attentionToken") ?? "";
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return attentionToken;
}

export default function SourceRefundAttentionRoute() {
  const params = useLocalSearchParams<{ refundId: string | string[] }>();
  const refundId = Array.isArray(params.refundId)
    ? params.refundId[0]
    : params.refundId;
  const [attentionToken, setAttentionToken] = useState(fragmentAttentionToken);
  const [submitting, setSubmitting] = useState(false);
  const [banks, setBanks] = useState<RefundBank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const loadBanks = useCallback(async () => {
    setLoadingBanks(true);
    const { data, error } = await supabase.functions.invoke(
      "source-refund-attention",
      {
        body: {
          mode: "banks",
          refundId,
          ...(attentionToken ? { attentionToken } : {}),
        },
      },
    );
    setBanks(error ? [] : (data?.banks ?? []));
    setLoadingBanks(false);
  }, [attentionToken, refundId]);
  useEffect(() => {
    void loadBanks();
  }, [loadBanks]);
  if (!refundId) {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.host}>
        <Text accessibilityRole="alert">This refund link is unavailable.</Text>
      </SafeScreen>
    );
  }
  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.host}>
      <Text style={styles.title}>Complete your refund</Text>
      {loadingBanks ? <ActivityIndicator /> : null}
      {!submitted
        ? (
          <SourceRefundAttentionForm
            banks={banks}
            loadingBanks={loadingBanks}
            onRetryBanks={() => void loadBanks()}
            submitting={submitting}
            onSubmit={async (details) => {
              setSubmitting(true);
              setMessage("");
              const { error } = await supabase.functions.invoke(
                "source-refund-attention",
                {
                  body: {
                    mode: "submit_paystack_details",
                    refundId,
                    currency: "NGN",
                    ...(attentionToken ? { attentionToken } : {}),
                    ...details,
                  },
                },
              );
              if (error) {
                setMessage("We couldn’t submit those details. Try again.");
              } else {
                setAttentionToken("");
                setSubmitted(true);
                setMessage("Your refund is processing.");
              }
              setSubmitting(false);
            }}
          />
        )
        : null}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    </SafeScreen>
  );
}
const styles = StyleSheet.create({
  host: { flex: 1, padding: 24, justifyContent: "center", gap: 16 },
  title: { fontSize: 24, fontWeight: "700" },
});
