import React, { useState, useEffect } from 'react';
import { X, Check, Users, Clock, Heart, MessageCircle, Calendar, Lock, Bell, Tag, Sparkles } from 'lucide-react';

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
    <div className="fixed top-4 right-4 z-[60] space-y-3 max-w-sm pointer-events-none">
      {notifications.map(notification => (
        <NotificationCard 
          key={notification.id} 
          notification={notification} 
          onDismiss={() => onDismiss(notification.id)} 
        />
      ))}
    </div>
  );
}

function NotificationCard({ notification, onDismiss }: { notification: Notification; onDismiss: () => void }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    setTimeout(() => setIsVisible(true), 50);
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 200);
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'invite':
        return <Users className="w-5 h-5 text-[#eb7825]" />;
      case 'join':
        return <Users className="w-5 h-5 text-[#eb7825]" />;
      case 'success':
        return <Check className="w-5 h-5 text-[#eb7825]" />;
      case 'board_activity':
        if (notification.activityType === 'like') return <Heart className="w-5 h-5 text-[#eb7825] fill-[#eb7825]" />;
        if (notification.activityType === 'rsvp') return <Calendar className="w-5 h-5 text-[#eb7825]" />;
        if (notification.activityType === 'discussion') return <MessageCircle className="w-5 h-5 text-[#eb7825]" />;
        if (notification.activityType === 'lock_in') return <Lock className="w-5 h-5 text-[#eb7825]" />;
        return <Bell className="w-5 h-5 text-[#eb7825]" />;
      case 'discussion_tag':
        return <Tag className="w-5 h-5 text-[#eb7825]" />;
      case 'lock_in':
        return <Lock className="w-5 h-5 text-[#eb7825]" />;
      case 'rsvp':
        return <Calendar className="w-5 h-5 text-[#eb7825]" />;
      default:
        return <Bell className="w-5 h-5 text-[#eb7825]" />;
    }
  };

  const getBackgroundGradient = () => {
    switch (notification.type) {
      case 'success':
        return 'bg-[#eb7825]';
      case 'invite':
      case 'join':
        return 'bg-[#eb7825]';
      default:
        return 'bg-white';
    }
  };

  const getTextColor = () => {
    switch (notification.type) {
      case 'success':
      case 'invite':
      case 'join':
        return 'text-white';
      default:
        return 'text-gray-900';
    }
  };

  const getSecondaryTextColor = () => {
    switch (notification.type) {
      case 'success':
      case 'invite':
      case 'join':
        return 'text-white/90';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div 
      className={`transform transition-all duration-500 ease-out pointer-events-auto ${
        isVisible 
          ? 'translate-x-0 opacity-100 scale-100' 
          : 'translate-x-full opacity-0 scale-95'
      }`}
    >
      <div className={`${getBackgroundGradient()} rounded-2xl border ${
        notification.type === 'success' || notification.type === 'invite' || notification.type === 'join' 
          ? 'border-white/20' 
          : 'border-gray-200'
      } shadow-2xl backdrop-blur-sm p-5 min-w-[340px] relative overflow-hidden`}>
        
        {/* Sparkle decoration for success notifications */}
        {notification.type === 'success' && (
          <div className="absolute top-2 right-2 opacity-30">
            <Sparkles className="w-4 h-4 text-white animate-pulse" />
          </div>
        )}
        
        {/* Subtle gradient overlay for premium feel */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
        
        <div className="flex items-start gap-4 relative">
          <div className={`flex-shrink-0 mt-0.5 p-2 rounded-xl ${
            notification.type === 'success' || notification.type === 'invite' || notification.type === 'join'
              ? 'bg-white/20 backdrop-blur-sm'
              : 'bg-orange-50'
          }`}>
            {getIcon()}
          </div>
          
          <div className="flex-1 min-w-0">
            <h4 className={`font-semibold ${getTextColor()} mb-1.5`}>{notification.title}</h4>
            <p className={`text-sm ${getSecondaryTextColor()} leading-relaxed`}>{notification.message}</p>
            
            {(notification.sessionName || notification.boardName) && (
              <div className={`mt-3 px-3 py-1.5 rounded-xl text-xs font-medium inline-block ${
                notification.type === 'success' || notification.type === 'invite' || notification.type === 'join'
                  ? 'bg-white/20 text-white backdrop-blur-sm'
                  : 'bg-orange-50 text-[#eb7825]'
              }`}>
                "{notification.sessionName || notification.boardName}"
              </div>
            )}

            {notification.actions && notification.actions.length > 0 && (
              <div className="flex gap-2 mt-4">
                {notification.actions.map((action, index) => (
                  <button
                    key={index}
                    onClick={action.action}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 hover:scale-105 ${
                      action.variant === 'primary'
                        ? notification.type === 'success' || notification.type === 'invite' || notification.type === 'join'
                          ? 'bg-white text-[#eb7825] hover:bg-white/90 shadow-lg'
                          : 'bg-[#eb7825] text-white hover:bg-[#d6691f] shadow-lg'
                        : notification.type === 'success' || notification.type === 'invite' || notification.type === 'join'
                          ? 'bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button 
            onClick={handleDismiss}
            className={`flex-shrink-0 p-2 rounded-xl transition-all duration-200 hover:scale-110 ${
              notification.type === 'success' || notification.type === 'invite' || notification.type === 'join'
                ? 'hover:bg-white/20 text-white/80 hover:text-white'
                : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}