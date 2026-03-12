import React from 'react'
import {
  ActivityIndicator,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { s } from '../utils/responsive'
import { colors, spacing } from '../constants/designSystem'

const logo = require('../../assets/mingla_official_logo.png')

interface AppLoadingScreenProps {
  /** Optional short message displayed below the spinner. */
  message?: string
  testID?: string
}

/**
 * Brand-consistent loading screen used during auth resolution and profile
 * hydration.  Background matches the splash screen (#FAFAFA) so the
 * transition feels seamless.
 */
export default function AppLoadingScreen({ message, testID }: AppLoadingScreenProps) {
  return (
    <View style={styles.container} testID={testID}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <Image
        source={logo}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Mingla"
        accessibilityRole="image"
      />
      <ActivityIndicator
        size="small"
        color={colors.primary[300]}
        style={styles.spinner}
      />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA', // Must match app.json splash.backgroundColor
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: s(140),
    maxWidth: '40%',
    aspectRatio: 1356 / 480,
  },
  spinner: {
    marginTop: spacing.lg,
  },
  message: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.text.tertiary,
  },
})
