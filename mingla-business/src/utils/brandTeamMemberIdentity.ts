/**
 * issue #4271 — what the brand team screen shows for an accepted member.
 *
 * Names and emails come from rpc biz_brand_team_members (callable by any
 * accepted member of the brand). The screen shows display_name, falling back to
 * the email, then "Team member"; the email line falls back to empty. A raw
 * user id is NEVER shown: it is not a name, and it leaks an internal key.
 */

export interface BrandTeamDirectoryEntry {
  userId: string;
  role: string | null;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  joinedAt: string | null;
}

export interface TeamMemberIdentity {
  name: string;
  email: string;
  avatarUrl: string | null;
}

export const TEAM_MEMBER_FALLBACK_NAME = "Team member";

const clean = (value: string | null | undefined, userId: string): string | null => {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return null;
  // Defence in depth: a source that echoes the id back is not a name.
  if (trimmed === userId) return null;
  return trimmed;
};

export const teamMemberIdentity = (
  userId: string,
  entry: BrandTeamDirectoryEntry | null | undefined,
): TeamMemberIdentity => {
  const displayName = clean(entry?.displayName, userId);
  const email = clean(entry?.email, userId);
  return {
    name: displayName ?? email ?? TEAM_MEMBER_FALLBACK_NAME,
    email: email ?? "",
    avatarUrl: clean(entry?.avatarUrl, userId),
  };
};

export const parseBrandTeamDirectory = (data: unknown): BrandTeamDirectoryEntry[] => {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: unknown) => {
    if (typeof row !== "object" || row === null) return [];
    const r = row as Record<string, unknown>;
    if (typeof r.user_id !== "string" || r.user_id.length === 0) return [];
    const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
    return [{
      userId: r.user_id,
      role: s(r.role),
      displayName: s(r.display_name),
      email: s(r.email),
      avatarUrl: s(r.avatar_url),
      joinedAt: s(r.joined_at),
    }];
  });
};
