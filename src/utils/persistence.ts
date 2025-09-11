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

// Simplified functions for now - will be enhanced once types are updated
export async function loadUserData(userId: string) {
  try {
    const cached = getCachedData();
    if (cached) {
      return cached;
    }

    return {
      profiles: null,
      preferences: null,
      saves: []
    };
  } catch (error) {
    console.error('Error loading user data:', error);
    return null;
  }
}

export async function saveUserPreferences(userId: string, preferences: any) {
  try {
    console.log('Preferences will be saved when database types are updated:', preferences);
    return true;
  } catch (error) {
    console.error('Error saving preferences:', error);
    return false;
  }
}

export async function saveExperience(userId: string, experienceId: string, status: string = 'liked') {
  try {
    console.log('Experience will be saved when database types are updated:', { userId, experienceId, status });
    return true;
  } catch (error) {
    console.error('Error saving experience:', error);
    return false;
  }
}

export async function removeSavedExperience(userId: string, experienceId: string) {
  try {
    console.log('Experience will be removed when database types are updated:', { userId, experienceId });
    return true;
  } catch (error) {
    console.error('Error removing saved experience:', error);
    return false;
  }
}