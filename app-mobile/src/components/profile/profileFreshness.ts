// #4265 — how long Profile reuses its cached sections when the tab is opened again.
//
// Inactive tabs unmount, so every tap on Profile mounts fresh observers, and
// React Query refetches any query older than that observer's staleTime. Profile's
// sections used 30–60 s windows (friends 30 s, brand follows 30 s, level,
// purchases, follower counts and creator programs 60 s), so moving between tabs
// for a minute re-sent ~20 requests per visit even though the app default is
// five minutes.
//
// Every one of these changes through the user's own actions, which already
// invalidate the key (follow/unfollow, checkout, friend actions, creator flows),
// through Realtime (friends), or on app resume (useForegroundRefresh), so a
// five-minute window only stops tab-switch refetches. The full screens behind
// these cards (Purchases, Friends, Creator) keep their own shorter windows.
export const PROFILE_REVISIT_STALE_MS = 5 * 60_000;
