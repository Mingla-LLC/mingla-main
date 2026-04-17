/**
 * Canonical category constants for the Mingla admin dashboard.
 * ORCH-0434: 10 categories (8 visible + flowers + groceries).
 *
 * These match the app-side slugs stored in the database.
 * The seeding pipeline (admin-seed-places) accepts these slugs
 * and maps them to seeding configs internally.
 */

export const CATEGORY_LABELS = {
  nature: "Nature & Views",
  icebreakers: "Icebreakers",
  drinks_and_music: "Drinks & Music",
  brunch_lunch_casual: "Brunch, Lunch & Casual",
  upscale_fine_dining: "Upscale & Fine Dining",
  movies_theatre: "Movies & Theatre",
  creative_arts: "Creative & Arts",
  play: "Play",
  flowers: "Flowers",
  groceries: "Groceries",
};

export const CATEGORY_COLORS = {
  nature: "#22c55e",
  icebreakers: "#f97316",
  drinks_and_music: "#a855f7",
  brunch_lunch_casual: "#ef4444",
  upscale_fine_dining: "#dc2626",
  movies_theatre: "#3b82f6",
  creative_arts: "#ec4899",
  play: "#f59e0b",
  flowers: "#f472b6",
  groceries: "#6b7280",
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);
