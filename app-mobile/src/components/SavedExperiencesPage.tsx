import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
} from "react-native";
import { Icon } from './ui/Icon';
import SavedTab from "./activity/SavedTab";
import { useScreenLogger } from "../hooks/useScreenLogger";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboard } from '../hooks/useKeyboard';
import { useTranslation } from 'react-i18next';

interface SavedExperiencesPageProps {
  isTabVisible?: boolean;
  savedCards: any[];
  isLoading?: boolean;
  userPreferences?: any;
  onScheduleFromSaved: (card: any) => void;
  onPurchaseFromSaved: (card: any, option: any) => void;
  onShareCard: (card: any) => void;
}

type DateRangeFilter = "all" | "7" | "30";
type SortOption = "newest" | "oldest" | "matchHigh" | "matchLow";

// All available categories in the app
const ALL_CATEGORIES = [
  "All",
  "Take a Stroll",
  "Sip & Chill",
  "Casual Eats",
  "Screen & Relax",
  "Creative & Hands-On",
  "Picnics",
  "Play & Move",
  "Dining Experiences",
  "Wellness Dates",
  "Freestyle",
];

// All available experience types in the app
const ALL_EXPERIENCE_TYPES = [
  "Adventurous",
  "First Date",
  "Romantic",
  "Group Fun",
  "Business",
];

// Combined categories and experience types for the filter
const ALL_FILTER_OPTIONS = [
  "All",
  ...ALL_CATEGORIES.filter(cat => cat !== "All"),
  ...ALL_EXPERIENCE_TYPES,
];

// These are now built inside the component using t() for i18n

interface DropdownProps {
  label: string;
  value: string;
  options: { label: string; value: any }[];
  onSelect: (value: any) => void;
  placeholder?: string;
}

const Dropdown: React.FC<DropdownProps> = ({
  label,
  value,
  options,
  onSelect,
  placeholder,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <View style={styles.dropdownContainer}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TouchableOpacity
        style={styles.dropdownButton}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.dropdownButtonText,
            !selectedOption && styles.dropdownButtonTextPlaceholder,
          ]}
        >
          {selectedOption?.label || placeholder}
        </Text>
        <Icon
          name={isOpen ? "chevron-up" : "chevron-down"}
          size={20}
          color="#6b7280"
        />
      </TouchableOpacity>

      {isOpen && (
        <Modal
          visible={isOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsOpen(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setIsOpen(false)}
          >
            <View style={styles.dropdownMenu}>
              <ScrollView style={styles.dropdownScrollView}>
                {options.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.dropdownOption,
                      value === option.value && styles.dropdownOptionActive,
                    ]}
                    onPress={() => {
                      onSelect(option.value);
                      setIsOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownOptionText,
                        value === option.value && styles.dropdownOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {value === option.value && (
                      <Icon name="checkmark" size={20} color="#eb7825" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
};

const SavedExperiencesPage: React.FC<SavedExperiencesPageProps> = ({
  savedCards = [],
  isLoading = false,
  userPreferences,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onShareCard,
}) => {
  // ORCH-0679 Wave 2A: Dev-only render counter (I-TAB-PROPS-STABLE verification).
  const renderCountRef = React.useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] SavedExperiencesPage: ${renderCountRef.current}`);
  }

  useScreenLogger('saved');
  const { t } = useTranslation(['saved', 'common']);

  const matchScoreOptions = [
    { label: t('saved:match_any'), value: null },
    { label: t('saved:match_70'), value: 70 },
    { label: t('saved:match_80'), value: 80 },
    { label: t('saved:match_90'), value: 90 },
  ];

  const dateRangeOptions: { label: string; value: DateRangeFilter }[] = [
    { label: t('saved:date_all'), value: "all" },
    { label: t('saved:date_7'), value: "7" },
    { label: t('saved:date_30'), value: "30" },
  ];

  const sortOptions: { label: string; value: SortOption }[] = [
    { label: t('saved:sort_newest'), value: "newest" },
    { label: t('saved:sort_oldest'), value: "oldest" },
    { label: t('saved:sort_match_high'), value: "matchHigh" },
    { label: t('saved:sort_match_low'), value: "matchLow" },
  ];

  const insets = useSafeAreaInsets();
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [matchScoreFilter, setMatchScoreFilter] = useState<number | null>(null);
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("newest");

  const categoryOptions = useMemo(() => {
    return ALL_FILTER_OPTIONS.map((option) => ({
      label: option,
      value: option === "All" ? null : option,
    }));
  }, []);

  const getCardDate = (card: any): Date => {
    const raw =
      card?.dateAdded ||
      card?.created_at ||
      card?.card_data?.dateAdded ||
      card?.card_data?.created_at;
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !isNaN(parsed.getTime())) {
      return parsed;
    }
    return new Date(0);
  };

  const getMatchScore = (card: any): number => {
    if (typeof card?.matchScore === "number") return card.matchScore;
    if (typeof card?.match_score === "number") return card.match_score;
    if (card?.matchFactors?.overall) return card.matchFactors.overall;
    return 0;
  };

  const [filteredCards, setFilteredCards] = useState<any[]>(
    Array.isArray(savedCards) ? savedCards : []
  );

  useEffect(() => {
    let cards = Array.isArray(savedCards) ? [...savedCards] : [];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      cards = cards.filter((card) => {
        const haystack = `${card?.title || ""} ${card?.description || ""} ${
          card?.category || ""
        }`.toLowerCase();
        return haystack.includes(query);
      });
    }

    if (selectedCategory) {
      cards = cards.filter((card) => {
        // Check if it matches category
        if (card?.category === selectedCategory) return true;
        // Check if it matches experience type
        const experienceType =
          card?.experienceType || (card)?.experience_type;
        if (experienceType === selectedCategory) return true;
        return false;
      });
    }

    if (matchScoreFilter) {
      cards = cards.filter((card) => getMatchScore(card) >= matchScoreFilter);
    }

    if (dateRangeFilter !== "all") {
      const days = Number(dateRangeFilter);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      cards = cards.filter((card) => getCardDate(card) >= cutoff);
    }

    cards.sort((a, b) => {
      if (sortOption === "newest") {
        return getCardDate(b).getTime() - getCardDate(a).getTime();
      }
      if (sortOption === "oldest") {
        return getCardDate(a).getTime() - getCardDate(b).getTime();
      }
      if (sortOption === "matchHigh") {
        return getMatchScore(b) - getMatchScore(a);
      }
      if (sortOption === "matchLow") {
        return getMatchScore(a) - getMatchScore(b);
      }
      return 0;
    });

    setFilteredCards(cards);
  }, [
    savedCards,
    searchQuery,
    selectedCategory,
    matchScoreFilter,
    dateRangeFilter,
    sortOption,
  ]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Icon name="heart" size={28} color="#eb7825" />
        <Text style={styles.loadingText}>{t('saved:loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{t('saved:title')}</Text>
            <Text style={styles.subtitle}>
              {t('saved:total_shown', { total: savedCards?.length || 0, shown: filteredCards.length })}
            </Text>
          </View>
          <View style={styles.badge}>
            <Icon name="bookmark" size={16} color="#eb7825" />
            <Text style={styles.badgeText}>{t('saved:library')}</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Icon name="search" size={18} color="#9CA3AF" />
          <TextInput
            placeholder={t('saved:search_placeholder')}
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />
        </View>

        {/* Filters Row */}
        <View style={styles.filtersRow}>
          {/* Category Filter */}
          <View style={styles.filterHalf}>
            <Dropdown
              label={t('saved:category_label')}
              value={selectedCategory || "All"}
              options={categoryOptions}
              onSelect={(value) => setSelectedCategory(value)}
              placeholder={t('saved:all_categories')}
            />
          </View>

          {/* Match Score Filter */}
          <View style={styles.filterHalf}>
            <Dropdown
              label={t('saved:match_score_label')}
              value={String(matchScoreFilter ?? '')}
              options={matchScoreOptions}
              onSelect={(value) => setMatchScoreFilter(value)}
              placeholder={t('saved:any_score')}
            />
          </View>
        </View>

        {/* Second Filters Row */}
        <View style={styles.filtersRow}>
          {/* Date Range Filter */}
          <View style={styles.filterHalf}>
            <Dropdown
              label={t('saved:date_range_label')}
              value={dateRangeFilter}
              options={dateRangeOptions}
              onSelect={(value) => setDateRangeFilter(value)}
            />
          </View>

          {/* Sort Filter */}
          <View style={styles.filterHalf}>
            <Dropdown
              label={t('saved:sort_label')}
              value={sortOption}
              options={sortOptions}
              onSelect={(value) => setSortOption(value)}
            />
          </View>
        </View>

        <View style={styles.resultsContainer}>
          <SavedTab
            savedCards={filteredCards}
            onScheduleFromSaved={onScheduleFromSaved}
            onPurchaseFromSaved={onPurchaseFromSaved}
            onShareCard={onShareCard}
            userPreferences={userPreferences}
          />
        </View>
        <View style={{ height: keyboardHeight > 0 ? keyboardHeight : insets.bottom }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff7ed",
    borderRadius: 999,
  },
  badgeText: {
    color: "#c2410c",
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 48,
  },
  loadingText: {
    fontSize: 14,
    color: "#6b7280",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
  },
  filtersRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  filterHalf: {
    flex: 1,
  },
  dropdownContainer: {
    marginBottom: 0,
  },
  dropdownLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  dropdownButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
  },
  dropdownButtonText: {
    fontSize: 15,
    color: "#111827",
    fontWeight: "500",
    flex: 1,
  },
  dropdownButtonTextPlaceholder: {
    color: "#9ca3af",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  dropdownMenu: {
    backgroundColor: "white",
    borderRadius: 16,
    maxHeight: 400,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  dropdownScrollView: {
    maxHeight: 400,
  },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  dropdownOptionActive: {
    backgroundColor: "#fff7ed",
  },
  dropdownOptionText: {
    fontSize: 15,
    color: "#374151",
    fontWeight: "500",
    flex: 1,
  },
  dropdownOptionTextActive: {
    color: "#eb7825",
    fontWeight: "600",
  },
  resultsContainer: {
    marginTop: 8,
    paddingBottom: 40,
  },
});

// ORCH-0679 Wave 2A: I-TAB-SCREENS-MEMOIZED.
export default React.memo(SavedExperiencesPage);
