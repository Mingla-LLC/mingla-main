import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MatchFactorsBreakdownProps {
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
}

interface FactorConfig {
  name: string;
  icon: string;
  value: number;
}

export default function MatchFactorsBreakdown({
  matchFactors,
}: MatchFactorsBreakdownProps) {
  const factors: FactorConfig[] = [
    {
      name: 'Location',
      icon: 'location',
      value: matchFactors.location,
    },
    {
      name: 'Budget',
      icon: 'cash',
      value: matchFactors.budget,
    },
    {
      name: 'Category',
      icon: 'pricetag',
      value: matchFactors.category,
    },
    {
      name: 'Time',
      icon: 'time',
      value: matchFactors.time,
    },
    {
      name: 'Popularity',
      icon: 'trending-up',
      value: matchFactors.popularity,
    },
  ];

  // Get color based on score
  const getScoreColor = (score: number): string => {
    if (score >= 80) return '#10b981'; // Green
    if (score >= 60) return '#f59e0b'; // Amber
    if (score >= 40) return '#ef4444'; // Red
    return '#9ca3af'; // Gray
  };

  // Get score label
  const getScoreLabel = (score: number): string => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="analytics" size={20} color="#eb7825" />
        <Text style={styles.title}>Match Breakdown</Text>
      </View>

      <View style={styles.factorsContainer}>
        {factors.map((factor, index) => {
          const scoreColor = getScoreColor(factor.value);
          const scoreLabel = getScoreLabel(factor.value);

          return (
            <View key={index} style={styles.factorRow}>
              <View style={styles.factorHeader}>
                <View style={styles.factorInfo}>
                  <Ionicons
                    name={factor.icon as any}
                    size={18}
                    color="#6b7280"
                  />
                  <Text style={styles.factorName}>{factor.name}</Text>
                </View>
                <View style={styles.scoreContainer}>
                  <Text style={[styles.scoreValue, { color: scoreColor }]}>
                    {factor.value}%
                  </Text>
                  <View
                    style={[
                      styles.scoreBadge,
                      { backgroundColor: `${scoreColor}15` },
                    ]}
                  >
                    <Text
                      style={[styles.scoreLabel, { color: scoreColor }]}
                    >
                      {scoreLabel}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Progress Bar */}
              <View style={styles.progressBarContainer}>
                <View
                  style={[
                    styles.progressBar,
                    {
                      width: `${factor.value}%`,
                      backgroundColor: scoreColor,
                    },
                  ]}
                />
                <View style={styles.progressBarBackground} />
              </View>
            </View>
          );
        })}
      </View>

      {/* Summary */}
      <View style={styles.summaryContainer}>
        <Text style={styles.summaryText}>
          These factors determine how well this experience matches your
          preferences. Higher scores indicate better alignment.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  factorsContainer: {
    paddingHorizontal: 16,
    gap: 20,
  },
  factorRow: {
    gap: 8,
  },
  factorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  factorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  factorName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreValue: {
    fontSize: 16,
    fontWeight: '700',
    minWidth: 45,
    textAlign: 'right',
  },
  scoreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  scoreLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressBarContainer: {
    height: 8,
    borderRadius: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  progressBarBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 4,
    zIndex: 1,
  },
  summaryContainer: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  summaryText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
    fontStyle: 'italic',
  },
});

