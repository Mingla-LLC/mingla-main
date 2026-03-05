/**
 * Gamified History Component
 * Shows user's activity timeline, stats, and achievements
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ProfileGamifiedData } from '../types';

interface GamifiedHistoryProps {
  gamifiedData: ProfileGamifiedData;
  onViewDetails?: (type: string, data: any) => void;
}

const { width } = Dimensions.get('window');

export const GamifiedHistory: React.FC<GamifiedHistoryProps> = ({
  gamifiedData,
  onViewDetails
}) => {
  const [activeTab, setActiveTab] = useState<'stats' | 'timeline' | 'achievements'>('stats');

  const formatCategoryName = (category: string) => {
    return category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getCategoryIcon = (category: string) => {
    const iconMap: Record<string, string> = {
      'sip_chill': 'wine',
      'dining': 'restaurant',
      'play_move': 'fitness',
      'creative': 'brush',
      'stroll': 'walk',
      'screen_relax': 'tv',
      'casual_eats': 'fast-food',
      'freestyle': 'sparkles'
    };
    return iconMap[category] || 'star';
  };

  const getCategoryColor = (category: string) => {
    const colorMap: Record<string, string> = {
      'sip_chill': '#8B5CF6',
      'dining': '#F59E0B',
      'play_move': '#10B981',
      'creative': '#F97316',
      'stroll': '#06B6D4',
      'screen_relax': '#6366F1',
      'casual_eats': '#EF4444',
      'freestyle': '#EC4899'
    };
    return colorMap[category] || '#6B7280';
  };

  const renderStatsTab = () => (
    <View style={styles.tabContent}>
      {/* Monthly Overview */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>This Month</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{gamifiedData.monthlyStats.totalExperiences}</Text>
            <Text style={styles.statLabel}>Experiences</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{gamifiedData.monthlyStats.placesVisited}</Text>
            <Text style={styles.statLabel}>Places Visited</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{gamifiedData.monthlyStats.collaborationsJoined}</Text>
            <Text style={styles.statLabel}>Collaborations</Text>
          </View>
        </View>
      </View>

      {/* Vibes Breakdown */}
      {gamifiedData.vibes.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Your Vibes</Text>
          <Text style={styles.sectionSubtitle}>Your activity breakdown this month</Text>
          {gamifiedData.vibes.slice(0, 5).map((vibe, index) => (
            <View key={vibe.id} style={styles.vibeItem}>
              <View style={styles.vibeIconContainer}>
                <Ionicons 
                  name={getCategoryIcon(vibe.category) as any} 
                  size={20} 
                  color={getCategoryColor(vibe.category)} 
                />
              </View>
              <View style={styles.vibeInfo}>
                <Text style={styles.vibeCategory}>{formatCategoryName(vibe.category)}</Text>
                <Text style={styles.vibePercentage}>{vibe.percentage.toFixed(1)}%</Text>
              </View>
              <View style={styles.vibeBarContainer}>
                <View 
                  style={[
                    styles.vibeBar, 
                    { 
                      width: `${vibe.percentage}%`,
                      backgroundColor: getCategoryColor(vibe.category)
                    }
                  ]} 
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Recent Activity */}
      {gamifiedData.recentActivity.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {gamifiedData.recentActivity.slice(0, 5).map((activity) => (
            <View key={activity.id} style={styles.activityItem}>
              <View style={styles.activityIcon}>
                <Ionicons 
                  name={getCategoryIcon(activity.category || 'freestyle') as any} 
                  size={16} 
                  color={getCategoryColor(activity.category || 'freestyle')} 
                />
              </View>
              <View style={styles.activityInfo}>
                <Text style={styles.activityText}>
                  {activity.activity_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  {activity.category && ` • ${formatCategoryName(activity.category)}`}
                </Text>
                <Text style={styles.activityTime}>
                  {new Date(activity.created_at).toLocaleDateString()}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const renderTimelineTab = () => (
    <View style={styles.tabContent}>
      {gamifiedData.timeline.length > 0 ? (
        gamifiedData.timeline.map((event) => (
          <View key={event.id} style={styles.timelineItem}>
            <View style={styles.timelineIcon}>
              <Ionicons 
                name={event.badge_earned ? 'trophy' : 'star'} 
                size={20} 
                color="#FF9500" 
              />
            </View>
            <View style={styles.timelineContent}>
              <Text style={styles.timelineTitle}>
                {event.event_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </Text>
              {event.badge_earned && (
                <Text style={styles.timelineBadge}>🏆 {event.badge_earned.replace(/_/g, ' ')}</Text>
              )}
              <Text style={styles.timelineDate}>
                {new Date(event.created_at).toLocaleDateString()}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="time-outline" size={48} color="#CCC" />
          <Text style={styles.emptyStateText}>No timeline events yet</Text>
          <Text style={styles.emptyStateSubtext}>Start exploring to build your timeline!</Text>
        </View>
      )}
    </View>
  );

  const renderAchievementsTab = () => (
    <View style={styles.tabContent}>
      {/* Achievement Stats */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Your Achievements</Text>
        <View style={styles.achievementGrid}>
          <View style={styles.achievementItem}>
            <Text style={styles.achievementNumber}>{gamifiedData.achievements.totalExperiences}</Text>
            <Text style={styles.achievementLabel}>Total Experiences</Text>
          </View>
          <View style={styles.achievementItem}>
            <Text style={styles.achievementNumber}>{gamifiedData.achievements.totalPlaces}</Text>
            <Text style={styles.achievementLabel}>Places Visited</Text>
          </View>
          <View style={styles.achievementItem}>
            <Text style={styles.achievementNumber}>{gamifiedData.achievements.streakDays}</Text>
            <Text style={styles.achievementLabel}>Day Streak</Text>
          </View>
          <View style={styles.achievementItem}>
            <Text style={styles.achievementNumber}>{gamifiedData.achievements.totalCollaborations}</Text>
            <Text style={styles.achievementLabel}>Collaborations</Text>
          </View>
        </View>
      </View>

      {/* Badges */}
      {gamifiedData.badges.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Badges Earned</Text>
          <View style={styles.badgesContainer}>
            {gamifiedData.badges.map((badge, index) => (
              <View key={index} style={styles.badgeItem}>
                <Ionicons name="trophy" size={24} color="#FF9500" />
                <Text style={styles.badgeText}>{badge.replace(/_/g, ' ')}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Favorite Category */}
      {gamifiedData.achievements.favoriteCategory && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Your Favorite</Text>
          <View style={styles.favoriteCategory}>
            <Ionicons 
              name={getCategoryIcon(gamifiedData.achievements.favoriteCategory) as any} 
              size={32} 
              color={getCategoryColor(gamifiedData.achievements.favoriteCategory)} 
            />
            <Text style={styles.favoriteCategoryText}>
              {formatCategoryName(gamifiedData.achievements.favoriteCategory)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );

  if (!gamifiedData) {
    return (
      <View style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, color: '#666' }}>No gamified data available</Text>
        </View>
      </View>
    );
  }

  // Check if user has any activity data
  const hasActivity = gamifiedData.monthlyStats.total_experiences > 0 || 
                     gamifiedData.recentActivity.length > 0 || 
                     gamifiedData.timeline.length > 0;

  if (!hasActivity) {
    return (
      <View style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Ionicons name="trophy-outline" size={64} color="#FF9500" style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 8 }}>
            Start Your Journey!
          </Text>
          <Text style={{ fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 24 }}>
            Begin exploring experiences to unlock your personalized stats, achievements, and timeline.
          </Text>
          <View style={{ marginTop: 24, backgroundColor: '#FFF4E6', padding: 16, borderRadius: 12, width: '100%' }}>
            <Text style={{ fontSize: 14, color: '#FF9500', fontWeight: '600', marginBottom: 8 }}>
              🎯 Your First Steps:
            </Text>
            <Text style={{ fontSize: 14, color: '#666', lineHeight: 20 }}>
              • Like and save experiences{'\n'}
              • Create your first board{'\n'}
              • Join a collaboration session{'\n'}
              • Visit a recommended place
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Navigation */}
      <View style={styles.tabNavigation}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'stats' && styles.activeTab]}
          onPress={() => setActiveTab('stats')}
        >
          <Ionicons name="stats-chart" size={20} color={activeTab === 'stats' ? '#FF9500' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'stats' && styles.activeTabText]}>Stats</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'timeline' && styles.activeTab]}
          onPress={() => setActiveTab('timeline')}
        >
          <Ionicons name="time" size={20} color={activeTab === 'timeline' ? '#FF9500' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'timeline' && styles.activeTabText]}>Timeline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'achievements' && styles.activeTab]}
          onPress={() => setActiveTab('achievements')}
        >
          <Ionicons name="trophy" size={20} color={activeTab === 'achievements' ? '#FF9500' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'achievements' && styles.activeTabText]}>Achievements</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      <ScrollView style={styles.tabContentContainer} showsVerticalScrollIndicator={false}>
        {activeTab === 'stats' && renderStatsTab()}
        {activeTab === 'timeline' && renderTimelineTab()}
        {activeTab === 'achievements' && renderAchievementsTab()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabNavigation: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFF4E6',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    marginLeft: 4,
  },
  activeTabText: {
    color: '#FF9500',
  },
  tabContentContainer: {
    flex: 1,
  },
  tabContent: {
    paddingBottom: 20,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FF9500',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  vibeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  vibeIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  vibeInfo: {
    flex: 1,
  },
  vibeCategory: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  vibePercentage: {
    fontSize: 14,
    color: '#666',
  },
  vibeBarContainer: {
    width: 60,
    height: 4,
    backgroundColor: '#f0f0f0',
    borderRadius: 2,
    marginLeft: 12,
  },
  vibeBar: {
    height: 4,
    borderRadius: 2,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  activityIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  activityInfo: {
    flex: 1,
  },
  activityText: {
    fontSize: 14,
    color: '#1a1a1a',
  },
  activityTime: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  timelineIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFF4E6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  timelineBadge: {
    fontSize: 14,
    color: '#FF9500',
    fontWeight: '500',
    marginBottom: 4,
  },
  timelineDate: {
    fontSize: 12,
    color: '#666',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
  },
  achievementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  achievementItem: {
    width: '48%',
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    marginBottom: 8,
  },
  achievementNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FF9500',
    marginBottom: 4,
  },
  achievementLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF4E6',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 12,
    color: '#FF9500',
    marginLeft: 4,
    fontWeight: '500',
  },
  favoriteCategory: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  favoriteCategoryText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 8,
  },
});
