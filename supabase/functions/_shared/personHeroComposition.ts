// ORCH-0684 D-Q1 — Holiday-driven composition rules for paired-person CardRows.
// Each rule names the combo's anchor signals, the rank signal, the singles
// section bias, and the singles count range. The edge fn looks up the rule by
// holidayKey + isCustomHoliday + (for custom) yearsElapsed.
//
// See specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md §3.4 for the binding contract.

export interface CompositionRule {
  holidayKey: string;                       // 'birthday' | STANDARD_HOLIDAYS.id | 'custom_default' | 'anniversary_default'
  comboAnchors: string[];                   // signal IDs for the combo planner anchors
  comboRankSignal: string;                  // signal to rank combos by within bbox
  comboCount: 0 | 1;                        // 0 = singles-only fallback; 1 = include 1 curated combo
  singlesSectionBias: string[];             // signal IDs to bias singles toward
  singlesMin: number;                       // minimum singles to include (after combo)
  singlesMax: number;                       // maximum singles to include (after combo)
  experienceType: string;                   // labels the combo: 'celebration' | 'romantic' | 'adventurous' | etc.
}

// ── Standard rules — keyed on holidayKey ────────────────────────────────────
export const COMPOSITION_RULES: Record<string, CompositionRule> = {
  birthday: {
    holidayKey: 'birthday',
    comboAnchors: ['play', 'fine_dining', 'drinks'],
    comboRankSignal: 'play',
    comboCount: 1,
    singlesSectionBias: ['icebreakers', 'drinks', 'nature', 'fine_dining', 'play', 'creative_arts', 'movies'],
    singlesMin: 5,
    singlesMax: 8,
    experienceType: 'celebration',
  },
  valentines_day: {
    holidayKey: 'valentines_day',
    comboAnchors: ['fine_dining', 'drinks', 'creative_arts'],
    comboRankSignal: 'fine_dining',
    comboCount: 1,
    singlesSectionBias: ['fine_dining', 'drinks', 'icebreakers', 'flowers'],
    singlesMin: 4,
    singlesMax: 6,
    experienceType: 'romantic',
  },
  mothers_day: {
    holidayKey: 'mothers_day',
    comboAnchors: ['brunch', 'nature'],
    comboRankSignal: 'brunch',
    comboCount: 1,
    singlesSectionBias: ['fine_dining', 'brunch', 'flowers', 'creative_arts'],
    singlesMin: 4,
    singlesMax: 6,
    experienceType: 'celebration',
  },
  fathers_day: {
    holidayKey: 'fathers_day',
    comboAnchors: ['play', 'fine_dining'],
    comboRankSignal: 'play',
    comboCount: 1,
    singlesSectionBias: ['play', 'fine_dining', 'drinks', 'casual_food'],
    singlesMin: 4,
    singlesMax: 6,
    experienceType: 'celebration',
  },
};

// Default for custom holidays with year > 1 (anniversary)
export const ANNIVERSARY_DEFAULT: CompositionRule = {
  holidayKey: 'anniversary_default',
  comboAnchors: ['fine_dining', 'drinks', 'creative_arts'],
  comboRankSignal: 'fine_dining',
  comboCount: 1,
  singlesSectionBias: [],   // filled at runtime from useHolidayCategories AI sections
  singlesMin: 4,
  singlesMax: 6,
  experienceType: 'romantic',
};

// Default for custom holidays without anniversary semantics
export const CUSTOM_HOLIDAY_DEFAULT: CompositionRule = {
  holidayKey: 'custom_default',
  comboAnchors: [],         // filled at runtime from useHolidayCategories AI sections
  comboRankSignal: '',      // filled at runtime
  comboCount: 1,
  singlesSectionBias: [],   // filled at runtime
  singlesMin: 4,
  singlesMax: 6,
  experienceType: 'curated',
};

// ── Generic fallback for STANDARD_HOLIDAYS not in COMPOSITION_RULES ─────────
// Derives a rule biased toward the holiday's resolved section signals.
export function deriveCompositionFromSections(
  holidayKey: string,
  sectionSignals: string[],
): CompositionRule {
  if (sectionSignals.length === 0) {
    return {
      holidayKey,
      comboAnchors: ['fine_dining', 'play'],
      comboRankSignal: 'fine_dining',
      comboCount: 1,
      singlesSectionBias: ['fine_dining', 'play', 'movies', 'drinks', 'nature'],
      singlesMin: 4,
      singlesMax: 6,
      experienceType: 'curated',
    };
  }
  return {
    holidayKey,
    comboAnchors: sectionSignals.slice(0, Math.min(3, sectionSignals.length)),
    comboRankSignal: sectionSignals[0],
    comboCount: 1,
    singlesSectionBias: sectionSignals,
    singlesMin: 4,
    singlesMax: 6,
    experienceType: 'curated',
  };
}

export function getCompositionForHolidayKey(args: {
  holidayKey: string;                   // e.g. 'birthday', 'valentines_day', 'custom_<uuid>'
  isCustomHoliday: boolean;
  yearsElapsed?: number;                // for custom holidays — anniversary if > 0
  resolvedSectionSignals: string[];     // signals already resolved from holiday.sections
                                        // (or from useHolidayCategories for custom)
}): CompositionRule {
  // 1. Built-in named rule
  if (COMPOSITION_RULES[args.holidayKey]) {
    return COMPOSITION_RULES[args.holidayKey];
  }
  // 2. Custom holiday — anniversary if yearsElapsed > 0
  if (args.isCustomHoliday && (args.yearsElapsed ?? 0) > 0) {
    return {
      ...ANNIVERSARY_DEFAULT,
      holidayKey: args.holidayKey,
      singlesSectionBias: args.resolvedSectionSignals.length > 0
        ? args.resolvedSectionSignals
        : ['fine_dining', 'drinks', 'creative_arts'],
    };
  }
  // 3. Custom holiday — generic
  if (args.isCustomHoliday) {
    return {
      ...CUSTOM_HOLIDAY_DEFAULT,
      holidayKey: args.holidayKey,
      comboAnchors: args.resolvedSectionSignals.slice(0, Math.min(3, args.resolvedSectionSignals.length)),
      comboRankSignal: args.resolvedSectionSignals[0] ?? 'fine_dining',
      singlesSectionBias: args.resolvedSectionSignals,
    };
  }
  // 4. STANDARD_HOLIDAYS not in COMPOSITION_RULES — derive from section config
  return deriveCompositionFromSections(args.holidayKey, args.resolvedSectionSignals);
}

// Empty-state contract: caller MUST emit { emptyReason: 'no_viable_combo' }
// on the response when comboCount > 0 but planCombos returns zero combos.
// Mirrors ORCH-0677 emptyReason precedent.
export const COMBO_EMPTY_REASON = 'no_viable_combo' as const;
