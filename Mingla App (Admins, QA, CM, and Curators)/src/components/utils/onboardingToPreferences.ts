import { OnboardingData } from '../onboarding/types';

/**
 * Converts onboarding data to user preferences format
 * This allows seamless transition from onboarding to the home page with filtered experiences
 * PRIMARY FILTER: Only categories are used for strict filtering
 */
export function convertOnboardingToPreferences(onboardingData: OnboardingData) {
  const preferences: any = {
    // PRIMARY FILTER: Categories from vibes - this is the only strict filter
    categories: (onboardingData.vibes || []).map(vibe => vibe.id).filter(Boolean),
    
    // Experience types from intents (stored for reference, not strict filtering)
    experienceTypes: (onboardingData.intents || []).map(intent => intent.title),
    
    // Location data (stored but not used for strict filtering)
    location: onboardingData.location || '',
    locationCoords: onboardingData.locationDetails?.coordinates || null,
    useLocation: 'gps',
    
    // Travel mode (stored but not used for strict filtering)
    travelMode: onboardingData.travelMode || 'walking',
    
    // Travel constraints (stored but not used for strict filtering)
    constraintType: 'time',
    timeConstraint: '',
    distanceConstraint: '',
    
    // Budget (stored but not used for strict filtering)
    budgetMin: '',
    budgetMax: '',
    budgetPreset: '',
    
    // Date and time (stored for display only)
    dateOption: onboardingData.datePreference || 'now',
    selectedDate: onboardingData.customDate || '',
    selectedTimeSlot: onboardingData.timeSlot || '',
    exactTime: onboardingData.exactTime || '',
    
    // Additional fields for compatibility
    timeOfDay: onboardingData.timeSlot || 'Afternoon',
    dayOfWeek: onboardingData.datePreference === 'weekend' ? 'Weekend' : 'Weekday',
    planningTimeframe: onboardingData.datePreference === 'now' ? 'Today' : 'This week',
  };
  
  return preferences;
}

/**
 * Saves onboarding data to localStorage
 */
export function saveOnboardingData(data: OnboardingData) {
  try {
    localStorage.setItem('mingla_onboarding_data', JSON.stringify(data));
    
    // Also save as preferences for immediate use
    const preferences = convertOnboardingToPreferences(data);
    localStorage.setItem('mingla_user_preferences', JSON.stringify(preferences));
    
    return true;
  } catch (error) {
    console.error('Error saving onboarding data:', error);
    return false;
  }
}

/**
 * Loads onboarding data from localStorage
 */
export function loadOnboardingData(): OnboardingData | null {
  try {
    const data = localStorage.getItem('mingla_onboarding_data');
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Error loading onboarding data:', error);
    return null;
  }
}

/**
 * Loads user preferences from localStorage
 */
export function loadUserPreferences(): any | null {
  try {
    const data = localStorage.getItem('mingla_user_preferences');
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Error loading user preferences:', error);
    return null;
  }
}