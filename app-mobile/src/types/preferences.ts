/**
 * Canonical UserPreferences type — single source of truth (C2).
 *
 * Matches the `preferences` table in PostgreSQL exactly.
 * Both preferencesService.ts and experiencesService.ts re-export this type.
 * Do NOT define a competing UserPreferences interface anywhere else.
 *
 * ORCH-0434: Removed budget_min, budget_max, time_slot, price_tiers.
 * Added intent_toggle, category_toggle, selected_dates.
 */
export interface UserPreferences {
  // Core preference fields
  mode: string;
  people_count: number;
  categories: string[];
  travel_mode: string;
  travel_constraint_type: 'time';
  travel_constraint_value: number;
  datetime_pref: string | null;

  // Date options — ORCH-0434: 'today' | 'this_weekend' | 'pick_dates'
  date_option?: string | null;

  // Location
  custom_location?: string | null;
  custom_lat?: number | null;
  custom_lng?: number | null;

  // GPS toggle — NOT NULL DEFAULT TRUE in DB
  use_gps_location: boolean;

  // Intents
  intents?: string[];

  // ORCH-0434: Toggle states for intents and categories sections
  intent_toggle: boolean;
  category_toggle: boolean;

  // ORCH-0434: Multi-day date selection for 'pick_dates' mode
  selected_dates: string[] | null;
}
