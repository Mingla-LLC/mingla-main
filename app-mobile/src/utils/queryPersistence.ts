const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NEVER_PERSIST_ROOT_KEYS = new Set([
  "curated-experiences",
  "recommendations",
  "phone-lookup",
  "link-consent",
]);

const USER_ID_POSITIONS: Record<string, number[]> = {
  userPreferences: [1],
  friends: [2],
  subscription: [1, 2],
  calendarEntries: [1],
  notifications: [1],
  "phone-invites": [1],
  pairings: [1, 2],
  savedCards: [2],
  "profile-interests": [1],
  userLevel: [1],
  "session-creation-gate": [1],
  // #4265 — share-sheet recipients: contentShareRecipientKeys.list(userId).
  contentShareRecipients: [2],
};

type QueryLike = {
  queryKey: unknown;
  state: {
    status?: string;
    fetchStatus?: string;
    data?: unknown;
  };
};

export function isQueryCancellationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { name?: string; message?: string };
  const name = maybeError.name ?? "";
  const message = maybeError.message ?? "";
  return (
    name === "CancelledError" ||
    name === "CanceledError" ||
    name === "AuthStateCancelledError" ||
    name === "AbortError" ||
    message === "CancelledError" ||
    message.includes("CancelledError") ||
    message.includes("aborted")
  );
}

export function getUserIdFromQueryKey(queryKey: unknown): string | null {
  if (!Array.isArray(queryKey)) return null;
  const root = String(queryKey[0] ?? "");
  const positions = USER_ID_POSITIONS[root] ?? [];

  for (const position of positions) {
    const value = queryKey[position];
    if (typeof value === "string" && UUID_RE.test(value)) return value;
  }

  for (const value of queryKey) {
    if (typeof value === "string" && UUID_RE.test(value)) return value;
  }

  return null;
}

export function isAuthScopedQueryKey(queryKey: unknown): boolean {
  return getUserIdFromQueryKey(queryKey) !== null;
}

export function shouldRemoveForAuthChange(queryKey: unknown, currentUserId?: string | null): boolean {
  const keyUserId = getUserIdFromQueryKey(queryKey);
  if (!keyUserId) return false;
  return !currentUserId || keyUserId !== currentUserId;
}

export function shouldDehydrateMinglaQuery(query: QueryLike, currentUserId?: string | null): boolean {
  const queryKey = query.queryKey;

  if (query.state.status === "pending") return false;
  // Issue #4275: an Error stringifies to `{}`, so a persisted failed query came
  // back on the next launch as `error: {}`. Nothing worth keeping without data.
  if (query.state.status === "error" && query.state.data === undefined) return false;
  if (query.state.fetchStatus && query.state.fetchStatus !== "idle") return false;

  if (Array.isArray(queryKey)) {
    const firstKey = String(queryKey[0] ?? "");
    if (NEVER_PERSIST_ROOT_KEYS.has(firstKey)) return false;
    // #4265 — people and chats are private: never persist a copy that is not
    // tied to a signed-in user id (it could not be removed on account switch).
    if (firstKey === "contentShareRecipients" && getUserIdFromQueryKey(queryKey) === null) {
      return false;
    }

    // #4265: the Home deck is never written into the React Query cache any more.
    // It was 1.19 MB of the 1.87 MB blob (125 cards x ~10 KB) and pushed the whole
    // cache past the startup guard; its cold start is now owned by its own
    // snapshot (src/utils/deckSnapshot.ts). Excluding it also keeps the
    // ORCH-0469 rule (an empty deck must never be persisted) trivially true.
    if (firstKey === "deck-cards") return false;
  }

  if (shouldRemoveForAuthChange(queryKey, currentUserId)) return false;

  return true;
}
