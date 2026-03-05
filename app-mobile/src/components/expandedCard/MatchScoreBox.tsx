import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface MatchScoreBoxProps {
  matchScore: number;
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  userPreferences?: any;
  cardCategory?: string;
}

export default function MatchScoreBox({
  matchScore,
  matchFactors,
  userPreferences,
  cardCategory,
}: MatchScoreBoxProps) {
  // Generate match explanation based on factors
  const getMatchExplanation = (): string => {
    const factors = [];
    
    // Check for high-scoring factors
    if (matchFactors.category > 0.7) {
      const categoryText = getCategoryPreference();
      if (categoryText) {
        factors.push(`matches your preference for ${categoryText}`);
      }
    }
    if (matchFactors.budget > 0.7) {
      const budgetText = getBudgetPreference();
      if (budgetText) {
        factors.push(`fits within your ${budgetText} budget range`);
      } else {
        factors.push('fits within your budget range');
      }
    }
    if (matchFactors.time > 0.7) {
      const timeText = getTimePreference();
      if (timeText) {
        factors.push(`scheduled for your preferred ${timeText} time`);
      } else {
        factors.push('scheduled for your preferred time');
      }
    }
    if (matchFactors.location > 0.7) {
      factors.push('matches your location preferences');
    }

    // Default message if no strong factors
    if (factors.length === 0) {
      return 'Suggested based on your preferences and interests.';
    }

    // Combine factors with proper grammar
    if (factors.length === 1) {
      return `Suggested because it ${factors[0]}.`;
    } else if (factors.length === 2) {
      return `Suggested because it ${factors[0]} and ${factors[1]}.`;
    } else {
      return `Suggested because it ${factors.slice(0, -1).join(', ')}, and ${factors[factors.length - 1]}.`;
    }
  };

  // Helper to get category preference text
  const getCategoryPreference = (): string => {
    if (!userPreferences?.categories || userPreferences.categories.length === 0) {
      return cardCategory ? cardCategory.toLowerCase() : 'selected categories';
    }
    if (userPreferences.categories.length === 1) {
      return userPreferences.categories[0].toLowerCase();
    }
    return 'selected categories';
  };

  // Helper to get budget preference text
  const getBudgetPreference = (): string => {
    if (!userPreferences) return '';
    const min = userPreferences.budget_min || userPreferences.budgetMin;
    const max = userPreferences.budget_max || userPreferences.budgetMax;
    if (min !== undefined && max !== undefined) {
      return `$${min}-$${max}`;
    }
    return '';
  };

  // Helper to get time preference text
  const getTimePreference = (): string => {
    if (!userPreferences) return '';
    const timeSlot = userPreferences.time_slot || userPreferences.timeSlot;
    if (timeSlot) {
      const timeMap: { [key: string]: string } = {
        brunch: 'brunch',
        afternoon: 'afternoon',
        dinner: 'dinner',
        lateNight: 'late night',
      };
      return timeMap[timeSlot] || timeSlot;
    }
    return '';
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Match Reason:</Text>
      <Text style={styles.explanation}>{getMatchExplanation()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#eb7825',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  explanation: {
    fontSize: 14,
    color: '#ffffff',
    lineHeight: 20,
  },
});

