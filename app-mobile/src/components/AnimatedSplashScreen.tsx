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

const logo = require('../../assets/mingla_official_logo.png')

const BASE_WIDTH = 375

interface AnimatedSplashScreenProps {
  onDone: () => void
}

export default function AnimatedSplashScreen({ onDone }: AnimatedSplashScreenProps) {
  const { width: screenWidth } = useWindowDimensions()
  const logoWidth = (200 / BASE_WIDTH) * screenWidth

  const logoOpacity    = useRef(new Animated.Value(0)).current
  const logoScale      = useRef(new Animated.Value(0.88)).current
  const overlayOpacity = useRef(new Animated.Value(1)).current

  // Stable ref so the animation closure always calls the latest onDone
  // without needing it in the effect dependency array.
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone })

  useEffect(() => {
    // Component is definitely painted here — safe to dismiss the native splash.
    SplashScreen.hideAsync().catch(() => {})

    let cancelled = false
    let holdTimeout: ReturnType<typeof setTimeout> | null = null
    let failsafeTimeout: ReturnType<typeof setTimeout> | null = null

    const done = () => {
      if (!cancelled) onDoneRef.current()
    }

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

      // Phase 1: logo fade in + scale up — 700ms ease-out cubic
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || cancelled) return

        // Phase 2: hold 400ms, then fade entire overlay out over 350ms
        holdTimeout = setTimeout(() => {
          if (cancelled) return
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration: 350,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }).start(({ finished: fadeFinished }) => {
            if (fadeFinished && !cancelled) done()
          })
        }, 400)
      })
    }

    // Failsafe: ensure splash is always dismissed even if the animation
    // never completes (Animated bridge stall, unexpected unmount, etc.)
    failsafeTimeout = setTimeout(done, 5000)

    run()

    return () => {
      cancelled = true
      if (holdTimeout) clearTimeout(holdTimeout)
      if (failsafeTimeout) clearTimeout(failsafeTimeout)
      // Stop in-flight animations to prevent native bridge warnings
      logoOpacity.stopAnimation()
      logoScale.stopAnimation()
      overlayOpacity.stopAnimation()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
      <View style={styles.center}>
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          }}
        >
          <Image
            source={logo}
            style={[styles.logo, { width: logoWidth }]}
            resizeMode="contain"
            accessibilityLabel="Mingla"
            accessibilityRole="image"
          />
        </Animated.View>
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
  logo: {
    aspectRatio: 1356 / 480,
  },
})
