import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import SavedTab from "./activity/SavedTab";

interface SavedExperiencesPageProps {
  savedCards: any[];
  userPreferences?: any;
  onScheduleFromSaved: (card: any) => void;
  onPurchaseFromSaved: (card: any, option: any) => void;
  onShareCard: (card: any) => void;
  onRemoveSaved: (card: any) => void;
}

type DateRangeFilter = "all" | "7" | "30";
type SortOption = "newest" | "oldest" | "matchHigh" | "matchLow";

const matchScoreOptions = [
  { label: "Any", value: null },
  { label: "70+", value: 70 },
  { label: "80+", value: 80 },
  { label: "90+", value: 90 },
];

const dateRangeOptions: { label: string; value: DateRangeFilter }[] = [
  { label: "All time", value: "all" },
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
];

const sortOptions: { label: string; value: SortOption }[] = [
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
  { label: "Match ↑", value: "matchHigh" },
  { label: "Match ↓", value: "matchLow" },
];

const SavedExperiencesPage: React.FC<SavedExperiencesPageProps> = ({
  savedCards = [],
  userPreferences,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onShareCard,
  onRemoveSaved,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [matchScoreFilter, setMatchScoreFilter] = useState<number | null>(null);
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("newest");

  const categories = useMemo(() => {
    const set = new Set<string>();
    savedCards?.forEach((card) => {
      if (card?.category) {
        set.add(card.category);
      }
    });

    return ["All", ...Array.from(set).sort()];
  }, [savedCards]);

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

  const filteredCards = useMemo(() => {
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

    if (selectedCategory && selectedCategory !== "All") {
      cards = cards.filter((card) => card?.category === selectedCategory);
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

    return cards;
  }, [
    savedCards,
    searchQuery,
    selectedCategory,
    matchScoreFilter,
    dateRangeFilter,
    sortOption,
  ]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Saved experiences</Text>
            <Text style={styles.subtitle}>
              {savedCards?.length || 0} total • {filteredCards.length} shown
            </Text>
          </View>
          <View style={styles.badge}>
            <Ionicons name="bookmark" size={16} color="#eb7825" />
            <Text style={styles.badgeText}>Library</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="#9CA3AF" />
          <TextInput
            placeholder="Search saved experiences"
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />
        </View>

        {/* Category Filter */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Categories</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {categories.map((category) => (
              <TouchableOpacity
                key={category}
                style={[
                  styles.chip,
                  (selectedCategory ?? "All") === category && styles.chipActive,
                ]}
                onPress={() =>
                  setSelectedCategory((prev) =>
                    prev === category || (category === "All" && prev === null)
                      ? null
                      : category
                  )
                }
              >
                <Text
                  style={[
                    styles.chipText,
                    (selectedCategory ?? "All") === category &&
                      styles.chipTextActive,
                  ]}
                >
                  {category}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Match filter */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Match score</Text>
          <View style={styles.chipRow}>
            {matchScoreOptions.map((option) => (
              <TouchableOpacity
                key={option.label}
                style={[
                  styles.chip,
                  matchScoreFilter === option.value && styles.chipActive,
                ]}
                onPress={() => setMatchScoreFilter(option.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    matchScoreFilter === option.value && styles.chipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Date range */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Date range</Text>
          <View style={styles.chipRow}>
            {dateRangeOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.chip,
                  dateRangeFilter === option.value && styles.chipActive,
                ]}
                onPress={() => setDateRangeFilter(option.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    dateRangeFilter === option.value && styles.chipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Sort */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Sort by</Text>
          <View style={styles.chipRow}>
            {sortOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.chip,
                  sortOption === option.value && styles.chipActive,
                ]}
                onPress={() => setSortOption(option.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    sortOption === option.value && styles.chipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.resultsContainer}>
          <SavedTab
            savedCards={filteredCards}
            onScheduleFromSaved={onScheduleFromSaved}
            onPurchaseFromSaved={onPurchaseFromSaved}
            onShareCard={onShareCard}
            onRemoveSaved={onRemoveSaved}
            userPreferences={userPreferences}
          />
        </View>
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
  filterSection: {
    marginBottom: 20,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
  },
  chipActive: {
    backgroundColor: "#fff5ef",
    borderColor: "#f97316",
  },
  chipText: {
    fontSize: 13,
    color: "#4b5563",
    fontWeight: "500",
  },
  chipTextActive: {
    color: "#c2410c",
  },
  resultsContainer: {
    marginTop: 8,
    paddingBottom: 40,
  },
});

export default SavedExperiencesPage;

