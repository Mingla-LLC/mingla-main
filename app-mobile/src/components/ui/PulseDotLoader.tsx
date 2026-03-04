import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors } from '../../constants/designSystem';

interface PulseDotLoaderProps {
  color?: string; // default colors.primary[500]
  size?: number; // default 8
}

export const PulseDotLoader: React.FC<PulseDotLoaderProps> = ({
  color = colors.primary[500],
  size = 8,
}) => {
  const dot1Scale = useRef(new Animated.Value(1)).current;
  const dot2Scale = useRef(new Animated.Value(1)).current;
  const dot3Scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const createPulse = (animatedValue: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.sequence([
            Animated.timing(animatedValue, {
              toValue: 1.3,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(animatedValue, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
          // Pad remainder of cycle so total = 3 * 200ms stagger + pulse duration
          Animated.delay(600 - delay),
        ]),
      );
    };

    const anim1 = createPulse(dot1Scale, 0);
    const anim2 = createPulse(dot2Scale, 200);
    const anim3 = createPulse(dot3Scale, 400);

    anim1.start();
    anim2.start();
    anim3.start();

    return () => {
      anim1.stop();
      anim2.stop();
      anim3.stop();
    };
  }, [dot1Scale, dot2Scale, dot3Scale]);

  const dotStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
  };

  return (
    <View style={styles.container}>
      <Animated.View
        style={[dotStyle, { transform: [{ scale: dot1Scale }] }]}
      />
      <View style={styles.gap} />
      <Animated.View
        style={[dotStyle, { transform: [{ scale: dot2Scale }] }]}
      />
      <View style={styles.gap} />
      <Animated.View
        style={[dotStyle, { transform: [{ scale: dot3Scale }] }]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gap: {
    width: 8,
  },
});
