export type CircleTier = 'close' | 'friend' | 'extended';
export type CircleRelationshipSource =
  | 'paired'
  | 'friend'
  | 'friend_of_friend'
  | 'co_attendee'
  | 'mixed'
  // #4508 1.23 — a close friend made when they claimed the RSVP pass you
  // saved them ("Close friend" · "through {event}").
  | 'rsvp_guest';
export type CircleRelationshipContextType = 'user' | 'event' | 'trip';

export interface CirclePerson {
  userId: string;
  tier: CircleTier;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  hasBusinessApp: boolean;
  relationshipSource: CircleRelationshipSource;
  relationshipLabel: string;
  relationshipContextType: CircleRelationshipContextType | null;
  relationshipContextId: string | null;
  relationshipContextTitle: string | null;
  relationshipSourceCount: number;
  sortScore: number;
}

export interface CirclePage {
  people: CirclePerson[];
  limit: number;
  offset: number;
  hasMore: boolean;
}
