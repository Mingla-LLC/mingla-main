// #4265 — how long Profile reuses its cached sections when the tab is opened again.
//
// Inactive tabs unmount, so every tap on Profile mounts fresh observers, and
// React Query refetches any query older than that observer's staleTime. Profile's
// sections used 30–60 s windows, so moving between tabs for a minute re-sent
// ~20 requests per visit even though the app default is five minutes.
//
// PROFILE_REVISIT_STALE_MS (five minutes) is used ONLY for sections that change
// through the user's own actions, which already invalidate the key, through
// Realtime, or on app resume (useForegroundRefresh):
//   - friends count     — friend actions + Realtime
//   - purchases card    — checkout / refund flows
//   - brands you follow + follower counts — follow / unfollow
// The full screens behind these cards (Purchases, Friends) keep their own
// shorter windows.
export const PROFILE_REVISIT_STALE_MS = 5 * 60_000;

// PROFILE_SERVER_DRIVEN_STALE_MS (60 s, the pre-#4265 window) is for sections
// the SERVER changes with no client mutation to invalidate them: the level / XP
// (awarded by server-side activity) and Creator programs (admin approvals,
// program and gig status, payouts). A five-minute window there would show a
// stale level or creator status for minutes after it changed.
export const PROFILE_SERVER_DRIVEN_STALE_MS = 60_000;
