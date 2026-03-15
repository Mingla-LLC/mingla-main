/**
 * Shared utility for resolving a user's display name.
 * Ensures usernames, emails, and phone numbers are NEVER shown to other users.
 *
 * Fallback chain: display_name → first_name + last_name → fallback string
 */

interface ProfileLike {
  display_name?: string | null
  first_name?: string | null
  last_name?: string | null
  // These exist on profiles but must NEVER be used as display text
  username?: string | null
  email?: string | null
}

export function getDisplayName(
  profile: ProfileLike | null | undefined,
  fallback = 'Unknown',
): string {
  if (!profile) return fallback

  if (profile.display_name) return profile.display_name

  const first = profile.first_name?.trim()
  const last = profile.last_name?.trim()
  if (first && last) return `${first} ${last}`
  if (first) return first

  return fallback
}
