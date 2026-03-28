import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, LayoutAnimation, UIManager, Platform } from 'react-native';
import { Icon } from '../ui/Icon';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
        <View style={styles.dropdown}>
          <TouchableOpacity
            style={[styles.menuRow, placesLayerOn && styles.menuRowActive]}
            onPress={onTogglePlaces}
            activeOpacity={0.7}
          >
            <Icon name="location" size={14} color={placesLayerOn ? '#eb7825' : '#6b7280'} />
            <Text style={[styles.menuLabel, placesLayerOn && styles.menuLabelActive]}>Places</Text>
            {placesLayerOn && <Icon name="checkmark" size={12} color="#eb7825" />}
          </TouchableOpacity>
          {onToggleFeed && (
            <TouchableOpacity
              style={[styles.menuRow, feedOn && styles.menuRowActive]}
              onPress={onToggleFeed}
              activeOpacity={0.7}
            >
              <Icon name="notifications-outline" size={14} color={feedOn ? '#eb7825' : '#6b7280'} />
              <Text style={[styles.menuLabel, feedOn && styles.menuLabelActive]}>Feed</Text>
              {feedOn && <Icon name="checkmark" size={12} color="#eb7825" />}
            </TouchableOpacity>
          )}
          {onToggleHeatmap && (
            <TouchableOpacity
              style={[styles.menuRow, heatmapOn && styles.menuRowActive]}
              onPress={onToggleHeatmap}
              activeOpacity={0.7}
            >
              <Icon name="flame-outline" size={14} color={heatmapOn ? '#eb7825' : '#6b7280'} />
              <Text style={[styles.menuLabel, heatmapOn && styles.menuLabelActive]}>Heatmap</Text>
              {heatmapOn && <Icon name="checkmark" size={12} color="#eb7825" />}
            </TouchableOpacity>
          )}
        </View>
      )}
      {/* Main FAB — always visible, orange */}
      <TouchableOpacity
        style={styles.mainFab}
        onPress={toggleExpanded}
        activeOpacity={0.7}
      >
        <Icon name={expanded ? 'close' : 'layers-outline'} size={22} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 12,
    right: 14,
    zIndex: 10,
    alignItems: 'center',
    gap: 8,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dropdown: {
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 12,
    paddingVertical: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    width: 155,
    alignSelf: 'flex-end',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  menuRowActive: {
    backgroundColor: 'rgba(235,120,37,0.08)',
  },
  menuLabel: {
    fontSize: 12,
    color: '#374151',
    flex: 1,
  },
  menuLabelActive: {
    color: '#eb7825',
    fontWeight: '600',
  },
  mainFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#eb7825',
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
