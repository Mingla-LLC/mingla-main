import React from "react";
import {
  View,
  Text,
  Pressable,
  Image,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
} from "../constants/designSystem";
import { PendingLinkConsent } from "../services/linkConsentService";

interface LinkConsentCardProps {
  consent: PendingLinkConsent;
  onRespond: (linkId: string, action: "accept" | "decline") => void;
  isResponding: boolean;
}

export function LinkConsentCard({
  consent,
  onRespond,
  isResponding,
}: LinkConsentCardProps) {
  const initials = consent.friendName
    ? consent.friendName
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <View style={styles.card}>
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        {consent.friendAvatarUrl ? (
          <Image
            source={{ uri: consent.friendAvatarUrl }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
      </View>

      {/* Text */}
      <View style={styles.textContainer}>
        <Text style={styles.messageText}>
          <Text style={styles.friendName}>{consent.friendName}</Text>
          {" wants to link profiles with you. This shares your name, birthday, and details with each other."}
        </Text>
      </View>

      {/* Buttons */}
      <View style={styles.buttonsContainer}>
        <Pressable
          style={[styles.linkButton, isResponding && styles.buttonDisabled]}
          onPress={() => onRespond(consent.linkId, "accept")}
          disabled={isResponding}
        >
          {isResponding ? (
            <ActivityIndicator size="small" color={colors.text.inverse} />
          ) : (
            <Text style={styles.linkButtonText}>Link</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.notNowButton, isResponding && styles.buttonDisabled]}
          onPress={() => onRespond(consent.linkId, "decline")}
          disabled={isResponding}
        >
          <Text style={styles.notNowButtonText}>Not Now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  avatarContainer: {
    marginRight: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[400],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    ...typography.sm,
    fontWeight: fontWeights.bold,
    color: colors.text.inverse,
  },
  textContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  messageText: {
    ...typography.xs,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
  },
  friendName: {
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  buttonsContainer: {
    flexDirection: "column",
    gap: spacing.xs,
  },
  linkButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
    minHeight: 32,
  },
  linkButtonText: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  notNowButton: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
    minHeight: 32,
  },
  notNowButtonText: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
    color: colors.text.secondary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
