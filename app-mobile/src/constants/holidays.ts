import { HolidayCardSection, HolidayDefinition } from '../types/holidayTypes'

// Helper: Nth weekday of month (0=Sunday, 1=Monday, etc.)
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const firstDay = new Date(year, month, 1)
  const firstWeekday = (weekday - firstDay.getDay() + 7) % 7
  const day = firstWeekday + 1 + (n - 1) * 7
  return new Date(year, month, day)
}

// Section presets — ORCH-0434: updated to new canonical slugs
const ROMANTIC_SECTION: HolidayCardSection = { label: 'Romantic', type: 'romantic' }
const ADVENTUROUS_SECTION: HolidayCardSection = { label: 'Adventurous', type: 'adventurous' }
const FINE_DINING_SECTION: HolidayCardSection = { label: 'Fine Dining', type: 'category', categorySlug: 'upscale_fine_dining' }
const NATURE_SECTION: HolidayCardSection = { label: 'Nature', type: 'category', categorySlug: 'nature' }
const PLAY_SECTION: HolidayCardSection = { label: 'Play', type: 'category', categorySlug: 'play' }
const DRINKS_SECTION: HolidayCardSection = { label: 'Drinks & Music', type: 'category', categorySlug: 'drinks_and_music' }
const MOVIES_SECTION: HolidayCardSection = { label: 'Movies & Theatre', type: 'category', categorySlug: 'movies_theatre' }
const CREATIVE_ARTS_SECTION: HolidayCardSection = { label: 'Creative & Arts', type: 'category', categorySlug: 'creative_arts' }

// Birthday and Custom Holiday preset: 3 curated + 3 category
export const DEFAULT_PERSON_SECTIONS: HolidayCardSection[] = [
  ROMANTIC_SECTION,
  ADVENTUROUS_SECTION,
  FINE_DINING_SECTION,
  MOVIES_SECTION,
  PLAY_SECTION,
]

export const STANDARD_HOLIDAYS: HolidayDefinition[] = [
  {
    id: 'new_years_day',
    name: "New Year's Day",
    getDate: (year) => new Date(year, 0, 1),
    sections: [NATURE_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'valentines_day',
    name: "Valentine's Day",
    getDate: (year) => new Date(year, 1, 14),
    sections: [ROMANTIC_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'intl_womens_day',
    name: "International Women's Day",
    getDate: (year) => new Date(year, 2, 8),
    sections: [NATURE_SECTION, FINE_DINING_SECTION],
    genderFilter: ['woman'],
  },
  {
    id: 'first_day_of_spring',
    name: 'First Day of Spring',
    getDate: (year) => new Date(year, 2, 20),
    sections: [ADVENTUROUS_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'mothers_day',
    name: "Mother's Day",
    getDate: (year) => nthWeekdayOfMonth(year, 4, 0, 2), // 2nd Sunday of May
    sections: [FINE_DINING_SECTION],
    genderFilter: ['woman'],
  },
  {
    id: 'fathers_day',
    name: "Father's Day",
    getDate: (year) => nthWeekdayOfMonth(year, 5, 0, 3), // 3rd Sunday of June
    sections: [PLAY_SECTION, FINE_DINING_SECTION],
    genderFilter: ['man'],
  },
  {
    id: 'juneteenth',
    name: 'Juneteenth',
    getDate: (year) => new Date(year, 5, 19),
    sections: [FINE_DINING_SECTION],
  },
  {
    id: 'intl_nonbinary_day',
    name: "International Non-Binary People's Day",
    getDate: (year) => new Date(year, 6, 14),
    sections: [CREATIVE_ARTS_SECTION, FINE_DINING_SECTION],
    genderFilter: ['non-binary', 'transgender', 'genderqueer', 'genderfluid', 'agender', 'prefer-not-to-say'],
  },
  {
    id: 'intl_day_of_peace',
    name: 'International Day of Peace',
    getDate: (year) => new Date(year, 8, 21),
    sections: [NATURE_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'sweetest_day',
    name: 'Sweetest Day',
    getDate: (year) => new Date(year, 9, 17),
    sections: [DRINKS_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'halloween',
    name: 'Halloween',
    getDate: (year) => new Date(year, 9, 31),
    sections: [MOVIES_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'intl_mens_day',
    name: "International Men's Day",
    getDate: (year) => new Date(year, 10, 19),
    sections: [PLAY_SECTION, FINE_DINING_SECTION],
    genderFilter: ['man'],
  },
  {
    id: 'thanksgiving',
    name: 'Thanksgiving',
    getDate: (year) => nthWeekdayOfMonth(year, 10, 4, 4), // 4th Thursday of November
    sections: [PLAY_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'christmas_eve',
    name: 'Christmas Eve',
    getDate: (year) => new Date(year, 11, 24),
    sections: [FINE_DINING_SECTION],
  },
  {
    id: 'christmas_day',
    name: 'Christmas Day',
    getDate: (year) => new Date(year, 11, 25),
    sections: [FINE_DINING_SECTION, MOVIES_SECTION],
  },
  {
    id: 'new_years_eve',
    name: "New Year's Eve",
    getDate: (year) => new Date(year, 11, 31),
    sections: [FINE_DINING_SECTION],
  },
]

// Intent → category slugs mapping for intent-based card sections
// ORCH-0434: Updated to new canonical slugs.
// ORCH-0597 (Slice 5): brunch_lunch_casual bundled chip split into brunch + casual_food.
export const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  romantic: ['icebreakers', 'drinks_and_music', 'nature'],
  adventurous: ['nature', 'play', 'creative_arts', 'brunch', 'casual_food', 'drinks_and_music', 'icebreakers', 'movies_theatre'],
}
