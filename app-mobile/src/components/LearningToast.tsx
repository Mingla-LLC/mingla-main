import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { s, vs } from '../utils/responsive';
import { shadows } from '../constants/designSystem';

interface LearningToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
}

const ENTER_DURATION = 300;
const HOLD_DURATION = 3000;
const EXIT_DURATION = 200;

const LearningToast: React.FC<LearningToastProps> = ({
  message,
  visible,
  onDismiss,
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(s(20))).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (visible) {
      // Enter
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: ENTER_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: ENTER_DURATION,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss
      timerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: EXIT_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: s(10),
            duration: EXIT_DURATION,
            useNativeDriver: true,
          }),
        ]).start(() => {
          onDismissRef.current();
        });
      }, ENTER_DURATION + HOLD_DURATION);
    } else {
      opacity.setValue(0);
      translateY.setValue(s(20));
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, opacity, translateY]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={styles.toast}
        activeOpacity={0.9}
        onPress={onDismiss}
      >
        <Text style={styles.text}>{message}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: vs(100),
    left: s(24),
    right: s(24),
    alignItems: 'center',
    zIndex: 9999,
  },
  toast: {
    backgroundColor: 'rgba(17,24,39,0.88)',
    borderRadius: s(12),
    paddingHorizontal: s(20),
    paddingVertical: vs(14),
    ...shadows.md,
  },
  text: {
    fontSize: s(14),
    fontWeight: '500',
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: s(20),
  },
});

export default LearningToast;
