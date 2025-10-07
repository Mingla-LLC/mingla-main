import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface AccountSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onNavigateToSignUp?: () => void;
}

const AccountSetupStep = ({ onNext, onBack, onNavigateToSignUp }: AccountSetupStepProps) => {
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
    accountMainContent: {
      flex: 1,
      paddingHorizontal: 24,
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
    profileCard: {
      backgroundColor: '#f9fafb',
      borderRadius: 16,
      padding: 16,
      marginBottom: 32,
      marginHorizontal: 4,
      minHeight: 80,
    },
    profileInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    avatar: {
      width: 56,
      height: 56,
      backgroundColor: '#eb7825',
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    avatarText: {
      fontSize: 24,
      fontWeight: 'bold',
      color: 'white',
    },
    profileDetails: {
      flex: 1,
      marginLeft: 8,
      flexShrink: 1,
    },
    profileName: {
      fontSize: 20,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 6,
      flexShrink: 0,
    },
    profileEmail: {
      fontSize: 16,
      color: '#6b7280',
      flexShrink: 0,
    },
    loginOptions: {
      marginBottom: 24,
    },
    appleButton: {
      backgroundColor: '#000000',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    appleIcon: {
      fontSize: 20,
      marginRight: 12,
    },
    appleButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '500',
    },
    googleButton: {
      backgroundColor: 'white',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: '#e5e7eb',
      marginBottom: 12,
    },
    googleIcon: {
      width: 20,
      height: 20,
      backgroundColor: '#4285f4',
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    googleIconText: {
      color: 'white',
      fontSize: 12,
      fontWeight: 'bold',
    },
    googleButtonText: {
      color: '#111827',
      fontSize: 16,
      fontWeight: '500',
    },
    emailButton: {
      backgroundColor: '#f3f4f6',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    emailButtonText: {
      color: '#111827',
      fontSize: 16,
      fontWeight: '500',
      marginLeft: 12,
    },
    disclaimer: {
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
          <Text style={styles.headerTitle}>Account Setup</Text>
          <Text style={styles.headerSubtitle}>Step 2 of 7</Text>
        </View>
        
        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: '28.6%' }]} />
      </View>

      {/* Main Content */}
      <View style={styles.accountMainContent}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Create Your Account</Text>
          <Text style={styles.subtitle}>Quick setup with trusted login options</Text>
        </View>

        {/* User Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.profileInfo}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>J</Text>
            </View>
            <View style={styles.profileDetails}>
              <Text style={styles.profileName}>Jordan Smith</Text>
              <Text style={styles.profileEmail}>jordan.smith@email.com</Text>
            </View>
          </View>
        </View>

        {/* Login Options */}
        <View style={styles.loginOptions}>
          <TouchableOpacity style={styles.appleButton}>
            <Text style={styles.appleIcon}>🍎</Text>
            <Text style={styles.appleButtonText}>Continue with Apple</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.googleButton}>
            <View style={styles.googleIcon}>
              <Text style={styles.googleIconText}>G</Text>
            </View>
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.emailButton}
            onPress={onNavigateToSignUp}
          >
            <Ionicons name="mail" size={20} color="#6b7280" />
            <Text style={styles.emailButtonText}>Continue with Email</Text>
          </TouchableOpacity>
        </View>

        {/* Disclaimer */}
        <Text style={styles.disclaimer}>
          All data is prefilled for demo purposes. In production, this would connect to your actual accounts.
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

export default AccountSetupStep;
