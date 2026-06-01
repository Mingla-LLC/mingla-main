/**
 * Coach mark step definitions — ORCH-1037 + ORCH-1035 (11-step variant).
 *
 * ORCH-1029: steps 4/5 ("Better together"/"Back to solo") deleted — META-ORCH-0929
 * made Home solo-only — leaving a contiguous 7-step tour.
 *
 * ORCH-1037 [exact-target determinism] + ORCH-1035 [content expansion]: the tour
 * grew 7 → 11. Four NEW steps were added (Trips, the + button, Your interests,
 * Your circle) and every existing trailing step was renumbered. Final order is
 * driven by tab (home → discover → connections → profile) and within-screen
 * reading order:
 *   1 Deck · 2 Preferences · 3 Likes        (home — unchanged ids)
 *   4 Events tab · 5 Trips tab              (discover)
 *   6 People icon · 7 + button              (connections)
 *   8 Interests · 9 Circle · 10 Account · 11 Share Feedback (profile, scroll steps)
 *
 * ⚠ LOCKSTEP-RENUMBER WARNING: step-to-target wiring is by numeric stepId only
 * (see useCoachMark.ts). EVERY useCoachMark(<id>), registerTargetScrollOffset(<id>),
 * and the SCROLL_STEPS literal in CoachMarkContext (= new Set([8,9,10,11])) MUST
 * match the ids below. A mismatch orphans a step's target (the dev-time warning in
 * useCoachMark.ts + the happy-path bijection test catch it). The old `targetId`
 * string field was dead metadata and was removed in ORCH-1029.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-1037-1035_COACHMARK_DETERMINISM_AND_EXPANSION.md §5
 *       Mingla_Artifacts/specs/SPEC_ORCH-1029_COACH_MARK_FIXES.md §3.F-2 (lineage)
 */
export interface CoachStep {
  id: number;
  tab: 'home' | 'discover' | 'connections' | 'profile';
  title: string;
  description: string;
  buttonLabel: string;
  /** Override bubble position. 'auto' (default) places the bubble above/below the
   *  cutout. 'center' renders the bubble in the middle of the screen — useful when
   *  the cutout is large (e.g. a full screen section) and the bubble shouldn't hug it. */
  bubblePosition?: 'auto' | 'center';
}

export const COACH_STEPS: CoachStep[] = [
  {
    id: 1,
    tab: 'home',
    title: 'Meet your deck',
    description: 'Swipe right to save, left to pass. Tap any card for the full story.',
    buttonLabel: 'Got it',
  },
  {
    id: 2,
    tab: 'home',
    title: 'Your taste, your rules',
    description: "Dial in your vibe — categories, budget, distance. It's all here.",
    buttonLabel: 'Got it',
  },
  {
    id: 3,
    tab: 'home',
    title: 'Where your saves live',
    description: 'Every card you save lands in Likes. Scheduled plans too.',
    buttonLabel: 'Got it',
  },
  {
    // ORCH-1037: now targets the small Events tab Pressable (not the whole header
    // panel), so the bubble hugs the pill like every other small target — the
    // 'center' override was a band-aid for the too-broad target and is removed.
    id: 4,
    tab: 'discover',
    title: 'Events, near you',
    description: 'Concerts, shows, experiences — all within reach.',
    buttonLabel: 'Got it',
  },
  {
    // ORCH-1035 NEW: Trips tab (ORCH-1016 travel reframing).
    id: 5,
    tab: 'discover',
    title: 'Trips, ready when you are',
    description: 'Weekend escapes, big adventures — plan the whole thing here.',
    buttonLabel: 'Got it',
  },
  {
    id: 6,
    tab: 'connections',
    title: 'Your people',
    description: 'Friends, requests, blocks — everything social lives here.',
    buttonLabel: 'Got it',
  },
  {
    // ORCH-1035 NEW: the + button opens the FriendsActionChooser — pair a friend
    // AND start a shared group chat (the chooser does exactly both).
    id: 7,
    tab: 'connections',
    title: 'Pair up, plan together',
    description: 'Tap + to pair with a friend and start a shared group chat.',
    buttonLabel: 'Got it',
  },
  {
    // ORCH-1035 NEW: Interests card (scroll step).
    id: 8,
    tab: 'profile',
    title: 'Your interests',
    description: "Tell us what you're into — your deck gets sharper every time.",
    buttonLabel: 'Got it',
  },
  {
    // ORCH-1035 NEW: Your Circle card (scroll step).
    id: 9,
    tab: 'profile',
    title: 'Your circle',
    description: 'The people you plan with, all in one place.',
    buttonLabel: 'Got it',
  },
  {
    id: 10,
    tab: 'profile',
    title: 'Your rules',
    description: 'Privacy, notifications, language — all in Account Settings.',
    buttonLabel: 'Got it',
  },
  {
    id: 11,
    tab: 'profile',
    title: 'Tell us what works',
    description: "Love something? Spot a bug? Tap here — we read every one.",
    buttonLabel: "You're set",
  },
];

export const COACH_STEP_COUNT = COACH_STEPS.length;
