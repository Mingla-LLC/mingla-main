import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { User } from '../types';

export const useAuthSimple = () => {
  const [loading, setLoading] = useState(true);
  const { user, setAuth, setProfile, clearUserData } = useAppStore();
  
  // Add timeout to prevent infinite loading
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('useAuthSimple timeout - forcing loading to false');
      setLoading(false);
    }, 8000); // 8 second timeout
    
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        console.log('Initializing auth...');
        
        // Get initial session
        const { data: { session }, error } = await supabase.auth.getSession();
        console.log('Session result:', { session: !!session, error });
        
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
              console.error('Profile error details:', {
                code: profileError.code,
                message: profileError.message,
                details: profileError.details,
                hint: profileError.hint
              });
              
              // Debug: Check what's in the database
              try {
                const { debugProfileData } = await import('../debug/profile-debug');
                await debugProfileData(session.user.id);
              } catch (debugError) {
                console.error('Debug error:', debugError);
              }
              
              // If profile doesn't exist, create one
              if (profileError.code === 'PGRST116') {
                console.log('Profile not found, creating new profile...');
                try {
                  const emailName = session.user.email?.split('@')[0] || 'User';
                  const { data: newProfile, error: createError } = await supabase
                    .from('profiles')
                    .insert({
                      id: session.user.id,
                      email: session.user.email,
                      display_name: emailName,
                      first_name: emailName,
                      last_name: '',
                      username: emailName,
                      profile_image: null,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString()
                    })
                    .select()
                    .single();
                    
                  if (createError) {
                    console.error('Error creating profile:', createError);
                  } else {
                    console.log('Profile created successfully:', newProfile);
                    setProfile(newProfile);
                  }
                } catch (createError) {
                  console.error('Error creating profile:', createError);
                }
              }
            } else if (profile) {
              console.log('Profile loaded successfully:', profile);
              console.log('Profile fields:', {
                first_name: profile.first_name,
                last_name: profile.last_name,
                username: profile.username,
                profile_image: profile.profile_image
              });
              setProfile(profile);
            } else {
              console.log('No profile found for user:', session.user.id);
            }
          } catch (profileError) {
            console.error('Error loading profile:', profileError);
          }
        } else {
          console.log('No session found');
          setAuth(null);
        }

        if (mounted) {
          console.log('Setting loading to false - auth initialized');
          setLoading(false);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (mounted) {
          console.log('Setting loading to false - auth error');
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
          console.log('Setting loading to false - auth state change');
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
