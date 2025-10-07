import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface LocationSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  location: string;
  onRequestLocationPermission: () => void;
}

const LocationSetupStep = ({ onNext, onBack, location, onRequestLocationPermission }: LocationSetupStepProps) => {
  const styles = StyleSheet.create({
    container: {
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
    locationMainContent: {
      flex: 1,
      paddingHorizontal: 24,
      alignItems: 'center',
    },
    locationIconContainer: {
      marginBottom: 32,
    },
    locationIcon: {
      width: 80,
      height: 80,
      backgroundColor: '#eb7825',
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleSection: {
      alignItems: 'center',
      marginBottom: 32,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: '#111827',
      textAlign: 'center',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: '#6b7280',
      textAlign: 'center',
    },
    locationCard: {
      backgroundColor: '#f9fafb',
      borderRadius: 16,
      padding: 20,
      marginBottom: 24,
      width: '100%',
    },
    locationCardContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    locationTextContainer: {
      marginLeft: 12,
      flex: 1,
    },
    locationLabel: {
      fontSize: 16,
      fontWeight: '500',
      color: '#111827',
      marginBottom: 4,
    },
    locationValue: {
      fontSize: 16,
      color: '#6b7280',
    },
    enableLocationButton: {
      backgroundColor: '#eb7825',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      width: '100%',
    },
    enableLocationButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '500',
      marginLeft: 12,
    },
    locationDisclaimer: {
      fontSize: 12,
      color: '#9ca3af',
      textAlign: 'center',
      marginBottom: 32,
      lineHeight: 16,
    },
    continueButton: {
      backgroundColor: '#eb7825',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    continueButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
      marginRight: 8,
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#9ca3af" />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Location</Text>
          <Text style={styles.headerSubtitle}>Step 5 of 7</Text>
        </View>
        
        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: '71.4%' }]} />
      </View>

      {/* Main Content */}
      <View style={styles.locationMainContent}>
        {/* Large Location Icon */}
        <View style={styles.locationIconContainer}>
          <View style={styles.locationIcon}>
            <Ionicons name="location" size={40} color="white" />
          </View>
        </View>

        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Location Setup</Text>
          <Text style={styles.subtitle}>
            We'll never share your exact location — just to find the best spots near you.
          </Text>
        </View>

        {/* Current Location Card */}
        <View style={styles.locationCard}>
          <View style={styles.locationCardContent}>
            <Ionicons name="location" size={20} color="#eb7825" />
            <View style={styles.locationTextContainer}>
              <Text style={styles.locationLabel}>Current Location</Text>
              <Text style={styles.locationValue}>{location}</Text>
            </View>
          </View>
        </View>

        {/* Enable Location Services Button */}
        <TouchableOpacity
          onPress={onRequestLocationPermission}
          style={styles.enableLocationButton}
        >
          <Ionicons name="location" size={20} color="white" />
          <Text style={styles.enableLocationButtonText}>Enable Location Services</Text>
        </TouchableOpacity>

        {/* Disclaimer */}
        <Text style={styles.locationDisclaimer}>
          For demo purposes, we'll use San Francisco, CA as your location
        </Text>

        {/* Continue Button */}
        <TouchableOpacity
          onPress={onNext}
          style={styles.continueButton}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
          <Ionicons name="arrow-forward" size={20} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default LocationSetupStep;
