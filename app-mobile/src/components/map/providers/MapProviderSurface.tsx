import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ACTIVE_DISCOVER_MAP_PROVIDER } from './config';
import { MapLibreProvider } from './MapLibreProvider';
import { ReactNativeMapsProvider } from './ReactNativeMapsProvider';
import type { DiscoverMapProviderProps } from './types';

export function MapProviderSurface(props: DiscoverMapProviderProps) {
  switch (ACTIVE_DISCOVER_MAP_PROVIDER) {
    case 'react-native-maps':
      return <ReactNativeMapsProvider {...props} />;
    case 'maplibre':
      return <MapLibreProvider {...props} />;
    default:
      return (
        <View style={styles.unsupportedContainer}>
          <Text style={styles.unsupportedTitle}>Unknown map provider</Text>
          <Text style={styles.unsupportedText}>
            The configured map provider could not be resolved.
          </Text>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  unsupportedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
    padding: 24,
  },
  unsupportedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  unsupportedText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 18,
  },
});
