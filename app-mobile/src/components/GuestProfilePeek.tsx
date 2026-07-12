/**
 * GuestProfilePeek — ORCH-1358.
 *
 * The public-profile view opened by tapping a NAMED guest row in
 * EventGuestListSheet. It renders INSIDE the sheet's existing RN Modal (the sheet
 * swaps its body: guest list ⇄ this peek), so there is NEVER a second RN Modal —
 * this is the `overlay`-slot resolution the META-ORCH-1337 design flagged for a
 * future ORCH (DESIGN §2 / COMMS-0084 modal-over-modal ban). It is deliberately
 * LIGHT — read-only public identity only (avatar, name, @username, bio, location,
 * friend count, interest chips). It intentionally does NOT reuse the 1246-line
 * ViewFriendProfileScreen, whose nested ExpandedCardModal/CustomHolidayModal would
 * re-introduce modal-over-modal inside the sheet. Add-friend / message stay on the
 * row (the row's trailing actions are untouched by 1358).
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Icon } from "./ui/Icon";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { useFriendProfile } from "../hooks/useFriendProfile";
import { HapticFeedback } from "../utils/hapticFeedback";

interface GuestProfilePeekProps {
  userId: string;
  /** Fallback display name from the guest row (shown while the profile loads). */
  fallbackName: string;
  /** Close the peek and return to the guest list (never closes the sheet). */
  onBack: () => void;
}

const initialsFor = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
};

const GuestProfilePeek: React.FC<GuestProfilePeekProps> = ({
  userId,
  fallbackName,
  onBack,
}) => {
  const { data: profile, isLoading, isError } = useFriendProfile(userId);

  const fullName =
    profile !== null && profile !== undefined
      ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim()
      : "";
  const name = fullName.length > 0 ? fullName : fallbackName;
  const locationLine = [profile?.location, profile?.country]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" · ");
  const chips = [
    ...(profile?.intents ?? []),
    ...(profile?.categories ?? []),
  ].slice(0, 6);

  const handleBack = (): void => {
    HapticFeedback.light();
    onBack();
  };

  return (
    <View style={styles.root} testID={`orch-1358-guest-profile-peek-${userId}`}>
      <View style={styles.topBar}>
        <Pressable
          onPress={handleBack}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, pressed ? styles.pressed : null]}
          accessibilityRole="button"
          accessibilityLabel="Back to the guest list"
          testID="orch-1358-guest-profile-peek-back"
        >
          <Icon name="chevron-back" size={22} color="#f5f5f5" />
          <Text style={styles.backText}>Guest list</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#f97316" />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn{"’"}t load this profile.</Text>
          <Pressable onPress={handleBack} hitSlop={8} style={styles.errorRetry}>
            <Text style={styles.errorRetryText}>Go back</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.avatarWrap}>
            {profile?.avatar_url ? (
              <ImageWithFallback
                uri={profile.avatar_url}
                style={styles.avatar}
                accessibilityLabel={`${name}'s photo`}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitials}>{initialsFor(name)}</Text>
              </View>
            )}
          </View>

          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>
          {profile?.username ? (
            <Text style={styles.username}>@{profile.username}</Text>
          ) : null}

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {profile?.friendCount ?? 0} friend
              {(profile?.friendCount ?? 0) === 1 ? "" : "s"}
            </Text>
            {locationLine.length > 0 ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText} numberOfLines={1}>
                  {locationLine}
                </Text>
              </>
            ) : null}
          </View>

          {profile?.bio && profile.bio.trim().length > 0 ? (
            <Text style={styles.bio}>{profile.bio.trim()}</Text>
          ) : null}

          {chips.length > 0 ? (
            <View style={styles.chipRow}>
              {chips.map((chip) => (
                <View key={chip} style={styles.chip}>
                  <Text style={styles.chipText}>{chip}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { paddingBottom: 8 },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingRight: 12,
  },
  backText: { color: "#f5f5f5", fontSize: 16, fontWeight: "600", marginLeft: 2 },
  pressed: { opacity: 0.6 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
  errorText: { color: "rgba(255,255,255,0.7)", fontSize: 15 },
  errorRetry: { paddingVertical: 8, paddingHorizontal: 16 },
  errorRetryText: { color: "#f97316", fontSize: 15, fontWeight: "600" },
  body: { alignItems: "center", paddingTop: 8, paddingBottom: 24 },
  avatarWrap: { marginBottom: 14 },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: "rgba(255,255,255,0.08)" },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitials: { color: "#f5f5f5", fontSize: 30, fontWeight: "700" },
  name: { color: "#ffffff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  username: { color: "rgba(255,255,255,0.55)", fontSize: 15, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 6, flexWrap: "wrap", justifyContent: "center" },
  metaText: { color: "rgba(255,255,255,0.7)", fontSize: 14 },
  metaDot: { color: "rgba(255,255,255,0.4)", fontSize: 14 },
  bio: { color: "rgba(255,255,255,0.82)", fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 16, paddingHorizontal: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 18 },
  chip: { backgroundColor: "rgba(249,115,22,0.14)", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: "#f97316", fontSize: 13, fontWeight: "600" },
});

export default GuestProfilePeek;
