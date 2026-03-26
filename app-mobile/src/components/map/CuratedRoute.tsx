import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Polyline, Marker, Callout } from 'react-native-maps';
import { Recommendation } from '../../types/recommendation';

interface CuratedRouteProps {
  card: Recommendation;
}

export function CuratedRoute({ card }: CuratedRouteProps) {
  if (!card.strollData) return null;

  const { anchor, companionStops, timeline } = card.strollData;

  const stops = [
    { location: anchor.location, name: anchor.name, step: 1 },
    ...companionStops.map((s, i) => ({
      location: s.location,
      name: s.name,
      step: i + 2,
    })),
  ];

  const roleMap = new Map<number, string>();
  if (timeline) {
    for (const t of timeline) {
      if (t.step && t.type) roleMap.set(t.step, t.type);
    }
  }

  const coordinates = stops.map(s => ({
    latitude: s.location.lat,
    longitude: s.location.lng,
  }));

  return (
    <>
      <Polyline
        coordinates={coordinates}
        strokeColor="#eb7825"
        strokeWidth={3}
        lineDashPattern={[6, 3]}
      />
      {stops.map((stop, idx) => (
        <Marker
          key={`stop-${card.id}-${idx}`}
          coordinate={{ latitude: stop.location.lat, longitude: stop.location.lng }}
          tracksViewChanges={false}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.stopMarker}>
            <Text style={styles.stopNumber}>{stop.step}</Text>
          </View>
          <Callout tooltip>
            <View style={styles.calloutBubble}>
              <Text style={styles.calloutTitle}>{stop.name}</Text>
              <Text style={styles.calloutRole}>{roleMap.get(stop.step) || `Stop ${stop.step}`}</Text>
            </View>
          </Callout>
        </Marker>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  stopMarker: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2, shadowRadius: 2, elevation: 3,
  },
  stopNumber: { fontSize: 11, fontWeight: '800', color: '#FFF' },
  calloutBubble: {
    backgroundColor: '#FFF', borderRadius: 8, padding: 8,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
    maxWidth: 180,
  },
  calloutTitle: { fontSize: 13, fontWeight: '600', color: '#111' },
  calloutRole: { fontSize: 11, color: '#6b7280', marginTop: 2 },
});
