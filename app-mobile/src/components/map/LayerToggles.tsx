import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';

interface LayerTogglesProps {
  placesLayerOn: boolean;
  onTogglePlaces: () => void;
  peopleLayerOn: boolean;
  onTogglePeople: () => void;
  feedOn?: boolean;
  onToggleFeed?: () => void;
  heatmapOn?: boolean;
  onToggleHeatmap?: () => void;
}

export function LayerToggles({
  placesLayerOn,
  onTogglePlaces,
  peopleLayerOn,
  onTogglePeople,
  feedOn,
  onToggleFeed,
  heatmapOn,
  onToggleHeatmap,
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
      <TouchableOpacity
        style={[styles.fab, peopleLayerOn && styles.fabActive]}
        onPress={onTogglePeople}
        activeOpacity={0.7}
      >
        <Icon name="people" size={20} color={peopleLayerOn ? '#FFF' : '#6b7280'} />
      </TouchableOpacity>
      {onToggleFeed && (
        <TouchableOpacity
          style={[styles.fab, feedOn && styles.fabActive]}
          onPress={onToggleFeed}
          activeOpacity={0.7}
        >
          <Icon name="notifications-outline" size={20} color={feedOn ? '#FFF' : '#6b7280'} />
        </TouchableOpacity>
      )}
      {onToggleHeatmap && (
        <TouchableOpacity
          style={[styles.fab, heatmapOn && styles.fabActive]}
          onPress={onToggleHeatmap}
          activeOpacity={0.7}
        >
          <Icon name="flame-outline" size={20} color={heatmapOn ? '#FFF' : '#6b7280'} />
        </TouchableOpacity>
      )}
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
