import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../../src/components/ui/Button";
import { color, edge, radius, space } from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import { acceptReferralInvite } from "../../../src/services/referralInviteService";

export default function ReferralInviteRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ token: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [state, setState] = React.useState<
    "ready" | "saving" | "done" | "error"
  >("ready");
  const [detail, setDetail] = React.useState("");
  const accept = async (): Promise<void> => {
    if (!token || !user) return;
    setState("saving");
    try {
      await acceptReferralInvite(token);
      setState("done");
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "Try again.");
      setState("error");
    }
  };
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.pageContent,
        { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[6] },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.title}>
          {state === "done" ? "You’re on the team" : "Accept promoter invite"}
        </Text>
        <Text style={styles.copy}>
          {state === "done"
            ? "Your private sharing link and earnings are ready in Promoting."
            : user
              ? `Accept with ${user.email ?? "your signed-in account"}. The invite only works for the email the host invited.`
              : "Sign in with the same email address the host invited, then return to this link."}
        </Text>
        {state === "error" ? <Text style={styles.error}>{detail}</Text> : null}
        {state === "done" ? (
          <Button
            label="See my promoting offers"
            onPress={() => router.replace("/promoting" as never)}
          />
        ) : user ? (
          <Button
            label={state === "saving" ? "Accepting…" : "Accept invite"}
            disabled={state === "saving" || !token}
            onPress={() => void accept()}
          />
        ) : (
          <Button
            label="Sign in"
            onPress={() =>
              router.push(
                `/auth?next=${encodeURIComponent(`/join/referral/${token ?? ""}`)}` as never,
              )
            }
          />
        )}
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  pageContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: space[6],
  },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 520,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: edge.ringInputFocus.borderColor,
    backgroundColor: color.fill.inset,
    padding: space[6],
    gap: space[4],
  },
  title: { color: color.text1, fontSize: 25, fontWeight: "900" },
  copy: { color: color.text2, lineHeight: 21 },
  error: { color: color.errorText, fontWeight: "700" },
});
