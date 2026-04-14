import React, { useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import WizardChrome from "../onboarding/WizardChrome";
import { claimPlace, type PlacePoolItem } from "../../services/placeService";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  shadows,
  surface,
  border,
} from "../../constants/designSystem";

interface PlacePreviewProps {
  place: PlacePoolItem;
  onClaimed: (businessProfileId: string) => void;
  onBack: () => void;
}

const BENEFITS = [
  "Verified badge on your card",
  "Your own photos & description",
  "AI menu scanning",
  "See who's viewing & saving",
  "Create events at your venue",
];

export default function PlacePreview({
  place,
  onClaimed,
  onBack,
}: PlacePreviewProps): React.JSX.Element {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleClaim = async (): Promise<void> => {
    setClaiming(true);
    setError(null);
    try {
      const result = await claimPlace(place.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClaimed(result.business_profile_id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't claim this place";
      setError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <WizardChrome
      currentStep={2}
      totalSteps={4}
      onBack={onBack}
      onContinue={handleClaim}
      continueLabel="Claim this place"
      continueLoading={claiming}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={styles.title}>This is what guests see today</Text>

          {/* Place preview card */}
          <View style={styles.previewCard}>
            {place.photos?.[0] ? (
              <Image
                source={{ uri: place.photos[0] }}
                style={styles.previewImage}
              />
            ) : (
              <View style={[styles.previewImage, styles.previewImagePlaceholder]}>
                <Ionicons
                  name="business"
                  size={48}
                  color={colors.gray[300]}
                />
              </View>
            )}
            <View style={styles.previewContent}>
              <Text style={styles.placeName}>{place.name}</Text>
              <Text style={styles.placeAddress}>{place.address}</Text>
              <View style={styles.placeMeta}>
                {place.category ? (
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryText}>{place.category}</Text>
                  </View>
                ) : null}
                {place.rating ? (
                  <Text style={styles.placeRating}>
                    ⭐ {place.rating.toFixed(1)}
                  </Text>
                ) : null}
                {place.price_level ? (
                  <Text style={styles.placePrice}>
                    {"$".repeat(place.price_level)}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Benefits card */}
          <View style={styles.benefitsCard}>
            <View style={styles.benefitsHeader}>
              <Ionicons name="sparkles" size={20} color={colors.primary[600]} />
              <Text style={styles.benefitsTitle}>What claiming gets you:</Text>
            </View>
            {BENEFITS.map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.success[500]}
                />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </WizardChrome>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 24,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: spacing.lg,
  },
  previewCard: {
    borderRadius: radius.xl,
    backgroundColor: surface.card,
    overflow: "hidden",
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  previewImage: {
    width: "100%",
    height: 200,
    backgroundColor: colors.gray[100],
  },
  previewImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  previewContent: {
    padding: spacing.md,
  },
  placeName: {
    fontSize: 20,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
  },
  placeAddress: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  placeMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  categoryPill: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  categoryText: {
    fontSize: 12,
    color: colors.text.secondary,
  },
  placeRating: {
    fontSize: 13,
    color: colors.text.secondary,
  },
  placePrice: {
    fontSize: 13,
    color: colors.text.tertiary,
  },
  benefitsCard: {
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  benefitsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.md,
  },
  benefitsTitle: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.primary[700],
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  benefitText: {
    fontSize: 14,
    color: colors.text.primary,
  },
  errorContainer: {
    backgroundColor: "#fef2f2",
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: {
    fontSize: 14,
    color: colors.error[500],
    textAlign: "center",
  },
});
