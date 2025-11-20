import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MatchScoreBoxProps {
  matchScore: number;
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
}

export default function MatchScoreBox({
  matchScore,
  matchFactors,
}: MatchScoreBoxProps) {
  // Generate match explanation based on score
  const getMatchExplanation = (score: number): string => {
    if (score >= 90) {
      return 'Excellent match! This experience aligns perfectly with your preferences.';
    } else if (score >= 75) {
      return 'Great match! This experience closely matches your preferences.';
    } else if (score >= 60) {
      return 'Good match! This experience aligns well with most of your preferences.';
    } else {
      return 'Decent match. This experience may have some differences from your preferences.';
    }
  };

  // Get top match factors
  const getTopFactors = () => {
    const factors = [
      { name: 'Location', score: matchFactors.location },
      { name: 'Budget', score: matchFactors.budget },
      { name: 'Category', score: matchFactors.category },
      { name: 'Time', score: matchFactors.time },
      { name: 'Popularity', score: matchFactors.popularity },
    ];

    return factors
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((f) => f.name.toLowerCase())
      .join(' and ');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.scoreContainer}>
          <Ionicons name="star" size={20} color="#ffffff" />
          <Text style={styles.scoreText}>{matchScore}% Match</Text>
        </View>
        <Text style={styles.explanation}>{getMatchExplanation(matchScore)}</Text>
      </View>
      <View style={styles.factorsContainer}>
        <Text style={styles.factorsLabel}>
          Strongest matches: {getTopFactors()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#eb7825',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
  },
  header: {
    marginBottom: 8,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  scoreText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
  },
  explanation: {
    fontSize: 14,
    color: '#ffffff',
    lineHeight: 20,
    opacity: 0.95,
  },
  factorsContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.3)',
  },
  factorsLabel: {
    fontSize: 12,
    color: '#ffffff',
    opacity: 0.9,
    fontStyle: 'italic',
  },
});

