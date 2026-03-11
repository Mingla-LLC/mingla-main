import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface NotificationData {
  type: 'collaboration_invite' | 'session_message' | 'board_update' | 'experience_shared' | 'location_reminder' | 'message';
  title: string;
  body: string;
  data?: any;
}

class EnhancedNotificationService {
  private expoPushToken: string | null = null;
  private isInitialized = false;
  private pushTokenStored = false;

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        return false;
      }

      // Get push token
      if (Device.isDevice) {
        try {
          const token = await Notifications.getExpoPushTokenAsync();
          this.expoPushToken = token.data;
        } catch (tokenError) {
          // Continue without push notifications for now
          this.expoPushToken = null;
        }
      } else {
        this.expoPushToken = null;
      }

      // Configure notification channel for Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });

        await Notifications.setNotificationChannelAsync('collaboration', {
          name: 'Collaboration',
          description: 'Notifications for collaboration features',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#007AFF',
        });

        await Notifications.setNotificationChannelAsync('location', {
          name: 'Location',
          description: 'Location-based notifications',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#34C759',
        });
      }

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing notifications:', error);
      return false;
    }
  }

  async registerForPushNotifications(userId: string): Promise<boolean> {
    try {
      // Always re-register. Tokens can expire after app reinstall, iOS update,
      // or Expo SDK upgrade. The DB upsert is idempotent (UNIQUE on user_id+push_token).
      // We still skip if we have no token to store.
      if (!this.expoPushToken) {
        // Re-initialize to get fresh token (handles reinstall/update scenarios)
        await this.initialize();
        if (!this.expoPushToken) return false;
      }

      // Store push token in user_push_tokens table
      const { error } = await supabase
        .from('user_push_tokens')
        .upsert(
          {
            user_id: userId,
            push_token: this.expoPushToken,
            platform: Platform.OS,
            device_id: Device.osInternalBuildId || 'unknown',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,push_token' }
        );

      if (error) {
        console.error('Error storing push token in user_push_tokens:', error);
      } else {
        this.pushTokenStored = true;
      }

      return true;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return false;
    }
  }

  /**
   * Resets internal token state. Called on logout so the next login
   * triggers a fresh token registration.
   */
  resetTokenState(): void {
    this.pushTokenStored = false;
  }

  async sendLocalNotification(notification: NotificationData): Promise<void> {
    try {
      const channelId = this.getChannelId(notification.type);
      
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notification.title,
          body: notification.body,
          data: notification.data,
          sound: 'default',
        },
        trigger: null, // Show immediately
        ...(Platform.OS === 'android' && { channelId }),
      });
    } catch (error) {
      console.error('Error sending local notification:', error);
    }
  }

  async sendPushNotification(
    userId: string,
    notification: NotificationData
  ): Promise<boolean> {
    try {
      const { data: tokenData } = await supabase
        .from('user_push_tokens')
        .select('push_token')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const pushToken = tokenData?.push_token || null;

      if (!pushToken) {
        return false;
      }

      // Send push notification via Expo
      const message = {
        to: pushToken,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data,
        channelId: this.getChannelId(notification.type),
      };

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const result = await response.json();
      
      if (result.data && result.data[0] && result.data[0].status === 'ok') {
        return true;
      } else {
        console.error('Failed to send push notification:', result);
        return false;
      }
    } catch (error) {
      console.error('Error sending push notification:', error);
      return false;
    }
  }

  async scheduleLocationReminder(
    title: string,
    body: string,
    latitude: number,
    longitude: number,
    radius: number = 100
  ): Promise<string | null> {
    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: {
            type: 'location_reminder',
            latitude,
            longitude,
            radius,
          },
        },
        trigger: {
          type: 'location',
          latitude,
          longitude,
          radius,
        },
      });

      return notificationId;
    } catch (error) {
      console.error('Error scheduling location reminder:', error);
      return null;
    }
  }

  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (error) {
      console.error('Error canceling notification:', error);
    }
  }

  async cancelAllNotifications(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error canceling all notifications:', error);
    }
  }

  async getBadgeCount(): Promise<number> {
    try {
      return await Notifications.getBadgeCountAsync();
    } catch (error) {
      console.error('Error getting badge count:', error);
      return 0;
    }
  }

  async setBadgeCount(count: number): Promise<void> {
    try {
      await Notifications.setBadgeCountAsync(count);
    } catch (error) {
      console.error('Error setting badge count:', error);
    }
  }

  addNotificationReceivedListener(
    listener: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(listener);
  }

  addNotificationResponseReceivedListener(
    listener: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(listener);
  }

  private getChannelId(type: NotificationData['type']): string {
    switch (type) {
      case 'collaboration_invite':
      case 'session_message':
      case 'board_update':
      case 'experience_shared':
        return 'collaboration';
      case 'location_reminder':
        return 'location';
      default:
        return 'default';
    }
  }

  // Helper methods for common notification types
  async notifyCollaborationInvite(
    userId: string,
    inviterName: string,
    sessionName: string
  ): Promise<boolean> {
    return this.sendPushNotification(userId, {
      type: 'collaboration_invite',
      title: 'New Collaboration Invite',
      body: `${inviterName} invited you to join "${sessionName}"`,
      data: { sessionName, inviterName },
    });
  }

  async notifySessionMessage(
    userId: string,
    senderName: string,
    message: string,
    sessionName: string
  ): Promise<boolean> {
    return this.sendPushNotification(userId, {
      type: 'session_message',
      title: `${senderName} in ${sessionName}`,
      body: message,
      data: { senderName, sessionName, message },
    });
  }

  async notifyBoardUpdate(
    userId: string,
    boardName: string,
    updateType: string,
    updaterName: string
  ): Promise<boolean> {
    return this.sendPushNotification(userId, {
      type: 'board_update',
      title: `Board Update: ${boardName}`,
      body: `${updaterName} ${updateType}`,
      data: { boardName, updateType, updaterName },
    });
  }

  async notifyExperienceShared(
    userId: string,
    sharerName: string,
    experienceName: string
  ): Promise<boolean> {
    return this.sendPushNotification(userId, {
      type: 'experience_shared',
      title: 'Experience Shared',
      body: `${sharerName} shared "${experienceName}" with you`,
      data: { sharerName, experienceName },
    });
  }
}

export const enhancedNotificationService = new EnhancedNotificationService();
