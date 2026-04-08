/**
 * Canonical UserPreferences type — single source of truth (C2).
 *
 * Matches the `preferences` table in PostgreSQL exactly.
 * Both preferencesService.ts and experiencesService.ts re-export this type.
 * Do NOT define a competing UserPreferences interface anywhere else.
 *
 * Schema source: migrations 20250126000004 (base) through 20260401000001 (custom_lat/lng).
 * See ORCH-0339 for the investigation that unified the two competing definitions.
 */
export interface UserPreferences {
  // Core preference fields (base table: 20250126000004)
  mode: string;
  budget_min: number;
  budget_max: number;
  people_count: number;
  categories: string[];
  travel_mode: string;
  travel_constraint_type: 'time';
  travel_constraint_value: number;
  datetime_pref: string | null;

  // Date/time options (20250127000003, 20250127000005, 20250216000001)
  date_option?: string | null;
  time_slot?: string | null;
  exact_time?: string | null;

  // Location (20250126000014, 20260401000001)
  custom_location?: string | null;
  custom_lat?: number | null;
  custom_lng?: number | null;

  // GPS toggle (20260228000002) — NOT NULL DEFAULT TRUE in DB
  use_gps_location: boolean;

  // Intents (20260302000002)
  intents?: string[];

  // Price tiers (20260305000001) — NOT NULL DEFAULT {'chill','comfy','bougie','lavish'}
  price_tiers: string[];
}
