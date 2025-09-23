import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RecommendationCard } from '../types';

interface TrafficHeatmapProps {
  card: RecommendationCard;
}

interface PopularTime {
  hour: number;
  popularity: number; // 0-100
}

export const TrafficHeatmap: React.FC<TrafficHeatmapProps> = ({ card }) => {
  const [popularTimes, setPopularTimes] = useState<PopularTime[]>([]);
  const [currentPopularity, setCurrentPopularity] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Generate realistic popular times data based on category
  const generatePopularTimes = (category: string): PopularTime[] => {
    const times: PopularTime[] = [];
    
    // Define patterns based on category
    const patterns: Record<string, { peak: number[]; moderate: number[]; low: number[] }> = {
      'sip': {
        peak: [17, 18, 19, 20, 21, 22],
        moderate: [16, 23],
        low: [9, 10, 11, 12, 13, 14, 15, 0, 1]
      },
      'dining': {
        peak: [12, 13, 18, 19, 20],
        moderate: [11, 14, 17, 21],
        low: [9, 10, 15, 16, 22, 23, 0, 1]
      },
      'casual_eats': {
        peak: [12, 13, 17, 18, 19],
        moderate: [11, 14, 15, 16, 20],
        low: [9, 10, 21, 22, 23, 0, 1]
      },
      'stroll': {
        peak: [10, 11, 14, 15, 16, 17],
        moderate: [9, 12, 13, 18],
        low: [19, 20, 21, 22, 23, 0, 1]
      },
      'play_move': {
        peak: [9, 10, 11, 17, 18, 19],
        moderate: [8, 12, 16, 20],
        low: [13, 14, 15, 21, 22, 23, 0, 1]
      },
      'creative': {
        peak: [14, 15, 16, 17, 18],
        moderate: [10, 11, 12, 13, 19],
        low: [9, 20, 21, 22, 23, 0, 1]
      },
      'screen_relax': {
        peak: [19, 20, 21, 22],
        moderate: [14, 15, 16, 17, 18],
        low: [9, 10, 11, 12, 13, 23, 0, 1]
      }
    };

    const pattern = patterns[category] || patterns['stroll'];
    
    for (let hour = 0; hour < 24; hour++) {
      let popularity = 20; // Base popularity
      
      if (pattern.peak.includes(hour)) {
        popularity = 70 + Math.random() * 30; // 70-100%
      } else if (pattern.moderate.includes(hour)) {
        popularity = 40 + Math.random() * 30; // 40-70%
      } else if (pattern.low.includes(hour)) {
        popularity = 10 + Math.random() * 30; // 10-40%
      }
      
      times.push({ hour, popularity: Math.round(popularity) });
    }
    
    return times;
  };

  const getCurrentPopularity = (times: PopularTime[]): number => {
    const currentHour = new Date().getHours();
    const currentTime = times.find(t => t.hour === currentHour);
    return currentTime?.popularity || 30;
  };

  const getPopularityLevel = (popularity: number): {
    level: 'low' | 'moderate' | 'high';
    color: string;
    icon: string;
    text: string;
  } => {
    if (popularity < 40) {
      return {
        level: 'low',
        color: '#10B981',
        icon: 'trending-down-outline',
        text: 'Usually quiet'
      };
    } else if (popularity < 70) {
      return {
        level: 'moderate',
        color: '#F59E0B',
        icon: 'remove-outline',
        text: 'Moderately busy'
      };
    } else {
      return {
        level: 'high',
        color: '#EF4444',
        icon: 'trending-up-outline',
        text: 'Usually busy'
      };
    }
  };

  const getPeakHours = (times: PopularTime[]): string => {
    const peaks = times
      .filter(t => t.popularity > 70)
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 3);
    
    if (peaks.length === 0) return 'No peak hours';
    
    return peaks
      .map(p => `${p.hour}:00`)
      .join(', ');
  };

  useEffect(() => {
    const times = generatePopularTimes(card.category);
    setPopularTimes(times);
    setCurrentPopularity(getCurrentPopularity(times));
    setLoading(false);
  }, [card.category]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingPlaceholder} />
        <View style={styles.loadingPlaceholder} />
      </View>
    );
  }

  const popularityInfo = getPopularityLevel(currentPopularity);
  const peakHours = getPeakHours(popularTimes);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="people-outline" size={16} color="#6B7280" />
        <Text style={styles.headerText}>Current Activity</Text>
      </View>
      
      <View style={styles.popularityContainer}>
        <View style={[styles.popularityBadge, { backgroundColor: `${popularityInfo.color}20` }]}>
          <Ionicons name={popularityInfo.icon as any} size={12} color={popularityInfo.color} />
          <Text style={[styles.popularityText, { color: popularityInfo.color }]}>
            {popularityInfo.text}
          </Text>
        </View>
        <Text style={styles.popularityPercentage}>
          {currentPopularity}% busy
        </Text>
      </View>

      {/* Visual popularity bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Activity Level</Text>
          <Text style={styles.progressPercentage}>{currentPopularity}%</Text>
        </View>
        <View style={styles.progressBar}>
          <View 
            style={[
              styles.progressFill,
              { 
                width: `${currentPopularity}%`,
                backgroundColor: currentPopularity < 40 ? '#10B981' :
                                currentPopularity < 70 ? '#F59E0B' : '#EF4444'
              }
            ]}
          />
        </View>
      </View>

      {peakHours !== 'No peak hours' && (
        <View style={styles.peakHoursContainer}>
          <Ionicons name="time-outline" size={12} color="#6B7280" />
          <Text style={styles.peakHoursText}>
            <Text style={styles.peakHoursLabel}>Peak hours:</Text> {peakHours}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  popularityContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  popularityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  popularityText: {
    fontSize: 12,
    fontWeight: '600',
  },
  popularityPercentage: {
    fontSize: 12,
    color: '#6B7280',
  },
  progressContainer: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  progressPercentage: {
    fontSize: 12,
    color: '#6B7280',
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  peakHoursContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  peakHoursText: {
    fontSize: 12,
    color: '#6B7280',
    flex: 1,
  },
  peakHoursLabel: {
    fontWeight: '600',
  },
  loadingContainer: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
    marginVertical: 8,
  },
  loadingPlaceholder: {
    height: 16,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    marginBottom: 8,
  },
});
