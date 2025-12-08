import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type BoardTab = 'swipe' | 'saved' | 'discussion';

interface BoardTabsProps {
  activeTab: BoardTab;
  onTabChange: (tab: BoardTab) => void;
  swipeCount?: number;
  savedCount?: number;
  unreadMessages?: number;
}

export const BoardTabs: React.FC<BoardTabsProps> = ({
  activeTab,
  onTabChange,
  swipeCount = 0,
  savedCount = 0,
  unreadMessages = 0,
}) => {
  const tabs: Array<{
    id: BoardTab;
    label: string;
    icon: string;
    badge?: number;
  }> = [
    {
      id: 'swipe',
      label: 'Swipe',
      icon: 'swap-horizontal',
    },
    {
      id: 'saved',
      label: 'Saved',
      icon: 'bookmark',
      badge: savedCount > 0 ? savedCount : undefined,
    },
    {
      id: 'discussion',
      label: 'Discussion',
      icon: 'chatbubbles',
      badge: unreadMessages > 0 ? unreadMessages : undefined,
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.tabsContainer}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onTabChange(tab.id)}
              activeOpacity={0.7}
            >
              <View style={styles.tabContent}>
                <View style={styles.iconContainer}>
                  <Ionicons
                    name={tab.icon as any}
                    size={20}
                    color={isActive ? '#007AFF' : '#666'}
                  />
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    styles.tabLabel,
                    isActive && styles.tabLabelActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </View>
              {isActive && <View style={styles.activeIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabActive: {
    backgroundColor: 'transparent',
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 4,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666',
  },
  tabLabelActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#007AFF',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
});

