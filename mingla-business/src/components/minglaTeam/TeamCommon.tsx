/**
 * #4255 W5 — what every Mingla team screen shares: the header, the staff
 * gate (and the screen a host who is not staff sees), and the avatars.
 */
import React, { useCallback } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { accent, radius, spacing } from "../../constants/designSystem";
import type { TeamThread } from "../../services/teamChatService";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { useTeamText } from "./teamText";
import { useTeamAccess } from "./useTeamChat";

// ── Access ──────────────────────────────────────────────────────────────────

export function TeamHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }): React.ReactElement {
  const { t } = useTeamText();
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("team.back")} onPress={onBack} hitSlop={6} style={styles.iconButton}>
        <Icon name="arrowL" size={20} color={brandGroupChat.textPrimary} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

export function useBack(fallback = "/(tabs)/home"): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as never);
  }, [fallback, router]);
}

/** What a host who is not active Admin staff sees on any team screen or link. */
export function TeamLockedScreen(): React.ReactElement {
  const { t } = useTeamText();
  const router = useRouter();
  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen} testID="team-locked">
      <TeamHeader title={t("team.title")} onBack={() => router.replace("/(tabs)/home" as never)} />
      <View style={styles.locked}>
        <Text style={styles.lockedTitle}>{t("team.locked_title")}</Text>
        <Text style={styles.lockedBody}>{t("team.locked_body")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("team.back_home")} onPress={() => router.replace("/(tabs)/home" as never)} style={styles.chipButton} testID="team-locked-home">
          <Text style={styles.chipButtonText}>{t("team.back_home")}</Text>
        </Pressable>
      </View>
    </SafeScreen>
  );
}

/** Loading, a failed staff check (with Retry), not staff, or the screen. */
export function TeamAccessGate({ children }: { children: (userId: string) => React.ReactNode }): React.ReactElement {
  const { t } = useTeamText();
  const access = useTeamAccess();
  if (access.checking) {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.screen} testID="team-checking">
        <View style={styles.state}><ActivityIndicator color={accent.warm} accessibilityLabel={t("team.loading")} /></View>
      </SafeScreen>
    );
  }
  if (access.error) {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.screen} testID="team-check-error">
        <View style={styles.state}>
          <Text style={styles.stateText}>{t("team.check_failed")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("team.retry")} onPress={access.retry} style={styles.chipButton}>
            <Text style={styles.chipButtonText}>{t("team.retry")}</Text>
          </Pressable>
        </View>
      </SafeScreen>
    );
  }
  if (!access.staff || access.userId === null) return <TeamLockedScreen />;
  return <>{children(access.userId)}</>;
}

// ── Avatars and rows ────────────────────────────────────────────────────────

export const PALETTE = ["#1f8a5b", "#7a4fd1", "#2f6fd6", "#c2410c", "#b4235a", "#0e7490"];
export function tint(seed: string): string {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) n = (n * 31 + seed.charCodeAt(i)) % 997;
  return PALETTE[n % PALETTE.length];
}

export function TeamAvatar({ thread, size = 38 }: { thread: Pick<TeamThread, "id" | "kind" | "title">; size?: number }): React.ReactElement {
  const label = thread.kind === "team" ? "M" : thread.kind === "group" ? "#" : (thread.title.trim().charAt(0) || "?").toUpperCase();
  const background = thread.kind === "team" ? brandGroupChat.textPrimary : tint(thread.id);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: thread.kind === "dm" ? size / 2 : size / 3.2, backgroundColor: background }]}>
      <Text style={[styles.avatarText, thread.kind === "team" && styles.avatarTextTeam]}>{label}</Text>
    </View>
  );
}

export function PersonAvatar({ name, id, size = 32 }: { name: string; id: string; size?: number }): React.ReactElement {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint(id) }]}>
      <Text style={styles.avatarText}>{(name.trim().charAt(0) || "?").toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: brandGroupChat.screenBg },
  header: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  headerTitle: { flex: 1, color: brandGroupChat.textPrimary, fontSize: 17, fontWeight: "700" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  state: { padding: spacing.lg, alignItems: "center", justifyContent: "center", gap: spacing.md },
  stateText: { color: brandGroupChat.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" },
  locked: { margin: spacing.lg, marginTop: spacing.xl, gap: spacing.sm, alignItems: "center" },
  lockedTitle: { color: brandGroupChat.textPrimary, fontSize: 17, fontWeight: "700", textAlign: "center" },
  lockedBody: { color: brandGroupChat.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: spacing.sm },
  chipButton: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surfaceRaised, alignItems: "center", justifyContent: "center" },
  chipButtonText: { color: brandGroupChat.textPrimary, fontSize: 13, fontWeight: "600" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  avatarTextTeam: { color: brandGroupChat.screenBg, fontWeight: "800" },
});
