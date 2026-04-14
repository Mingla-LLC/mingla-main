import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import WizardChrome from "../onboarding/WizardChrome";
import { searchPlaces, type PlacePoolItem } from "../../services/placeService";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  surface,
  border,
  shadows,
} from "../../constants/designSystem";

interface FindBusinessProps {
  onSelect: (place: PlacePoolItem) => void;
  onBack: () => void;
  onCreateNew: () => void;
}

export default function FindBusiness({
  onSelect,
  onBack,
  onCreateNew,
}: FindBusinessProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlacePoolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const data = await searchPlaces(q);
      setResults(data);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (text: string): void => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 300);
  };

  return (
    <WizardChrome
      currentStep={1}
      totalSteps={4}
      onBack={onBack}
      onContinue={() => {}}
      continueDisabled
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={styles.title}>Find your business</Text>
          <Text style={styles.subtitle}>Search by name or address.</Text>

          <View style={styles.searchRow}>
            <Ionicons
              name="search"
              size={20}
              color={colors.text.tertiary}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={handleQueryChange}
              placeholder="Search by name or address..."
              placeholderTextColor={colors.text.tertiary}
              autoFocus
              autoCapitalize="words"
              returnKeyType="search"
              accessibilityLabel="Search for your business"
            />
          </View>

          {loading && (
            <ActivityIndicator
              size="small"
              color={colors.primary[500]}
              style={styles.loader}
            />
          )}

          {results.map((place) => (
            <TouchableOpacity
              key={place.id}
              style={[styles.resultCard, place.is_claimed && styles.resultClaimed]}
              onPress={() => {
                if (place.is_claimed) {
                  Alert.alert(
                    "Already claimed",
                    "This place is managed by someone else."
                  );
                  return;
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelect(place);
              }}
              activeOpacity={place.is_claimed ? 1 : 0.85}
              accessibilityRole="button"
              accessibilityLabel={`${place.name}, ${place.address}${place.is_claimed ? ", already claimed" : ""}`}
            >
              {place.photos?.[0] ? (
                <Image
                  source={{ uri: place.photos[0] }}
                  style={styles.resultPhoto}
                />
              ) : (
                <View style={[styles.resultPhoto, styles.resultPhotoPlaceholder]}>
                  <Ionicons
                    name="business-outline"
                    size={24}
                    color={colors.gray[300]}
                  />
                </View>
              )}
              <View style={styles.resultInfo}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {place.name}
                </Text>
                <Text style={styles.resultAddress} numberOfLines={1}>
                  {place.address}
                </Text>
                <View style={styles.resultMeta}>
                  {place.category ? (
                    <Text style={styles.resultCategory}>{place.category}</Text>
                  ) : null}
                  {place.rating ? (
                    <Text style={styles.resultRating}>
                      ⭐ {place.rating.toFixed(1)}
                    </Text>
                  ) : null}
                  {place.review_count ? (
                    <Text style={styles.resultReviews}>
                      · {place.review_count} reviews
                    </Text>
                  ) : null}
                </View>
              </View>
              {place.is_claimed ? (
                <View style={styles.claimedBadge}>
                  <Text style={styles.claimedText}>Claimed</Text>
                </View>
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.gray[300]}
                />
              )}
            </TouchableOpacity>
          ))}

          {searched && !loading && results.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons
                name="search-outline"
                size={36}
                color={colors.text.tertiary}
              />
              <Text style={styles.emptyText}>
                We couldn't find that place
              </Text>
            </View>
          )}

          {/* Create new place */}
          <View style={styles.createSection}>
            <Text style={styles.createLabel}>Can't find it?</Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={onCreateNew}
              activeOpacity={0.85}
            >
              <Ionicons
                name="add-circle-outline"
                size={20}
                color={colors.primary[500]}
              />
              <Text style={styles.createText}>Create a new place</Text>
            </TouchableOpacity>
          </View>
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginBottom: spacing.lg,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 52,
    backgroundColor: surface.input,
    borderWidth: 1.5,
    borderColor: border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text.primary,
  },
  loader: {
    marginVertical: spacing.md,
  },
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  resultClaimed: {
    opacity: 0.5,
  },
  resultPhoto: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.gray[100],
  },
  resultPhotoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  resultInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  resultName: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  resultAddress: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  resultMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 4,
  },
  resultCategory: {
    fontSize: 12,
    color: colors.text.tertiary,
  },
  resultRating: {
    fontSize: 12,
    color: colors.text.secondary,
  },
  resultReviews: {
    fontSize: 12,
    color: colors.text.tertiary,
  },
  claimedBadge: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  claimedText: {
    fontSize: 11,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: 15,
    color: colors.text.tertiary,
  },
  createSection: {
    marginTop: spacing.lg,
  },
  createLabel: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.gray[300],
    borderStyle: "dashed",
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  createText: {
    fontSize: 15,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
});
