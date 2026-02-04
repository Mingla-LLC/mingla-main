import React from 'react';

interface BusinessPageLayoutProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Standardized layout for all business pages
 * Modern iOS-style glass morphism with efficient spacing
 */
export default function BusinessPageLayout({ title, description, actions, children }: BusinessPageLayoutProps) {
  return (
    <div className="h-full bg-white/70 backdrop-blur-xl rounded-2xl sm:rounded-3xl shadow-lg border border-white/50 overflow-hidden flex flex-col">
      {/* Header Section - Modern glass effect with minimal padding */}
      <div className="px-3 py-3 border-b border-gray-100/50 bg-gradient-to-b from-white/50 to-transparent flex-shrink-0">
        <div className="flex flex-col gap-3">
          {actions && (
            <div className="w-full">
              {actions}
            </div>
          )}
        </div>
      </div>

      {/* Content Section - Efficient spacing with modern design */}
      <div className="flex-1 overflow-y-auto p-3 pb-24">
        {children}
      </div>
    </div>
  );
}