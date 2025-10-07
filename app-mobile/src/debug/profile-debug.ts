// Debug script to check profile data
import { supabase } from '../services/supabase';

export const debugProfileData = async (userId: string) => {
  try {
    console.log('=== PROFILE DEBUG START ===');
    console.log('Checking profile for user ID:', userId);
    
    // Check if profile exists
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (profileError) {
      console.log('Profile error:', profileError);
      console.log('Error code:', profileError.code);
      console.log('Error message:', profileError.message);
    } else {
      console.log('Profile found:', profile);
      console.log('First name:', profile.first_name);
      console.log('Last name:', profile.last_name);
      console.log('Username:', profile.username);
      console.log('Profile image:', profile.profile_image);
    }
    
    // Check all profiles to see what's in the database
    const { data: allProfiles, error: allProfilesError } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, username, profile_image')
      .limit(10);
      
    if (allProfilesError) {
      console.log('All profiles error:', allProfilesError);
    } else {
      console.log('All profiles in database:', allProfiles);
    }
    
    console.log('=== PROFILE DEBUG END ===');
  } catch (error) {
    console.error('Debug error:', error);
  }
};
