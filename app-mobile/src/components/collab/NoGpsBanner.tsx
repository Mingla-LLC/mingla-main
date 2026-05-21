import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../ui/Icon';

interface NoGpsBannerProps {
  participantPrefs?: {
    custom_lat?: number | null;
    custom_lng?: number | null;
  } | null;
}

export default function NoGpsBanner({ participantPrefs }: NoGpsBannerProps) {
  if (!participantPrefs) return null;
  if (participantPrefs.custom_lat != null && participantPrefs.custom_lng != null) {
    return null;
  }

  return (
    <View style={styles.container} accessibilityRole="alert">
      <Icon name="location-outline" size={16} color="#9a3412" />
      <Text style={styles.text}>
        We're having trouble getting your location. Once we have it, your travel limits will be added to the deck.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 10,
    left: 16,
    right: 16,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fed7aa',
    backgroundColor: '#fff7ed',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: {
    flex: 1,
    color: '#9a3412',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
