export type CircleTier = 'close' | 'friend' | 'extended';
export type CircleRelationshipSource =
  | 'paired'
  | 'friend'
  | 'friend_of_friend'
  | 'co_attendee'
  | 'mixed';
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
