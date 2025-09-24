import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';
import { useHapticFeedback } from '../utils/hapticFeedback';

interface Suggestion {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  category: string;
  timeRange: string;
  weather?: string;
  season?: string;
}

const TIME_BASED_SUGGESTIONS: Suggestion[] = [
  // Morning (6 AM - 12 PM)
  {
    id: 'morning-coffee',
    title: 'Morning Coffee',
    description: 'Start your day with a great cup of coffee',
    icon: 'cafe',
    category: 'Food & Drink',
    timeRange: 'morning',
  },
  {
    id: 'breakfast-spot',
    title: 'Breakfast Spot',
    description: 'Find the perfect place for breakfast',
    icon: 'restaurant',
    category: 'Food & Drink',
    timeRange: 'morning',
  },
  {
    id: 'morning-walk',
    title: 'Morning Walk',
    description: 'Take a refreshing walk to start your day',
    icon: 'walk',
    category: 'Outdoor',
    timeRange: 'morning',
  },

  // Afternoon (12 PM - 6 PM)
  {
    id: 'lunch-spot',
    title: 'Lunch Spot',
    description: 'Discover great lunch options nearby',
    icon: 'restaurant',
    category: 'Food & Drink',
    timeRange: 'afternoon',
  },
  {
    id: 'afternoon-activity',
    title: 'Afternoon Activity',
    description: 'Find something fun to do this afternoon',
    icon: 'game-controller',
    category: 'Entertainment',
    timeRange: 'afternoon',
  },
  {
    id: 'shopping',
    title: 'Shopping',
    description: 'Explore local shops and boutiques',
    icon: 'bag',
    category: 'Shopping',
    timeRange: 'afternoon',
  },

  // Evening (6 PM - 12 AM)
  {
    id: 'dinner',
    title: 'Dinner',
    description: 'Find the perfect place for dinner',
    icon: 'restaurant',
    category: 'Food & Drink',
    timeRange: 'evening',
  },
  {
    id: 'nightlife',
    title: 'Nightlife',
    description: 'Discover bars and entertainment venues',
    icon: 'wine',
    category: 'Nightlife',
    timeRange: 'evening',
  },
  {
    id: 'evening-stroll',
    title: 'Evening Stroll',
    description: 'Take a relaxing evening walk',
    icon: 'moon',
    category: 'Outdoor',
    timeRange: 'evening',
  },

  // Late Night (12 AM - 6 AM)
  {
    id: 'late-night-eats',
    title: 'Late Night Eats',
    description: 'Find food that\'s open late',
    icon: 'pizza',
    category: 'Food & Drink',
    timeRange: 'late-night',
  },
  {
    id: '24-hour-spot',
    title: '24-Hour Spot',
    description: 'Places that are always open',
    icon: 'time',
    category: 'Convenience',
    timeRange: 'late-night',
  },
];

const WEATHER_SUGGESTIONS: Record<string, Suggestion[]> = {
  sunny: [
    {
      id: 'outdoor-cafe',
      title: 'Outdoor Café',
      description: 'Enjoy the sunshine at an outdoor café',
      icon: 'sunny',
      category: 'Food & Drink',
      timeRange: 'any',
      weather: 'sunny',
    },
    {
      id: 'park-visit',
      title: 'Park Visit',
      description: 'Perfect weather for a park visit',
      icon: 'leaf',
      category: 'Outdoor',
      timeRange: 'any',
      weather: 'sunny',
    },
  ],
  rainy: [
    {
      id: 'indoor-activities',
      title: 'Indoor Activities',
      description: 'Stay dry with indoor entertainment',
      icon: 'home',
      category: 'Indoor',
      timeRange: 'any',
      weather: 'rainy',
    },
    {
      id: 'cozy-cafe',
      title: 'Cozy Café',
      description: 'Perfect weather for a cozy café',
      icon: 'cafe',
      category: 'Food & Drink',
      timeRange: 'any',
      weather: 'rainy',
    },
  ],
  cold: [
    {
      id: 'warm-drinks',
      title: 'Warm Drinks',
      description: 'Warm up with hot beverages',
      icon: 'thermometer',
      category: 'Food & Drink',
      timeRange: 'any',
      weather: 'cold',
    },
    {
      id: 'indoor-entertainment',
      title: 'Indoor Entertainment',
      description: 'Stay warm with indoor activities',
      icon: 'tv',
      category: 'Entertainment',
      timeRange: 'any',
      weather: 'cold',
    },
  ],
};

interface SmartSuggestionsProps {
  onSuggestionSelect: (suggestion: Suggestion) => void;
  currentTime?: Date;
  weather?: string;
}

export const SmartSuggestions: React.FC<SmartSuggestionsProps> = ({
  onSuggestionSelect,
  currentTime = new Date(),
  weather,
}) => {
  const haptic = useHapticFeedback();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    const hour = currentTime.getHours();
    let timeRange = 'morning';
    
    if (hour >= 6 && hour < 12) {
      timeRange = 'morning';
    } else if (hour >= 12 && hour < 18) {
      timeRange = 'afternoon';
    } else if (hour >= 18 && hour < 24) {
      timeRange = 'evening';
    } else {
      timeRange = 'late-night';
    }

    // Get time-based suggestions
    const timeBasedSuggestions = TIME_BASED_SUGGESTIONS.filter(
      suggestion => suggestion.timeRange === timeRange || suggestion.timeRange === 'any'
    );

    // Get weather-based suggestions
    let weatherSuggestions: Suggestion[] = [];
    if (weather && WEATHER_SUGGESTIONS[weather]) {
      weatherSuggestions = WEATHER_SUGGESTIONS[weather];
    }

    // Combine and limit to 6 suggestions
    const allSuggestions = [...timeBasedSuggestions, ...weatherSuggestions];
    const uniqueSuggestions = allSuggestions.filter(
      (suggestion, index, self) => 
        index === self.findIndex(s => s.id === suggestion.id)
    );

    setSuggestions(uniqueSuggestions.slice(0, 6));
  }, [currentTime, weather]);

  const handleSuggestionPress = (suggestion: Suggestion) => {
    haptic.selection();
    onSuggestionSelect(suggestion);
  };

  const getTimeGreeting = () => {
    const hour = currentTime.getHours();
    if (hour >= 6 && hour < 12) return 'Good Morning';
    if (hour >= 12 && hour < 18) return 'Good Afternoon';
    if (hour >= 18 && hour < 24) return 'Good Evening';
    return 'Good Night';
  };

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{getTimeGreeting()}</Text>
        <Text style={styles.subtitle}>Here are some suggestions for you</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {suggestions.map((suggestion) => (
          <TouchableOpacity
            key={suggestion.id}
            style={styles.suggestionCard}
            onPress={() => handleSuggestionPress(suggestion)}
            activeOpacity={0.8}
          >
            <View style={styles.suggestionIcon}>
              <Ionicons
                name={suggestion.icon}
                size={24}
                color={colors.primary[500]}
              />
            </View>
            
            <Text style={styles.suggestionTitle}>{suggestion.title}</Text>
            <Text style={styles.suggestionDescription} numberOfLines={2}>
              {suggestion.description}
            </Text>
            
            <View style={styles.suggestionBadge}>
              <Text style={styles.suggestionBadgeText}>{suggestion.category}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  greeting: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.sm,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
  },
  suggestionCard: {
    width: 160,
    backgroundColor: colors.background.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginRight: spacing.md,
    ...shadows.sm,
  },
  suggestionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  suggestionTitle: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  suggestionDescription: {
    ...typography.sm,
    color: colors.text.secondary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  suggestionBadge: {
    backgroundColor: colors.primary[100],
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  suggestionBadgeText: {
    ...typography.xs,
    fontWeight: fontWeights.medium,
    color: colors.primary[700],
  },
});
