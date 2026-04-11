import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation(['expanded_details', 'common']);

  const factors: FactorConfig[] = [
    {
      name: t('expanded_details:match_factors.location'),
      icon: 'location',
      value: matchFactors.location,
    },
    {
      name: t('expanded_details:match_factors.budget'),
      icon: 'cash',
      value: matchFactors.budget,
    },
    {
      name: t('expanded_details:match_factors.category'),
      icon: 'pricetag',
      value: matchFactors.category,
    },
    {
      name: t('expanded_details:match_factors.time'),
      icon: 'time',
      value: matchFactors.time,
    },
    {
      name: t('expanded_details:match_factors.popularity'),
      icon: 'trending-up',
      value: matchFactors.popularity,
    },
  ];

  const getScoreStyles = (
    score: number
  ): { bar: string; text: string; badge: string } => {
    if (score >= 80) {
      return {
        bar: '#c25507', // deep orange
        text: '#a03f00',
        badge: '#fde0c9',
      };
    }
    if (score >= 60) {
      return {
        bar: '#eb7825', // primary
        text: '#c45d12',
        badge: '#ffe9d9',
      };
    }
    if (score >= 40) {
      return {
        bar: '#f5a266', // light orange
        text: '#d17a3a',
        badge: '#fff4ea',
      };
    }
    return {
      bar: '#fbd7bd', // soft peach
      text: '#d28a5c',
      badge: '#fff8f2',
    };
  };

  // Get score label
  const getScoreLabel = (score: number): string => {
    if (score >= 80) return t('expanded_details:match_factors.excellent');
    if (score >= 60) return t('expanded_details:match_factors.good');
    if (score >= 40) return t('expanded_details:match_factors.fair');
    return t('expanded_details:match_factors.poor');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon name="analytics" size={20} color="#eb7825" />
        <Text style={styles.title}>{t('expanded_details:match_factors.title')}</Text>
      </View>

      <View style={styles.factorsContainer}>
        {factors.map((factor, index) => {
          const scoreStyles = getScoreStyles(factor.value);
          const scoreLabel = getScoreLabel(factor.value);

          return (
            <View key={index} style={styles.factorRow}>
              <View style={styles.factorHeader}>
                <View style={styles.factorInfo}>
                  <Icon
                    name={factor.icon}
                    size={18}
                    color="#6b7280"
                  />
                  <Text style={styles.factorName}>{factor.name}</Text>
                </View>
                <View style={styles.scoreContainer}>
                  <Text style={[styles.scoreValue, { color: scoreStyles.text }]}>
                    {factor.value}%
                  </Text>
                  <View
                    style={[
                      styles.scoreBadge,
                      { backgroundColor: scoreStyles.badge },
                    ]}
                  >
                    <Text
                      style={[styles.scoreLabel, { color: scoreStyles.text }]}
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
                      backgroundColor: scoreStyles.bar,
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
          {t('expanded_details:match_factors.summary')}
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

