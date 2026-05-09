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
  "beta-feedback": [2],
  "session-creation-gate": [1],
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
  if (query.state.fetchStatus && query.state.fetchStatus !== "idle") return false;

  if (Array.isArray(queryKey)) {
    const firstKey = String(queryKey[0] ?? "");
    if (NEVER_PERSIST_ROOT_KEYS.has(firstKey)) return false;

    if (firstKey === "deck-cards") {
      const data = query.state.data as { cards?: unknown[] } | undefined;
      if (!data || !Array.isArray(data.cards) || data.cards.length === 0) {
        return false;
      }
    }
  }

  if (shouldRemoveForAuthChange(queryKey, currentUserId)) return false;

  return true;
}
