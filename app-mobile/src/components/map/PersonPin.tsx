import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import type { NearbyPerson } from '../../hooks/useNearbyPeople';

interface PersonPinProps {
  person: NearbyPerson;
  onPress: () => void;
}

export function PersonPin({ person, onPress }: PersonPinProps) {
  const isOnline = Date.now() - new Date(person.lastActiveAt).getTime() < 15 * 60_000;
  const isPaired = person.relationship === 'paired';
  const isStranger = person.relationship === 'stranger';

  return (
    <Marker
      coordinate={{ latitude: person.approximateLat, longitude: person.approximateLng }}
      onPress={onPress}
      tracksViewChanges={false}
    >
      <View style={styles.wrapper}>
        <View style={[
          styles.avatarRing,
          isPaired && styles.pairedRing,
          isStranger && styles.strangerRing,
        ]}>
          {person.avatarUrl ? (
            <Image source={{ uri: person.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.initials}>
                {(person.firstName || person.displayName || '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        {isOnline && <View style={styles.onlineDot} />}
        {isStranger && person.tasteMatchPct != null && person.tasteMatchPct > 0 && (
          <View style={styles.matchBadge}>
            <Text style={styles.matchText}>{person.tasteMatchPct}%</Text>
          </View>
        )}
        {person.activityStatus && (
          <View style={styles.statusBubble}>
            <Text style={styles.statusText} numberOfLines={1}>{person.activityStatus}</Text>
          </View>
        )}
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', width: 52, height: 58 },
  avatarRing: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 2, borderColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF',
  },
  pairedRing: { borderColor: '#eb7825' },
  strangerRing: { borderColor: '#9ca3af' },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarFallback: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center',
  },
  initials: { fontSize: 14, fontWeight: '700', color: '#6b7280' },
  onlineDot: {
    position: 'absolute', top: 0, right: 4,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#FFF',
  },
  statusBubble: {
    marginTop: 2, paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, maxWidth: 100,
  },
  statusText: { fontSize: 9, color: '#FFF' },
  matchBadge: {
    position: 'absolute', bottom: -4, left: -4,
    backgroundColor: '#eb7825', borderRadius: 8,
    paddingHorizontal: 4, paddingVertical: 1,
    borderWidth: 1.5, borderColor: '#FFF',
    minWidth: 28, alignItems: 'center',
  },
  matchText: { fontSize: 8, fontWeight: '700', color: '#FFF' },
});
