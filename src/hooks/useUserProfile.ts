import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  currency: string;
  measurement_system: string;
  first_name?: string;
  last_name?: string;
  username: string;
  share_location?: boolean;
  share_budget?: boolean;
  share_categories?: boolean;
  share_date_time?: boolean;
}

export const useUserProfile = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Get initial user
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) {
        fetchProfile(user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching profile:', error);
        setProfile(null);
      } else if (data) {
        setProfile(data);
      } else {
        // No profile exists, create default
        const defaultProfile = {
          id: userId,
          username: user?.email?.split('@')[0] || `user_${userId.slice(0, 8)}`,
          currency: 'USD',
          measurement_system: 'metric',
          share_location: true,
          share_budget: false,
          share_categories: true,
          share_date_time: true
        };
        
        // Try to create the profile in the database
        try {
          const { error: insertError } = await supabase
            .from('profiles')
            .insert(defaultProfile);
            
          if (!insertError) {
            setProfile(defaultProfile);
          } else {
            console.error('Error creating default profile:', insertError);
            setProfile(defaultProfile); // Still set for display
          }
        } catch (insertError) {
          console.error('Error creating default profile:', insertError);
          setProfile(defaultProfile); // Still set for display
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = () => {
    if (user) {
      setLoading(true);
      fetchProfile(user.id);
    }
  };

  return {
    profile,
    user,
    loading,
    refreshProfile
  };
};