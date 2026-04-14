import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  shadows,
  surface,
  border,
} from "../../constants/designSystem";

interface PlaceLiveConfirmationProps {
  placeName: string;
  onSnapMenu: () => void;
  onCreateEvent: () => void;
  onGoToDashboard: () => void;
}

export default function PlaceLiveConfirmation({
  placeName,
  onSnapMenu,
  onCreateEvent,
  onGoToDashboard,
}: PlaceLiveConfirmationProps): React.JSX.Element {
  const checkAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.sequence([
      Animated.spring(checkAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
      Animated.timing(contentAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Checkmark */}
      <Animated.View
        style={[
          styles.checkContainer,
          { transform: [{ scale: checkAnim }], opacity: checkAnim },
        ]}
      >
        <View style={styles.checkCircle}>
          <Ionicons name="checkmark" size={40} color="#fff" />
        </View>
      </Animated.View>

      <Animated.View style={{ opacity: contentAnim }}>
        <Text style={styles.title}>Your place is live!</Text>
        <Text style={styles.placeName}>{placeName}</Text>

        <View style={styles.verifiedBadge}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success[500]} />
          <Text style={styles.verifiedText}>Verified</Text>
        </View>

        <Text style={styles.socialProof}>
          Mingla users near you can now discover your place.
        </Text>

        <Text style={styles.reachLabel}>Here's how to reach them:</Text>

        {/* Snap menu CTA */}
        <TouchableOpacity
          style={styles.primaryCard}
          onPress={onSnapMenu}
          activeOpacity={0.85}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="camera-outline" size={24} color={colors.primary[500]} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Snap your menu</Text>
            <Text style={styles.cardDesc}>
              AI turns photos into bookable items your guests can purchase.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gray[300]} />
        </TouchableOpacity>

        {/* Create event CTA */}
        <TouchableOpacity
          style={styles.secondaryCard}
          onPress={onCreateEvent}
          activeOpacity={0.85}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="ticket-outline" size={24} color={colors.accent} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Create an event</Text>
            <Text style={styles.cardDesc}>
              Trivia, live music, tastings...
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gray[300]} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dashboardLink}
          onPress={onGoToDashboard}
          activeOpacity={0.7}
        >
          <Text style={styles.dashboardLinkText}>Go to dashboard →</Text>
        </TouchableOpacity>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 80,
    paddingBottom: 48,
    alignItems: "center",
  },
  checkContainer: {
    marginBottom: spacing.lg,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success[500],
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: "center",
    marginBottom: 4,
  },
  placeName: {
    fontSize: 16,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f0fdf4",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    marginBottom: spacing.xl,
  },
  verifiedText: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
    color: colors.success[700],
  },
  socialProof: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  reachLabel: {
    fontSize: 14,
    color: colors.text.tertiary,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  primaryCard: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    padding: spacing.md,
    backgroundColor: surface.selected,
    borderWidth: 1.5,
    borderColor: border.selected,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  secondaryCard: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    padding: spacing.md,
    backgroundColor: surface.card,
    borderWidth: 1.5,
    borderColor: border.default,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary[50],
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  cardDesc: {
    fontSize: 13,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  dashboardLink: {
    paddingVertical: spacing.sm,
  },
  dashboardLinkText: {
    fontSize: 15,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
});
