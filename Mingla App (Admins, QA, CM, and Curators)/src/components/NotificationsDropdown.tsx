import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, UserPlus, MessageCircle, Heart, Users, Calendar, Bell } from 'lucide-react';

interface Notification {
  id: string;
  type: 'friend_request' | 'mention' | 'like' | 'comment' | 'invite' | 'system';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  avatar?: string;
}

interface NotificationsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}

// Mock notifications data
const mockNotifications: Notification[] = [
  {
    id: '1',
    type: 'friend_request',
    title: 'New Friend Request',
    message: 'Sarah Chen wants to connect with you',
    timestamp: '2m ago',
    read: false,
  },
  {
    id: '2',
    type: 'mention',
    title: 'Mentioned in Discussion',
    message: 'Alex mentioned you in "Tokyo Food Tour" discussion',
    timestamp: '15m ago',
    read: false,
  },
  {
    id: '3',
    type: 'invite',
    title: 'Board Invitation',
    message: 'Maria invited you to collaborate on "Paris Adventure"',
    timestamp: '1h ago',
    read: false,
  },
  {
    id: '4',
    type: 'like',
    title: 'Card Liked',
    message: 'John liked your saved experience "Sunset Kayaking"',
    timestamp: '2h ago',
    read: true,
  },
  {
    id: '5',
    type: 'comment',
    title: 'New Comment',
    message: 'Emma commented on your board "Weekend Getaway"',
    timestamp: '3h ago',
    read: true,
  },
  {
    id: '6',
    type: 'system',
    title: 'New Features',
    message: 'Check out the new AI-powered itinerary suggestions!',
    timestamp: '1d ago',
    read: true,
  },
];

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case 'friend_request':
      return <UserPlus className="w-4 h-4 text-[#eb7825]" />;
    case 'mention':
      return <MessageCircle className="w-4 h-4 text-blue-500" />;
    case 'like':
      return <Heart className="w-4 h-4 text-red-500" />;
    case 'invite':
      return <Users className="w-4 h-4 text-purple-500" />;
    case 'comment':
      return <MessageCircle className="w-4 h-4 text-green-500" />;
    case 'system':
      return <Bell className="w-4 h-4 text-gray-500" />;
  }
};

export default function NotificationsDropdown({ isOpen, onClose, buttonRef }: NotificationsDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const unreadCount = mockNotifications.filter(n => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, buttonRef]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[9998]"
            onClick={onClose}
          />
          
          {/* Dropdown */}
          <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed top-[4.5rem] right-3 sm:right-6 w-80 sm:w-96 max-h-[32rem] overflow-hidden glass-morphism rounded-2xl shadow-2xl border border-gray-200/50 z-[9999]"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200/50 flex items-center justify-between bg-white/80 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-[#eb7825] text-white rounded-full">
                    {unreadCount}
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Notifications List */}
            <div className="overflow-y-auto max-h-[28rem]" style={{ scrollbarWidth: 'thin' }}>
              {mockNotifications.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <Bell className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200/50">
                  {mockNotifications.map((notification) => (
                    <motion.div
                      key={notification.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`px-4 py-3 hover:bg-gray-100 transition-colors cursor-pointer ${
                        !notification.read ? 'bg-orange-50' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-gray-900 leading-tight">
                              {notification.title}
                            </p>
                            {!notification.read && (
                              <div className="w-2 h-2 rounded-full bg-[#eb7825] flex-shrink-0 mt-1" />
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-0.5 leading-snug">
                            {notification.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {notification.timestamp}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {mockNotifications.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-200/50 bg-white/80 backdrop-blur-xl">
                <button className="w-full text-center text-sm text-[#eb7825] font-medium hover:text-[#d6691f] transition-colors py-1">
                  Mark all as read
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}