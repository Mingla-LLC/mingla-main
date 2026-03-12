import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native'
import * as SplashScreen from 'expo-splash-screen'

// Use the SAME image as the native splash (app.json → splash.image) so
// frame 0 of the animated overlay is pixel-identical to the native splash.
const splashIcon = require('../../assets/splash-icon.png')

interface AnimatedSplashScreenProps {
  onDone: () => void
}

export default function AnimatedSplashScreen({ onDone }: AnimatedSplashScreenProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()

  // Start fully visible — the overlay must match the native splash exactly
  // so that hideAsync() produces zero visual change.
  const overlayOpacity = useRef(new Animated.Value(1)).current

  // Stable ref so the animation closure always calls the latest onDone
  // without needing it in the effect dependency array.
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone })

  useEffect(() => {
    let cancelled = false
    let holdTimeout: ReturnType<typeof setTimeout> | null = null
    let failsafeTimeout: ReturnType<typeof setTimeout> | null = null

    const done = () => {
      if (!cancelled) onDoneRef.current()
    }

    // Hide native splash immediately — our overlay is visually identical,
    // so the user sees zero change. No flash, no gap.
    SplashScreen.hideAsync().catch(() => {})

    const run = async () => {
      let reducedMotion = false
      try {
        reducedMotion = await AccessibilityInfo.isReduceMotionEnabled()
      } catch {
        reducedMotion = false
      }

      if (reducedMotion || cancelled) {
        done()
        return
      }

      // Phase 1: Hold for 600ms so the brand registers
      holdTimeout = setTimeout(() => {
        if (cancelled) return

        // Phase 2: Fade the entire overlay out over 400ms
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 400,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && !cancelled) done()
        })
      }, 600)
    }

    // Failsafe: ensure splash is always dismissed even if the animation
    // never completes (Animated bridge stall, unexpected unmount, etc.)
    failsafeTimeout = setTimeout(done, 3000)

    run()

    return () => {
      cancelled = true
      if (holdTimeout) clearTimeout(holdTimeout)
      if (failsafeTimeout) clearTimeout(failsafeTimeout)
      overlayOpacity.stopAnimation()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Size the image to match how the native splash sizes it:
  // contain mode on a 1:1 square image → limited by the shorter axis.
  const imageSize = Math.min(screenWidth, screenHeight)

  return (
    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
      <View style={styles.center}>
        <Image
          source={splashIcon}
          style={{ width: imageSize, height: imageSize }}
          resizeMode="contain"
          accessibilityLabel="Mingla"
          accessibilityRole="image"
        />
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FAFAFA',   // MUST match app.json splash.backgroundColor exactly
    zIndex: 9999,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
