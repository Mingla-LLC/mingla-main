/**
 * Navigation Component
 * Bottom navigation bar for main app screens
 */

import React from 'react';
import { Home, Users, Heart, User, MessageCircle } from 'lucide-react';
import { RouteNames } from './routes';

interface NavigationProps {
  currentPage: RouteNames;
  onNavigate: (page: RouteNames) => void;
}

export default function Navigation({ currentPage, onNavigate }: NavigationProps) {
  const navItems = [
    { id: 'home' as RouteNames, label: 'Home', Icon: Home },
    { id: 'connections' as RouteNames, label: 'Connections', Icon: Users },
    { id: 'messages' as RouteNames, label: 'Messages', Icon: MessageCircle },
    { id: 'activity' as RouteNames, label: 'Likes', Icon: Heart },
    { id: 'profile' as RouteNames, label: 'Profile', Icon: User },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 glass-nav shadow-lg px-4 py-2 z-50">
      <div className="flex items-center justify-around">
        {navItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className="flex flex-col items-center gap-1 py-2 px-4 transition-smooth hover:scale-110 active:scale-95"
            data-coachmark={id === 'connections' ? 'nav-connections' : id === 'activity' ? 'nav-activity' : undefined}
          >
            <Icon
              className={`w-6 h-6 transition-transform duration-300 ${
                currentPage === id ? 'text-[#eb7825] scale-110' : 'text-gray-400'
              }`}
            />
            <span
              className={`text-xs ${
                currentPage === id
                  ? 'text-[#eb7825] font-medium'
                  : 'text-gray-400'
              }`}
            >
              {label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}