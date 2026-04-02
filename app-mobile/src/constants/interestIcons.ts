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
  Handshake,
  TreePine,
  UtensilsCrossed,
  Wine,
  ChefHat,
  Film,
  Music,
  Palette,
  Gamepad2,
  HeartPulse,
  Flower2,
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

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  nature: Trees,
  first_meet: Handshake,
  picnic_park: TreePine,
  drink: Wine,
  casual_eats: UtensilsCrossed,
  fine_dining: ChefHat,
  watch: Film,
  live_performance: Music,
  creative_arts: Palette,
  play: Gamepad2,
  wellness: HeartPulse,
  flowers: Flower2,
};
