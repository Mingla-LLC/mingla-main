import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, Animated } from 'react-native';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { Ionicons } from '@expo/vector-icons';

interface Notification {
  id: string;
  type: 'invite' | 'join' | 'success' | 'board_activity' | 'discussion_tag' | 'lock_in' | 'rsvp';
  title: string;
  message: string;
  sessionName?: string;
  fromUser?: string;
  boardName?: string;
  activityType?: 'like' | 'rsvp' | 'discussion' | 'lock_in' | 'tag';
  actions?: Array<{
    label: string;
    action: () => void;
    variant: 'primary' | 'secondary';
  }>;
  autoHide?: boolean;
  duration?: number;
}

interface NotificationSystemProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

export default function NotificationSystem({ notifications, onDismiss }: NotificationSystemProps) {
  useEffect(() => {
    notifications.forEach(notification => {
      if (notification.autoHide && notification.duration) {
        const timer = setTimeout(() => {
          onDismiss(notification.id);
        }, notification.duration);
        
        return () => clearTimeout(timer);
      }
    });
  }, [notifications, onDismiss]);

  if (notifications.length === 0) return null;

  return (
    <View style={styles.container}>
      {notifications.map(notification => (
        <NotificationCard 
          key={notification.id} 
          notification={notification} 
          onDismiss={() => onDismiss(notification.id)} 
        />
      ))}
    </View>
  );
}

function NotificationCard({ notification, onDismiss }: { notification: Notification; onDismiss: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const slideAnim = new Animated.Value(300);
  const opacityAnim = new Animated.Value(0);

  useEffect(() => {
    // Trigger enter animation
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  const getIcon = () => {
    const iconProps = { size: 20, color: '#eb7825' };
    
    switch (notification.type) {
      case 'invite':
        return <Ionicons name="people" {...iconProps} />;
      case 'join':
        return <Ionicons name="people" {...iconProps} />;
      case 'success':
        return <Ionicons name="checkmark" {...iconProps} />;
      case 'board_activity':
        if (notification.activityType === 'like') return <Ionicons name="heart" {...iconProps} />;
        if (notification.activityType === 'rsvp') return <Ionicons name="calendar" {...iconProps} />;
        if (notification.activityType === 'discussion') return <Ionicons name="chatbubble" {...iconProps} />;
        if (notification.activityType === 'lock_in') return <Ionicons name="lock-closed" {...iconProps} />;
        return <Ionicons name="notifications" {...iconProps} />;
      case 'discussion_tag':
        return <Ionicons name="pricetag" {...iconProps} />;
      case 'lock_in':
        return <Ionicons name="lock-closed" {...iconProps} />;
      case 'rsvp':
        return <Ionicons name="calendar" {...iconProps} />;
      default:
        return <Ionicons name="notifications" {...iconProps} />;
    }
  };

  const getBackgroundStyle = () => {
    switch (notification.type) {
      case 'success':
        return styles.successBackground;
      case 'invite':
      case 'join':
        return styles.inviteBackground;
      default:
        return styles.defaultBackground;
    }
  };

  const getTextStyle = () => {
    switch (notification.type) {
      case 'success':
      case 'invite':
      case 'join':
        return styles.whiteText;
      default:
        return styles.darkText;
    }
  };

  const getSecondaryTextStyle = () => {
    switch (notification.type) {
      case 'success':
      case 'invite':
      case 'join':
        return styles.whiteSecondaryText;
      default:
        return styles.graySecondaryText;
    }
  };

  return (
    <Animated.View 
      style={[
        styles.notificationCard,
        {
          transform: [{ translateX: slideAnim }],
          opacity: opacityAnim,
        }
      ]}
    >
      <View style={[styles.notificationContainer, getBackgroundStyle()]}>
        
        {/* Sparkle decoration for success notifications */}
        {notification.type === 'success' && (
          <View style={styles.sparkleContainer}>
            <Ionicons name="sparkles" size={16} color="white" />
          </View>
        )}
        
        <View style={styles.notificationContent}>
          <View style={[
            styles.iconContainer,
            (notification.type === 'success' || notification.type === 'invite' || notification.type === 'join')
              ? styles.iconContainerSuccess
              : styles.iconContainerDefault
          ]}>
            {getIcon()}
          </View>
          
          <View style={styles.textContainer}>
            <Text style={[styles.title, getTextStyle()]}>{notification.title}</Text>
            <Text style={[styles.message, getSecondaryTextStyle()]}>{notification.message}</Text>
            
            {(notification.sessionName || notification.boardName) && (
              <View style={[
                styles.sessionTag,
                (notification.type === 'success' || notification.type === 'invite' || notification.type === 'join')
                  ? styles.sessionTagSuccess
                  : styles.sessionTagDefault
              ]}>
                <Text style={[
                  styles.sessionTagText,
                  (notification.type === 'success' || notification.type === 'invite' || notification.type === 'join')
                    ? styles.sessionTagTextSuccess
                    : styles.sessionTagTextDefault
                ]}>
                  "{notification.sessionName || notification.boardName}"
                </Text>
              </View>
            )}

            {notification.actions && notification.actions.length > 0 && (
              <View style={styles.actionsContainer}>
                {notification.actions.map((action, index) => (
                  <TrackedTouchableOpacity logComponent="NotificationSystem"
                    key={index}
                    onPress={action.action}
                    style={[
                      styles.actionButton,
                      action.variant === 'primary'
                        ? (notification.type === 'success' || notification.type === 'invite' || notification.type === 'join')
                          ? styles.primaryActionSuccess
                          : styles.primaryActionDefault
                        : (notification.type === 'success' || notification.type === 'invite' || notification.type === 'join')
                          ? styles.secondaryActionSuccess
                          : styles.secondaryActionDefault
                    ]}
                  >
                    <Text style={[
                      styles.actionButtonText,
                      action.variant === 'primary'
                        ? (notification.type === 'success' || notification.type === 'invite' || notification.type === 'join')
                          ? styles.primaryActionTextSuccess
                          : styles.primaryActionTextDefault
                        : (notification.type === 'success' || notification.type === 'invite' || notification.type === 'join')
                          ? styles.secondaryActionTextSuccess
                          : styles.secondaryActionTextDefault
                    ]}>
                      {action.label}
                    </Text>
                  </TrackedTouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <TrackedTouchableOpacity logComponent="NotificationSystem" 
            onPress={handleDismiss}
            style={[
              styles.dismissButton,
              (notification.type === 'success' || notification.type === 'invite' || notification.type === 'join')
                ? styles.dismissButtonSuccess
                : styles.dismissButtonDefault
            ]}
          >
            <Ionicons 
              name="close" 
              size={16} 
              color={(notification.type === 'success' || notification.type === 'invite' || notification.type === 'join') ? 'rgba(255, 255, 255, 0.8)' : '#9ca3af'} 
            />
          </TrackedTouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 60,
    maxWidth: 340,
    gap: 12,
  },
  notificationCard: {
    // Animation styles handled by Animated.View
  },
  notificationContainer: {
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
    padding: 20,
    minWidth: 340,
    position: 'relative',
    overflow: 'hidden',
  },
  successBackground: {
    backgroundColor: '#FF7043',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  inviteBackground: {
    backgroundColor: '#eb7825',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  defaultBackground: {
    backgroundColor: 'white',
    borderColor: '#e5e7eb',
  },
  sparkleContainer: {
    position: 'absolute',
    top: 8,
    right: 8,
    opacity: 0.3,
  },
  notificationContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  iconContainer: {
    flexShrink: 0,
    marginTop: 2,
    padding: 8,
    borderRadius: 12,
  },
  iconContainerSuccess: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  iconContainerDefault: {
    backgroundColor: '#fef3e2',
  },
  textContainer: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  whiteText: {
    color: 'white',
  },
  darkText: {
    color: '#111827',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  whiteSecondaryText: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  graySecondaryText: {
    color: '#6b7280',
  },
  sessionTag: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  sessionTagSuccess: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  sessionTagDefault: {
    backgroundColor: '#fef3e2',
  },
  sessionTagText: {
    fontSize: 12,
    fontWeight: '500',
  },
  sessionTagTextSuccess: {
    color: 'white',
  },
  sessionTagTextDefault: {
    color: '#eb7825',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryActionSuccess: {
    backgroundColor: 'white',
  },
  primaryActionDefault: {
    backgroundColor: '#eb7825',
  },
  secondaryActionSuccess: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  secondaryActionDefault: {
    backgroundColor: '#f3f4f6',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  primaryActionTextSuccess: {
    color: '#eb7825',
  },
  primaryActionTextDefault: {
    color: 'white',
  },
  secondaryActionTextSuccess: {
    color: 'white',
  },
  secondaryActionTextDefault: {
    color: '#374151',
  },
  dismissButton: {
    flexShrink: 0,
    padding: 8,
    borderRadius: 12,
  },
  dismissButtonSuccess: {
    // No background for success notifications
  },
  dismissButtonDefault: {
    // No background for default notifications
  },
});