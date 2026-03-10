export type FriendLinkStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'unlinked'
export type LinkConsentStatus = 'none' | 'pending_consent' | 'consented' | 'declined'

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
  linkStatus: LinkConsentStatus
  requesterLinkConsent: boolean
  targetLinkConsent: boolean
  linkedAt: string | null
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
  linkId?: string
  linkStatus?: string
  personId?: string
  linkedPersonId?: string
}
