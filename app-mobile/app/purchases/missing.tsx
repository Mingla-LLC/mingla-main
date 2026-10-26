// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { AddIdentitySheet } from "../../src/components/purchases/AddIdentitySheet";
import { queryClient } from "../../src/config/queryClient";
import { useClaimIdentifiers } from "../../src/hooks/useClaimIdentifiers";
import { purchaseKeys } from "../../src/hooks/queryKeys";
import { runClaimSweep } from "../../src/services/claimSweep";
import { useAppStore } from "../../src/store/appStore";

export default function MissingPurchaseRoute(): React.ReactElement {
  const { t } = useTranslation("purchases");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAppStore((state) => state.user?.id ?? null);
  const identifiers = useClaimIdentifiers(userId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resultCopy, setResultCopy] = useState<string | null>(null);

  const verified = async (result: {
    foundCount: number;
    claimed: unknown[];
  }): Promise<void> => {
    setSheetOpen(false);
    if (userId) {
      await queryClient.invalidateQueries({
        queryKey: purchaseKeys.identifiers(userId),
      });
      const sweep =
        result.claimed.length === 0
          ? await runClaimSweep(userId, "add_identity")
          : null;
      const total = Math.max(result.foundCount, sweep?.count ?? 0);
      setResultCopy(
        total > 0
          ? t("missing.foundCount", { count: total })
          : t("missing.verifiedNoPurchase"),
      );
    }
  };

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("screen.back")}
          hitSlop={10}
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/purchases")
          }
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Text style={styles.backText}>‹</Text>
          <Text style={styles.backLabel}>{t("screen.title")}</Text>
        </Pressable>

        <Text style={styles.eyebrow}>{t("missing.eyebrow")}</Text>
        <Text style={styles.title}>{t("missing.title")}</Text>
        <Text style={styles.body}>{t("missing.body")}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("missing.confirmedHeading")}</Text>
          {identifiers.isLoading ? (
            <ActivityIndicator color="#eb7825" style={styles.loading} />
          ) : identifiers.data?.length ? (
            identifiers.data.map((identifier) => (
              <View
                key={`${identifier.kind}:${identifier.value}`}
                style={styles.identifierRow}
              >
                <View style={styles.check}>
                  <Text style={styles.checkText}>✓</Text>
                </View>
                <View style={styles.identifierCopy}>
                  <Text selectable style={styles.identifierValue}>
                    {identifier.display}
                  </Text>
                  <Text style={styles.identifierKind}>
                    {identifier.kind === "email"
                      ? t("missing.email")
                      : t("missing.mobile")}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>{t("missing.noneConfirmed")}</Text>
          )}
        </View>

        {resultCopy ? (
          <View accessibilityLiveRegion="polite" style={styles.result}>
            <Text style={styles.resultText}>{resultCopy}</Text>
          </View>
        ) : null}

        <Text style={styles.differentTitle}>
          {t("missing.differentHeading")}
        </Text>
        <Text style={styles.differentBody}>{t("missing.ctaHint")}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>{t("missing.cta")}</Text>
        </Pressable>
      </ScrollView>

      <AddIdentitySheet
        onClose={() => setSheetOpen(false)}
        onVerified={(result) => {
          void verified(result);
        }}
        visible={sheetOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0b0d11" },
  content: { paddingHorizontal: 20 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    minHeight: 44,
    gap: 4,
  },
  backText: { color: "#fff", fontSize: 31, lineHeight: 33, marginTop: -3 },
  backLabel: { color: "#fff", fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.65 },
  eyebrow: {
    color: "#eb7825",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
    marginTop: 24,
  },
  title: {
    color: "#fff",
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    marginTop: 7,
  },
  body: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#171a20",
    padding: 18,
    marginTop: 28,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 10,
  },
  loading: { marginVertical: 22 },
  identifierRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(38,179,102,0.16)",
  },
  checkText: { color: "#52d78f", fontWeight: "900" },
  identifierCopy: { flex: 1, marginLeft: 12 },
  identifierValue: { color: "#fff", fontSize: 14, fontWeight: "700" },
  identifierKind: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 11,
    marginTop: 2,
  },
  empty: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 12,
  },
  result: {
    borderRadius: 15,
    backgroundColor: "rgba(38,179,102,0.12)",
    padding: 14,
    marginTop: 16,
  },
  resultText: { color: "#91e6b8", fontSize: 13, lineHeight: 19 },
  differentTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 30,
  },
  differentBody: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7,
  },
  primary: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
    marginTop: 20,
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
