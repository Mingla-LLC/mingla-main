import React from 'react';
import { Calendar, Heart } from 'lucide-react';
import { ActivityHeaderProps } from './types';
import { motion } from 'motion/react';
import { useCoachMarkRef } from '../CoachMark/CoachMarkProvider';

export default function ActivityHeader({ activeTab, onTabChange }: ActivityHeaderProps) {
  const savedTabRef = useCoachMarkRef('saved-tab');
  const calendarTabRef = useCoachMarkRef('calendar-tab');
  
  return (
    <div className="sticky top-0 z-20 glass-nav shadow-sm">
      <div className="flex items-center" data-coachmark="activity-tabs">
        <button
          ref={savedTabRef}
          data-coachmark="saved-tab"
          onClick={() => onTabChange('saved')}
          className={`flex-1 py-4 px-4 text-center font-medium transition-smooth relative ${
            activeTab === 'saved'
              ? 'text-[#eb7825]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Heart className="w-5 h-5 mx-auto mb-1 transition-transform duration-300 hover:scale-110" />
          <span className="text-sm">Saved</span>
          {activeTab === 'saved' && (
            <motion.div
              layoutId="activityTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#eb7825]"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </button>
        <button
          ref={calendarTabRef}
          data-coachmark="calendar-tab"
          onClick={() => onTabChange('calendar')}
          className={`flex-1 py-4 px-4 text-center font-medium transition-smooth relative ${
            activeTab === 'calendar'
              ? 'text-[#eb7825]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Calendar className="w-5 h-5 mx-auto mb-1 transition-transform duration-300 hover:scale-110" />
          <span className="text-sm">Calendar</span>
          {activeTab === 'calendar' && (
            <motion.div
              layoutId="activityTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#eb7825]"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </button>
      </div>
    </div>
  );
}