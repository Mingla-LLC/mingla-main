import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { User } from '../types';

export const useAuthSimple = () => {
  const [loading, setLoading] = useState(true);
  const { user, setAuth, setProfile, clearUserData } = useAppStore();

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        console.log('Initializing auth...');
        
        // Get initial session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting session:', error);
          if (mounted) setLoading(false);
          return;
        }

        console.log('Session check result:', session ? 'Found session' : 'No session');

        if (session?.user) {
          console.log('Setting user from session');
          setAuth(session.user as User);
          
          // Load profile
          try {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single();

            if (profileError) {
              console.error('Error loading profile:', profileError);
            } else if (profile) {
              console.log('Profile loaded successfully');
              setProfile(profile);
            }
          } catch (profileError) {
            console.error('Error loading profile:', profileError);
          }
        } else {
          console.log('No session found');
          setAuth(null);
        }

        if (mounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session ? 'Has session' : 'No session');
        
        if (session?.user) {
          setAuth(session.user as User);
          
          // Load profile
          try {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single();

            if (profileError) {
              console.error('Error loading profile:', profileError);
            } else if (profile) {
              setProfile(profile);
            }
          } catch (profileError) {
            console.error('Error loading profile:', profileError);
          }
        } else {
          setAuth(null);
          clearUserData();
        }
        
        if (mounted) {
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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
