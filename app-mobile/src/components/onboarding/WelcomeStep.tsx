import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import minglaLogo from '../../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png';

interface WelcomeStepProps {
  onNext: () => void;
  onBack: () => void;
}

const WelcomeStep = ({ onNext, onBack }: WelcomeStepProps) => {
  const styles = StyleSheet.create({
    welcomeContainer: {
      flex: 1,
      backgroundColor: 'white',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingVertical: 16,
      backgroundColor: 'white',
      borderBottomWidth: 1,
      borderBottomColor: '#f3f4f6',
    },
    backButton: {
      padding: 8,
      borderRadius: 20,
    },
    headerCenter: {
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: '#111827',
    },
    headerSubtitle: {
      fontSize: 14,
      color: '#6b7280',
    },
    progressBar: {
      height: 8,
      backgroundColor: '#e5e7eb',
      borderRadius: 4,
      marginHorizontal: 24,
      marginVertical: 16,
    },
    progressFill: {
      height: 8,
      backgroundColor: '#eb7825',
      borderRadius: 4,
    },
    mainContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    logoCard: {
      backgroundColor: 'white',
      borderRadius: 24,
      borderWidth: 16,
      borderColor: '#eb7825',
      padding: 20,
      marginBottom: 40,
      shadowColor: '#000',
      shadowOffset: {
        width: 0,
        height: 4,
      },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
      alignItems: 'center',
      justifyContent: 'center',
      width: 200,
      height: 200,
    },
    logoImage: {
      width: 320,
      height: 140,
      resizeMode: 'contain',
    },
    welcomeTitle: {
      fontSize: 32,
      fontWeight: 'bold',
      color: '#111827',
      textAlign: 'center',
      marginBottom: 16,
    },
    welcomeSubtitle: {
      fontSize: 16,
      color: '#6b7280',
      textAlign: 'center',
      lineHeight: 24,
      marginBottom: 40,
    },
    startButton: {
      backgroundColor: '#eb7825',
      paddingVertical: 16,
      paddingHorizontal: 24,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      minWidth: 200,
    },
    startButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
      marginRight: 8,
    },
  });

  return (
    <SafeAreaView style={styles.welcomeContainer}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#9ca3af" />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Welcome</Text>
          <Text style={styles.headerSubtitle}>Step 1 of 7</Text>
        </View>
        
        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: '14.3%' }]} />
      </View>

      {/* Main Content */}
      <View style={styles.mainContent}>
        {/* Logo Card with Orange Border */}
        <View style={styles.logoCard}>
          <Image
            source={minglaLogo}
            style={styles.logoImage}
          />
        </View>

        {/* Welcome Text */}
        <Text style={styles.welcomeTitle}>Welcome to Mingla!</Text>
        <Text style={styles.welcomeSubtitle}>
          Let's make sure you never have to worry about what to do on dates and hangouts ever again.
        </Text>
        
        {/* Button */}
        <TouchableOpacity
          onPress={onNext}
          style={styles.startButton}
        >
          <Text style={styles.startButtonText}>Let's Start</Text>
          <Ionicons name="arrow-forward" size={20} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default WelcomeStep;
