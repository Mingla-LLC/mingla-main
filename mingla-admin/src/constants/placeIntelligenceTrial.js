// ORCH-0712 — constants for the Place Intelligence Trial admin page.
//
// Mirrors the 16 Mingla signal IDs (must stay in sync with
// supabase/functions/_shared/photoAestheticEnums.ts::MINGLA_SIGNAL_IDS).

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

// Default minimum signal score for candidate filter. Operator can lower per
// signal in the picker if a thin signal (movies/flowers/groceries) needs it.
export const DEFAULT_CANDIDATE_SCORE_THRESHOLD = 100;

export const ANCHORS_PER_SIGNAL = 2;
export const TOTAL_ANCHORS_TARGET = MINGLA_SIGNAL_IDS.length * ANCHORS_PER_SIGNAL; // 32
