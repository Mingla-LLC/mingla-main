import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { User } from '../types';

export const useAuth = () => {
  const [loading, setLoading] = useState(true);
  const { user, setAuth, setProfile, clearUserData } = useAppStore();

  useEffect(() => {
    // Get initial session with timeout
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Session check timeout')), 5000)
    );
    
    Promise.race([sessionPromise, timeoutPromise])
      .then(({ data: { session } }: any) => {
        console.log('Initial session check:', session ? 'Found session' : 'No session');
        if (session?.user) {
          setAuth(session.user as User);
          loadUserProfile(session.user.id);
        } else {
          console.log('No session found, setting loading to false');
          setLoading(false);
        }
      })
      .catch((error) => {
        console.error('Session check failed:', error);
        setLoading(false);
      });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session ? 'Has session' : 'No session');
        if (session?.user) {
          setAuth(session.user as User);
          await loadUserProfile(session.user.id);
        } else {
          setAuth(null);
          clearUserData();
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (userId: string) => {
    try {
      console.log('Loading profile for user:', userId);
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error loading profile:', error);
        return;
      }

      if (profile) {
        console.log('Profile loaded successfully');
        setProfile(profile);
      } else {
        console.log('No profile found for user');
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        // Create user profile
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: data.user.id,
            email: data.user.email,
            display_name: displayName || data.user.email?.split('@')[0],
          });

        if (profileError) {
          console.error('Error creating profile:', profileError);
        }

        return { data, error: null };
      }
    } catch (error: any) {
      return { data: null, error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const updateProfile = async (updates: Partial<User>) => {
    if (!user) return { error: new Error('No user logged in') };

    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setProfile(data);
      }

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

  return {
    user,
    loading,
    signUp,
    signIn,
    signOut,
    updateProfile,
  };
};
