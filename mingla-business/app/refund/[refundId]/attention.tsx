import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SourceRefundAttentionForm } from "../../../src/components/refunds/SourceRefundAttentionForm";
import type { RefundBank } from "../../../src/components/refunds/SourceRefundAttentionForm";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { supabase } from "../../../src/services/supabase";
import { ScrollView } from "../../../src/wrappers/SmartScrollView";

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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <Text accessibilityRole="alert">This refund link is unavailable.</Text>
        </ScrollView>
      </SafeScreen>
    );
  }
  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.host}>
      {/*
        #2211 — this region SCROLLS. `host` was `flex: 1` + `padding: 24` +
        `justifyContent: "center"` with no scroll container anywhere in the
        render path: the form's ONLY ScrollView is a `maxHeight: 220` bank
        list nested inside it. At the largest Dynamic Type setting the 24 pt
        title, the paragraph, the account-number input, the bank list and the
        submit button all grew inside a centred container that cannot scroll,
        so a buyer owed a refund could not reach the field or the button. This
        is a money surface — the least acceptable place in the app to strand
        someone.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
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
      </ScrollView>
    </SafeScreen>
  );
}
const styles = StyleSheet.create({
  // #2211 — `host` no longer centres or pads: it is only the SafeScreen frame.
  // The centring moved to `scrollContent`, where `flexGrow: 1` reproduces it
  // exactly while there is room and yields to scrolling once there is not.
  host: { flex: 1 },
  scroll: { flex: 1, overflow: "hidden" },
  // #2211 — `flexGrow: 1` is EXPLICIT. A ScrollView's content container
  // defaults to `flexGrow: 0`; omitting it is the silent footgun recorded in
  // feedback_rn_scrollview_flex_grow_default_one_silent_footgun.
  scrollContent: { flexGrow: 1, padding: 24, justifyContent: "center", gap: 16 },
  title: { fontSize: 24, fontWeight: "700" },
});
