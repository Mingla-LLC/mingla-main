import React from 'react';
import { BottomNavigation } from './BottomNavigation';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="min-h-screen bg-background">
      <main className="pb-20 max-w-md mx-auto">
        {children}
      </main>
      <BottomNavigation />
    </div>
  );
};