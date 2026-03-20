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
  Heart,
  HeartHandshake,
  PartyPopper,
  Footprints,
  TreePine,
  Handshake,
  UtensilsCrossed,
  Wine,
  Hamburger,
  ChefHat,
  Clapperboard,
  Palette,
  Target,
  Sparkles,
  ShoppingCart,
  Briefcase,
  type LucideIcon,
} from 'lucide-react-native';

// ─── Intent ID → Lucide Icon ───────────────────────────────────────────────

export const INTENT_ICON_MAP: Record<string, LucideIcon> = {
  adventurous: Compass,
  'first-date': Heart,
  romantic: HeartHandshake,
  'group-fun': PartyPopper,
  'picnic-dates': UtensilsCrossed,
  'take-a-stroll': Footprints,
};

// ─── Category slug → Lucide Icon ───────────────────────────────────────────

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  nature: TreePine,
  first_meet: Handshake,
  picnic_park: UtensilsCrossed,
  drink: Wine,
  casual_eats: Hamburger,
  fine_dining: ChefHat,
  watch: Clapperboard,
  creative_arts: Palette,
  play: Target,
  wellness: Sparkles,
  groceries_flowers: ShoppingCart,
  work_business: Briefcase,
};
