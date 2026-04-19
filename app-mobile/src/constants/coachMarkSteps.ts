export interface CoachStep {
  id: number;
  tab: 'home' | 'discover' | 'connections' | 'profile';
  targetId: string;
  title: string;
  description: string;
  buttonLabel: string;
}

export const COACH_STEPS: CoachStep[] = [
  {
    id: 1,
    tab: 'home',
    targetId: 'coach-card-deck',
    title: 'Meet Your Deck',
    description: 'Swipe right to save, left to pass. Tap any card for the full scoop.',
    buttonLabel: 'Got it',
  },
  {
    id: 2,
    tab: 'home',
    targetId: 'coach-preferences-btn',
    title: 'Your Taste, Your Rules',
    description: "Tell us what you're craving \u2014 categories, budget, how far you'll go.",
    buttonLabel: 'Got it',
  },
  {
    id: 3,
    tab: 'home',
    targetId: 'coach-card-tap',
    title: 'Lock It In',
    description: 'Tap any card to expand it. Save for later or schedule it \u2014 your call.',
    buttonLabel: 'Got it',
  },
  {
    id: 4,
    tab: 'home',
    targetId: 'coach-create-session',
    title: 'Better Together',
    description: 'Start a session, invite your crew, and swipe the same deck together.',
    buttonLabel: 'Got it',
  },
  {
    id: 5,
    tab: 'home',
    targetId: 'coach-collab-prefs',
    title: 'Set the Mood',
    description: "Tap a session pill and this icon turns orange. Set your preferences \u2014 cards are built from what everyone picks, so make yours count.",
    buttonLabel: 'Got it',
  },
  {
    id: 6,
    tab: 'home',
    targetId: 'coach-solo-pill',
    title: 'Back to You',
    description: "Done planning with the group? Tap Solo to switch back to your own deck and preferences.",
    buttonLabel: 'Got it',
  },
  {
    id: 7,
    tab: 'discover',
    targetId: 'coach-discover-feed',
    title: "What's Happening",
    description: 'Browse concerts, events, and experiences near you. Filter by genre, date, or price.',
    buttonLabel: 'Got it',
  },
  {
    id: 8,
    tab: 'connections',
    targetId: 'coach-chat-header',
    title: 'Your Social Hub',
    description: 'Message friends, manage your circle, send pair requests, and invite people with a link. Everything social lives here.',
    buttonLabel: 'Got it',
  },
  {
    id: 9,
    tab: 'profile',
    targetId: 'coach-privacy',
    title: 'On Your Terms',
    description: 'Control who sees you and what you share. Nobody gets in without your say-so.',
    buttonLabel: 'Got it',
  },
  {
    id: 10,
    tab: 'profile',
    targetId: 'coach-feedback',
    title: "We're All Ears",
    description: "Got thoughts? Record a quick voice note \u2014 bugs, ideas, vibes. We hear every one.",
    buttonLabel: "Let's go!",
  },
];

export const COACH_STEP_COUNT = COACH_STEPS.length;
