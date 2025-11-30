import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';

interface WelcomeScreenProps {
  onSignUp: () => void;
  onNavigateToSignIn: () => void;
  onStartOnboarding?: (accountType?: string) => void;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  mainContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: '#eb7825',
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  tagline: {
    color: '#1f2937',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 48,
    maxWidth: 300,
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 400,
    gap: 16,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#eb7825',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  signUpLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  signUpLinkText: {
    color: '#6b7280',
    fontSize: 14,
  },
});

export default function WelcomeScreen({ onSignUp, onNavigateToSignIn, onStartOnboarding }: WelcomeScreenProps) {
  const handleSignUp = () => {
    // Hardcode "explorer" as account type and navigate directly to onboarding
    if (onStartOnboarding) {
      onStartOnboarding('explorer');
    } else if (onSignUp) {
      onSignUp();
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      
      <View style={styles.mainContent}>
        {/* Mingla Title */}
        <Text style={styles.title}>Mingla</Text>

        {/* Tagline */}
        <Text style={styles.tagline}>
          The easiest way to figure out what to do on dates and hangouts.
        </Text>

        {/* Sign Up Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            onPress={handleSignUp}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Sign Up</Text>
          </TouchableOpacity>

          {/* Sign In Link */}
          <TouchableOpacity
            onPress={onNavigateToSignIn}
            style={styles.signUpLink}
          >
            <Text style={styles.signUpLinkText}>or sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
