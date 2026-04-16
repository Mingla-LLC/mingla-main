/**
 * ORCH-0437: Gradient background for the Near You tab.
 * Static 3-stop diagonal gradient. Breathing animation deferred —
 * Reanimated + expo-linear-gradient start/end props are not natively
 * animatable and cause a native crash.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const COLORS = ['#fff7ed', '#fef3e2', '#fdf2f8'] as const;

// Static 135° angle points
const START = { x: 0.146, y: 0.146 };
const END = { x: 0.854, y: 0.854 };

export function AmbientGradient(): React.ReactElement {
  // [TRANSITIONAL] Static gradient — breathing animation causes native crash
  // with Animated.createAnimatedComponent(LinearGradient). Exit: use a different
  // animation approach (e.g., opacity crossfade between two rotated gradients).
  return (
    <LinearGradient
      colors={[...COLORS]}
      start={START}
      end={END}
      style={StyleSheet.absoluteFillObject}
    />
  );
}
