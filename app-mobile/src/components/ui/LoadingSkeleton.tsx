import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';

interface LoadingSkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 4,
  style,
}) => {
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [animatedValue]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
};

interface CardSkeletonProps {
  count?: number;
}

export const CardSkeleton: React.FC<CardSkeletonProps> = ({ count = 1 }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.cardSkeleton}>
          <LoadingSkeleton width="100%" height={200} borderRadius={12} />
          <View style={styles.cardContent}>
            <LoadingSkeleton width="70%" height={24} borderRadius={4} />
            <LoadingSkeleton width="50%" height={16} borderRadius={4} style={{ marginTop: 8 }} />
            <LoadingSkeleton width="100%" height={16} borderRadius={4} style={{ marginTop: 8 }} />
            <LoadingSkeleton width="80%" height={16} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
        </View>
      ))}
    </>
  );
};

interface MessageSkeletonProps {
  count?: number;
}

export const MessageSkeleton: React.FC<MessageSkeletonProps> = ({ count = 3 }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.messageSkeleton,
            index % 2 === 0 ? styles.messageSkeletonRight : styles.messageSkeletonLeft,
          ]}
        >
          <LoadingSkeleton width={40} height={40} borderRadius={20} />
          <View style={styles.messageContent}>
            <LoadingSkeleton width="60%" height={16} borderRadius={4} />
            <LoadingSkeleton width="80%" height={16} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
        </View>
      ))}
    </>
  );
};

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#e5e7eb',
  },
  cardSkeleton: {
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardContent: {
    padding: 16,
  },
  messageSkeleton: {
    flexDirection: 'row',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  messageSkeletonLeft: {
    justifyContent: 'flex-start',
  },
  messageSkeletonRight: {
    justifyContent: 'flex-end',
    flexDirection: 'row-reverse',
  },
  messageContent: {
    marginHorizontal: 12,
    flex: 1,
  },
});

