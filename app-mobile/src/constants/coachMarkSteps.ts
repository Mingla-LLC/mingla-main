/**
 * Coach mark step definitions — ORCH-0635 refresh (Pass 2, 8-step variant).
 *
 * Step-to-target wiring is by numeric stepId only (see useCoachMark.ts).
 * The old `targetId` string field was dead metadata and has been removed.
 *
 * Spec: Mingla_Artifacts/outputs/DESIGN_ORCH-0635_COACH_MARK_REFRESH_SPEC.md §2
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
    id: 4,
    tab: 'home',
    title: 'Better together',
    description: 'Start a session, invite your crew, swipe the same deck together.',
    buttonLabel: 'Got it',
  },
  {
    id: 5,
    tab: 'home',
    title: 'Back to solo',
    description: 'Your deck, your rules. Tap Solo to switch back anytime.',
    buttonLabel: 'Got it',
  },
  {
    id: 6,
    tab: 'discover',
    title: 'Events, near you',
    description: 'Concerts, shows, experiences — all within reach.',
    buttonLabel: 'Got it',
    // Cutout covers the entire header panel (title + filter bar). With a large
    // top-of-screen target, the auto-positioned bubble would hug the bottom edge
    // awkwardly. Center on screen for a cleaner read.
    bubblePosition: 'center',
  },
  {
    id: 7,
    tab: 'connections',
    title: 'Your people',
    description: 'Friends, requests, blocks — everything social lives here.',
    buttonLabel: 'Got it',
  },
  {
    id: 8,
    tab: 'profile',
    title: 'Your rules',
    description: 'Privacy, notifications, language — all in Account Settings.',
    buttonLabel: 'Got it',
  },
  {
    id: 9,
    tab: 'profile',
    title: 'Tell us what works',
    description: "Love something? Spot a bug? Tap here — we read every one.",
    buttonLabel: "You're set",
  },
];

export const COACH_STEP_COUNT = COACH_STEPS.length;
