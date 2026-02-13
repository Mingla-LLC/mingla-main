import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY");

// Experience categories available in Mingla
const DISCOVER_CATEGORIES = [
  "Dining Experiences",
  "Casual Eats",
  "Sip & Chill",
  "Stroll",
  "Picnics",
  "Screen & Relax",
  "Wellness Dates",
  "Creative & Hands-On",
  "Play & Move",
  "Freestyle",
] as const;

// Map categories to Google Places types (validated for Google Places API New)
const CATEGORY_TO_PLACE_TYPES: { [key: string]: string[] } = {
  "Dining Experiences": ["bakery", "ice_cream_shop"],
  "Casual Eats": ["restaurant", "cafe"],
  "Sip & Chill": ["bar", "cafe"],
  "Stroll": ["park", "hiking_area"],
  "Picnics": ["park", "beach", "marina"],
  "Screen & Relax": ["movie_theater"],
  "Wellness Dates": ["spa", "gym"],
  "Creative & Hands-On": ["art_gallery", "museum"],
  "Play & Move": ["bowling_alley", "amusement_park"],
  "Freestyle": ["tourist_attraction", "night_club", "aquarium", "zoo"],
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
  { date: "01-01", name: "New Year's Day", description: 'The "Fresh Start" date', categories: ["Wellness Dates", "Dining Experiences"], gender: null },
  { date: "02-14", name: "Valentine's Day", description: "The biggest high-pressure day", categories: ["Dining Experiences", "Sip & Chill"], gender: null },
  { date: "03-08", name: "International Women's Day", description: "Celebrate the women in your life", categories: ["Dining Experiences", "Wellness Dates"], gender: "female" },
  { date: "03-20", name: "First Day of Spring", description: 'Great for "Take a Stroll" dates', categories: ["Stroll", "Picnics"], gender: null },
  { date: "04-20", name: "Easter", description: "Spring celebration", categories: ["Casual Eats", "Dining Experiences"], gender: null },
  { date: "05-11", name: "Mother's Day", description: "Crucial if they have kids or to remind about partner's mom", categories: ["Dining Experiences", "Wellness Dates"], gender: "female" },
  { date: "05-26", name: "Memorial Day", description: "Honor and remember", categories: ["Picnics", "Freestyle"], gender: null },
  { date: "06-15", name: "Father's Day", description: "Honor the father figures in your life", categories: ["Play & Move", "Dining Experiences"], gender: "male" },
  { date: "06-19", name: "Juneteenth / Start of Summer", description: "Summer celebration", categories: ["Freestyle", "Picnics"], gender: null },
  { date: "07-04", name: "Independence Day", description: 'The "Big Night Out"', categories: ["Freestyle", "Picnics"], gender: null },
  { date: "09-01", name: "Labor Day", description: "End of summer celebration", categories: ["Picnics", "Casual Eats"], gender: null },
  { date: "09-21", name: "International Day of Peace", description: 'A "Relationship Reset" day', categories: ["Picnics", "Wellness Dates"], gender: null },
  { date: "10-17", name: "Sweetest Day", description: 'A popular "second Valentine\'s"', categories: ["Sip & Chill", "Dining Experiences"], gender: null },
  { date: "10-31", name: "Halloween", description: 'Perfect for "Screen & Relax" or costumes', categories: ["Screen & Relax", "Freestyle"], gender: null },
  { date: "11-19", name: "International Men's Day", description: "Celebrate the men in your life", categories: ["Play & Move", "Dining Experiences"], gender: "male" },
  { date: "11-27", name: "Thanksgiving", description: 'Focus on "Gratitude"', categories: ["Dining Experiences", "Casual Eats"], gender: null },
  { date: "12-24", name: "Christmas Eve", description: "High gift-giving expectation", categories: ["Creative & Hands-On", "Dining Experiences"], gender: null },
  { date: "12-25", name: "Christmas Day", description: "Holiday celebration", categories: ["Freestyle", "Dining Experiences"], gender: null },
  { date: "12-31", name: "New Year's Eve", description: 'The "Big Night Out"', categories: ["Dining Experiences", "Sip & Chill"], gender: null },
];

interface HolidayExperienceRequest {
  location: { lat: number; lng: number };
  radius?: number;
  gender?: "male" | "female" | null; // Filter holidays by gender
  days?: number; // Number of days to look ahead (default 90)
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
    
    const { location, radius = 10000, gender = null, days = 90, customHolidays = [] } = request;

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
        const customDate = new Date(h.date);
        customDate.setHours(0, 0, 0, 0);
        const daysAway = Math.ceil((customDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        return {
          id: h.id,
          name: h.name,
          description: h.description,
          date: h.date,
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

    // Fetch experiences for each holiday's categories in parallel
    const holidayPromises = upcomingHolidays.map(async (holiday) => {
      let experiences: ExperienceCard[] = [];
      try {
        experiences = await fetchExperiencesForCategories(
          holiday.definition.categories,
          location,
          radius
        );
      } catch (fetchError) {
        console.error(`Error fetching experiences for ${holiday.definition.name}:`, fetchError);
        // Return empty experiences on error
      }

      return {
        id: `holiday-${holiday.definition.date}-${holiday.definition.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: holiday.definition.name,
        description: holiday.definition.description,
        date: holiday.date.toISOString(),
        daysAway: holiday.daysAway,
        primaryCategory: holiday.definition.categories[0],
        categories: holiday.definition.categories,
        gender: holiday.definition.gender,
        experiences,
      } as HolidayWithExperiences;
    });

    const holidaysWithExperiences = await Promise.all(holidayPromises);

    console.log(`Returning ${holidaysWithExperiences.length} holidays with experiences`);

    // Process custom holidays if provided
    let customHolidaysWithExperiences: HolidayWithExperiences[] = [];
    
    if (customHolidays && customHolidays.length > 0) {
      console.log(`Processing ${customHolidays.length} custom holidays`);
      
      const customHolidayPromises = customHolidays.map(async (customHoliday) => {
        const categories = [customHoliday.category];
        let experiences: ExperienceCard[] = [];
        
        try {
          experiences = await fetchExperiencesForCategories(
            categories,
            location,
            radius
          );
        } catch (fetchError) {
          console.error(`Error fetching experiences for custom holiday ${customHoliday.name}:`, fetchError);
        }

        // Calculate days away for custom holiday
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const customDate = new Date(customHoliday.date);
        customDate.setHours(0, 0, 0, 0);
        const daysAway = Math.ceil((customDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        return {
          id: customHoliday.id,
          name: customHoliday.name,
          description: customHoliday.description,
          date: customHoliday.date,
          daysAway,
          primaryCategory: customHoliday.category,
          categories: [customHoliday.category],
          gender: null,
          experiences,
          isCustom: true,
        } as HolidayWithExperiences;
      });

      customHolidaysWithExperiences = await Promise.all(customHolidayPromises);
      console.log(`Processed ${customHolidaysWithExperiences.length} custom holidays with experiences`);
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
 * Fetch up to 3 experiences for the given categories
 */
async function fetchExperiencesForCategories(
  categories: string[],
  location: { lat: number; lng: number },
  radius: number
): Promise<ExperienceCard[]> {
  const allExperiences: ExperienceCard[] = [];
  const usedPlaceIds = new Set<string>();

  // Fetch from each category, spreading the 3 cards across categories
  const cardsPerCategory = Math.max(1, Math.floor(3 / categories.length));
  
  for (const category of categories) {
    const placeTypes = CATEGORY_TO_PLACE_TYPES[category];
    if (!placeTypes || placeTypes.length === 0) {
      console.warn(`No place types defined for category: ${category}`);
      continue;
    }

    try {
      const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";
      
      const fieldMask = [
        "places.id",
        "places.displayName",
        "places.location",
        "places.formattedAddress",
        "places.priceLevel",
        "places.rating",
        "places.userRatingCount",
        "places.photos",
        "places.types",
      ].join(",");

      const requestBody = {
        includedTypes: placeTypes,
        maxResultCount: 10,
        locationRestriction: {
          circle: {
            center: {
              latitude: location.lat,
              longitude: location.lng,
            },
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
        continue;
      }

      const data = await response.json();

      if (!data.places || data.places.length === 0) {
        console.log(`No places found for category: ${category}`);
        continue;
      }

      // Filter out excluded types
      const validPlaces = data.places.filter((place: any) => {
        const placeTypeSet = new Set(place.types || []);
        return !Array.from(EXCLUDED_TYPES).some((excluded) => placeTypeSet.has(excluded));
      });

      // Sort by rating
      const sortedPlaces = validPlaces.sort((a: any, b: any) => {
        const aScore = (a.rating || 0) * Math.min(1, (a.userRatingCount || 0) / 100);
        const bScore = (b.rating || 0) * Math.min(1, (b.userRatingCount || 0) / 100);
        return bScore - aScore;
      });

      // Add unique places up to the limit for this category
      let addedCount = 0;
      for (const place of sortedPlaces) {
        if (addedCount >= cardsPerCategory) break;
        if (usedPlaceIds.has(place.id)) continue;

        usedPlaceIds.add(place.id);
        allExperiences.push(transformToExperienceCard(place, category));
        addedCount++;
      }

      console.log(`Added ${addedCount} experiences from ${category}`);
    } catch (error) {
      console.error(`Error fetching places for category ${category}:`, error);
    }

    // Stop if we have enough
    if (allExperiences.length >= 3) break;
  }

  // If we still need more, fill from remaining categories
  if (allExperiences.length < 2) {
    console.log(`Only ${allExperiences.length} experiences, trying to fetch more...`);
    // Try to get more from any available category
    for (const category of DISCOVER_CATEGORIES) {
      if (allExperiences.length >= 2) break;
      
      const placeTypes = CATEGORY_TO_PLACE_TYPES[category];
      if (!placeTypes) continue;

      try {
        const baseUrl = "https://places.googleapis.com/v1/places:searchNearby";
        const fieldMask = [
          "places.id",
          "places.displayName",
          "places.location",
          "places.formattedAddress",
          "places.priceLevel",
          "places.rating",
          "places.userRatingCount",
          "places.photos",
          "places.types",
        ].join(",");

        const requestBody = {
          includedTypes: placeTypes,
          maxResultCount: 5,
          locationRestriction: {
            circle: {
              center: {
                latitude: location.lat,
                longitude: location.lng,
              },
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

        if (!response.ok) continue;

        const data = await response.json();
        if (!data.places) continue;

        for (const place of data.places) {
          if (allExperiences.length >= 2) break;
          if (usedPlaceIds.has(place.id)) continue;

          usedPlaceIds.add(place.id);
          allExperiences.push(transformToExperienceCard(place, category));
        }
      } catch (_error) {
        // Continue to next category
      }
    }
  }

  return allExperiences.slice(0, 3);
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
  };
}
