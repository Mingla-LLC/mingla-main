import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fetchHolidayCategories,
  slotsToSections,
  type CategorySlot,
} from "../services/holidayCategoryService";
import { DEFAULT_PERSON_SECTIONS } from "../constants/holidays";
import type { HolidayCardSection } from "../types/holidayTypes";

const STORAGE_PREFIX = "mingla_holiday_categories_v1_";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CachedCategories {
  categories: CategorySlot[];
  generatedAt: string;
}

/**
 * Returns AI-generated holiday card sections with AsyncStorage caching.
 * Falls back to DEFAULT_PERSON_SECTIONS on failure.
 */
export function useHolidayCategories(
  holidayKey: string | null,
  holidayName: string | null,
  holidayDescription?: string
) {
  const [sections, setSections] = useState<HolidayCardSection[]>(
    DEFAULT_PERSON_SECTIONS
  );
  const [isLoading, setIsLoading] = useState(false);

  const storageKey = holidayKey ? `${STORAGE_PREFIX}${holidayKey}` : null;

  // Load from cache or fetch
  useEffect(() => {
    if (!storageKey || !holidayName) return;

    let cancelled = false;

    (async () => {
      setIsLoading(true);

      // Check cache first
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const cached: CachedCategories = JSON.parse(raw);
          const age = Date.now() - new Date(cached.generatedAt).getTime();
          if (age < TTL_MS && cached.categories.length === 6) {
            if (!cancelled) {
              setSections(slotsToSections(cached.categories));
              setIsLoading(false);
            }
            return;
          }
        }
      } catch {
        // Cache miss or invalid — proceed to fetch
      }

      // Fetch from edge function
      try {
        const slots = await fetchHolidayCategories(
          holidayName,
          holidayDescription
        );

        if (!cancelled && slots.length === 6) {
          setSections(slotsToSections(slots));

          // Save to cache
          const toCache: CachedCategories = {
            categories: slots,
            generatedAt: new Date().toISOString(),
          };
          await AsyncStorage.setItem(
            storageKey,
            JSON.stringify(toCache)
          ).catch(() => {});
        }
      } catch (err) {
        console.warn("[useHolidayCategories] Fetch failed, using defaults:", err);
        if (!cancelled) {
          setSections(DEFAULT_PERSON_SECTIONS);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey, holidayName, holidayDescription]);

  // Invalidate cache (for shuffle)
  const invalidate = useCallback(async () => {
    if (!storageKey || !holidayName) return;

    setIsLoading(true);

    // Clear cache
    await AsyncStorage.removeItem(storageKey).catch(() => {});

    // Re-fetch
    try {
      const slots = await fetchHolidayCategories(
        holidayName,
        holidayDescription
      );

      if (slots.length === 6) {
        setSections(slotsToSections(slots));

        const toCache: CachedCategories = {
          categories: slots,
          generatedAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(
          storageKey,
          JSON.stringify(toCache)
        ).catch(() => {});
      }
    } catch (err) {
      console.warn("[useHolidayCategories] Re-fetch failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [storageKey, holidayName, holidayDescription]);

  return { sections, isLoading, invalidate };
}
