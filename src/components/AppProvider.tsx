import React, { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';

interface AppProviderProps {
  children: React.ReactNode;
}

export const AppProvider = ({ children }: AppProviderProps) => {
  const { setAuth } = useAppStore();

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session?.user?.email);
        
        // Only synchronous state updates here to prevent deadlocks
        setAuth(session?.user ?? null, session);
        
        // Handle auth events
        if (event === 'SIGNED_OUT') {
          // Clear all user data on sign out
          const { clearUserData, clearRealtimeChannels } = useAppStore.getState();
          clearRealtimeChannels();
          clearUserData();
        }
      }
    );

    // Check for existing session on app start
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuth(session?.user ?? null, session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setAuth]);

  return <>{children}</>;
};