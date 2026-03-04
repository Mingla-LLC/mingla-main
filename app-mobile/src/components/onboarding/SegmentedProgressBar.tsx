import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors, radius } from '../../constants/designSystem';

interface SegmentedProgressBarProps {
  totalSegments: 5;
  currentStep: number; // 1-5
  currentSegmentFill: number; // 0-1, animated fill within current segment
}

export const SegmentedProgressBar: React.FC<SegmentedProgressBarProps> = ({
  totalSegments = 5,
  currentStep,
  currentSegmentFill,
}) => {
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: currentSegmentFill,
      duration: 300,
      useNativeDriver: false, // width animation requires non-native driver
    }).start();
  }, [currentSegmentFill, fillAnim]);

  const segments: React.ReactNode[] = [];

  for (let i = 1; i <= totalSegments; i++) {
    const isCompleted = i < currentStep;
    const isCurrent = i === currentStep;

    segments.push(
      <View key={i} style={styles.segment}>
        {isCompleted && <View style={styles.segmentFilled} />}
        {isCurrent && (
          <Animated.View
            style={[
              styles.segmentFilled,
              {
                width: fillAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        )}
      </View>,
    );

    if (i < totalSegments) {
      segments.push(<View key={`gap-${i}`} style={styles.gap} />);
    }
  }

  return <View style={styles.container}>{segments}</View>;
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.gray[200],
    overflow: 'hidden',
  },
  segmentFilled: {
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.primary[500],
    width: '100%',
  },
  gap: {
    width: 4,
  },
});
