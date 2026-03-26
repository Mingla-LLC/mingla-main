import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import { supabase } from '../../services/supabase';
import { useAppStore } from '../../store/appStore';
import type { NearbyPerson } from '../../hooks/useNearbyPeople';

interface FeedItem {
  id: string;
  message: string;
  icon: string;
  timestamp: Date;
}

interface ActivityFeedOverlayProps {
  enabled: boolean;
  nearbyPeople: NearbyPerson[];
}

export function ActivityFeedOverlay({ enabled, nearbyPeople }: ActivityFeedOverlayProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const user = useAppStore(s => s.user);

  useEffect(() => {
    if (!enabled || !user?.id) return;

    const friendIds = nearbyPeople
      .filter(p => p.relationship === 'friend' || p.relationship === 'paired')
      .map(p => p.userId);

    if (friendIds.length === 0) return;

    const channel = supabase
      .channel('map-activity-feed')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'saved_card',
        filter: `profile_id=in.(${friendIds.join(',')})`,
      }, (payload) => {
        const savedBy = nearbyPeople.find(p => p.userId === (payload.new as any).profile_id);
        if (!savedBy) return;
        const newItem: FeedItem = {
          id: (payload.new as any).id,
          message: `${savedBy.firstName || savedBy.displayName} saved a spot`,
          icon: 'heart',
          timestamp: new Date(),
        };
        setItems(prev => [newItem, ...prev].slice(0, 5));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [enabled, nearbyPeople, user?.id]);

  useEffect(() => {
    if (items.length === 0) return;
    const timer = setTimeout(() => {
      setItems(prev => prev.slice(0, -1));
    }, 5000);
    return () => clearTimeout(timer);
  }, [items]);

  const exploringCount = nearbyPeople.filter(p =>
    p.activityStatus && p.relationship !== 'stranger'
  ).length;

  if (!enabled || (items.length === 0 && exploringCount === 0)) return null;

  return (
    <View style={styles.container}>
      {exploringCount > 0 && (
        <View style={styles.toast}>
          <Icon name="people-outline" size={14} color="#6b7280" />
          <Text style={styles.toastText}>{exploringCount} {exploringCount === 1 ? 'person' : 'people'} exploring nearby</Text>
        </View>
      )}
      {items.map(item => (
        <View key={item.id} style={styles.toast}>
          <Icon name={item.icon} size={14} color="#eb7825" />
          <Text style={styles.toastText}>{item.message}</Text>
          <Text style={styles.toastTime}>just now</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute', top: 100, left: 16, right: 16,
    zIndex: 15, gap: 6,
  },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2,
  },
  toastText: { fontSize: 13, color: '#111', flex: 1 },
  toastTime: { fontSize: 11, color: '#9ca3af' },
});
