import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useNavigation } from '../contexts/NavigationContext';

const { width } = Dimensions.get('window');

export const NotificationBar: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'invite' | 'session_update' | 'error' | 'success';
    title: string;
    message: string;
    action?: () => void;
  } | null>(null);

  const { pendingInvites } = useSessionManagement();
  const { openSessionSwitcher } = useNavigation();

  const slideAnim = new Animated.Value(-100);

  useEffect(() => {
    // Show notification when there are pending invites
    if (pendingInvites.length > 0) {
      const latestInvite = pendingInvites[0];
      setNotification({
        type: 'invite',
        title: 'New Collaboration Invite',
        message: `You've been invited to join "${latestInvite.collaboration_sessions?.name}"`,
        action: () => {
          openSessionSwitcher();
          hideNotification();
        },
      });
      showNotification();
    }
  }, [pendingInvites, openSessionSwitcher]);

  const showNotification = () => {
    setIsVisible(true);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Auto-hide after 5 seconds
    setTimeout(() => {
      hideNotification();
    }, 5000);
  };

  const hideNotification = () => {
    Animated.timing(slideAnim, {
      toValue: -100,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setIsVisible(false);
      setNotification(null);
    });
  };

  const getNotificationStyle = () => {
    switch (notification?.type) {
      case 'invite':
        return styles.inviteNotification;
      case 'session_update':
        return styles.updateNotification;
      case 'error':
        return styles.errorNotification;
      case 'success':
        return styles.successNotification;
      default:
        return styles.defaultNotification;
    }
  };

  const getIcon = () => {
    switch (notification?.type) {
      case 'invite':
        return 'mail';
      case 'session_update':
        return 'people';
      case 'error':
        return 'alert-circle';
      case 'success':
        return 'checkmark-circle';
      default:
        return 'information-circle';
    }
  };

  if (!isVisible || !notification) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        getNotificationStyle(),
        {
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons
            name={getIcon() as any}
            size={20}
            color={notification.type === 'error' ? '#FF3B30' : 'white'}
          />
        </View>
        
        <View style={styles.textContainer}>
          <Text style={styles.title}>{notification.title}</Text>
          <Text style={styles.message} numberOfLines={2}>
            {notification.message}
          </Text>
        </View>

        <View style={styles.actions}>
          {notification.action && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={notification.action}
            >
              <Text style={styles.actionButtonText}>View</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity
            style={styles.closeButton}
            onPress={hideNotification}
          >
            <Ionicons
              name="close"
              size={16}
              color={notification.type === 'error' ? '#FF3B30' : 'white'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingTop: 50, // Account for status bar
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  message: {
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    backgroundColor: '#007AFF',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  // Notification type styles
  inviteNotification: {
    // Uses default styles with blue accent
  },
  updateNotification: {
    // Uses default styles with blue accent
  },
  errorNotification: {
    // Error notifications have red accent
  },
  successNotification: {
    // Success notifications have green accent
  },
  defaultNotification: {
    // Default blue accent
  },
});
