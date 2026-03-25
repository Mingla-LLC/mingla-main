/**
 * Shared utility for resolving a user's display name.
 * Centralizes the fallback chain across all 17+ surfaces.
 *
 * Priority: first_name + last_name → first_name → display_name → username → fallback
 */

interface ProfileLike {
  display_name?: string | null
  first_name?: string | null
  last_name?: string | null
  username?: string | null
  email?: string | null
}

export function getDisplayName(
  profile: ProfileLike | null | undefined,
  fallback = 'Someone',
): string {
  if (!profile) return fallback

  const first = profile.first_name?.trim()
  const last = profile.last_name?.trim()
  if (first && last) return `${first} ${last}`
  if (first) return first

  if (profile.display_name?.trim()) return profile.display_name.trim()
  if (profile.username?.trim()) return profile.username.trim()

  return fallback
}
