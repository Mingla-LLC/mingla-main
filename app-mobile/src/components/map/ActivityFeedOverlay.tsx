import React, { useState, useEffect } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import { supabase } from '../../services/supabase';
import { useAppStore } from '../../store/appStore';
import type { NearbyPerson } from '../../hooks/useNearbyPeople';

interface FeedItem {
  id: string;
  message: string;
  icon: string;
  timestamp: Date;
  relatedId?: string | null;
  isInteractive?: boolean;
}

interface ActivityFeedOverlayProps {
  enabled: boolean;
  nearbyPeople: NearbyPerson[];
  onActivityPress?: (cardId: string) => void;
}

export function ActivityFeedOverlay({ enabled, nearbyPeople, onActivityPress }: ActivityFeedOverlayProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const user = useAppStore(s => s.user);

  useEffect(() => {
    if (!enabled || !user?.id) return;

    const channel = supabase
      .channel(`map-activity-feed-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const notification = payload.new as {
          id?: string;
          type?: string;
          title?: string;
          body?: string;
          created_at?: string;
          related_id?: string | null;
        };

        if (
          notification.type !== 'paired_user_saved_card' &&
          notification.type !== 'paired_user_visited'
        ) {
          return;
        }

        const newItem: FeedItem = {
          id: notification.id || `${notification.type}-${Date.now()}`,
          message: notification.body || notification.title || 'New activity nearby',
          icon: notification.type === 'paired_user_saved_card' ? 'heart' : 'location-outline',
          timestamp: notification.created_at ? new Date(notification.created_at) : new Date(),
          relatedId: notification.related_id ?? null,
          isInteractive: notification.type === 'paired_user_saved_card' && !!notification.related_id,
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
        <Pressable
          key={item.id}
          style={styles.toast}
          disabled={!item.isInteractive || !item.relatedId}
          onPress={() => {
            if (item.relatedId) {
              onActivityPress?.(item.relatedId);
            }
          }}
        >
          <Icon name={item.icon} size={14} color="#eb7825" />
          <Text style={styles.toastText}>{item.message}</Text>
          <Text style={styles.toastTime}>just now</Text>
        </Pressable>
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
