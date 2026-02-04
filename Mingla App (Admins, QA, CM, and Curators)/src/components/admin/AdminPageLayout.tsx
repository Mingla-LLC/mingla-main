import React from 'react';

interface AdminPageLayoutProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Standardized layout for all admin pages
 * Provides consistent white container, header structure, and spacing
 */
export default function AdminPageLayout({ title, description, actions, children }: AdminPageLayoutProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      {/* Header Section - White container with bottom border */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-[#111827]">{title}</h1>
            {description && (
              <p className="text-[#6B7280] mt-1">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      </div>

      {/* Content Section - Proper spacing inside white container */}
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}
