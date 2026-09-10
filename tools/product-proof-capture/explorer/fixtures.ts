export const EXPLORER_FIXTURE_IDS = {
  saved: "sample-saved-3176",
  session: "sample-session-3176",
  personA: "sample-person-ava-3176",
  personB: "sample-person-noah-3176",
  rsvp: "sample-rsvp-3176",
} as const;

export const sampleSavedCard = {
  id: EXPLORER_FIXTURE_IDS.saved,
  title: "Sample sunset gallery plan",
  category: "Arts & Culture",
  categoryIcon: "color-palette-outline",
  image: "",
  images: [],
  rating: 4.8,
  reviewCount: 126,
  priceRange: "$$",
  priceTier: "comfy",
  travelTime: "12 min",
  description: "A saved sample plan for an easy gallery evening.",
  fullDescription: "A saved sample plan with time for art, conversation and a relaxed walk afterwards.",
  address: "Sample Arts District",
  highlights: ["Gallery", "Sunset walk", "Easy to share"],
  matchScore: 92,
  socialStats: { views: 0, likes: 0, saves: 1 },
  dateAdded: "2026-09-10T18:00:00.000Z",
  source: "solo" as const,
  lat: 0,
  lng: 0,
  openingHours: null,
};

export const sampleParticipants = [
  { id: "participant-a", user_id: EXPLORER_FIXTURE_IDS.personA, session_id: EXPLORER_FIXTURE_IDS.session, has_accepted: true, profiles: { id: EXPLORER_FIXTURE_IDS.personA, username: "sample_ava", display_name: "Sample Ava", first_name: "Sample", last_name: "Ava" } },
  { id: "participant-b", user_id: EXPLORER_FIXTURE_IDS.personB, session_id: EXPLORER_FIXTURE_IDS.session, has_accepted: true, profiles: { id: EXPLORER_FIXTURE_IDS.personB, username: "sample_noah", display_name: "Sample Noah", first_name: "Sample", last_name: "Noah" } },
] as const;

export const sampleMessages = [
  { id: "sample-message-1", session_id: EXPLORER_FIXTURE_IDS.session, user_id: EXPLORER_FIXTURE_IDS.personA, content: "The sunset slot works for me.", created_at: "2026-09-10T18:00:00.000Z", updated_at: "2026-09-10T18:00:00.000Z", profiles: sampleParticipants[0].profiles, reactions: [] },
  { id: "sample-message-2", session_id: EXPLORER_FIXTURE_IDS.session, user_id: EXPLORER_FIXTURE_IDS.personB, content: "Perfect — I saved the gallery plan.", created_at: "2026-09-10T18:02:00.000Z", updated_at: "2026-09-10T18:02:00.000Z", profiles: sampleParticipants[1].profiles, reactions: [{ id: "sample-reaction-1", message_id: "sample-message-2", user_id: EXPLORER_FIXTURE_IDS.personA, emoji: "❤️", created_at: "2026-09-10T18:03:00.000Z" }], reply_to: { id: "sample-message-1", session_id: EXPLORER_FIXTURE_IDS.session, user_id: EXPLORER_FIXTURE_IDS.personA, content: "The sunset slot works for me.", created_at: "2026-09-10T18:00:00.000Z", updated_at: "2026-09-10T18:00:00.000Z", profiles: sampleParticipants[0].profiles } },
] as const;

export const sampleRsvpRow = {
  rsvpId: EXPLORER_FIXTURE_IDS.rsvp,
  guestId: null,
  role: "primary" as const,
  qrCode: "mingla-demo://not-valid/sample-rsvp-3176",
  status: "going",
  approvalStatus: "approved",
  plusGuestNames: [],
  displayName: "Sample Explorer",
  coverMediaUrl: null,
  eventId: "sample-event-3176",
  eventTitle: "Sample rooftop listening session",
  eventSlug: "sample-rooftop-listening-session",
  brandName: "Sample City Sessions",
  masterDateUtc: "2026-10-17T23:00:00.000Z",
  masterDateEndUtc: "2026-10-18T02:00:00.000Z",
  timezone: "America/New_York",
  venue: { locationText: "Sample Rooftop, City Center", isOnline: false, onlineUrl: null },
  invitedBy: null,
};
