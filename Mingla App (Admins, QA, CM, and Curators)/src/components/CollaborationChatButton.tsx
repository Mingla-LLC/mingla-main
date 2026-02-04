import React from 'react';
import { MessageCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

interface CollaborationChatButtonProps {
  onClick: () => void;
  unreadCount?: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'icon' | 'full';
  className?: string;
}

export default function CollaborationChatButton({
  onClick,
  unreadCount = 0,
  size = 'md',
  variant = 'full',
  className = ''
}: CollaborationChatButtonProps) {
  const sizeClasses = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4',
    lg: 'h-12 px-6'
  };

  const iconSizes = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6'
  };

  if (variant === 'icon') {
    return (
      <Button
        variant="outline"
        size="icon"
        onClick={onClick}
        className={`relative border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white ${className}`}
        title="Open collaboration chat"
      >
        <MessageCircle className={iconSizes[size]} />
        {unreadCount > 0 && (
          <Badge
            className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-red-500 text-white text-xs border-2 border-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </Badge>
        )}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={onClick}
      className={`relative border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white ${sizeClasses[size]} ${className}`}
    >
      <MessageCircle className={`${iconSizes[size]} mr-2`} />
      Chat
      {unreadCount > 0 && (
        <Badge
          className="ml-2 h-5 px-2 bg-red-500 text-white text-xs"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </Badge>
      )}
    </Button>
  );
}
