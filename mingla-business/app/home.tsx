import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../src/context/AuthContext";
import { deleteCreatorAccount } from "../src/services/creatorAccount";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  shadows,
  surface,
  border,
} from "../src/constants/designSystem";

function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return "home:greeting_morning";
  if (h < 18) return "home:greeting_afternoon";
  return "home:greeting_evening";
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(["home", "common"]);
  const { user, loading, accountStatus, signOut } = useAuth();

  if (loading) return null;
  if (!user) return <Redirect href="/" />;

  const firstName = accountStatus?.firstName ?? "there";
  const intent = accountStatus?.intent ?? "both";

  const showClaimFirst = intent === "place" || intent === "both";
  const showEventFirst = intent === "events";

  const comingSoon = (): void => {
    Alert.alert(t("common:coming_soon"), t("common:coming_soon_body"));
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + 16 }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting */}
      <Text style={styles.greeting}>
        {t(getGreetingKey())}, {firstName} 👋
      </Text>
      <Text style={styles.greetingSub}>{t("home:subtitle_new")}</Text>

      {/* Hero Card */}
      <View style={styles.heroCard}>
        <Ionicons
          name={showEventFirst ? "ticket-outline" : "location-outline"}
          size={48}
          color={colors.primary[500]}
        />
        <Text style={styles.heroTitle}>
          {showEventFirst ? t("home:hero_event_title") : t("home:hero_place_title")}
        </Text>
        <Text style={styles.heroBody}>
          {showEventFirst ? t("home:hero_event_body") : t("home:hero_place_body")}
        </Text>
        <TouchableOpacity
          style={styles.heroCta}
          onPress={comingSoon}
          activeOpacity={0.85}
        >
          <Text style={styles.heroCtaText}>
            {showEventFirst ? t("home:cta_event") : t("home:cta_claim")}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Divider */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t("home:or")}</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Secondary Actions */}
      {showClaimFirst && (
        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={comingSoon}
          activeOpacity={0.85}
        >
          <View style={styles.secondaryIcon}>
            <Ionicons name="ticket-outline" size={22} color={colors.accent} />
          </View>
          <View style={styles.secondaryText}>
            <Text style={styles.secondaryTitle}>{t("home:cta_event")}</Text>
            <Text style={styles.secondaryDesc}>
              {t("home:cta_event_desc")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gray[300]} />
        </TouchableOpacity>
      )}

      {showEventFirst && (
        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={comingSoon}
          activeOpacity={0.85}
        >
          <View style={styles.secondaryIcon}>
            <Ionicons name="location-outline" size={22} color={colors.accent} />
          </View>
          <View style={styles.secondaryText}>
            <Text style={styles.secondaryTitle}>{t("home:cta_claim")}</Text>
            <Text style={styles.secondaryDesc}>
              {t("home:cta_claim_desc")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gray[300]} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.secondaryCard, { marginTop: spacing.sm }]}
        onPress={comingSoon}
        activeOpacity={0.85}
      >
        <View style={styles.secondaryIcon}>
          <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
        </View>
        <View style={styles.secondaryText}>
          <Text style={styles.secondaryTitle}>{t("home:cta_add_place")}</Text>
          <Text style={styles.secondaryDesc}>
            {t("home:cta_add_place_desc")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.gray[300]} />
      </TouchableOpacity>

      {/* Account actions */}
      <View style={styles.accountActions}>
        <TouchableOpacity
          style={styles.signOutLink}
          onPress={() => signOut()}
          activeOpacity={0.7}
        >
          <Text style={styles.signOutText}>{t("home:sign_out")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteLink}
          onPress={() => {
            Alert.alert(
              "Delete account",
              "This will permanently delete your account and all your data. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      if (user) await deleteCreatorAccount(user.id);
                      await signOut();
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : "Couldn't delete account";
                      Alert.alert("Error", msg);
                    }
                  },
                },
              ]
            );
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteText}>Delete account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  greeting: {
    fontSize: 24,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
  },
  greetingSub: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  heroCard: {
    backgroundColor: surface.selected,
    borderRadius: radius.xl,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
    ...shadows.md,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    textAlign: "center",
    marginTop: spacing.md,
  },
  heroBody: {
    fontSize: 14,
    color: colors.text.tertiary,
    textAlign: "center",
    marginTop: 4,
    marginBottom: spacing.lg,
    maxWidth: 260,
  },
  heroCta: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 32,
    ...shadows.sm,
  },
  heroCtaText: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.gray[200],
  },
  dividerText: {
    marginHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text.tertiary,
  },
  secondaryCard: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: surface.card,
    borderWidth: 1.5,
    borderColor: border.default,
    borderRadius: radius.lg,
  },
  secondaryIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primary[50],
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  secondaryText: {
    flex: 1,
  },
  secondaryTitle: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  secondaryDesc: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  accountActions: {
    alignItems: "center",
    marginTop: 32,
    gap: spacing.md,
  },
  signOutLink: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  signOutText: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
  deleteLink: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.error[500],
  },
});
