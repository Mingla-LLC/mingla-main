import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Modal,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface CoachMapStep {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: 'bottomTabs' | 'swipeCard' | 'preferencesButton' | 'collaborateButton' | 'shareButton' | 'tabHome' | 'tabConnections' | 'tabActivity' | 'tabSaved' | 'tabProfile';
  position: 'top' | 'bottom' | 'center' | 'left' | 'right';
  highlightPosition?: { x: number; y: number; width: number; height: number };
}

const COACH_STEPS: CoachMapStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Mingla! 🎉',
    description: 'Let\'s take a quick tour to get you started',
    icon: 'sparkles',
    target: 'center',
    position: 'center',
  },
  {
    id: 'swipe',
    title: 'Swipe to Discover',
    description: 'Swipe right to save experiences you love. Swipe left to skip and see the next card.',
    icon: 'swap-horizontal',
    target: 'swipeCard',
    position: 'top',
  },
  {
    id: 'tabHome',
    title: 'Home Tab',
    description: 'Discover new experiences tailored to your preferences. Swipe through personalized recommendations.',
    icon: 'home',
    target: 'tabHome',
    position: 'bottom',
  },
  {
    id: 'tabConnections',
    title: 'Connections Tab',
    description: 'Manage your friends and connections. Add people, view mutual friends, and see who\'s online.',
    icon: 'people',
    target: 'tabConnections',
    position: 'bottom',
  },
  {
    id: 'tabActivity',
    title: 'Activity Tab',
    description: 'View your collaboration boards, saved experiences, and calendar. See all your planned activities in one place.',
    icon: 'calendar',
    target: 'tabActivity',
    position: 'bottom',
  },
  {
    id: 'tabSaved',
    title: 'Saved Tab',
    description: 'Access all your saved experiences. Filter, search, and manage the places you\'ve bookmarked.',
    icon: 'bookmark',
    target: 'tabSaved',
    position: 'bottom',
  },
  {
    id: 'tabProfile',
    title: 'Profile Tab',
    description: 'Manage your account settings, view your stats, and customize your profile information.',
    icon: 'person',
    target: 'tabProfile',
    position: 'bottom',
  },
  {
    id: 'preferences',
    title: 'Customize Your Preferences',
    description: 'Tap the settings icon to adjust your interests, budget, and more',
    icon: 'options',
    target: 'preferencesButton',
    position: 'top',
  },
  {
    id: 'collaborate',
    title: 'Plan with Friends',
    description: 'Collaborate with friends to discover experiences together',
    icon: 'people',
    target: 'collaborateButton',
    position: 'top',
  },
  {
    id: 'complete',
    title: 'You\'re All Set! ✨',
    description: 'Start swiping to find your next adventure',
    icon: 'checkmark-circle',
    target: 'center',
    position: 'center',
  },
];

interface CoachMapProps {
  visible: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export default function CoachMap({ visible, onComplete, onSkip }: CoachMapProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [highlightLayout, setHighlightLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  const currentStep = COACH_STEPS[currentStepIndex];

  useEffect(() => {
    if (visible) {
      // Reset to first step when opened
      setCurrentStepIndex(0);
      
      // Animate in
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();

      // Pulse animation for highlight
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      // Reset animations when closed
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.8);
      slideAnim.setValue(50);
      pulseAnim.setValue(1);
    }
  }, [visible]);

  const handleNext = () => {
    if (currentStepIndex < COACH_STEPS.length - 1) {
      // Animate out
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setCurrentStepIndex(currentStepIndex + 1);
        // Animate in next step
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 8,
            tension: 40,
            useNativeDriver: true,
          }),
        ]).start();
      });
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      // Animate out
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setCurrentStepIndex(currentStepIndex - 1);
        // Animate in previous step
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 8,
            tension: 40,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }
  };

  const handleComplete = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onComplete();
    });
  };

  const handleSkip = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onSkip();
    });
  };

  const getTooltipPosition = () => {
    const tooltipWidth = SCREEN_WIDTH - 40;
    const tooltipCenter = tooltipWidth / 2;
    
    switch (currentStep.position) {
      case 'top':
        // For swipe card, position tooltip at the top so it doesn't block the card
        if (currentStep.target === 'swipeCard') {
          return {
            position: 'absolute' as const,
            top: 180,
            left: 20,
            right: 20,
          };
        }
        return {
          position: 'absolute' as const,
          top: 120,
          left: 20,
          right: 20,
        };
      case 'bottom':
        return {
          position: 'absolute' as const,
          bottom: 120,
          left: 20,
          right: 20,
        };
      case 'center':
        return {
          position: 'absolute' as const,
          top: SCREEN_HEIGHT / 2 - 150,
          left: 20,
          right: 20,
        };
      default:
        return {
          position: 'absolute' as const,
          top: SCREEN_HEIGHT / 2 - 150,
          left: 20,
          right: 20,
        };
    }
  };

  const renderHighlight = () => {
    // Don't render highlight for center/welcome steps
    if (currentStep.target === 'center') {
      return null;
    }

    // Calculate highlight position based on target
    // These positions account for SafeAreaView padding and actual button sizes
    let highlightStyle: any = {};
    
    switch (currentStep.target) {
      case 'bottomTabs':
        highlightStyle = {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 90,
        };
        break;
      case 'tabHome':
        // First tab (Home) - tabs are evenly spaced with space-around
        // With 5 tabs, centers are at approximately: 10%, 30%, 50%, 70%, 90%
        // Tab width is roughly 70-80px, so highlight should be centered on tab
        highlightStyle = {
          position: 'absolute',
          bottom: 0,
          left: SCREEN_WIDTH * 0.10 - 40,
          width: 80,
          height: 90,
          borderRadius: 12,
        };
        break;
      case 'tabConnections':
        // Second tab (Connections)
        highlightStyle = {
          position: 'absolute',
          bottom: 0,
          left: SCREEN_WIDTH * 0.30 - 40,
          width: 80,
          height: 90,
          borderRadius: 12,
        };
        break;
      case 'tabActivity':
        // Third tab (Activity) - center tab
        highlightStyle = {
          position: 'absolute',
          bottom: 0,
          left: SCREEN_WIDTH * 0.50 - 40,
          width: 80,
          height: 90,
          borderRadius: 12,
        };
        break;
      case 'tabSaved':
        // Fourth tab (Saved)
        highlightStyle = {
          position: 'absolute',
          bottom: 0,
          left: SCREEN_WIDTH * 0.70 - 40,
          width: 80,
          height: 90,
          borderRadius: 12,
        };
        break;
      case 'tabProfile':
        // Fifth tab (Profile)
        highlightStyle = {
          position: 'absolute',
          bottom: 0,
          left: SCREEN_WIDTH * 0.90 - 40,
          width: 80,
          height: 90,
          borderRadius: 12,
        };
        break;
      case 'preferencesButton':
        // Header: paddingTop: 24, SafeAreaView adds ~44-50px on iOS, ~24px on Android
        // Button: padding: 12, minWidth/minHeight: 44, so total 68x68
        // Position: left: 24 (header paddingHorizontal), top: ~24 (header paddingTop) + ~44 (SafeArea) = ~68
        // Adjust to match actual button position more precisely - account for SafeAreaView
        highlightStyle = {
          position: 'absolute',
          top: 60,
          left: 20,
          width: 68,
          height: 68,
          borderRadius: 12,
        };
        break;
      case 'collaborateButton':
        // Header: paddingTop: 24, SafeAreaView adds ~44-50px on iOS
        // Button: paddingHorizontal: 16, paddingVertical: 8, height ~40px, width ~120-140px
        // Position: right: 24 (header paddingHorizontal), top: ~68
        highlightStyle = {
          position: 'absolute',
          top: 60,
          right: 20,
          width: 140,
          height: 40,
          borderRadius: 20,
        };
        break;
      case 'swipeCard':
        // Position card highlight in center, but tooltip will be above it
        highlightStyle = {
          position: 'absolute',
          top: SCREEN_HEIGHT / 2 - 280,
          left: SCREEN_WIDTH / 2 - 175,
          width: 350,
          height: 600,
          borderRadius: 24,
        };
        break;
      default:
        return null;
    }

    return (
      <Animated.View
        style={[
          styles.highlight,
          highlightStyle,
          {
            transform: [{ scale: pulseAnim }],
          },
        ]}
      >
        <View style={styles.highlightBorder} />
        <View style={styles.highlightGlow} />
      </Animated.View>
    );
  };

  if (!visible) return null;

  const tooltipPosition = getTooltipPosition();
  const progress = ((currentStepIndex + 1) / COACH_STEPS.length) * 100;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* Dark overlay */}
        <View style={[StyleSheet.absoluteFill, styles.darkOverlay]} />

        {/* Highlight effect */}
        {renderHighlight()}

        {/* Tooltip */}
        <Animated.View
          style={[
            styles.tooltipContainer,
            tooltipPosition,
            {
              opacity: fadeAnim,
              transform: [
                { scale: scaleAnim },
                { translateY: slideAnim },
              ],
            },
          ]}
        >
          {/* Close button (X) */}
          {currentStepIndex < COACH_STEPS.length - 1 && (
            <TouchableOpacity
              onPress={handleSkip}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          )}

          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons name={currentStep.icon as any} size={32} color="#eb7825" />
          </View>

          {/* Content */}
          <View style={styles.tooltipContent}>
            <Text style={styles.tooltipTitle}>{currentStep.title}</Text>
            <Text style={styles.tooltipDescription}>{currentStep.description}</Text>
          </View>

          {/* Progress bar */}
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {currentStepIndex + 1} of {COACH_STEPS.length}
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actionsContainer}>
            {currentStepIndex > 0 && (
              <TouchableOpacity
                onPress={handlePrevious}
                style={styles.secondaryButton}
              >
                <Ionicons name="chevron-back" size={20} color="#6b7280" />
                <Text style={styles.secondaryButtonText}>Previous</Text>
              </TouchableOpacity>
            )}
            
            <View style={styles.primaryActions}>
              <TouchableOpacity
                onPress={handleNext}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>
                  {currentStepIndex === COACH_STEPS.length - 1 ? 'Get Started' : 'Next'}
                </Text>
                {currentStepIndex < COACH_STEPS.length - 1 && (
                  <Ionicons name="chevron-forward" size={20} color="white" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  darkOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  highlight: {
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: '#eb7825',
    borderRadius: 24,
    overflow: 'visible',
  },
  highlightBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  highlightGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    backgroundColor: 'rgba(235, 120, 37, 0.1)',
  },
  tooltipContainer: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 20,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fef3e2',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  tooltipContent: {
    alignItems: 'center',
    marginBottom: 24,
  },
  tooltipTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  tooltipDescription: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  progressBarContainer: {
    marginBottom: 24,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#eb7825',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    fontWeight: '500',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  primaryActions: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  skipButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
});

