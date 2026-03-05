import { useState, useEffect, useCallback } from "react";
import { DeviceCalendarService } from "../services/deviceCalendarService";

// Holiday category mapping - determines which experience category to show for each holiday
const HOLIDAY_CATEGORY_MAP: { [key: string]: string } = {
  // Common holiday keywords -> experience categories (v2)
  "new year": "Wellness",
  "valentine": "Fine Dining",
  "women's day": "Fine Dining",
  "spring": "Nature",
  "mother's day": "Fine Dining",
  "father's day": "Play",
  "summer": "Nature",
  "juneteenth": "Nature",
  "peace": "Picnic",
  "sweetest": "Drink",
  "halloween": "Watch",
  "men's day": "Play",
  "thanksgiving": "Fine Dining",
  "christmas eve": "Creative & Arts",
  "christmas": "Nature",
  "hanukkah": "Fine Dining",
  "kwanzaa": "Fine Dining",
  "easter": "Casual Eats",
  "memorial": "Picnic",
  "labor day": "Picnic",
  "independence": "Nature",
  "fourth of july": "Nature",
  "july 4": "Nature",
};

// Holiday descriptions for display
const HOLIDAY_DESCRIPTIONS: { [key: string]: string } = {
  "new year": 'The "Fresh Start" date',
  "valentine": "The biggest high-pressure day",
  "women's day": "Celebrate the women in your life",
  "spring": "Great for nature dates",
  "mother's day": "Crucial if they have kids or to remind about partner's mom",
  "father's day": "Honor the father figures in your life",
  "summer": "Summer celebration",
  "juneteenth": "Summer celebration",
  "peace": 'A "Relationship Reset" day',
  "sweetest": 'A popular "second Valentine\'s"',
  "halloween": "Perfect for a spooky movie night or costumes",
  "men's day": "Celebrate the men in your life",
  "thanksgiving": 'Focus on "Gratitude"',
  "christmas eve": "High gift-giving expectation",
  "christmas": "Holiday celebration",
  "hanukkah": "Festival of Lights celebration",
  "kwanzaa": "Cultural celebration",
  "easter": "Spring celebration",
  "memorial": "Honor and remember",
  "labor day": "End of summer celebration",
  "independence": 'The "Big Night Out"',
  "fourth of july": 'The "Big Night Out"',
  "july 4": 'The "Big Night Out"',
};

export interface CalendarHoliday {
  id: string;
  name: string;
  description: string;
  date: Date;
  daysAway: number;
  category: string; // Primary experience category
  categories: string[]; // All experience categories for this holiday
  isFromCalendar: boolean; // True if from device calendar, false if fallback
  gender?: "male" | "female" | null; // If set, only show for this gender
}

// Fallback holidays in case calendar access is denied or no holidays found
// Gender-specific holidays: Mother's Day (female), Father's Day (male), Int. Women's Day (female), Int. Men's Day (male)
const FALLBACK_HOLIDAYS: Array<{
  date: string;
  name: string;
  description: string;
  categories: string[];
  gender?: "male" | "female" | null;
}> = [
  { date: "2026-01-01", name: "New Year's Day", description: 'The "Fresh Start" date', categories: ["Wellness", "Fine Dining"], gender: null },
  { date: "2026-02-14", name: "Valentine's Day", description: "The biggest high-pressure day", categories: ["Fine Dining", "Drink"], gender: null },
  { date: "2026-03-08", name: "International Women's Day", description: "Celebrate the women in your life", categories: ["Fine Dining", "Wellness"], gender: "female" },
  { date: "2026-03-20", name: "First Day of Spring", description: "Great for nature dates", categories: ["Nature", "Picnic"], gender: null },
  { date: "2026-05-10", name: "Mother's Day", description: "Crucial if they have kids or to remind about partner's mom", categories: ["Fine Dining", "Wellness"], gender: "female" },
  { date: "2026-06-15", name: "Father's Day", description: "Honor the father figures in your life", categories: ["Play", "Fine Dining"], gender: "male" },
  { date: "2026-06-19", name: "Juneteenth / Start of Summer", description: "Summer celebration", categories: ["Nature", "Picnic"], gender: null },
  { date: "2026-09-21", name: "International Day of Peace", description: 'A "Relationship Reset" day', categories: ["Picnic", "Wellness"], gender: null },
  { date: "2026-10-17", name: "Sweetest Day", description: 'A popular "second Valentine\'s"', categories: ["Drink", "Fine Dining"], gender: null },
  { date: "2026-10-31", name: "Halloween", description: "Perfect for a spooky movie night or costumes", categories: ["Watch", "Creative & Arts"], gender: null },
  { date: "2026-11-19", name: "International Men's Day", description: "Celebrate the men in your life", categories: ["Play", "Fine Dining"], gender: "male" },
  { date: "2026-11-26", name: "Thanksgiving", description: 'Focus on "Gratitude"', categories: ["Fine Dining", "Casual Eats"], gender: null },
  { date: "2026-12-24", name: "Christmas Eve", description: "High gift-giving expectation", categories: ["Creative & Arts", "Fine Dining"], gender: null },
  { date: "2026-12-25", name: "Christmas Day", description: "Holiday celebration", categories: ["Nature", "Fine Dining"], gender: null },
  { date: "2026-12-31", name: "New Year's Eve", description: 'The "Big Night Out"', categories: ["Fine Dining", "Drink"], gender: null },
];

/**
 * Get the category for a holiday based on its name
 */
const getCategoryForHoliday = (holidayName: string): string => {
  const nameLower = holidayName.toLowerCase();
  
  for (const [keyword, category] of Object.entries(HOLIDAY_CATEGORY_MAP)) {
    if (nameLower.includes(keyword)) {
      return category;
    }
  }
  
  // Default to Fine Dining for unknown holidays
  return "Fine Dining";
};

/**
 * Get all categories for a holiday (primary + Dining Experiences for most)
 */
const getCategoriesForHoliday = (holidayName: string): string[] => {
  const primaryCategory = getCategoryForHoliday(holidayName);
  
  // Most holidays should also include Fine Dining
  if (primaryCategory === "Fine Dining") {
    return ["Fine Dining"];
  }

  return [primaryCategory, "Fine Dining"];
};

/**
 * Get a description for a holiday based on its name
 */
const getDescriptionForHoliday = (holidayName: string): string => {
  const nameLower = holidayName.toLowerCase();
  
  for (const [keyword, description] of Object.entries(HOLIDAY_DESCRIPTIONS)) {
    if (nameLower.includes(keyword)) {
      return description;
    }
  }
  
  // Default description
  return "Special day for celebration";
};

/**
 * Get the gender restriction for a holiday based on its name
 */
const getGenderForHoliday = (holidayName: string): "male" | "female" | null => {
  const nameLower = holidayName.toLowerCase();
  
  // Female-specific holidays
  if (nameLower.includes("mother") || nameLower.includes("women")) {
    return "female";
  }
  
  // Male-specific holidays
  if (nameLower.includes("father") || nameLower.includes("men's day")) {
    return "male";
  }
  
  // No gender restriction
  return null;
};

/**
 * Calculate days away from today
 */
const calculateDaysAway = (date: Date): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * Get fallback holidays with dynamic days calculation
 */
const getFallbackHolidays = (daysAhead: number = 365): CalendarHoliday[] => {
  const today = new Date();
  const currentYear = today.getFullYear();
  
  return FALLBACK_HOLIDAYS.map((holiday) => {
    // Parse the date and adjust year if needed
    let holidayDate = new Date(holiday.date);
    
    // Adjust to current or next year
    holidayDate.setFullYear(currentYear);
    if (holidayDate < today) {
      holidayDate.setFullYear(currentYear + 1);
    }
    
    const daysAway = calculateDaysAway(holidayDate);
    
    return {
      id: `fallback-${holiday.name.replace(/\s+/g, '-').toLowerCase()}`,
      name: holiday.name,
      description: holiday.description,
      date: holidayDate,
      daysAway,
      category: holiday.categories[0], // Primary category
      categories: holiday.categories, // All categories
      isFromCalendar: false,
      gender: holiday.gender || null,
    };
  })
  .filter(holiday => holiday.daysAway >= 0 && holiday.daysAway <= daysAhead)
  .sort((a, b) => a.daysAway - b.daysAway);
};

export interface UseCalendarHolidaysReturn {
  holidays: CalendarHoliday[];
  loading: boolean;
  error: string | null;
  hasCalendarAccess: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch holidays from the device calendar (including synced Google Calendar)
 * Falls back to hardcoded holidays if calendar access is denied or no holidays found
 */
export const useCalendarHolidays = (daysAhead: number = 365): UseCalendarHolidaysReturn => {
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasCalendarAccess, setHasCalendarAccess] = useState(false);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Check for calendar permissions
      const hasPermissions = await DeviceCalendarService.hasPermissions();
      
      if (!hasPermissions) {
        // Try to request permissions
        const granted = await DeviceCalendarService.requestPermissions();
        if (!granted) {
          console.log("Calendar permissions denied, using fallback holidays");
          setHasCalendarAccess(false);
          setHolidays(getFallbackHolidays(daysAhead));
          setLoading(false);
          return;
        }
      }

      setHasCalendarAccess(true);

      // Try to fetch holidays from device calendar
      const calendarHolidays = await DeviceCalendarService.getHolidaysFromCalendar(daysAhead);
      
      if (calendarHolidays.length > 0) {
        // Transform calendar events to our holiday format
        const transformedHolidays: CalendarHoliday[] = calendarHolidays
          .map((event) => {
            const categories = getCategoriesForHoliday(event.name);
            return {
              id: event.id,
              name: event.name,
              description: getDescriptionForHoliday(event.name),
              date: event.date,
              daysAway: calculateDaysAway(event.date),
              category: categories[0], // Primary category
              categories: categories, // All categories
              isFromCalendar: true,
              gender: getGenderForHoliday(event.name),
            };
          })
          .filter(holiday => holiday.daysAway >= 0)
          .sort((a, b) => a.daysAway - b.daysAway);

        if (transformedHolidays.length > 0) {
          setHolidays(transformedHolidays);
          setLoading(false);
          return;
        }
      }

      // Fallback if no holidays found in calendar
      console.log("No holidays found in calendar, using fallback holidays");
      setHolidays(getFallbackHolidays(daysAhead));
    } catch (err: any) {
      console.error("Error fetching calendar holidays:", err);
      setError(err.message || "Failed to fetch holidays");
      // Use fallback holidays on error
      setHolidays(getFallbackHolidays(daysAhead));
    } finally {
      setLoading(false);
    }
  }, [daysAhead]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  return {
    holidays,
    loading,
    error,
    hasCalendarAccess,
    refresh: fetchHolidays,
  };
};
