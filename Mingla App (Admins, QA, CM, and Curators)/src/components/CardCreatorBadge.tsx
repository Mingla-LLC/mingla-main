import React from 'react';
import { Sparkles, User, Building2 } from 'lucide-react';

interface CardCreatorBadgeProps {
  createdBy?: string;
  creatorId?: string;
  createdByRole?: string;
  creatorRole?: string;
  createdByName?: string;
  creatorName?: string;
  currentUserId?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'subtle' | 'minimal';
}

// Simplified badge for Explorer/Business-only mode
export function CardCreatorBadge({ 
  createdByRole,
  creatorRole,
  size = 'md',
  variant = 'default'
}: CardCreatorBadgeProps) {
  const role = createdByRole || creatorRole || 'business';
  
  if (variant === 'minimal') return null;
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm'
  };
  
  const bgColor = role === 'business' ? 'bg-green-100' : 'bg-orange-100';
  const textColor = role === 'business' ? 'text-green-700' : 'text-orange-700';
  
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full ${bgColor} ${textColor} ${sizeClasses[size]} backdrop-blur-sm`}>
      {role === 'business' ? (
        <Building2 className="w-3 h-3" />
      ) : (
        <User className="w-3 h-3" />
      )}
      <span className="font-medium capitalize">{role}</span>
    </div>
  );
}
