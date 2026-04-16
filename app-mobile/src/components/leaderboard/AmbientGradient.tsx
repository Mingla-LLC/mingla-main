/**
 * ORCH-0437: Background for the Near You tab.
 * Clean white background — glassmorphism effect comes from the card surfaces.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

export function AmbientGradient(): React.ReactElement {
  return <View style={styles.bg} />;
}

const styles = StyleSheet.create({
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
  },
});
