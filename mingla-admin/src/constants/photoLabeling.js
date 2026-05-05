// ORCH-0708 Phase 0 — constants for the Photo Labeling admin page.
//
// SOURCE OF TRUTH for the form's enum dropdowns and chip selectors. These
// values mirror the structured-output schema Claude will return via the
// photo_aesthetic_score tool (spec §5.1). They MUST stay aligned with:
//   - supabase/functions/_shared/photoAestheticScorer.ts (when Phase 2 ships)
//   - the field-weight prefix matchers in supabase/functions/_shared/signalScorer.ts
//
// If you change a value here, audit those two files for matching prefixes.

// ─── 16 Mingla signal IDs ───────────────────────────────────────────────────
// SOURCE OF TRUTH: live `signal_definitions` table — refresh manually if signals
// are added/removed via DB. The scorer reads `photo_appropriate_for_includes_<signal_id>`,
// so signal IDs are what go in the appropriate_for / inappropriate_for chips
// (NOT the 10 canonical chip slugs from categoryPlaceTypes.DISPLAY_TO_SLUG —
// different abstraction layer).
export const MINGLA_SIGNAL_IDS = [
  "brunch",
  "casual_food",
  "creative_arts",
  "drinks",
  "fine_dining",
  "flowers",
  "groceries",
  "icebreakers",
  "lively",
  "movies",
  "nature",
  "picnic_friendly",
  "play",
  "romantic",
  "scenic",
  "theatre",
];

// ─── 6 anchor categories (one per slot in Anchors tab) ──────────────────────
// CHECK constraint `chk_anchor_category` in the photo_aesthetic_labels table
// enforces this exact set.
export const ANCHOR_CATEGORIES = [
  {
    id: "upscale_steakhouse",
    label: "Upscale Steakhouse",
    description: "High-end dining, dim warm lighting, food-forward shots",
  },
  {
    id: "sunny_brunch_cafe",
    label: "Sunny Brunch Café",
    description: "Bright daylight, brunchy vibes, casual but photogenic",
  },
  {
    id: "neon_dive_bar",
    label: "Neon Dive Bar",
    description: "Lively dim party, neon, cocktail-focused",
  },
  {
    id: "adult_venue",
    label: "Adult Venue",
    description: "Sex club / strip club — safety_flags should fire here",
  },
  {
    id: "average_storefront",
    label: "Average Storefront",
    description: "Mid-tier place — pizza shop, sandwich shop, convenience store",
  },
  {
    id: "cozy_coffee_shop",
    label: "Cozy Coffee Shop",
    description: "Warm intimate, food-forward, casual cozy vibe",
  },
];

// ─── 3 fixture cities (10 fixtures per city = 30 total) ─────────────────────
export const FIXTURE_CITIES = ["Raleigh", "Cary", "Durham"];

// ─── Form-field enums (mirror Claude's photo_aesthetic_score tool schema) ──

export const LIGHTING_OPTIONS = [
  "bright_daylight",
  "warm_intimate",
  "dim_moody",
  "candle_lit",
  "neon_party",
  "fluorescent_clinical",
  "natural_outdoor",
  "mixed",
  "unclear",
];

export const COMPOSITION_OPTIONS = ["strong", "average", "weak"];

export const SUBJECT_CLARITY_OPTIONS = ["clear", "partial", "unclear"];

export const PRIMARY_SUBJECT_OPTIONS = [
  "food",
  "drinks",
  "ambience",
  "exterior",
  "people",
  "art",
  "nature",
  "products",
  "mixed",
];

export const VIBE_TAG_OPTIONS = [
  "fine_dining",
  "casual",
  "intimate",
  "lively",
  "party",
  "family_friendly",
  "romantic",
  "candle_lit",
  "brunchy",
  "food_forward",
  "cocktail_focused",
  "outdoor",
  "scenic",
  "artsy",
  "cozy",
  "modern",
  "rustic",
  "upscale",
  "divey",
  "bright",
  "dim",
  "professional",
  "amateur",
  "photogenic",
];

export const SAFETY_FLAG_OPTIONS = [
  "adult_content",
  "explicit_imagery",
  "weapons",
  "drugs",
  "none",
];

// ─── Aesthetic score range ──────────────────────────────────────────────────
export const AESTHETIC_SCORE_MIN = 1.0;
export const AESTHETIC_SCORE_MAX = 10.0;
export const AESTHETIC_SCORE_STEP = 0.1;
export const AESTHETIC_SCORE_DEFAULT = 5.0;

// ─── Photo quality notes max length ─────────────────────────────────────────
export const PHOTO_QUALITY_NOTES_MAX = 300;

// ─── Default empty aggregate (used when seeding a new draft form) ──────────
export const EMPTY_EXPECTED_AGGREGATE = {
  aesthetic_score: AESTHETIC_SCORE_DEFAULT,
  lighting: "unclear",
  composition: "average",
  subject_clarity: "clear",
  primary_subject: "mixed",
  vibe_tags: [],
  appropriate_for: [],
  inappropriate_for: [],
  safety_flags: [],
  photo_quality_notes: "",
};

// ─── Candidate-picker SQL filters per anchor category (spec §24.4) ─────────
// Each filter is a fragment that gets composed into the broader place_pool
// query in CandidatePicker.jsx. Scoped to the 3 fixture cities by default.
//
// adult_venue uses a manual-name-search escape hatch — there's no automatic
// filter (no Google primary_type cleanly identifies sex clubs / strip clubs).
export const ANCHOR_CANDIDATE_FILTERS = {
  upscale_steakhouse: {
    description: "Fine-dining + steak houses, high rating",
    where:
      "primary_type IN ('fine_dining_restaurant','steak_house') AND rating >= 4.5 AND review_count >= 100",
  },
  sunny_brunch_cafe: {
    description: "Brunch / breakfast restaurants, mid-high rating",
    where:
      "(primary_type = 'brunch_restaurant' OR 'breakfast_restaurant' = ANY(types)) AND rating >= 4.4 AND review_count >= 50",
  },
  neon_dive_bar: {
    description: "Night clubs / bars, decent rating",
    where:
      "(primary_type = 'night_club' OR 'bar' = ANY(types)) AND rating >= 4.0 AND review_count >= 80",
  },
  adult_venue: {
    description: "Manual: search by name (no automatic filter)",
    where: null, // signals the picker to render a name-search box instead
  },
  average_storefront: {
    description: "Mid-tier neighborhood spots",
    where:
      "rating BETWEEN 3.5 AND 4.2 AND review_count BETWEEN 30 AND 200 AND primary_type IN ('pizza_restaurant','sandwich_shop','convenience_store')",
  },
  cozy_coffee_shop: {
    description: "Cafes / coffee shops, high rating",
    where:
      "primary_type IN ('cafe','coffee_shop') AND rating >= 4.5 AND review_count >= 80",
  },
};
