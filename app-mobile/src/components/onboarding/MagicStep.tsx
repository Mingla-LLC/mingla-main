import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MagicStepProps {
  onComplete: (onboardingData: any) => void;
  onBack: () => void;
  onboardingData: any;
}

const MagicStep = ({ onComplete, onBack, onboardingData }: MagicStepProps) => {
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'white',
    },
    magicCard: {
      backgroundColor: '#eb7825',
      borderRadius: 24,
      margin: 24,
      padding: 40,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 200,
    },
    magicContent: {
      alignItems: 'center',
    },
    sparklesContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 24,
    },
    sparkleLarge: {
      fontSize: 48,
      marginRight: 8,
    },
    sparkleSmall: {
      fontSize: 32,
    },
    magicTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: 'white',
      marginBottom: 8,
      textAlign: 'center',
    },
    magicSubtitle: {
      fontSize: 16,
      color: 'rgba(255, 255, 255, 0.8)',
      textAlign: 'center',
    },
    profileSection: {
      flex: 1,
      paddingHorizontal: 24,
    },
    profileTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 20,
    },
    profileContent: {
      flex: 1,
    },
    profileContentContainer: {
      paddingBottom: 20,
    },
    profileCard: {
      backgroundColor: '#f9fafb',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    },
    profileCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    profileCardTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginLeft: 8,
    },
    profileCardContent: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    profileCardText: {
      fontSize: 16,
      color: '#6b7280',
    },
    profileTag: {
      backgroundColor: 'white',
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
    },
    profileTagEmoji: {
      fontSize: 14,
      marginRight: 4,
    },
    profileTagText: {
      fontSize: 14,
      color: '#374151',
    },
    enterMinglaButton: {
      backgroundColor: '#eb7825',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 20,
    },
    enterMinglaButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
      marginRight: 8,
    },
  });

  const vibeCategories = [
    {
      id: 'take-a-stroll',
      name: 'Take a Stroll',
      emoji: '🚶',
    },
    {
      id: 'sip-and-chill',
      name: 'Sip & Chill',
      emoji: '☕',
    },
    {
      id: 'casual-eats',
      name: 'Casual Eats',
      emoji: '🍕',
    },
    {
      id: 'screen-and-relax',
      name: 'Screen & Relax',
      emoji: '🎬',
    },
    {
      id: 'creative-hands-on',
      name: 'Creative & Hands-On',
      emoji: '🎨',
    },
    {
      id: 'play-and-move',
      name: 'Play & Move',
      emoji: '⚽',
    },
    {
      id: 'dining-experiences',
      name: 'Dining Experiences',
      emoji: '🍽️',
    },
    {
      id: 'wellness-dates',
      name: 'Wellness Dates',
      emoji: '🧘',
    },
    {
      id: 'freestyle',
      name: 'Freestyle',
      emoji: '✨',
    }
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Magic Card */}
      <View style={styles.magicCard}>
        <View style={styles.magicContent}>
          <View style={styles.sparklesContainer}>
            <Text style={styles.sparkleLarge}>✨</Text>
            <Text style={styles.sparkleSmall}>✨</Text>
          </View>
          <Text style={styles.magicTitle}>Creating Magic...</Text>
          <Text style={styles.magicSubtitle}>Personalizing your experience</Text>
        </View>
      </View>

      {/* Profile Section */}
      <View style={styles.profileSection}>
        <Text style={styles.profileTitle}>Your Mingla Profile</Text>
        
        <ScrollView 
          style={styles.profileContent}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.profileContentContainer}
        >
          {/* Your Intentions */}
          <View style={styles.profileCard}>
            <View style={styles.profileCardHeader}>
              <Ionicons name="flash" size={20} color="#eb7825" />
              <Text style={styles.profileCardTitle}>Your Intentions</Text>
            </View>
            <View style={styles.profileCardContent}>
              {onboardingData.intents?.length > 0 ? (
                onboardingData.intents.map((intent: any) => (
                  <View key={intent.id} style={styles.profileTag}>
                    <Text style={styles.profileTagEmoji}>{intent.emoji}</Text>
                    <Text style={styles.profileTagText}>{intent.title}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.profileCardText}>No intentions selected</Text>
              )}
            </View>
          </View>

          {/* Your Vibes */}
          {onboardingData.vibes?.length > 0 && (
            <View style={styles.profileCard}>
              <View style={styles.profileCardHeader}>
                <Ionicons name="sparkles" size={20} color="#eb7825" />
                <Text style={styles.profileCardTitle}>Your Vibes</Text>
              </View>
              <View style={styles.profileCardContent}>
                {onboardingData.vibes.map((vibeId: string) => {
                  const vibe = vibeCategories.find(v => v.id === vibeId);
                  return vibe ? (
                    <View key={vibeId} style={styles.profileTag}>
                      <Text style={styles.profileTagEmoji}>{vibe.emoji}</Text>
                      <Text style={styles.profileTagText}>{vibe.name}</Text>
                    </View>
                  ) : null;
                })}
              </View>
            </View>
          )}

          {/* Location */}
          <View style={styles.profileCard}>
            <View style={styles.profileCardHeader}>
              <Ionicons name="location" size={20} color="#eb7825" />
              <Text style={styles.profileCardTitle}>Location</Text>
            </View>
            <Text style={styles.profileCardText}>{onboardingData.location}</Text>
          </View>
        </ScrollView>

        {/* Enter Mingla Button */}
        <TouchableOpacity
          onPress={() => onComplete(onboardingData)}
          style={styles.enterMinglaButton}
        >
          <Text style={styles.enterMinglaButtonText}>Enter Mingla</Text>
          <Ionicons name="arrow-forward" size={20} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default MagicStep;
