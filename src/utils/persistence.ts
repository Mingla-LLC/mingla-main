import { supabase } from "@/integrations/supabase/client";

const CACHE_KEY = 'mingla:v1';

interface CachedData {
  profiles: any;
  preferences: any;
  saves: any[];
  timestamp: number;
}

export function getCachedData(): CachedData | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    
    const data = JSON.parse(cached);
    const isExpired = Date.now() - data.timestamp > 30 * 60 * 1000; // 30 minutes
    
    if (isExpired) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Error reading cached data:', error);
    return null;
  }
}

export function setCachedData(data: Omit<CachedData, 'timestamp'>) {
  try {
    const cacheData: CachedData = {
      ...data,
      timestamp: Date.now()
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Error caching data:', error);
  }
}

export function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.error('Error clearing cache:', error);  
  }
}

export async function loadUserData(userId: string) {
  try {
    // Try cache first
    const cached = getCachedData();
    if (cached) {
      return cached;
    }

    // Load from database
    const [profileRes, preferencesRes, savesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('preferences').select('*').eq('profile_id', userId).single(),
      supabase.from('saves').select('*, experiences(*)').eq('profile_id', userId)
    ]);

    const userData = {
      profiles: profileRes.data,
      preferences: preferencesRes.data,
      saves: savesRes.data || []
    };

    // Cache the result
    setCachedData(userData);
    
    return userData;
  } catch (error) {
    console.error('Error loading user data:', error);
    return null;
  }
}

export async function saveUserPreferences(userId: string, preferences: any) {
  try {
    const { error } = await supabase
      .from('preferences')
      .upsert({ profile_id: userId, ...preferences });

    if (error) throw error;

    // Update cache
    const cached = getCachedData();
    if (cached) {
      cached.preferences = { profile_id: userId, ...preferences };
      setCachedData(cached);
    }
    
    return true;
  } catch (error) {
    console.error('Error saving preferences:', error);
    return false;
  }
}

export async function saveExperience(userId: string, experienceId: string, status: string = 'liked') {
  try {
    const { error } = await supabase
      .from('saves')
      .upsert({ 
        profile_id: userId, 
        experience_id: experienceId, 
        status,
        scheduled_at: status === 'scheduled' ? new Date().toISOString() : null
      });

    if (error) throw error;

    // Update cache
    const cached = getCachedData();
    if (cached) {
      const existingIndex = cached.saves.findIndex(s => s.experience_id === experienceId);
      const saveData = { profile_id: userId, experience_id: experienceId, status };
      
      if (existingIndex >= 0) {
        cached.saves[existingIndex] = saveData;
      } else {
        cached.saves.push(saveData);
      }
      setCachedData(cached);
    }
    
    return true;
  } catch (error) {
    console.error('Error saving experience:', error);
    return false;
  }
}

export async function removeSavedExperience(userId: string, experienceId: string) {
  try {
    const { error } = await supabase
      .from('saves')
      .delete()
      .eq('profile_id', userId)
      .eq('experience_id', experienceId);

    if (error) throw error;

    // Update cache
    const cached = getCachedData();
    if (cached) {
      cached.saves = cached.saves.filter(s => s.experience_id !== experienceId);
      setCachedData(cached);
    }
    
    return true;
  } catch (error) {
    console.error('Error removing saved experience:', error);
    return false;
  }
}