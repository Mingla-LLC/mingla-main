import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, LayoutAnimation, UIManager, Platform } from 'react-native';
import { Icon } from '../ui/Icon';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface LayerTogglesProps {
  placesLayerOn: boolean;
  onTogglePlaces: () => void;
  peopleLayerOn: boolean;
  onTogglePeople: () => void;
  isDark: boolean;
  onToggleGoDark: () => void;
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
  isDark,
  onToggleGoDark,
  feedOn,
  onToggleFeed,
  heatmapOn,
  onToggleHeatmap,
}: LayerTogglesProps) {
  const [expanded, setExpanded] = useState(false);

  const activeCount =
    (placesLayerOn ? 1 : 0) +
    (peopleLayerOn ? 1 : 0) +
    (feedOn ? 1 : 0) +
    (heatmapOn ? 1 : 0);

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(p => !p);
  };

  return (
    <View style={styles.container}>
      {expanded && (
        <>
          {onToggleHeatmap && (
            <TouchableOpacity
              style={[styles.fab, heatmapOn && styles.fabActive]}
              onPress={onToggleHeatmap}
              activeOpacity={0.7}
            >
              <Icon name="flame-outline" size={18} color={heatmapOn ? '#FFF' : '#6b7280'} />
            </TouchableOpacity>
          )}
          {onToggleFeed && (
            <TouchableOpacity
              style={[styles.fab, feedOn && styles.fabActive]}
              onPress={onToggleFeed}
              activeOpacity={0.7}
            >
              <Icon name="notifications-outline" size={18} color={feedOn ? '#FFF' : '#6b7280'} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.fab, isDark && styles.fabDark]}
            onPress={onToggleGoDark}
            activeOpacity={0.7}
          >
            <Icon name={isDark ? 'eye-off' : 'moon-outline'} size={18} color={isDark ? '#FFF' : '#6b7280'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.fab, peopleLayerOn && styles.fabActive]}
            onPress={onTogglePeople}
            activeOpacity={0.7}
          >
            <Icon name="people" size={18} color={peopleLayerOn ? '#FFF' : '#6b7280'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.fab, placesLayerOn && styles.fabActive]}
            onPress={onTogglePlaces}
            activeOpacity={0.7}
          >
            <Icon name="location" size={18} color={placesLayerOn ? '#FFF' : '#6b7280'} />
          </TouchableOpacity>
        </>
      )}
      {/* Main toggle button — always visible */}
      <TouchableOpacity
        style={[styles.mainFab, expanded && styles.mainFabActive]}
        onPress={toggleExpanded}
        activeOpacity={0.7}
      >
        <Icon name={expanded ? 'close' : 'layers-outline'} size={22} color={expanded ? '#FFF' : '#111'} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    right: 14,
    zIndex: 10,
    alignItems: 'center',
    gap: 8,
  },
  fab: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  fabActive: {
    backgroundColor: '#eb7825',
  },
  fabDark: {
    backgroundColor: '#1f2937',
  },
  mainFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
  },
  mainFabActive: {
    backgroundColor: '#eb7825',
  },
});
