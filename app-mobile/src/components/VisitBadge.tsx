import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Icon } from './ui/Icon';
import { s } from '../utils/responsive';
import { colors } from '../constants/designSystem';

/**
 * Small green checkmark badge overlay for card thumbnails.
 * Position absolute — place inside a relative-positioned parent.
 */
const VisitBadge: React.FC = () => (
  <View
    style={styles.badge}
    accessibilityLabel="Visited"
    accessibilityRole="image"
  >
    <Icon name="checkmark" size={s(12)} color="#ffffff" />
  </View>
);

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    bottom: s(6),
    right: s(6),
    width: s(20),
    height: s(20),
    borderRadius: s(10),
    backgroundColor: colors.success[500],
    borderWidth: 1.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default VisitBadge;
