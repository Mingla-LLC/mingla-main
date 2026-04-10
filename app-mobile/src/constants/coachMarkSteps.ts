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
    description: 'Each session gets its own vibe. Tap the gear to set what the group wants.',
    buttonLabel: 'Got it',
  },
  {
    id: 6,
    tab: 'discover',
    targetId: 'coach-discover-map',
    title: 'Your Playground',
    description: 'Places and people, all on the map. Tap any pin to dig in, or filter your view.',
    buttonLabel: 'Got it',
  },
  {
    id: 7,
    tab: 'connections',
    targetId: 'coach-add-friend',
    title: 'Find Your People',
    description: "Search by name, email, or phone. Your crew is out there \u2014 go find them.",
    buttonLabel: 'Got it',
  },
  {
    id: 8,
    tab: 'connections',
    targetId: 'coach-chat',
    title: 'Plan the Move',
    description: 'Message friends and share your saves. Plot the next outing right here.',
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
