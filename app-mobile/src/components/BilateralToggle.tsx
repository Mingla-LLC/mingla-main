import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  AccessibilityRole,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { s, vs, ms } from '../utils/responsive';
import { colors, shadows } from '../constants/designSystem';

interface BilateralToggleProps {
  name: string;
  mode: 'individual' | 'bilateral';
  onModeChange: (mode: 'individual' | 'bilateral') => void;
}

const TRACK_PADDING = s(3);
const TRACK_HEIGHT = s(44);

const BilateralToggle: React.FC<BilateralToggleProps> = ({
  name,
  mode,
  onModeChange,
}) => {
  const slideAnim = useRef(new Animated.Value(mode === 'individual' ? 0 : 1)).current;
  const [trackWidth, setTrackWidth] = React.useState(0);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: mode === 'individual' ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [mode, slideAnim]);

  const handlePress = (newMode: 'individual' | 'bilateral') => {
    if (newMode === mode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onModeChange(newMode);
  };

  const pillWidth = trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / 2 : 0;

  const translateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, pillWidth],
  });

  return (
    <View
      style={styles.container}
      accessibilityRole={'tablist' as AccessibilityRole}
    >
      <View
        style={styles.track}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {/* Sliding pill */}
        {pillWidth > 0 && (
          <Animated.View
            style={[
              styles.pill,
              {
                width: pillWidth,
                transform: [{ translateX }],
              },
            ]}
          />
        )}

        {/* Individual segment */}
        <TouchableOpacity
          style={styles.segment}
          onPress={() => handlePress('individual')}
          activeOpacity={0.8}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === 'individual' }}
          accessibilityLabel={`For ${name}`}
        >
          <Text
            style={[
              styles.segmentText,
              mode === 'individual' && styles.segmentTextActive,
            ]}
          >
            For {name}
          </Text>
        </TouchableOpacity>

        {/* Bilateral segment */}
        <TouchableOpacity
          style={styles.segment}
          onPress={() => handlePress('bilateral')}
          activeOpacity={0.8}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === 'bilateral' }}
          accessibilityLabel={`For both of you`}
        >
          <Text
            style={[
              styles.segmentText,
              mode === 'bilateral' && styles.segmentTextActive,
            ]}
          >
            For both of you
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: s(16),
    marginTop: vs(16),
  },
  track: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: s(12),
    padding: TRACK_PADDING,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    height: TRACK_HEIGHT - TRACK_PADDING * 2,
    borderRadius: s(10),
    backgroundColor: '#ffffff',
    ...shadows.sm,
  },
  segment: {
    flex: 1,
    height: TRACK_HEIGHT - TRACK_PADDING * 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentText: {
    fontSize: ms(13),
    fontWeight: '500',
    color: colors.gray[500],
  },
  segmentTextActive: {
    fontWeight: '600',
    color: colors.gray[900],
  },
});

export default BilateralToggle;
