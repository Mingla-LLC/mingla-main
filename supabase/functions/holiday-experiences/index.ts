import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { batchSearchPlaces } from '../_shared/placesCache.ts';
import { serveCardsFromPipeline, upsertPlaceToPool, insertCardToPool, recordImpressions } from '../_shared/cardPoolService.ts';
import { resolveCategories } from '../_shared/categoryPlaceTypes.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Experience categories available in Mingla (v2)
const DISCOVER_CATEGORIES = [
  "Nature",
  "First Meet",
  "Picnic",
  "Drink",
  "Casual Eats",
  "Fine Dining",
  "Watch",
  "Creative & Arts",
  "Play",
  "Wellness",
] as const;

// Map categories to Google Places types (validated for Google Places API New)
const CATEGORY_TO_PLACE_TYPES: { [key: string]: string[] } = {
  "Nature": [
    "national_park", "state_park", "nature_preserve", "wildlife_refuge",
    "wildlife_park", "scenic_spot", "garden", "botanical_garden",
    "park", "lake", "river", "island", "mountain_peak",
    "woods", "hiking_area", "campground", "picnic_ground",
  ],
  "First Meet": ["cafe", "coffee_shop", "bar"],
  "Picnic": ["park", "beach", "marina"],
  "Drink": ["bar", "cafe", "wine_bar"],
  "Casual Eats": ["restaurant", "cafe", "fast_food_restaurant"],
  "Fine Dining": ["fine_dining_restaurant"],
  "Watch": ["movie_theater", "performing_arts_theater"],
  "Creative & Arts": ["art_gallery", "museum"],
  "Play": ["bowling_alley", "amusement_park"],
  "Wellness": ["spa", "massage", "sauna", "resort_hotel", "public_bath"],
};

// Excluded place types
const EXCLUDED_TYPES = new Set([
  "gas_station",
  "atm",
  "bank",
  "hospital",
  "pharmacy",
  "dentist",
  "doctor",
  "funeral_home",
  "cemetery",
  "car_repair",
  "car_wash",
  "car_dealer",
  "convenience_store",
  "supermarket",
  "grocery_store",
  "laundry",
  "locksmith",
  "post_office",
  "storage",
  "moving_company",
  "insurance_agency",
  "real_estate_agency",
  "travel_agency",
  "gym",
  "fitness_center",
]);

// Hardcoded holidays with categories, descriptions, and gender targeting
interface HolidayDefinition {
  date: string; // MM-DD format
  name: string;
  description: string;
  categories: string[];
  gender: "male" | "female" | null;
}

const HOLIDAYS: HolidayDefinition[] = [
  { date: "01-01", name: "New Year's Day", description: 'The "Fresh Start" date', categories: ["Wellness", "Fine Dining"], gender: null },
  { date: "02-14", name: "Valentine's Day", description: "The biggest high-pressure day", categories: ["Fine Dining", "Drink"], gender: null },
  { date: "03-08", name: "International Women's Day", description: "Celebrate the women in your life", categories: ["Fine Dining", "Wellness"], gender: "female" },
  { date: "03-20", name: "First Day of Spring", description: "Great for nature dates", categories: ["Nature", "Picnic"], gender: null },
  { date: "04-20", name: "Easter", description: "Spring celebration", categories: ["Casual Eats", "Fine Dining"], gender: null },
  { date: "05-11", name: "Mother's Day", description: "Crucial if they have kids or to remind about partner's mom", categories: ["Fine Dining", "Wellness"], gender: "female" },
  { date: "05-26", name: "Memorial Day", description: "Honor and remember", categories: ["Picnic", "Nature"], gender: null },
  { date: "06-15", name: "Father's Day", description: "Honor the father figures in your life", categories: ["Play", "Fine Dining"], gender: "male" },
  { date: "06-19", name: "Juneteenth / Start of Summer", description: "Summer celebration", categories: ["Nature", "Picnic"], gender: null },
  { date: "07-04", name: "Independence Day", description: 'The "Big Night Out"', categories: ["Nature", "Picnic"], gender: null },
  { date: "09-01", name: "Labor Day", description: "End of summer celebration", categories: ["Picnic", "Casual Eats"], gender: null },
  { date: "09-21", name: "International Day of Peace", description: 'A "Relationship Reset" day', categories: ["Picnic", "Wellness"], gender: null },
  { date: "10-17", name: "Sweetest Day", description: 'A popular "second Valentine\'s"', categories: ["Drink", "Fine Dining"], gender: null },
  { date: "10-31", name: "Halloween", description: "Perfect for a spooky movie night or costumes", categories: ["Watch", "Creative & Arts"], gender: null },
  { date: "11-19", name: "International Men's Day", description: "Celebrate the men in your life", categories: ["Play", "Fine Dining"], gender: "male" },
  { date: "11-27", name: "Thanksgiving", description: 'Focus on "Gratitude"', categories: ["Fine Dining", "Casual Eats"], gender: null },
  { date: "12-24", name: "Christmas Eve", description: "High gift-giving expectation", categories: ["Creative & Arts", "Fine Dining"], gender: null },
  { date: "12-25", name: "Christmas Day", description: "Holiday celebration", categories: ["Nature", "Fine Dining"], gender: null },
  { date: "12-31", name: "New Year's Eve", description: 'The "Big Night Out"', categories: ["Fine Dining", "Drink"], gender: null },
];

interface HolidayExperienceRequest {
  location: { lat: number; lng: number };
  radius?: number;
  gender?: "male" | "female" | null; // Filter holidays by gender
  days?: number; // Number of days to look ahead (default 365)
  customHolidays?: Array<{
    id: string;
    name: string;
    description: string;
    date: string; // ISO date string
    category: string;
  }>; // Custom holidays to also fetch experiences for
}

interface ExperienceCard {
  id: string;
  name: string;
  category: string;
  location: { lat: number; lng: number };
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string | null;
  images: string[];
  placeId: string;
  priceLevel: number;
  openingHours?: {
    open_now?: boolean;
    weekday_text?: string[];
  } | null;
}

interface HolidayWithExperiences {
  id: string;
  name: string;
  description: string;
  date: string; // ISO date string
  daysAway: number;
  primaryCategory: string;
  categories: string[];
  gender: "male" | "female" | null;
  experiences: ExperienceCard[];
  isCustom?: boolean; // true if this is a custom holiday
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let request: HolidayExperienceRequest;
    try {
      request = await req.json();
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError);
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          holidays: [],
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    const { location, radius = 10000, gender = null, days = 365, customHolidays = [] } = request;

    if (!location || !location.lat || !location.lng) {
      return new Response(
        JSON.stringify({
          error: "Location is required",
          holidays: [],
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Fetching holiday experiences for location: ${location.lat}, ${location.lng}, gender: ${gender}, days: ${days}`);

    // Get holidays within the next N days
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const upcomingHolidays: Array<{
      definition: HolidayDefinition;
      date: Date;
      daysAway: number;
    }> = [];

    for (const holiday of HOLIDAYS) {
      // Skip if gender-specific and doesn't match
      if (holiday.gender !== null && holiday.gender !== gender) {
        continue;
      }

      // Parse MM-DD and create date for current year
      const [month, day] = holiday.date.split("-").map(Number);
      let holidayDate = new Date(today.getFullYear(), month - 1, day);

      // If the holiday has already passed this year, use next year's date
      if (holidayDate < today) {
        holidayDate = new Date(today.getFullYear() + 1, month - 1, day);
      }

      const daysAway = Math.ceil((holidayDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Only include if within the specified days
      if (daysAway <= days) {
        upcomingHolidays.push({
          definition: holiday,
          date: holidayDate,
          daysAway,
        });
      }
    }

    // Sort by date
    upcomingHolidays.sort((a, b) => a.daysAway - b.daysAway);

    console.log(`Found ${upcomingHolidays.length} upcoming holidays within ${days} days`);

    // If no Google API key, return holidays without experiences
    if (!GOOGLE_API_KEY) {
      console.warn("No GOOGLE_API_KEY - returning holidays without experiences");
      const holidaysWithoutExperiences = upcomingHolidays.map((holiday) => ({
        id: `holiday-${holiday.definition.date}-${holiday.definition.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: holiday.definition.name,
        description: holiday.definition.description,
        date: holiday.date.toISOString(),
        daysAway: holiday.daysAway,
        primaryCategory: holiday.definition.categories[0],
        categories: holiday.definition.categories,
        gender: holiday.definition.gender,
        experiences: [],
      }));

      // Also include custom holidays without experiences
      const customHolidaysWithoutExperiences = (customHolidays || []).map((h) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let customDate: Date;
        if (/^\d{2}-\d{2}$/.test(h.date)) {
          const [month, day] = h.date.split("-").map(Number);
          customDate = new Date(today.getFullYear(), month - 1, day);
          if (customDate < today) {
            customDate.setFullYear(customDate.getFullYear() + 1);
          }
        } else {
          const legacyDate = new Date(h.date);
          customDate = new Date(today.getFullYear(), legacyDate.getMonth(), legacyDate.getDate());
          if (customDate < today) {
            customDate.setFullYear(customDate.getFullYear() + 1);
          }
        }
        customDate.setHours(0, 0, 0, 0);
        const daysAway = Math.ceil((customDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        return {
          id: h.id,
          name: h.name,
          description: h.description,
          date: customDate.toISOString(),
          daysAway,
          primaryCategory: h.category,
          categories: [h.category],
          gender: null,
          experiences: [],
          isCustom: true,
        };
      });

      return new Response(
        JSON.stringify({
          holidays: holidaysWithoutExperiences,
          customHolidays: customHolidaysWithoutExperiences,
          meta: {
            totalHolidays: holidaysWithoutExperiences.length,
            totalCustomHolidays: customHolidaysWithoutExperiences.length,
            daysAhead: days,
            gender,
            warning: "Google API key not configured - experiences not loaded",
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch experiences for ALL holidays sequentially with global deduplication
    // This ensures no experience appears in multiple holiday dropdowns
    const globalUsedPlaceIds = new Set<string>();
    const MIN_EXPERIENCES_PER_HOLIDAY = 2;
    const MAX_EXPERIENCES_PER_HOLIDAY = 3;

    // ── Pool-first pipeline: try to serve from card_pool before hitting Google ──
    const allHolidayCategories = [...new Set(upcomingHolidays.flatMap(h => h.definition.categories))];
    const poolAdminClient = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    if (poolAdminClient && GOOGLE_API_KEY && allHolidayCategories.length > 0) {
      try {
        const totalNeeded = upcomingHolidays.length * MAX_EXPERIENCES_PER_HOLIDAY;
        const poolResult = await serveCardsFromPipeline(
          {
            supabaseAdmin: poolAdminClient,
            userId: 'anonymous',
            lat: location.lat,
            lng: location.lng,
            radiusMeters: radius,
            categories: allHolidayCategories,
            budgetMin: 0,
            budgetMax: 500,
            limit: totalNeeded + 20, // extra buffer
            cardType: 'single',
          },
          GOOGLE_API_KEY,
        );

        // Check if pool has enough cards per holiday (>= 10 per holiday in the pool)
        const poolCardsPerHoliday = upcomingHolidays.length > 0
          ? Math.floor(poolResult.totalPoolSize / upcomingHolidays.length)
          : 0;

        if (poolCardsPerHoliday >= 10 && poolResult.cards.length >= totalNeeded) {
          console.log(`[pool-first] Serving holiday experiences from pool (${poolResult.fromPool} pool, ${poolResult.fromApi} API, ${poolCardsPerHoliday} per holiday)`);

          // Distribute pool cards across holidays
          let poolCardIndex = 0;
          const poolHolidaysWithExperiences: HolidayWithExperiences[] = [];

          for (const holiday of upcomingHolidays) {
            const experiences: ExperienceCard[] = [];
            for (let i = 0; i < MAX_EXPERIENCES_PER_HOLIDAY && poolCardIndex < poolResult.cards.length; i++) {
              const poolCard = poolResult.cards[poolCardIndex++];
              experiences.push({
                id: poolCard.placeId || poolCard.id,
                name: poolCard.title,
                category: poolCard.category,
                location: { lat: poolCard.lat, lng: poolCard.lng },
                address: poolCard.address || '',
                rating: poolCard.rating || 0,
                reviewCount: poolCard.reviewCount || 0,
                imageUrl: poolCard.image || null,
                images: poolCard.images || [],
                placeId: poolCard.placeId || poolCard.id,
                priceLevel: 0,
                openingHours: poolCard.openingHours || null,
                website: poolCard.website || null,
              });
            }

            poolHolidaysWithExperiences.push({
              id: `holiday-${holiday.definition.date}-${holiday.definition.name.replace(/\s+/g, "-").toLowerCase()}`,
              name: holiday.definition.name,
              description: holiday.definition.description,
              date: holiday.date.toISOString(),
              daysAway: holiday.daysAway,
              primaryCategory: holiday.definition.categories[0],
              categories: holiday.definition.categories,
              gender: holiday.definition.gender,
              experiences,
            });
          }

          // Also handle custom holidays from pool
          let poolCustomHolidays: HolidayWithExperiences[] = [];
          if (customHolidays && customHolidays.length > 0) {
            for (const customHoliday of customHolidays) {
              const experiences: ExperienceCard[] = [];
              for (let i = 0; i < MAX_EXPERIENCES_PER_HOLIDAY && poolCardIndex < poolResult.cards.length; i++) {
                const poolCard = poolResult.cards[poolCardIndex++];
                experiences.push({
                  id: poolCard.placeId || poolCard.id,
                  name: poolCard.title,
                  category: poolCard.category,
                  location: { lat: poolCard.lat, lng: poolCard.lng },
                  address: poolCard.address || '',
                  rating: poolCard.rating || 0,
                  reviewCount: poolCard.reviewCount || 0,
                  imageUrl: poolCard.image || null,
                  images: poolCard.images || [],
                  placeId: poolCard.placeId || poolCard.id,
                  priceLevel: 0,
                  openingHours: poolCard.openingHours || null,
                  website: poolCard.website || null,
                });
              }

              const today2 = new Date();
              today2.setHours(0, 0, 0, 0);
              let customDate: Date;
              if (/^\d{2}-\d{2}$/.test(customHoliday.date)) {
                const [month, day] = customHoliday.date.split("-").map(Number);
                customDate = new Date(today2.getFullYear(), month - 1, day);
                if (customDate < today2) customDate.setFullYear(customDate.getFullYear() + 1);
              } else {
                const legacyDate = new Date(customHoliday.date);
                customDate = new Date(today2.getFullYear(), legacyDate.getMonth(), legacyDate.getDate());
                if (customDate < today2) customDate.setFullYear(customDate.getFullYear() + 1);
              }
              customDate.setHours(0, 0, 0, 0);
              const daysAway = Math.ceil((customDate.getTime() - today2.getTime()) / (1000 * 60 * 60 * 24));

              poolCustomHolidays.push({
                id: customHoliday.id,
                name: customHoliday.name,
                description: customHoliday.description,
                date: customDate.toISOString(),
                daysAway,
                primaryCategory: customHoliday.category,
                categories: [customHoliday.category],
                gender: null,
                experiences,
                isCustom: true,
              });
            }
          }

          return new Response(
            JSON.stringify({
              holidays: poolHolidaysWithExperiences,
              customHolidays: poolCustomHolidays,
              meta: {
                totalHolidays: poolHolidaysWithExperiences.length,
                totalCustomHolidays: poolCustomHolidays.length,
                daysAhead: days,
                gender,
                poolFirst: true,
                fromPool: poolResult.fromPool,
                fromApi: poolResult.fromApi,
              },
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        console.log(`[pool-first] Pool has ${poolCardsPerHoliday} cards/holiday (need >= 10). Falling back to Google API.`);
      } catch (poolError) {
        console.warn("[pool-first] Pool query failed, falling back to Google API:", poolError);
      }
    }

    // Pre-fetch a large pool of experiences from ALL categories
    // Use a shared set to prevent the same place appearing in multiple category pools
    console.log("Pre-fetching experience pool from all categories...");
    const experiencePool: Map<string, ExperienceCard[]> = new Map();
    const poolPlaceIds = new Set<string>(); // Track ALL place IDs in the entire pool

    // Create admin client for cache operations
    const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;
    
    for (const category of DISCOVER_CATEGORIES) {
      try {
        const experiences = await fetchExperiencesForCategory(
          category,
          location,
          radius,
          15, // Fetch plenty per category
          poolPlaceIds, // Pass shared set to avoid duplicates across categories
          supabaseAdmin
        );
        experiencePool.set(category, experiences);
        console.log(`Pool: ${experiences.length} experiences for ${category}`);
      } catch (error) {
        console.error(`Error pre-fetching ${category}:`, error);
        experiencePool.set(category, []);
      }
    }
    
    // Count total pool size
    let totalPoolSize = 0;
    experiencePool.forEach((exps) => { totalPoolSize += exps.length; });
    console.log(`Total pool size: ${totalPoolSize} unique experiences across all categories (poolPlaceIds: ${poolPlaceIds.size})`);
    
    // Get all unique experiences from pool
    const getAllUnusedFromPool = (preferredCategories: string[]): ExperienceCard[] => {
      const results: ExperienceCard[] = [];
      const seenIds = new Set<string>();
      
      // First, get from preferred categories
      for (const cat of preferredCategories) {
        const catExperiences = experiencePool.get(cat) || [];
        for (const exp of catExperiences) {
          if (!globalUsedPlaceIds.has(exp.id) && !seenIds.has(exp.id)) {
            results.push(exp);
            seenIds.add(exp.id);
          }
        }
      }
      
      // Then, fill from other categories
      for (const cat of DISCOVER_CATEGORIES) {
        if (preferredCategories.includes(cat)) continue;
        const catExperiences = experiencePool.get(cat) || [];
        for (const exp of catExperiences) {
          if (!globalUsedPlaceIds.has(exp.id) && !seenIds.has(exp.id)) {
            results.push(exp);
            seenIds.add(exp.id);
          }
        }
      }
      
      return results;
    };
    
    const holidaysWithExperiences: HolidayWithExperiences[] = [];
    
    for (const holiday of upcomingHolidays) {
      // Get unused experiences, prioritizing this holiday's categories
      const availableExperiences = getAllUnusedFromPool(holiday.definition.categories);
      
      // Take up to MAX_EXPERIENCES_PER_HOLIDAY
      const experiences = availableExperiences.slice(0, MAX_EXPERIENCES_PER_HOLIDAY);
      
      // Mark as used
      experiences.forEach(exp => globalUsedPlaceIds.add(exp.id));
      
      if (experiences.length < MIN_EXPERIENCES_PER_HOLIDAY) {
        console.warn(`WARNING: Holiday ${holiday.definition.name} only got ${experiences.length} experiences (minimum ${MIN_EXPERIENCES_PER_HOLIDAY})`);
      } else {
        console.log(`Holiday ${holiday.definition.name}: ${experiences.length} experiences assigned`);
      }

      holidaysWithExperiences.push({
        id: `holiday-${holiday.definition.date}-${holiday.definition.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: holiday.definition.name,
        description: holiday.definition.description,
        date: holiday.date.toISOString(),
        daysAway: holiday.daysAway,
        primaryCategory: holiday.definition.categories[0],
        categories: holiday.definition.categories,
        gender: holiday.definition.gender,
        experiences,
      });
    }

    console.log(`Returning ${holidaysWithExperiences.length} holidays with experiences (${globalUsedPlaceIds.size} unique places used)`);

    // Process custom holidays if provided (also using the same pool)
    let customHolidaysWithExperiences: HolidayWithExperiences[] = [];
    
    if (customHolidays && customHolidays.length > 0) {
      console.log(`Processing ${customHolidays.length} custom holidays`);
      
      for (const customHoliday of customHolidays) {
        const categories = [customHoliday.category];
        
        // Get unused experiences from the pool, prioritizing the custom holiday's category
        const availableExperiences = getAllUnusedFromPool(categories);
        const experiences = availableExperiences.slice(0, MAX_EXPERIENCES_PER_HOLIDAY);
        
        // Mark as used
        experiences.forEach(exp => globalUsedPlaceIds.add(exp.id));
        
        if (experiences.length < MIN_EXPERIENCES_PER_HOLIDAY) {
          console.warn(`WARNING: Custom holiday ${customHoliday.name} only got ${experiences.length} experiences (minimum ${MIN_EXPERIENCES_PER_HOLIDAY})`);
        } else {
          console.log(`Custom holiday ${customHoliday.name}: ${experiences.length} experiences assigned`);
        }

        // Calculate days away for custom holiday - treat as recurring (MM-DD or legacy ISO)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let customDate: Date;
        if (/^\d{2}-\d{2}$/.test(customHoliday.date)) {
          // MM-DD format - calculate next occurrence
          const [month, day] = customHoliday.date.split("-").map(Number);
          customDate = new Date(today.getFullYear(), month - 1, day);
          if (customDate < today) {
            customDate.setFullYear(customDate.getFullYear() + 1);
          }
        } else {
          // Legacy ISO format - extract month/day and find next occurrence
          const legacyDate = new Date(customHoliday.date);
          customDate = new Date(today.getFullYear(), legacyDate.getMonth(), legacyDate.getDate());
          if (customDate < today) {
            customDate.setFullYear(customDate.getFullYear() + 1);
          }
        }
        customDate.setHours(0, 0, 0, 0);
        const daysAway = Math.ceil((customDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        customHolidaysWithExperiences.push({
          id: customHoliday.id,
          name: customHoliday.name,
          description: customHoliday.description,
          date: customDate.toISOString(),
          daysAway,
          primaryCategory: customHoliday.category,
          categories: [customHoliday.category],
          gender: null,
          experiences,
          isCustom: true,
        });
      }
      
      console.log(`Processed ${customHolidaysWithExperiences.length} custom holidays with experiences`);
    }

    // ── Pool storage: store generated experience cards in card_pool (fire-and-forget) ──
    const storageAdmin = supabaseAdmin || poolAdminClient;
    if (storageAdmin && GOOGLE_API_KEY) {
      const allExperiences = [
        ...holidaysWithExperiences.flatMap(h => h.experiences),
        ...customHolidaysWithExperiences.flatMap(h => h.experiences),
      ];
      (async () => {
        try {
          for (const exp of allExperiences) {
            const placePoolId = await upsertPlaceToPool(
              storageAdmin,
              {
                id: exp.placeId,
                placeId: exp.placeId,
                displayName: { text: exp.name },
                name: exp.name,
                formattedAddress: exp.address,
                location: { latitude: exp.location.lat, longitude: exp.location.lng },
                rating: exp.rating,
                userRatingCount: exp.reviewCount,
                types: [],
                photos: [],
                priceLevel: exp.priceLevel,
                regularOpeningHours: exp.openingHours,
              },
              GOOGLE_API_KEY!,
              'holiday_experiences'
            );

            await insertCardToPool(storageAdmin, {
              placePoolId: placePoolId || undefined,
              googlePlaceId: exp.placeId,
              cardType: 'single',
              title: exp.name,
              category: exp.category,
              categories: [exp.category],
              imageUrl: exp.imageUrl,
              images: exp.images,
              address: exp.address,
              lat: exp.location.lat,
              lng: exp.location.lng,
              rating: exp.rating,
              reviewCount: exp.reviewCount,
              priceMin: 0,
              priceMax: 0,
              openingHours: exp.openingHours,
            });
          }
          console.log(`[pool-storage] Stored ${allExperiences.length} holiday experience cards in pool`);
        } catch (e) {
          console.warn('[pool-storage] Error storing holiday experience cards:', e);
        }
      })();
    }

    return new Response(
      JSON.stringify({
        holidays: holidaysWithExperiences,
        customHolidays: customHolidaysWithExperiences,
        meta: {
          totalHolidays: holidaysWithExperiences.length,
          totalCustomHolidays: customHolidaysWithExperiences.length,
          daysAhead: days,
          gender,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in holiday-experiences:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        holidays: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Fetch experiences for a SINGLE category, using a shared set to prevent duplicates across categories
 */
async function fetchExperiencesForCategory(
  category: string,
  location: { lat: number; lng: number },
  radius: number,
  maxResults: number,
  sharedUsedPlaceIds: Set<string>,
  supabaseAdmin: any
): Promise<ExperienceCard[]> {
  const experiences: ExperienceCard[] = [];
  
  const placeTypes = CATEGORY_TO_PLACE_TYPES[category];
  if (!placeTypes || placeTypes.length === 0) {
    console.warn(`No place types defined for category: ${category}`);
    return experiences;
  }

  try {
    let allRawPlaces: any[] = [];

    if (supabaseAdmin) {
      // Use batch cache for all place types in this category
      const { results: typeResults } = await batchSearchPlaces(
        supabaseAdmin,
        GOOGLE_API_KEY!,
        placeTypes,
        location.lat,
        location.lng,
        radius,
        { maxResultsPerType: 10, rankPreference: 'POPULARITY', ttlHours: 24 }
      );

      // Merge all results from typeResults, deduplicating by place.id
      const seenIds = new Set<string>();
      for (const places of Object.values(typeResults)) {
        for (const place of places) {
          if (!seenIds.has(place.id)) {
            seenIds.add(place.id);
            allRawPlaces.push(place);
          }
        }
      }
    } else {
      // Fallback: direct API call
      const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";
      const fieldMask = [
        "places.id","places.displayName","places.location","places.formattedAddress",
        "places.priceLevel","places.rating","places.userRatingCount",
        "places.photos","places.types","places.regularOpeningHours",
        "places.websiteUri",
      ].join(",");

      const requestBody = {
        includedTypes: placeTypes,
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: location.lat, longitude: location.lng },
            radius: radius,
          },
        },
        rankPreference: "POPULARITY",
      };

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY!,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Google Places API error for ${category}:`, response.status, errorText);
        return experiences;
      }

      const data = await response.json();
      allRawPlaces = data.places || [];
    }

    if (allRawPlaces.length === 0) {
      console.log(`No places found for category: ${category}`);
      return experiences;
    }

    // Filter out excluded types
    const validPlaces = allRawPlaces.filter((place: any) => {
      const placeTypeSet = new Set(place.types || []);
      return !Array.from(EXCLUDED_TYPES).some((excluded) => placeTypeSet.has(excluded));
    });

    // Sort by rating
    const sortedPlaces = validPlaces.sort((a: any, b: any) => {
      const aScore = (a.rating || 0) * Math.min(1, (a.userRatingCount || 0) / 100);
      const bScore = (b.rating || 0) * Math.min(1, (b.userRatingCount || 0) / 100);
      return bScore - aScore;
    });

    // Add unique places that haven't been used by ANY category yet
    for (const place of sortedPlaces) {
      if (experiences.length >= maxResults) break;
      if (sharedUsedPlaceIds.has(place.id)) {
        console.log(`Skipping duplicate place ${place.id} (already in another category)`);
        continue;
      }

      sharedUsedPlaceIds.add(place.id);
      experiences.push(transformToExperienceCard(place, category));
    }

    console.log(`Fetched ${experiences.length} unique experiences for ${category}`);
  } catch (error) {
    console.error(`Error fetching places for category ${category}:`, error);
  }

  return experiences;
}

/**
 * Transform Google Places API place to ExperienceCard format
 */
function transformToExperienceCard(place: any, category: string): ExperienceCard {
  const primaryPhoto = place.photos?.[0];
  const imageUrl = primaryPhoto?.name
    ? `https://places.googleapis.com/v1/${primaryPhoto.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
    : null;

  const images = (place.photos || [])
    .slice(0, 5)
    .map((photo: any) =>
      photo.name
        ? `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&key=${GOOGLE_API_KEY}`
        : null
    )
    .filter((img: string | null): img is string => img !== null);

  const priceLevel = place.priceLevel || 0;
  const priceLevelNum = typeof priceLevel === "string"
    ? ["PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"].indexOf(priceLevel)
    : priceLevel;

  return {
    id: place.id,
    name: place.displayName?.text || "Unknown Place",
    category: category,
    location: {
      lat: place.location?.latitude || 0,
      lng: place.location?.longitude || 0,
    },
    address: place.formattedAddress || "",
    rating: place.rating || 0,
    reviewCount: place.userRatingCount || 0,
    imageUrl,
    images,
    placeId: place.id,
    priceLevel: priceLevelNum,
    openingHours: place.regularOpeningHours
      ? {
          open_now: place.regularOpeningHours.openNow || false,
          weekday_text: place.regularOpeningHours.weekdayDescriptions || [],
        }
      : null,
    website: place.websiteUri || null,
  };
}
