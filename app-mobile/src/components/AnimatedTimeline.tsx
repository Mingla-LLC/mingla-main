import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RecommendationCard } from '../types';

interface TimelineStep {
  id: string;
  time: string;
  title: string;
  description: string;
  icon: string;
  duration: number; // in minutes
}

interface AnimatedTimelineProps {
  card: RecommendationCard;
  isVisible: boolean;
  userTimePreference?: string;
  specificTime?: string;
}

export const AnimatedTimeline: React.FC<AnimatedTimelineProps> = ({ 
  card, 
  isVisible, 
  userTimePreference, 
  specificTime 
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Generate timeline steps based on card data and user preferences
  const generateTimelineSteps = (card: RecommendationCard): TimelineStep[] => {
    let startTime = new Date();
    
    // Use user time preference if available
    if (userTimePreference && userTimePreference !== 'now') {
      if (userTimePreference === 'tonight') {
        startTime.setHours(19, 0, 0, 0);
      } else if (userTimePreference === 'this weekend') {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
        startTime = new Date(today);
        startTime.setDate(today.getDate() + daysUntilSaturday);
        startTime.setHours(14, 0, 0, 0);
      } else if (specificTime) {
        const [hours, minutes] = specificTime.split(':').map(Number);
        startTime.setHours(hours, minutes, 0, 0);
      }
    } else if (card.startTime) {
      startTime = new Date(card.startTime);
    }
    
    const steps: TimelineStep[] = [];
    
    // Only show times if user has set a time preference
    const showTimes = userTimePreference && userTimePreference !== 'now';

    // Travel to location
    if (card.route?.etaMinutes && card.route.etaMinutes > 0) {
      const travelTime = new Date(startTime);
      travelTime.setMinutes(travelTime.getMinutes() - card.route.etaMinutes);
      
      steps.push({
        id: 'travel',
        time: showTimes ? travelTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        title: `Head to ${card.title}`,
        description: `${card.route.etaMinutes} min ${card.route.mode?.toLowerCase() || 'travel'}`,
        icon: 'navigate-outline',
        duration: card.route.etaMinutes
      });
    }

    // Arrival and main activity
    steps.push({
      id: 'arrival',
      time: showTimes ? startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      title: `Arrive at ${card.title}`,
      description: card.copy?.oneLiner || 'Start your experience',
      icon: getCategoryIcon(card.category),
      duration: Math.floor((card.durationMinutes || 90) * 0.7)
    });

    // Mid-experience highlight
    const midTime = new Date(startTime);
    midTime.setMinutes(midTime.getMinutes() + Math.floor((card.durationMinutes || 90) * 0.4));
    
    steps.push({
      id: 'highlight',
      time: showTimes ? midTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      title: getHighlightTitle(card.category),
      description: card.copy?.tip || 'Enjoy the best part of your experience',
      icon: 'heart-outline',
      duration: Math.floor((card.durationMinutes || 90) * 0.3)
    });

    // Experience end
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + (card.durationMinutes || 90));
    
    steps.push({
      id: 'end',
      time: showTimes ? endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      title: 'Experience Complete',
      description: 'Perfect time for photos and memories',
      icon: 'camera-outline',
      duration: 10
    });

    return steps;
  };

  const getCategoryIcon = (category: string): string => {
    switch (category) {
      case 'sip':
        return 'cafe-outline';
      case 'dining':
      case 'casual_eats':
        return 'restaurant-outline';
      case 'stroll':
        return 'location-outline';
      default:
        return 'calendar-outline';
    }
  };

  const getHighlightTitle = (category: string): string => {
    switch (category) {
      case 'sip':
        return 'Perfect conversation moment';
      case 'dining':
        return 'Savor the main course';
      case 'casual_eats':
        return 'Try the signature dish';
      case 'stroll':
        return 'Scenic photo opportunity';
      case 'creative':
        return 'Create something beautiful';
      case 'play_move':
        return 'Peak activity time';
      default:
        return 'Experience highlight';
    }
  };

  const timelineSteps = generateTimelineSteps(card);

  // Auto-play animation when visible
  useEffect(() => {
    if (isVisible && !isPlaying) {
      setIsPlaying(true);
      setCurrentStep(0);

      const interval = setInterval(() => {
        setCurrentStep(prev => {
          if (prev < timelineSteps.length - 1) {
            return prev + 1;
          } else {
            clearInterval(interval);
            setIsPlaying(false);
            return prev;
          }
        });
      }, 2000); // Change step every 2 seconds

      return () => clearInterval(interval);
    }
  }, [isVisible, timelineSteps.length]);

  // Reset when card changes
  useEffect(() => {
    setCurrentStep(0);
    setIsPlaying(false);
  }, [card.id]);

  if (!isVisible) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="time-outline" size={16} color="#007AFF" />
        <Text style={styles.headerText}>Your Timeline</Text>
      </View>

      <View style={styles.timeline}>
        {timelineSteps.map((step, index) => (
          <View key={step.id} style={styles.timelineItem}>
            {/* Timeline indicator */}
            <View style={styles.timelineIndicator}>
              <View style={[
                styles.timelineDot,
                index <= currentStep && styles.timelineDotActive,
                index === currentStep && styles.timelineDotCurrent
              ]}>
                <Ionicons 
                  name={step.icon as any} 
                  size={16} 
                  color={index <= currentStep ? 'white' : '#6B7280'} 
                />
              </View>
              
              {index < timelineSteps.length - 1 && (
                <View style={[
                  styles.timelineLine,
                  index < currentStep && styles.timelineLineActive
                ]} />
              )}
            </View>

            {/* Step content */}
            <View style={styles.stepContent}>
              <View style={styles.stepHeader}>
                {step.time && (
                  <Text style={[
                    styles.stepTime,
                    index <= currentStep && styles.stepTimeActive
                  ]}>
                    {step.time}
                  </Text>
                )}
                {index === currentStep && (
                  <View style={styles.currentIndicator} />
                )}
              </View>
              
              <Text style={[
                styles.stepTitle,
                index <= currentStep && styles.stepTitleActive
              ]}>
                {step.title}
              </Text>
              
              <Text style={[
                styles.stepDescription,
                index <= currentStep && styles.stepDescriptionActive
              ]}>
                {step.description}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Progress indicator */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View 
            style={[
              styles.progressFill,
              { width: `${((currentStep + 1) / timelineSteps.length) * 100}%` }
            ]} 
          />
        </View>
        <Text style={styles.progressText}>
          {currentStep + 1}/{timelineSteps.length}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  timeline: {
    gap: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineIndicator: {
    alignItems: 'center',
  },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timelineDotActive: {
    backgroundColor: '#007AFF',
  },
  timelineDotCurrent: {
    transform: [{ scale: 1.2 }],
  },
  timelineLine: {
    width: 2,
    height: 24,
    backgroundColor: '#E5E7EB',
    marginTop: 4,
  },
  timelineLineActive: {
    backgroundColor: '#007AFF',
  },
  stepContent: {
    flex: 1,
    paddingTop: 4,
  },
  stepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepTime: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#6B7280',
  },
  stepTimeActive: {
    color: '#007AFF',
  },
  currentIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007AFF',
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  stepTitleActive: {
    color: '#1F2937',
  },
  stepDescription: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 16,
  },
  stepDescriptionActive: {
    color: '#6B7280',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: '#6B7280',
    fontFamily: 'monospace',
  },
});
