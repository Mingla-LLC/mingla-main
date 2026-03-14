import { useQuery } from "@tanstack/react-query";
import {
  savedCardsService,
  SavedCardModel,
} from "../services/savedCardsService";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Safe AsyncStorage operations
const safeAsyncStorageGet = async (key: string, defaultValue: any) => {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (error) {
    console.error(`Error loading ${key}:`, error);
    return defaultValue;
  }
};

const safeAsyncStorageSet = async (key: string, value: any) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error saving ${key}:`, error);
  }
};

const fetchSavedCards = async (
  userId: string | undefined
): Promise<SavedCardModel[]> => {
  if (!userId) {
    // Clear AsyncStorage when no user (don't await - do in background)
    /*     safeAsyncStorageSet("mingla_saved_cards", []).catch(() => {}); */
    return [];
  }

  try {
    // Fetch fresh data from Supabase immediately - don't block on cache read
    // React Query's placeholderData and cache will handle showing cached data
    const cards = await savedCardsService.fetchSavedCards(userId);

    // Update AsyncStorage with fresh data in the background (don't await)
    /*     safeAsyncStorageSet("mingla_saved_cards", cards).catch(() => {}); */

    return cards;
  } catch (error) {
    console.error("Error fetching saved cards:", error);
    return [];
    // Only fallback to cache if fetch fails (non-blocking)
  }
};

export const useSavedCards = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["savedCards", userId],
    queryFn: async () => await fetchSavedCards(userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
