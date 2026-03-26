import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';

interface LayerTogglesProps {
  placesLayerOn: boolean;
  onTogglePlaces: () => void;
}

export function LayerToggles({
  placesLayerOn,
  onTogglePlaces,
}: LayerTogglesProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.fab, placesLayerOn && styles.fabActive]}
        onPress={onTogglePlaces}
        activeOpacity={0.7}
      >
        <Icon name="location" size={20} color={placesLayerOn ? '#FFF' : '#6b7280'} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    zIndex: 10,
    gap: 10,
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  fabActive: {
    backgroundColor: '#eb7825',
  },
});
