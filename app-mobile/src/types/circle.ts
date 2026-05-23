export type CircleTier = 'close' | 'friend' | 'extended';

export interface CirclePerson {
  userId: string;
  tier: CircleTier;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  hasBusinessApp: boolean;
  sortScore: number;
}

export interface CirclePage {
  people: CirclePerson[];
  limit: number;
  offset: number;
  hasMore: boolean;
}
