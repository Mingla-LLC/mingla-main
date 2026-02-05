import React from 'react';
import { Users, MessageSquare } from 'lucide-react';
import { TabType } from './types';
import { motion } from 'motion/react';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  unreadCount?: number;
}

export default function TabNavigation({ activeTab, onTabChange, unreadCount = 0 }: TabNavigationProps) {
  return (
    <div className="sticky top-0 z-20 glass-nav shadow-sm">
      <div className="flex items-center" data-coachmark="connections-tabs">
        <button
          onClick={() => onTabChange('friends')}
          data-coachmark="friends-tab"
          className={`flex-1 py-4 px-4 text-center font-medium transition-smooth relative ${
            activeTab === 'friends'
              ? 'text-[#eb7825]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Users className="w-5 h-5 mx-auto mb-1 transition-transform duration-300 hover:scale-110" />
          <span className="text-sm">Friends</span>
          {activeTab === 'friends' && (
            <motion.div
              layoutId="activeTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#eb7825]"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </button>

        <button
          onClick={() => onTabChange('messages')}
          data-coachmark="messages-tab"
          className={`flex-1 py-4 px-4 text-center font-medium transition-smooth relative ${
            activeTab === 'messages'
              ? 'text-[#eb7825]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <MessageSquare className="w-5 h-5 mx-auto mb-1 transition-transform duration-300 hover:scale-110" />
          <span className="text-sm">Messages</span>
          {unreadCount > 0 && (
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute top-2 right-1/4 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center shadow-lg"
            >
              {unreadCount}
            </motion.div>
          )}
          {activeTab === 'messages' && (
            <motion.div
              layoutId="activeTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#eb7825]"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </button>
      </div>
    </div>
  );
}