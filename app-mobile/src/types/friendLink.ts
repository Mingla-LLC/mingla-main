export type FriendLinkStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'unlinked'

export interface FriendLink {
  id: string
  requesterId: string
  targetId: string
  status: FriendLinkStatus
  requesterPersonId: string | null
  targetPersonId: string | null
  acceptedAt: string | null
  unlinkedAt: string | null
  unlinkedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface UserSearchResult {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
}

export interface SentFriendLink extends FriendLink {
  targetProfile: {
    display_name: string | null
    username: string | null
    avatar_url: string | null
  } | null
}

export interface SendLinkResponse {
  linkId: string
  status: 'pending'
}

export interface RespondLinkResponse {
  status: 'accepted' | 'declined'
  personId?: string
  linkedPersonId?: string
}
