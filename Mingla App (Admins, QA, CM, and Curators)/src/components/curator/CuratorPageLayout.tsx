import React from 'react';

interface CuratorPageLayoutProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Standardized layout for all curator pages
 * Provides consistent white container, header structure, and spacing
 * Fully responsive with optimized mobile padding and layout
 */
export default function CuratorPageLayout({ title, description, actions, children }: CuratorPageLayoutProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header Section - White container with bottom border */}
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-[#111827] break-words">{title}</h1>
            {description && (
              <p className="text-[#6B7280] mt-1 break-words">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
              {actions}
            </div>
          )}
        </div>
      </div>

      {/* Content Section - Proper spacing inside white container with mobile optimization */}
      <div className="p-4 sm:p-6">
        {children}
      </div>
    </div>
  );
}
