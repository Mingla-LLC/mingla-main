import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { claimGuestEarnings } from "../../src/services/referralEarningsService";
import { useAppStore } from "../../src/store/appStore";

export default function ClaimEarningsRoute() {
  const router = useRouter();
  const userId = useAppStore((state) => state.user?.id ?? null);
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [message, setMessage] = useState("Matching this claim to your verified email…");
  useEffect(() => {
    if (!userId) {
      setState("error");
      setMessage("Sign in with the exact email that received this claim link, then open the link again.");
      return;
    }
    if (!token || token.length < 32) {
      setState("error");
      setMessage("This claim link is incomplete.");
      return;
    }
    void claimGuestEarnings(token).then((claimed) => {
      setState("done");
      setMessage(`${claimed.sharesClaimed} reward ${claimed.sharesClaimed === 1 ? "entry" : "entries"} and ${claimed.vouchersClaimed} ${claimed.vouchersClaimed === 1 ? "voucher" : "vouchers"} were added to your account.`);
    }).catch(() => {
      setState("error");
      setMessage("Sign in with the exact email that received this claim link, then open it again. Expired and already-used links cannot be claimed.");
    });
  }, [token, userId]);
  return (
    <View style={styles.page}>
      {state === "loading" ? <ActivityIndicator color="#f97316" /> : null}
      <Text style={styles.eyebrow}>REFERRAL REWARDS</Text>
      <Text style={styles.title}>{state === "done" ? "Your rewards are claimed" : state === "error" ? "We could not claim this yet" : "Claiming your rewards"}</Text>
      <Text style={styles.body}>{message}</Text>
      <Pressable
        onPress={() => router.replace((userId ? "/earnings" : "/") as never)}
        style={styles.button}
      >
        <Text style={styles.buttonText}>
          {userId ? "Open earnings & rewards" : "Sign in"}
        </Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", padding: 28, gap: 12, backgroundColor: "#09090b" },
  eyebrow: { color: "#fb923c", fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: "#fff", fontSize: 30, lineHeight: 35, fontWeight: "900" },
  body: { color: "rgba(255,255,255,0.68)", lineHeight: 21 },
  button: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, backgroundColor: "#f97316" },
  buttonText: { color: "#fff", fontWeight: "800" },
});
