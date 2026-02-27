/**
 * useInAppNotifications hook
 * 
 * Subscribes to the in-app notification service and provides
 * reactive notification state for components.
 */
import { useState, useEffect, useCallback } from "react";
import {
  inAppNotificationService,
  InAppNotification,
} from "../services/inAppNotificationService";

export function useInAppNotifications() {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const init = async () => {
      await inAppNotificationService.initialize();
      unsubscribe = inAppNotificationService.subscribe(setNotifications);
      setIsInitialized(true);
    };

    init();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAsRead = useCallback(async (notificationId: string) => {
    await inAppNotificationService.markAsRead(notificationId);
  }, []);

  const markAllAsRead = useCallback(async () => {
    await inAppNotificationService.markAllAsRead();
  }, []);

  const clearAll = useCallback(async () => {
    await inAppNotificationService.clearAll();
  }, []);

  const removeNotification = useCallback(async (notificationId: string) => {
    await inAppNotificationService.remove(notificationId);
  }, []);

  return {
    notifications,
    unreadCount,
    isInitialized,
    markAsRead,
    markAllAsRead,
    clearAll,
    removeNotification,
  };
}
