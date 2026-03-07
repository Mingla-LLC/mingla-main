import React from 'react';
import { Animated, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Defs, Mask, Rect, Circle } from 'react-native-svg';
import { TargetLayout, SpotlightShape } from '../../types/coachMark';

interface SpotlightMaskProps {
  targetLayout: TargetLayout;
  shape: SpotlightShape;
  padding: number;
  borderRadius: number;
  opacity: Animated.Value;
}

export function SpotlightMask({
  targetLayout,
  shape,
  padding,
  borderRadius,
  opacity,
}: SpotlightMaskProps) {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const holeX = targetLayout.x - padding;
  const holeY = targetLayout.y - padding;
  const holeW = targetLayout.width + padding * 2;
  const holeH = targetLayout.height + padding * 2;

  return (
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="none">
      <Svg width={SCREEN_WIDTH} height={SCREEN_HEIGHT}>
        <Defs>
          <Mask id="spotlight-mask">
            {/* White = visible (dark overlay) */}
            <Rect x="0" y="0" width={SCREEN_WIDTH} height={SCREEN_HEIGHT} fill="white" />
            {/* Black = transparent (the hole) */}
            {shape === 'circle' ? (
              <Circle
                cx={targetLayout.x + targetLayout.width / 2}
                cy={targetLayout.y + targetLayout.height / 2}
                r={Math.max(holeW, holeH) / 2}
                fill="black"
              />
            ) : (
              <Rect
                x={holeX}
                y={holeY}
                width={holeW}
                height={holeH}
                rx={borderRadius}
                ry={borderRadius}
                fill="black"
              />
            )}
          </Mask>
        </Defs>
        <Rect
          x="0"
          y="0"
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT}
          fill="rgba(0, 0, 0, 0.72)"
          mask="url(#spotlight-mask)"
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
});
