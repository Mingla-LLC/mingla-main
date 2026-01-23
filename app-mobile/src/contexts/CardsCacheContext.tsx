import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: string;
  lat?: number;
  lng?: number;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  priceRange: string;
  distance: string;
  travelTime: string;
  experienceType: string;
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours: string;
  tags: string[];
  matchScore: number;
  reviewCount: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
}

interface CardsCacheEntry {
  cards: Recommendation[];
  timestamp: number;
  cacheKey: string;
  currentCardIndex: number;
  removedCardIds: string[];
  mode: string;
  location: { lat: number; lng: number };
}

interface CardsCacheContextType {
  getCachedCards: (cacheKey: string) => CardsCacheEntry | null;
  setCachedCards: (
    cacheKey: string,
    cards: Recommendation[],
    currentCardIndex: number,
    removedCardIds: string[],
    mode: string,
    location: { lat: number; lng: number }
  ) => void;
  clearCache: (cacheKey?: string) => void;
  generateCacheKey: (
    mode: string,
    location: { lat: number; lng: number } | null,
    preferences: any,
    refreshKey?: number | string
  ) => string;
  updateCacheEntry: (
    cacheKey: string,
    updates: {
      currentCardIndex?: number;
      removedCardIds?: string[];
    }
  ) => void;
  isCacheLoaded: boolean;
}

const CardsCacheContext = createContext<CardsCacheContextType | undefined>(
  undefined
);

// Cache expiration time: 30 minutes
const CACHE_EXPIRATION_MS = 30 * 60 * 1000;

// Maximum number of cache entries to keep
const MAX_CACHE_ENTRIES = 10;

// AsyncStorage key for persisting cache
const CACHE_STORAGE_KEY = "mingla_cards_cache";

export const CardsCacheProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Use a Map for efficient lookups
  const cacheRef = useRef<Map<string, CardsCacheEntry>>(new Map());
  const [isCacheLoaded, setIsCacheLoaded] = useState(false);

  // Save cache to AsyncStorage
  const saveCacheToStorage = useCallback(
    async (cache?: Map<string, CardsCacheEntry>) => {
      try {
        const cacheToSave = cache || cacheRef.current;
        // Convert Map to plain object for JSON serialization
        const cacheObject: Record<string, CardsCacheEntry> = {};
        cacheToSave.forEach((value, key) => {
          cacheObject[key] = value;
        });
        await AsyncStorage.setItem(
          CACHE_STORAGE_KEY,
          JSON.stringify(cacheObject)
        );
      } catch (error) {
        console.error("Error saving cache to storage:", error);
      }
    },
    []
  );

  // Load cache from AsyncStorage on mount
  useEffect(() => {
    const loadCacheFromStorage = async () => {
      try {
        const stored = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
        if (stored) {
          const parsedCache: Record<string, CardsCacheEntry> =
            JSON.parse(stored);
          const now = Date.now();

          // Filter out expired entries and restore valid ones
          const validCache = new Map<string, CardsCacheEntry>();
          Object.entries(parsedCache).forEach(([key, entry]) => {
            // Check if cache entry has expired
            if (now - entry.timestamp <= CACHE_EXPIRATION_MS) {
              validCache.set(key, entry);
            }
          });

          cacheRef.current = validCache;
          console.log(
            `📦 Loaded ${validCache.size} cache entries from storage`
          );

          // If we removed expired entries, save the cleaned cache
          if (validCache.size < Object.keys(parsedCache).length) {
            await saveCacheToStorage(validCache);
          }
        }
      } catch (error) {
        console.error("Error loading cache from storage:", error);
        // If there's an error, start with empty cache
        cacheRef.current = new Map();
      } finally {
        setIsCacheLoaded(true);
      }
    };

    loadCacheFromStorage();
  }, [saveCacheToStorage]);

  // Generate a cache key based on mode, location, and preferences
  const generateCacheKey = useCallback(
    (
      mode: string,
      location: { lat: number; lng: number } | null,
      preferences: any,
      refreshKey?: number | string
    ): string => {
      if (!location) {
        return `pending-location-${mode}`;
      }

      // Create a hash of relevant preferences
      const prefsHash = preferences
        ? JSON.stringify({
            categories: preferences.categories || [],
            budget_min: preferences.budget_min,
            budget_max: preferences.budget_max,
            people_count: preferences.people_count,
            travel_constraint_type: preferences.travel_constraint_type,
            travel_constraint_value: preferences.travel_constraint_value,
            vibe: preferences.vibe,
            intent: preferences.intent,
            date_option: preferences.date_option,
            time_slot: preferences.time_slot,
          })
        : "no-prefs";

      // Round location to ~1km precision to allow some cache reuse
      const roundedLat = Math.round(location.lat * 100) / 100;
      const roundedLng = Math.round(location.lng * 100) / 100;

      // Include refreshKey in cache key to invalidate when preferences change
      return `${mode}-${roundedLat},${roundedLng}-${prefsHash}-${
        refreshKey || 0
      }`;
    },
    []
  );

  // Get cached cards if they exist and haven't expired
  const getCachedCards = useCallback(
    (cacheKey: string): CardsCacheEntry | null => {
      const entry = cacheRef.current.get(cacheKey);

      if (!entry) {
        return null;
      }







      


      // Check if cache has expired
      const now = Date.now();
      const age = now - entry.timestamp;
      const isExpired = age > CACHE_EXPIRATION_MS;

      if (isExpired) {
        cacheRef.current.delete(cacheKey);
        return null;
      }

      return entry;
    },
    []
  );

  // Set cached cards
  const setCachedCards = useCallback(
    (
      cacheKey: string,
      cards: Recommendation[],
      currentCardIndex: number,
      removedCardIds: string[],
      mode: string,
      location: { lat: number; lng: number }
    ) => {
      // Limit cache size by removing oldest entries
      if (cacheRef.current.size >= MAX_CACHE_ENTRIES) {
        // Find and remove oldest entry
        let oldestKey: string | null = null;
        let oldestTimestamp = Infinity;

        cacheRef.current.forEach((entry, key) => {
          if (entry.timestamp < oldestTimestamp) {
            oldestTimestamp = entry.timestamp;
            oldestKey = key;
          }
        });

        if (oldestKey) {
          cacheRef.current.delete(oldestKey);
        }
      }

      const entry: CardsCacheEntry = {
        cards,
        timestamp: Date.now(),
        cacheKey,
        currentCardIndex,
        removedCardIds,
        mode,
        location,
      };

      cacheRef.current.set(cacheKey, entry);

      // Save to AsyncStorage (async, don't await to avoid blocking)
      saveCacheToStorage();
    },
    [saveCacheToStorage]
  );

  // Update an existing cache entry (e.g., when card index changes)
  const updateCacheEntry = useCallback(
    (
      cacheKey: string,
      updates: {
        currentCardIndex?: number;
        removedCardIds?: string[];
      }
    ) => {
      const entry = cacheRef.current.get(cacheKey);
      if (entry) {
        if (updates.currentCardIndex !== undefined) {
          entry.currentCardIndex = updates.currentCardIndex;
        }
        if (updates.removedCardIds !== undefined) {
          entry.removedCardIds = updates.removedCardIds;
        }
        cacheRef.current.set(cacheKey, entry);

        // Save to AsyncStorage (async, don't await to avoid blocking)
        saveCacheToStorage();
      }
    },
    [saveCacheToStorage]
  );

  // Clear cache - either specific entry or all entries
  const clearCache = useCallback(
    async (cacheKey?: string) => {
      if (cacheKey) {
        cacheRef.current.delete(cacheKey);
      } else {
        cacheRef.current.clear();
      }

      // Save to AsyncStorage (async, don't await to avoid blocking)
      saveCacheToStorage();
    },
    [saveCacheToStorage]
  );

  const value: CardsCacheContextType = useMemo(
    () => ({
      getCachedCards,
      setCachedCards,
      clearCache,
      generateCacheKey,
      updateCacheEntry,
      isCacheLoaded,
    }),
    [
      getCachedCards,
      setCachedCards,
      clearCache,
      generateCacheKey,
      updateCacheEntry,
      isCacheLoaded,
    ]
  );

  return (
    <CardsCacheContext.Provider value={value}>
      {children}
    </CardsCacheContext.Provider>
  );
};

export const useCardsCache = (): CardsCacheContextType => {
  const context = useContext(CardsCacheContext);
  if (context === undefined) {
    throw new Error("useCardsCache must be used within a CardsCacheProvider");
  }
  return context;
};
