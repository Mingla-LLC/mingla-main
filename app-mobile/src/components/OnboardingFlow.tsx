import React, { useState, useCallback, useMemo } from 'react';
import { Text, View, TouchableOpacity, Image, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import minglaLogo from '../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png';

interface OnboardingFlowProps {
  onComplete: (onboardingData: any) => void;
  onNavigateToSignUp?: () => void;
}

const OnboardingFlow = ({ onComplete, onNavigateToSignUp }: OnboardingFlowProps) => {
  const [currentStep, setCurrentStep] = useState(0);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'white',
    },
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
    progressBarContainer: {
      width: '100%',
      backgroundColor: '#e5e7eb',
      borderRadius: 4,
      height: 8,
      marginBottom: 32,
    },
    progressBarFill: {
      height: 8,
      backgroundColor: '#eb7825',
      borderRadius: 4,
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
    // Step 2 - Account Setup Styles
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
    // Step 3 - Intent Selection Styles
    intentMainContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    selectionCounter: {
      fontSize: 14,
      color: '#eb7825',
      fontWeight: '500',
      marginTop: 8,
    },
    optionsContainer: {
      flex: 1,
    },
    optionsContent: {
      paddingBottom: 20,
    },
    intentCard: {
      borderRadius: 12,
      marginBottom: 12,
      borderWidth: 2,
      width: '100%',
    },
    intentCardDefault: {
      backgroundColor: 'white',
      borderColor: '#e5e7eb',
    },
    intentCardSelected: {
      backgroundColor: '#fef3f2',
      borderColor: '#eb7825',
    },
    intentCardContent: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
    },
    intentIcon: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
    },
    intentIconDefault: {
      backgroundColor: '#f3f4f6',
    },
    intentIconSelected: {
      backgroundColor: '#eb7825',
    },
    intentEmoji: {
      fontSize: 20,
    },
    intentTextContainer: {
      flex: 1,
      flexShrink: 1,
    },
    intentTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 4,
    },
    intentDescription: {
      fontSize: 14,
      color: '#6b7280',
      lineHeight: 20,
    },
    // Step 4 - Vibe Selection Styles
    vibeMainContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    vibeOptionsContainer: {
      flex: 1,
    },
    vibeOptionsContent: {
      paddingBottom: 20,
    },
    vibeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    vibeCard: {
      width: '48%',
      borderRadius: 12,
      marginBottom: 12,
      borderWidth: 2,
    },
    vibeCardDefault: {
      backgroundColor: 'white',
      borderColor: '#e5e7eb',
    },
    vibeCardSelected: {
      backgroundColor: '#fef3f2',
      borderColor: '#eb7825',
    },
    vibeCardContent: {
      padding: 16,
      alignItems: 'center',
      position: 'relative',
    },
    vibeIcon: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    vibeIconDefault: {
      backgroundColor: '#f3f4f6',
    },
    vibeIconSelected: {
      backgroundColor: '#eb7825',
    },
    vibeEmoji: {
      fontSize: 20,
    },
    vibeTextContainer: {
      alignItems: 'center',
    },
    vibeTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 4,
      textAlign: 'center',
    },
    vibeDescription: {
      fontSize: 12,
      color: '#6b7280',
      textAlign: 'center',
      lineHeight: 16,
    },
    vibeCheckmark: {
      position: 'absolute',
      top: 8,
      right: 8,
    },
    // Step 5 - Location Setup Styles
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
    // Step 6 - Invite Friends Styles
    inviteMainContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    inviteIconContainer: {
      alignItems: 'center',
      marginBottom: 32,
    },
    inviteIcon: {
      width: 80,
      height: 80,
      backgroundColor: '#eb7825',
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactsSection: {
      flex: 1,
      marginBottom: 24,
    },
    contactsTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 16,
    },
    contactsList: {
      flex: 1,
    },
    contactsContent: {
      paddingBottom: 20,
    },
    contactCard: {
      backgroundColor: '#f9fafb',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    contactInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    contactAvatar: {
      width: 40,
      height: 40,
      backgroundColor: '#eb7825',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    contactAvatarText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    contactDetails: {
      flex: 1,
    },
    contactName: {
      fontSize: 16,
      fontWeight: '500',
      color: '#111827',
      marginBottom: 2,
    },
    contactEmail: {
      fontSize: 14,
      color: '#6b7280',
    },
    inviteButton: {
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    inviteButtonDefault: {
      backgroundColor: '#eb7825',
    },
    inviteButtonInvited: {
      backgroundColor: '#f3f4f6',
    },
    inviteButtonText: {
      fontSize: 14,
      fontWeight: '500',
    },
    inviteButtonTextDefault: {
      color: 'white',
    },
    inviteButtonTextInvited: {
      color: '#6b7280',
    },
    inviteOptionsContainer: {
      marginBottom: 16,
    },
    emailInviteCard: {
      borderWidth: 2,
      borderColor: '#d1d5db',
      borderStyle: 'dashed',
      borderRadius: 12,
      padding: 20,
      alignItems: 'center',
      marginBottom: 12,
    },
    emailInviteText: {
      fontSize: 16,
      color: '#6b7280',
      marginTop: 8,
    },
    contactsInviteCard: {
      borderWidth: 2,
      borderColor: '#d1d5db',
      borderStyle: 'dashed',
      borderRadius: 12,
      padding: 20,
      alignItems: 'center',
    },
    contactsInviteText: {
      fontSize: 16,
      color: '#6b7280',
      marginTop: 8,
    },
    inviteDisclaimer: {
      fontSize: 12,
      color: '#9ca3af',
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 16,
    },
    // Step 7 - Final Magic Screen Styles
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
  const [onboardingData, setOnboardingData] = useState<any>({
    userProfile: {
      name: 'Jordan Smith',
      email: 'jordan.smith@email.com',
      profileImage: null
    },
    intents: [], // Changed from single intent to multiple intents
    vibes: [],
    location: 'San Francisco, CA',
    invitedFriends: []
  });

  const totalSteps = 7;

  // Mock friend suggestions
  const mockContacts = [
    { id: '1', name: 'Alex Rivera', email: 'alex.rivera@email.com', phone: '(555) 123-4567', avatar: null },
    { id: '2', name: 'Taylor Kim', email: 'taylor.kim@email.com', phone: '(555) 234-5678', avatar: null },
    { id: '3', name: 'Morgan Chen', email: 'morgan.chen@email.com', phone: '(555) 345-6789', avatar: null },
    { id: '4', name: 'Casey Davis', email: 'casey.davis@email.com', phone: '(555) 456-7890', avatar: null }
  ];

  const intentOptions = [
    {
      id: 'solo-adventure',
      title: 'Explore new things solo',
      icon: 'globe',
      emoji: '🌍',
      description: 'Perfect for solo adventures and self-discovery',
      experienceType: 'Solo adventure'
    },
    {
      id: 'first-dates',
      title: 'Plan First Dates',
      icon: 'heart',
      emoji: '💕',
      description: 'Great first impression experiences',
      experienceType: 'First Date'
    },
    {
      id: 'romantic',
      title: 'Find Romantic Activities',
      icon: 'heart',
      emoji: '💘',
      description: 'Intimate and romantic experiences',
      experienceType: 'Romantic'
    },
    {
      id: 'friendly',
      title: 'Find Friendly Activities',
      icon: 'people',
      emoji: '👥',
      description: 'Fun activities with friends',
      experienceType: 'Friendly'
    },
    {
      id: 'group-fun',
      title: 'Find activities for my group',
      icon: 'people',
      emoji: '🎉',
      description: 'Group activities and celebrations',
      experienceType: 'Group fun'
    },
    {
      id: 'business',
      title: 'Find places for business and work meetings',
      icon: 'cafe',
      emoji: '💼',
      description: 'Professional meeting spaces',
      experienceType: 'Business'
    }
  ];

  const vibeCategories = [
    {
      id: 'take-a-stroll',
      name: 'Take a Stroll',
      icon: 'eye',
      emoji: '🚶',
      description: 'Walking tours, parks, scenic routes'
    },
    {
      id: 'sip-and-chill',
      name: 'Sip & Chill',
      icon: 'cafe',
      emoji: '☕',
      description: 'Cafes, bars, lounges'
    },
    {
      id: 'casual-eats',
      name: 'Casual Eats',
      icon: 'restaurant',
      emoji: '🍕',
      description: 'Casual dining, food trucks, markets'
    },
    {
      id: 'screen-and-relax',
      name: 'Screen & Relax',
      icon: 'musical-notes',
      emoji: '🎬',
      description: 'Movies, shows, entertainment'
    },
    {
      id: 'creative-hands-on',
      name: 'Creative & Hands-On',
      icon: 'sparkles',
      emoji: '🎨',
      description: 'Workshops, classes, DIY activities'
    },
    {
      id: 'play-and-move',
      name: 'Play & Move',
      icon: 'fitness',
      emoji: '⚽',
      description: 'Sports, games, active fun'
    },
    {
      id: 'dining-experiences',
      name: 'Dining Experiences',
      icon: 'restaurant',
      emoji: '🍽️',
      description: 'Fine dining, tastings, culinary'
    },
    {
      id: 'wellness-dates',
      name: 'Wellness Dates',
      icon: 'leaf',
      emoji: '🧘',
      description: 'Spa, yoga, meditation, nature'
    },
    {
      id: 'freestyle',
      name: 'Freestyle',
      icon: 'star',
      emoji: '✨',
      description: 'Spontaneous and unique experiences'
    }
  ];

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Complete onboarding
      onComplete(onboardingData);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const updateOnboardingData = useCallback((key: string, value: any) => {
    setOnboardingData((prev: any) => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const handleIntentToggle = useCallback((intent: any) => {
    setOnboardingData((prev: any) => {
      const currentIntents = prev.intents || [];
      let updatedIntents;
      
      if (currentIntents.find((i: any) => i.id === intent.id)) {
        // Remove if already selected
        updatedIntents = currentIntents.filter((i: any) => i.id !== intent.id);
      } else {
        // Add if not selected (no limit)
        updatedIntents = [...currentIntents, intent];
      }
      
      return {
        ...prev,
        intents: updatedIntents
      };
    });
  }, []);

  const handleVibeToggle = useCallback((vibeId: string) => {
    setOnboardingData((prev: any) => {
      const currentVibes = prev.vibes || [];
      let updatedVibes;
      
      if (currentVibes.includes(vibeId)) {
        updatedVibes = currentVibes.filter((id: string) => id !== vibeId);
      } else {
        // Add if not selected (no limit)
        updatedVibes = [...currentVibes, vibeId];
      }
      
      return {
        ...prev,
        vibes: updatedVibes
      };
    });
  }, []);

  const handleFriendInvite = useCallback((friend: any) => {
    setOnboardingData((prev: any) => {
      const currentInvited = prev.invitedFriends || [];
      const isAlreadyInvited = currentInvited.some((f: any) => f.id === friend.id);
      
      if (isAlreadyInvited) {
        return {
          ...prev,
          invitedFriends: currentInvited.filter((f: any) => f.id !== friend.id)
        };
      } else {
        return {
          ...prev,
          invitedFriends: [...currentInvited, friend]
        };
      }
    });
  }, []);

  const requestLocationPermission = useCallback(() => {
    // For demo purposes, always use San Francisco, CA
    updateOnboardingData('location', 'San Francisco, CA');
  }, [updateOnboardingData]);

  const renderProgressBar = () => (
    <View style={styles.progressBarContainer}>
      <View 
        style={[
          styles.progressBarFill,
          { width: `${((currentStep + 1) / totalSteps) * 100}%` }
        ]}
      />
    </View>
  );

  const renderStep = () => {
    switch (currentStep) {
      case 0: // Welcome Screen
        return (
          <SafeAreaView style={styles.welcomeContainer}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
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
                onPress={handleNext}
                style={styles.startButton}
              >
                <Text style={styles.startButtonText}>Let's Start</Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        );

      case 1: // Sign-up / Account Creation
        return (
          <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
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
                onPress={handleNext}
                style={styles.continueButton}
              >
                <Text style={styles.continueButtonText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        );

      case 2: // Intent & Context
        return (
          <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Ionicons name="arrow-back" size={20} color="#9ca3af" />
              </TouchableOpacity>
              
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Your Intent</Text>
                <Text style={styles.headerSubtitle}>Step 3 of 7</Text>
              </View>
              
              <View style={{ width: 32 }} />
            </View>

            {/* Progress Bar */}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '42.9%' }]} />
            </View>

            {/* Main Content */}
            <View style={styles.intentMainContent}>
              {/* Title Section */}
              <View style={styles.titleSection}>
                <Text style={styles.title}>I'm here to...</Text>
                <Text style={styles.subtitle}>Select all reasons that bring you to Mingla</Text>
                <Text style={styles.selectionCounter}>
                  {onboardingData.intents?.length || 0} selected
                </Text>
              </View>

              {/* Intent Options */}
              <ScrollView 
                style={styles.optionsContainer}
                showsVerticalScrollIndicator={true}
                contentContainerStyle={styles.optionsContent}
              >
                {intentOptions.map((option) => {
                  const isSelected = onboardingData.intents?.find((i: any) => i.id === option.id);
                  
                  return (
                    <TouchableOpacity
                      key={option.id}
                      onPress={() => handleIntentToggle(option)}
                      style={[
                        styles.intentCard,
                        isSelected ? styles.intentCardSelected : styles.intentCardDefault
                      ]}
                    >
                      <View style={styles.intentCardContent}>
                        <View style={[
                          styles.intentIcon,
                          isSelected ? styles.intentIconSelected : styles.intentIconDefault
                        ]}>
                          <Text style={styles.intentEmoji}>{option.emoji}</Text>
                        </View>
                        
                        <View style={styles.intentTextContainer}>
                          <Text style={styles.intentTitle}>{option.title}</Text>
                          <Text style={styles.intentDescription}>{option.description}</Text>
                        </View>
                        
                        {isSelected && (
                          <Ionicons name="checkmark" size={20} color="#eb7825" />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Continue Button */}
              <TouchableOpacity
                onPress={handleNext}
                style={styles.continueButton}
              >
                <Text style={styles.continueButtonText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        );

      case 3: // Choose your vibe
        return (
          <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Ionicons name="arrow-back" size={20} color="#9ca3af" />
              </TouchableOpacity>
              
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Your Vibes</Text>
                <Text style={styles.headerSubtitle}>Step 4 of 7</Text>
              </View>
              
              <View style={{ width: 32 }} />
            </View>

            {/* Progress Bar */}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '57.1%' }]} />
            </View>

            {/* Main Content */}
            <View style={styles.vibeMainContent}>
              {/* Title Section */}
              <View style={styles.titleSection}>
                <Text style={styles.title}>Choose Your Vibe</Text>
                <Text style={styles.subtitle}>Select all categories that match your style</Text>
                <Text style={styles.selectionCounter}>
                  {onboardingData.vibes?.length || 0} selected
                </Text>
              </View>

              {/* Vibe Options Grid */}
              <ScrollView 
                style={styles.vibeOptionsContainer}
                showsVerticalScrollIndicator={true}
                contentContainerStyle={styles.vibeOptionsContent}
              >
                <View style={styles.vibeGrid}>
                  {vibeCategories.map((vibe) => {
                    const isSelected = onboardingData.vibes?.includes(vibe.id);
                    
                    return (
                      <TouchableOpacity
                        key={vibe.id}
                        onPress={() => handleVibeToggle(vibe.id)}
                        style={[
                          styles.vibeCard,
                          isSelected ? styles.vibeCardSelected : styles.vibeCardDefault
                        ]}
                      >
                        <View style={styles.vibeCardContent}>
                          <View style={[
                            styles.vibeIcon,
                            isSelected ? styles.vibeIconSelected : styles.vibeIconDefault
                          ]}>
                            <Text style={styles.vibeEmoji}>{vibe.emoji}</Text>
                          </View>
                          
                          <View style={styles.vibeTextContainer}>
                            <Text style={styles.vibeTitle}>{vibe.name}</Text>
                            <Text style={styles.vibeDescription}>{vibe.description}</Text>
                          </View>
                          
                          {isSelected && (
                            <View style={styles.vibeCheckmark}>
                              <Ionicons name="checkmark" size={16} color="#eb7825" />
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Continue Button */}
              <TouchableOpacity
                onPress={handleNext}
                style={styles.continueButton}
              >
                <Text style={styles.continueButtonText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        );

      case 4: // Location Setup
        return (
          <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
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
                    <Text style={styles.locationValue}>{onboardingData.location}</Text>
                  </View>
                </View>
              </View>

              {/* Enable Location Services Button */}
              <TouchableOpacity
                onPress={requestLocationPermission}
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
                onPress={handleNext}
                style={styles.continueButton}
              >
                <Text style={styles.continueButtonText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        );

      case 5: // Invite to Mingla
        return (
          <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                <Ionicons name="arrow-back" size={20} color="#9ca3af" />
              </TouchableOpacity>
              
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Invite Friends</Text>
                <Text style={styles.headerSubtitle}>Step 6 of 7</Text>
              </View>
              
              <View style={{ width: 32 }} />
            </View>

            {/* Progress Bar */}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '85.7%' }]} />
            </View>

            {/* Main Content */}
            <View style={styles.inviteMainContent}>
              {/* Large Invite Icon */}
              <View style={styles.inviteIconContainer}>
                <View style={styles.inviteIcon}>
                  <Ionicons name="person-add" size={40} color="white" />
                </View>
              </View>

              {/* Title Section */}
              <View style={styles.titleSection}>
                <Text style={styles.title}>Invite Friends</Text>
                <Text style={styles.subtitle}>
                  Mingla is better with friends! Invite people to join you.
                </Text>
              </View>

              {/* Suggested Contacts */}
              <View style={styles.contactsSection}>
                <Text style={styles.contactsTitle}>Suggested Contacts</Text>
                <ScrollView 
                  style={styles.contactsList}
                  showsVerticalScrollIndicator={true}
                  contentContainerStyle={styles.contactsContent}
                >
                  {mockContacts.map((contact) => {
                    const isInvited = onboardingData.invitedFriends?.some((f: any) => f.id === contact.id);
                    
                    return (
                      <View key={contact.id} style={styles.contactCard}>
                        <View style={styles.contactInfo}>
                          <View style={styles.contactAvatar}>
                            <Text style={styles.contactAvatarText}>{contact.name.charAt(0)}</Text>
                          </View>
                          <View style={styles.contactDetails}>
                            <Text style={styles.contactName}>{contact.name}</Text>
                            <Text style={styles.contactEmail}>{contact.email}</Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleFriendInvite(contact)}
                          style={[
                            styles.inviteButton,
                            isInvited ? styles.inviteButtonInvited : styles.inviteButtonDefault
                          ]}
                        >
                          <Text style={[
                            styles.inviteButtonText,
                            isInvited ? styles.inviteButtonTextInvited : styles.inviteButtonTextDefault
                          ]}>
                            {isInvited ? 'Invited' : 'Invite'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Invite Options */}
              <View style={styles.inviteOptionsContainer}>
                <TouchableOpacity style={styles.emailInviteCard}>
                  <Ionicons name="add" size={24} color="#6b7280" />
                  <Text style={styles.emailInviteText}>Invite by Email</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.contactsInviteCard}>
                  <Ionicons name="call" size={24} color="#6b7280" />
                  <Text style={styles.contactsInviteText}>Invite from Contacts</Text>
                </TouchableOpacity>
              </View>

              {/* Disclaimer */}
              <Text style={styles.inviteDisclaimer}>
                Selected contacts will auto-accept for demo purposes
              </Text>

              {/* Continue Button */}
              <TouchableOpacity
                onPress={handleNext}
                style={styles.continueButton}
              >
                <Text style={styles.continueButtonText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        );

      case 6: // Let Mingla do the magic
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

      default:
        return null;
    }
  };

  const getButtonText = useMemo(() => {
    switch (currentStep) {
      case 0: return "Let's Start";
      case 1: return "Continue";
      case 2: return (onboardingData.intents?.length >= 1) ? "Continue" : "Select At Least One";
      case 3: return (onboardingData.vibes?.length >= 1) ? "Continue" : "Select At Least One";
      case 4: return "Continue";
      case 5: return "Continue";
      case 6: return "Enter Mingla";
      default: return "Continue";
    }
  }, [currentStep, onboardingData.intents, onboardingData.vibes]);

  const isStepComplete = useMemo(() => {
    switch (currentStep) {
      case 0: return true; // Welcome screen
      case 1: return true; // Account creation (prefilled)
      case 2: return (onboardingData.intents?.length >= 1);
      case 3: return (onboardingData.vibes?.length >= 1);
      case 4: return true; // Location (auto-set)
      case 5: return true; // Invites (optional)
      case 6: return true; // Final screen
      default: return false;
    }
  }, [currentStep, onboardingData.intents, onboardingData.vibes]);

  return (
    <SafeAreaView style={styles.container}>
      {renderStep()}
    </SafeAreaView>
  );
};

export default OnboardingFlow;