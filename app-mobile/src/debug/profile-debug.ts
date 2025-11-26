// Debug script to check profile data
import { supabase } from '../services/supabase';

export const debugProfileData = async (userId: string) => {
  try {
    
    // Check if profile exists
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (profileError) {
    } else {
    }
    
    // Check all profiles to see what's in the database
    const { data: allProfiles, error: allProfilesError } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, username, profile_image')
      .limit(10);
      
    if (allProfilesError) {
    } else {
    }
    
  } catch (error) {
    console.error('Debug error:', error);
  }
};
