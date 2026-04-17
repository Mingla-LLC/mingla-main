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

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  nature: Trees,
  drinks_and_music: Wine,
  icebreakers: Sparkles,
  brunch_lunch_casual: UtensilsCrossed,
  upscale_fine_dining: ChefHat,
  movies_theatre: Film,
  creative_arts: Palette,
  play: Gamepad2,
};
