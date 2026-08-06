import { useState, useEffect, useCallback, useRef } from "react";
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
 *
 * Issue #1639 — `options.enabled` exists because this hook used to run at the TOP of
 * every holiday section component, ABOVE the `isExpanded` gate. `fetchHolidayCategories`
 * hits `generate-holiday-categories`, an OpenAI `gpt-4o-mini` completion, so a profile
 * page fired ~16 concurrent LLM-backed calls on a cold device (and ~16 AsyncStorage
 * reads on every mount after that) in the exact window the user is staring at empty
 * card slots — while the batched card request itself uses the STATIC `holiday.sections`
 * and never reads a single one of these results. They are consumed only by the shuffle
 * button. Callers now pass `enabled: isExpanded`.
 */
export function useHolidayCategories(
  holidayKey: string | null,
  holidayName: string | null,
  holidayDescription?: string,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true;

  const [sections, setSections] = useState<HolidayCardSection[]>(
    DEFAULT_PERSON_SECTIONS
  );
  const [isLoading, setIsLoading] = useState(false);

  const storageKey = holidayKey ? `${STORAGE_PREFIX}${holidayKey}` : null;

  // Issue #1639: `sections` is read by the SHUFFLE callback, never by render. Mirror
  // it into a ref and expose `resolveSections()` so a tap that lands while the load
  // is still in flight AWAITS it instead of silently shuffling against the defaults —
  // that window is now real, because the load starts on expand rather than on mount.
  const sectionsRef = useRef<HolidayCardSection[]>(DEFAULT_PERSON_SECTIONS);
  const loadRef = useRef<Promise<HolidayCardSection[]> | null>(null);

  // Load from cache or fetch
  useEffect(() => {
    if (!storageKey || !holidayName || !enabled) return;

    let cancelled = false;

    const load = async (): Promise<HolidayCardSection[]> => {
      setIsLoading(true);

      // Check cache first
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const cached: CachedCategories = JSON.parse(raw);
          const age = Date.now() - new Date(cached.generatedAt).getTime();
          if (age < TTL_MS && cached.categories.length === 6) {
            const next = slotsToSections(cached.categories);
            sectionsRef.current = next;
            if (!cancelled) {
              setSections(next);
              setIsLoading(false);
            }
            return next;
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

        if (slots.length === 6) {
          const next = slotsToSections(slots);
          sectionsRef.current = next;
          if (!cancelled) {
            setSections(next);
          }

          // Save to cache
          const toCache: CachedCategories = {
            categories: slots,
            generatedAt: new Date().toISOString(),
          };
          await AsyncStorage.setItem(
            storageKey,
            JSON.stringify(toCache)
          ).catch(() => {});
          return next;
        }
      } catch (err) {
        console.warn("[useHolidayCategories] Fetch failed, using defaults:", err);
        sectionsRef.current = DEFAULT_PERSON_SECTIONS;
        if (!cancelled) {
          setSections(DEFAULT_PERSON_SECTIONS);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }

      return sectionsRef.current;
    };

    const pending = load();
    loadRef.current = pending;
    pending
      .catch(() => DEFAULT_PERSON_SECTIONS)
      .finally(() => {
        if (loadRef.current === pending) loadRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [storageKey, holidayName, holidayDescription, enabled]);

  /**
   * Issue #1639: the sections the shuffle must actually use. Awaits the in-flight
   * category load when there is one — ShuffleButton already renders its spinner +
   * "Finding..." for the whole duration of the `onShuffle` promise, so the wait is
   * an affordance the user already understands, and no tap is ever dropped.
   */
  const resolveSections = useCallback(async (): Promise<HolidayCardSection[]> => {
    const pending = loadRef.current;
    if (pending) {
      try {
        return await pending;
      } catch {
        return sectionsRef.current;
      }
    }
    return sectionsRef.current;
  }, []);

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
        const next = slotsToSections(slots);
        sectionsRef.current = next;
        setSections(next);

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

  return { sections, isLoading, invalidate, resolveSections };
}
