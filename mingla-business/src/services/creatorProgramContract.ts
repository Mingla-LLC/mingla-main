export const CREATOR_NICHES = [
  "food", "nightlife", "culture", "outdoors", "wellness", "music", "family", "travel",
] as const;

export const CREATOR_FORMATS = [
  { key: "first_timer_reaction", name: "First-timer reaction" },
  { key: "night_out_30", name: "Night out in 30 seconds" },
  { key: "what_price_gets", name: "What the price gets you" },
  { key: "behind_the_scenes", name: "Behind the scenes" },
  { key: "three_reasons", name: "Three reasons to go" },
  { key: "date_idea", name: "Date idea" },
] as const;

export type CreatorSetupStatus = {
  profile: boolean;
  mode_enabled?: boolean;
  verification?: "incomplete" | "verified" | "review" | "rejected" | "suspended";
  missing: string[];
  handles?: Array<{
    id: string;
    platform: string;
    handle: string;
    verify_code: string;
    verified: boolean;
    review_required: boolean;
    expires_at: string;
  }>;
  packages?: Array<Record<string, unknown>>;
};
