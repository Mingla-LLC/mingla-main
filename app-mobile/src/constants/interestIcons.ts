/**
 * Lucide icon mappings for interests displayed on the profile page.
 *
 * Intent icons replace the old Ionicons names from ONBOARDING_INTENTS.
 * Category icons replace the old emoji strings from categories.ts.
 *
 * Each value is the exact Lucide component name (PascalCase) which we
 * re-export from this module so consumers only need one import.
 */
import {
  Compass,
  Sparkles,
  Heart,
  Users,
  Sandwich,
  Footprints,
  Trees,
  UtensilsCrossed,
  Wine,
  ChefHat,
  Film,
  Palette,
  Gamepad2,
  Coffee,
  type LucideIcon,
} from 'lucide-react-native';

// ─── Intent ID → Lucide Icon ───────────────────────────────────────────────

export const INTENT_ICON_MAP: Record<string, LucideIcon> = {
  adventurous: Compass,
  'first-date': Sparkles,
  romantic: Heart,
  'group-fun': Users,
  'picnic-dates': Sandwich,
  'take-a-stroll': Footprints,
};

// ─── Category slug → Lucide Icon ───────────────────────────────────────────
// ORCH-0434: Updated to 8 visible categories with new slugs.
// ORCH-0597 (Slice 5): split brunch_lunch_casual → brunch + casual_food.
//   Legacy slug retained for resolution; remove after 2026-05-12.

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  nature: Trees,
  drinks_and_music: Wine,
  icebreakers: Sparkles,
  brunch: Coffee,
  casual_food: UtensilsCrossed,
  brunch_lunch_casual: UtensilsCrossed, // [TRANSITIONAL] legacy — remove after 2026-05-12
  upscale_fine_dining: ChefHat,
  movies_theatre: Film,
  creative_arts: Palette,
  play: Gamepad2,
};
