import { HolidayCardSection, HolidayDefinition } from '../types/holidayTypes'

// Helper: Nth weekday of month (0=Sunday, 1=Monday, etc.)
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const firstDay = new Date(year, month, 1)
  const firstWeekday = (weekday - firstDay.getDay() + 7) % 7
  const day = firstWeekday + 1 + (n - 1) * 7
  return new Date(year, month, day)
}

// Section presets
const ROMANTIC_SECTION: HolidayCardSection = { label: 'Romantic', type: 'romantic' }
const ADVENTUROUS_SECTION: HolidayCardSection = { label: 'Adventurous', type: 'adventurous' }
const FINE_DINING_SECTION: HolidayCardSection = { label: 'Fine Dining', type: 'category', categorySlug: 'fine_dining' }
const WELLNESS_SECTION: HolidayCardSection = { label: 'Wellness', type: 'category', categorySlug: 'wellness' }
const PLAY_SECTION: HolidayCardSection = { label: 'Play', type: 'category', categorySlug: 'play' }
const PICNIC_SECTION: HolidayCardSection = { label: 'Picnic', type: 'category', categorySlug: 'picnic' }
const DRINK_SECTION: HolidayCardSection = { label: 'Drink', type: 'category', categorySlug: 'drink' }
const WATCH_SECTION: HolidayCardSection = { label: 'Watch', type: 'category', categorySlug: 'watch' }
const CREATIVE_ARTS_SECTION: HolidayCardSection = { label: 'Creative & Arts', type: 'category', categorySlug: 'creative_arts' }

// Birthday and Custom Holiday preset: 3 curated + 3 category
export const DEFAULT_PERSON_SECTIONS: HolidayCardSection[] = [
  ROMANTIC_SECTION,
  ADVENTUROUS_SECTION,
  FINE_DINING_SECTION,
  WATCH_SECTION,
  PLAY_SECTION,
]

export const STANDARD_HOLIDAYS: HolidayDefinition[] = [
  {
    id: 'new_years_day',
    name: "New Year's Day",
    getDate: (year) => new Date(year, 0, 1),
    sections: [WELLNESS_SECTION, FINE_DINING_SECTION],
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
    sections: [WELLNESS_SECTION, FINE_DINING_SECTION],
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
    sections: [PICNIC_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'sweetest_day',
    name: 'Sweetest Day',
    getDate: (year) => new Date(year, 9, 17),
    sections: [DRINK_SECTION, FINE_DINING_SECTION],
  },
  {
    id: 'halloween',
    name: 'Halloween',
    getDate: (year) => new Date(year, 9, 31),
    sections: [WATCH_SECTION, FINE_DINING_SECTION],
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
    sections: [FINE_DINING_SECTION, WATCH_SECTION],
  },
  {
    id: 'new_years_eve',
    name: "New Year's Eve",
    getDate: (year) => new Date(year, 11, 31),
    sections: [FINE_DINING_SECTION],
  },
]

// Intent → category slugs mapping for intent-based card sections
export const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  romantic: ['first_meet', 'drink', 'picnic', 'wellness', 'nature'],
  adventurous: ['nature', 'play', 'creative_arts', 'casual_eats', 'drink', 'first_meet', 'picnic', 'watch', 'wellness', 'groceries_flowers', 'work_business'],
}
