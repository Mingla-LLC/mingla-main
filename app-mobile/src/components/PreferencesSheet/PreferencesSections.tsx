import React, { memo, useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';

/**
 * Memoized Experience Types Section
 * Prevents unnecessary re-renders of category buttons
 */
// Helper descriptions for curated experience types
const EXPERIENCE_TYPE_DESCRIPTION_KEYS: Record<string, string> = {
  "adventurous":   "experience_descriptions.adventurous",
  "first-date":    "experience_descriptions.first-date",
  "romantic":      "experience_descriptions.romantic",
  "group-fun":     "experience_descriptions.group-fun",
  "picnic-dates":  "experience_descriptions.picnic-dates",
  "take-a-stroll": "experience_descriptions.take-a-stroll",
};

export const ExperienceTypesSection = memo(
  ({
    experienceTypes,
    selectedIntents,
    onIntentToggle,
    minMessage,
    isCuratedLocked,
    onLockedTap,
  }: {
    experienceTypes: any[];
    selectedIntents: string[];
    onIntentToggle: (id: string) => void;
    minMessage?: boolean;
    isCuratedLocked?: boolean;
    onLockedTap?: () => void;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    const [lastTappedIntent, setLastTappedIntent] = useState<string | null>(null);

    const handlePress = (id: string) => {
      setLastTappedIntent(id);
      onIntentToggle(id);
    };

    const helperIntent = lastTappedIntent && selectedIntents.includes(lastTappedIntent)
      ? experienceTypes.find((t: any) => t.id === lastTappedIntent)
      : null;

    return (
      <View style={styles.section}>
        {isCuratedLocked && (
          <TouchableOpacity
            onPress={onLockedTap}
            activeOpacity={0.7}
            style={styles.curatedLockedBanner}
          >
            <Icon name="lock-closed" size={14} color="#f97316" />
            <Text style={styles.curatedLockedText}>
              {t('preferences:experience_types.curated_locked')}
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.experienceTypesContainer}>
          {experienceTypes.map((type) => {
            const isSelected = selectedIntents.includes(type.id);
            return (
              <TouchableOpacity
                key={type.id}
                onPress={() => handlePress(type.id)}
                style={[
                  styles.experienceTypeButton,
                  isSelected && styles.experienceTypeButtonSelected,
                ]}
              >
                <Icon
                  name={type.icon}
                  size={16}
                  color={isSelected ? "#ffffff" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.experienceTypeText,
                    isSelected && styles.experienceTypeTextSelected,
                  ]}
                >
                  {t(`common:intent_${type.id.replace(/-/g, '_')}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {helperIntent && EXPERIENCE_TYPE_DESCRIPTION_KEYS[helperIntent.id] && (
          <View style={styles.helperTextContainer}>
            <Icon name="information-circle-outline" size={14} color="#eb7825" style={{ marginRight: 6, marginTop: 1 }} />
            <Text style={styles.helperText}>
              <Text style={styles.helperTextBold}>{t(`common:intent_${helperIntent.id.replace(/-/g, '_')}`)}:</Text>{" "}
              {t(`preferences:${EXPERIENCE_TYPE_DESCRIPTION_KEYS[helperIntent.id]}`)}
            </Text>
          </View>
        )}
        {minMessage && (
          <View style={styles.funnyWarning}>
            <Text style={styles.funnyWarningText}>You need at least one — we can't read minds yet 😄</Text>
          </View>
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.selectedIntents.length === next.selectedIntents.length &&
    prev.minMessage === next.minMessage &&
    prev.isCuratedLocked === next.isCuratedLocked &&
    prev.selectedIntents.every((id: string) =>
      next.selectedIntents.includes(id)
    )
);

ExperienceTypesSection.displayName = "ExperienceTypesSection";

// Keys for each category description in the preferences namespace
// ORCH-0434: Updated to 8 new canonical slugs
const CATEGORY_DESCRIPTION_KEYS: Record<string, string> = {
  nature: "category_descriptions.nature",
  icebreakers: "category_descriptions.icebreakers",
  drinks_and_music: "category_descriptions.drinks_and_music",
  brunch_lunch_casual: "category_descriptions.brunch_lunch_casual",
  upscale_fine_dining: "category_descriptions.upscale_fine_dining",
  movies_theatre: "category_descriptions.movies_theatre",
  creative_arts: "category_descriptions.creative_arts",
  play: "category_descriptions.play",
};

/**
 * Memoized Categories Section
 * Prevents unnecessary re-renders of category buttons
 */
export const CategoriesSection = memo(
  ({
    filteredCategories,
    selectedCategories,
    onCategoryToggle,
    capMessage,
    minMessage,
  }: {
    filteredCategories: any[];
    selectedCategories: string[];
    onCategoryToggle: (id: string) => void;
    capMessage?: boolean;
    minMessage?: boolean;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    const [lastTappedCategory, setLastTappedCategory] = useState<string | null>(null);

    const handlePress = (id: string) => {
      setLastTappedCategory(id);
      onCategoryToggle(id);
    };

    // Show description for last tapped category (only if it's currently selected)
    const helperCategory = lastTappedCategory && selectedCategories.includes(lastTappedCategory)
      ? filteredCategories.find((c: any) => c.id === lastTappedCategory)
      : null;

    return (
      <View style={styles.section}>
        <View style={styles.categoriesContainer}>
          {filteredCategories.map((category) => {
            const isSelected = selectedCategories.includes(category.id);
            return (
              <TouchableOpacity
                key={category.id}
                onPress={() => handlePress(category.id)}
                style={[
                  styles.categoryButton,
                  isSelected && styles.categoryButtonSelected,
                ]}
              >
                <Icon
                  name={isSelected ? (category.icon as string).replace('-outline', '') : category.icon}
                  size={16}
                  color={isSelected ? "#ffffff" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.categoryText,
                    isSelected && styles.categoryTextSelected,
                  ]}
                >
                  {t(`common:category_${category.id}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {helperCategory && CATEGORY_DESCRIPTION_KEYS[helperCategory.id] && (
          <View style={styles.helperTextContainer}>
            <Icon name="information-circle-outline" size={14} color="#eb7825" style={{ marginRight: 6, marginTop: 1 }} />
            <Text style={styles.helperText}>
              <Text style={styles.helperTextBold}>{t(`common:category_${helperCategory.id}`)}:</Text>{" "}
              {t(`preferences:${CATEGORY_DESCRIPTION_KEYS[helperCategory.id]}`)}
            </Text>
          </View>
        )}
        {minMessage && (
          <View style={styles.funnyWarning}>
            <Text style={styles.funnyWarningText}>Keep at least one — gotta have something to explore! 🧭</Text>
          </View>
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.filteredCategories.length === next.filteredCategories.length &&
    prev.selectedCategories.length === next.selectedCategories.length &&
    prev.capMessage === next.capMessage &&
    prev.minMessage === next.minMessage &&
    prev.selectedCategories.every((id: string) =>
      next.selectedCategories.includes(id)
    )
);

CategoriesSection.displayName = "CategoriesSection";

// ORCH-0434: DateTimeSection deleted — replaced by WhenSection in PreferencesSheet/WhenSection.tsx


/**
 * Memoized Travel Mode Section
 */
export const TravelModeSection = memo(
  ({
    travelModes,
    travelMode,
    onTravelModeChange,
  }: {
    travelModes: any[];
    travelMode: string;
    onTravelModeChange: (mode: string) => void;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    return (
    <View style={styles.section}>
      <View style={styles.travelModesGrid}>
        {travelModes.map((mode) => {
          const isSelected = travelMode === mode.id;
          return (
            <TouchableOpacity
              key={mode.id}
              onPress={() => onTravelModeChange(mode.id)}
              style={[
                styles.travelModeCard,
                isSelected && styles.travelModeCardSelected,
              ]}
            >
              <Icon
                name={mode.icon}
                size={14}
                color={isSelected ? "#ffffff" : "#6b7280"}
              />
              <Text
                style={[
                  styles.travelModeLabel,
                  isSelected && styles.travelModeLabelSelected,
                ]}
              >
                {t(`common:transport_${mode.id}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
    );
  },
  (prev, next) => prev.travelMode === next.travelMode
);

TravelModeSection.displayName = "TravelModeSection";

/**
 * Memoized Loading Indicator
 */
export const LoadingShimmer = memo(() => {
  const { t } = useTranslation(['preferences', 'common']);
  return (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#eb7825" />
    <Text style={styles.loadingText}>{t('preferences:loading.text')}</Text>
  </View>
  );
});

LoadingShimmer.displayName = "LoadingShimmer";

const styles = StyleSheet.create({
  // ORCH-0434 Phase 6D: Content container inside glass cards — no wrapper styling needed
  section: {
    backgroundColor: 'transparent',
  },
  curatedLockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  curatedLockedText: {
    flex: 1,
    fontSize: 12,
    color: '#c2410c',
    fontWeight: '500',
  },
  experienceTypesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  experienceTypeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    shadowColor: 'rgba(0, 0, 0, 0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 1,
  },
  experienceTypeButtonSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    shadowColor: '#eb7825',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  experienceTypeText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#4b5563",
  },
  experienceTypeTextSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  categoriesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  categoryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    shadowColor: 'rgba(0, 0, 0, 0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 1,
  },
  categoryButtonSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    shadowColor: '#eb7825',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#4b5563",
  },
  categoryTextSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  helperTextContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fff7ed",
    borderLeftWidth: 3,
    borderLeftColor: "#eb7825",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  helperText: {
    fontSize: 12,
    color: "#92400e",
    flex: 1,
    lineHeight: 17,
  },
  helperTextBold: {
    fontWeight: "700",
    color: "#eb7825",
  },
  funnyWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.10)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  funnyWarningText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#ea580c',
  },
  travelModesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  travelModeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    shadowColor: 'rgba(0, 0, 0, 0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 1,
  },
  travelModeCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    shadowColor: '#eb7825',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  travelModeLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#4b5563",
  },
  travelModeLabelSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
});
