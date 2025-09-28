/**
 * Offline Indicator Component
 * Shows offline status and sync information to users
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { offlineService, SyncStatus } from '../services/offlineService';
import { spacing, colors, typography, radius, shadows } from '../constants/designSystem';

interface OfflineIndicatorProps {
  onSyncPress?: () => void;
  showDetails?: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  onSyncPress,
  showDetails = false
}) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: true,
    lastSyncTime: null,
    pendingSyncs: 0,
    syncInProgress: false,
    lastError: null
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [slideAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Set up sync status listener
    const handleSyncStatusChange = (status: SyncStatus) => {
      setSyncStatus(status);
    };

    offlineService.addSyncStatusListener(handleSyncStatusChange);
    
    // Get initial status
    setSyncStatus(offlineService.getSyncStatus());

    return () => {
      offlineService.removeSyncStatusListener(handleSyncStatusChange);
    };
  }, []);

  useEffect(() => {
    // Animate indicator when status changes
    Animated.timing(slideAnim, {
      toValue: syncStatus.isOnline ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [syncStatus.isOnline]);

  const handleSyncPress = async () => {
    if (syncStatus.syncInProgress) return;

    try {
      const success = await offlineService.forceSync();
      if (success) {
        Alert.alert('Success', 'Data synced successfully!');
      } else {
        Alert.alert('Error', 'Failed to sync data. Please check your connection.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to sync data');
    }
    
    onSyncPress?.();
  };

  const formatLastSyncTime = (timestamp: string | null): string => {
    if (!timestamp) return 'Never';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getStatusColor = (): string => {
    if (!syncStatus.isOnline) return colors.error;
    if (syncStatus.syncInProgress) return colors.warning;
    if (syncStatus.pendingSyncs > 0) return colors.warning;
    return colors.success;
  };

  const getStatusIcon = (): string => {
    if (!syncStatus.isOnline) return 'cloud-offline-outline';
    if (syncStatus.syncInProgress) return 'sync-outline';
    if (syncStatus.pendingSyncs > 0) return 'cloud-upload-outline';
    return 'cloud-done-outline';
  };

  const getStatusText = (): string => {
    if (!syncStatus.isOnline) return 'Offline';
    if (syncStatus.syncInProgress) return 'Syncing...';
    if (syncStatus.pendingSyncs > 0) return `${syncStatus.pendingSyncs} pending`;
    return 'Synced';
  };

  if (syncStatus.isOnline && !syncStatus.pendingSyncs && !showDetails) {
    return null; // Don't show indicator when everything is synced
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{
            translateY: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [-50, 0]
            })
          }],
          opacity: slideAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1]
          })
        }
      ]}
    >
      <TouchableOpacity
        style={[styles.indicator, { backgroundColor: getStatusColor() }]}
        onPress={() => setIsExpanded(!isExpanded)}
        disabled={!showDetails}
      >
        <View style={styles.statusContent}>
          <Ionicons
            name={getStatusIcon() as any}
            size={16}
            color="white"
          />
          <Text style={styles.statusText}>{getStatusText()}</Text>
          
          {syncStatus.syncInProgress && (
            <View style={styles.syncSpinner}>
              <Ionicons name="refresh" size={12} color="white" />
            </View>
          )}
        </View>

        {showDetails && (
          <TouchableOpacity
            style={styles.syncButton}
            onPress={handleSyncPress}
            disabled={syncStatus.syncInProgress || !syncStatus.isOnline}
          >
            <Ionicons
              name="sync"
              size={16}
              color={syncStatus.syncInProgress || !syncStatus.isOnline ? 'rgba(255,255,255,0.5)' : 'white'}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {isExpanded && showDetails && (
        <View style={styles.detailsContainer}>
          <View style={styles.detailItem}>
            <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.detailText}>
              Last sync: {formatLastSyncTime(syncStatus.lastSyncTime)}
            </Text>
          </View>
          
          {syncStatus.pendingSyncs > 0 && (
            <View style={styles.detailItem}>
              <Ionicons name="cloud-upload-outline" size={16} color={colors.warning} />
              <Text style={styles.detailText}>
                {syncStatus.pendingSyncs} actions pending sync
              </Text>
            </View>
          )}
          
          <View style={styles.detailItem}>
            <Ionicons name="wifi-outline" size={16} color={syncStatus.isOnline ? colors.success : colors.error} />
            <Text style={styles.detailText}>
              {syncStatus.isOnline ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  statusContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusText: {
    ...typography.caption,
    color: 'white',
    marginLeft: spacing.xs,
    fontWeight: '600',
  },
  syncSpinner: {
    marginLeft: spacing.sm,
    transform: [{ rotate: '0deg' }],
  },
  syncButton: {
    padding: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  detailsContainer: {
    backgroundColor: 'white',
    padding: spacing.md,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    ...shadows.sm,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  detailText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
});
