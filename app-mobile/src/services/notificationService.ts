import * as Notifications from 'expo-notifications';
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
  title: string;
  body: string;
  data?: any;
  sound?: boolean;
  badge?: number;
}

export class NotificationService {
  private static instance: NotificationService;
  private expoPushToken: string | null = null;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Notification permission not granted');
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error requesting notification permissions:', error);
      return false;
    }
  }

  async registerForPushNotifications(): Promise<string | null> {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return null;

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      }

      const token = await Notifications.getExpoPushTokenAsync({
        projectId: 'gqnoajqerqhnvulmnyvv', // Your Expo project ID
      });

      this.expoPushToken = token.data;
      return this.expoPushToken;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return null;
    }
  }

  async scheduleLocalNotification(notification: NotificationData, trigger?: Notifications.NotificationTriggerInput): Promise<string> {
    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: notification.title,
          body: notification.body,
          data: notification.data || {},
          sound: notification.sound !== false,
          badge: notification.badge,
        },
        trigger: trigger || null,
      });

      return notificationId;
    } catch (error) {
      console.error('Error scheduling notification:', error);
      throw error;
    }
  }

  async sendPushNotification(
    expoPushToken: string,
    notification: NotificationData
  ): Promise<boolean> {
    try {
      const message = {
        to: expoPushToken,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        badge: notification.badge,
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

      return response.ok;
    } catch (error) {
      console.error('Error sending push notification:', error);
      return false;
    }
  }

  async sendCollaborationInvite(
    invitedUserId: string,
    sessionName: string,
    inviterName: string
  ): Promise<boolean> {
    try {
      // Get the invited user's push token from the database
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('expo_push_token')
        .eq('id', invitedUserId)
        .single();

      if (!userProfile?.expo_push_token) {
        console.log('User does not have push token registered');
        return false;
      }

      const notification: NotificationData = {
        title: 'New Collaboration Invite',
        body: `${inviterName} invited you to join "${sessionName}"`,
        data: {
          type: 'collaboration_invite',
          sessionName,
          inviterName,
        },
      };

      return await this.sendPushNotification(userProfile.expo_push_token, notification);
    } catch (error) {
      console.error('Error sending collaboration invite:', error);
      return false;
    }
  }

  async sendSessionUpdate(
    userId: string,
    sessionName: string,
    updateType: 'new_experience' | 'experience_finalized' | 'session_ended'
  ): Promise<boolean> {
    try {
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('expo_push_token')
        .eq('id', userId)
        .single();

      if (!userProfile?.expo_push_token) {
        return false;
      }

      let title = '';
      let body = '';

      switch (updateType) {
        case 'new_experience':
          title = 'New Experience Added';
          body = `A new experience was added to "${sessionName}"`;
          break;
        case 'experience_finalized':
          title = 'Experience Finalized';
          body = `An experience in "${sessionName}" has been finalized`;
          break;
        case 'session_ended':
          title = 'Session Ended';
          body = `The collaboration session "${sessionName}" has ended`;
          break;
      }

      const notification: NotificationData = {
        title,
        body,
        data: {
          type: 'session_update',
          sessionName,
          updateType,
        },
      };

      return await this.sendPushNotification(userProfile.expo_push_token, notification);
    } catch (error) {
      console.error('Error sending session update:', error);
      return false;
    }
  }

  async updateUserPushToken(userId: string, pushToken: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ expo_push_token: pushToken })
        .eq('id', userId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error updating push token:', error);
      return false;
    }
  }

  addNotificationListener(
    callback: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(callback);
  }

  addNotificationResponseListener(
    callback: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }

  async cancelNotification(notificationId: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  }

  async cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  getExpoPushToken(): string | null {
    return this.expoPushToken;
  }
}

export const notificationService = NotificationService.getInstance();
