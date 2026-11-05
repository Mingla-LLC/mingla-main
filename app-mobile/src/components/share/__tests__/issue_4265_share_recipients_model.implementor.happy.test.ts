// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — the share sheet's "Send in Mingla" list, driven behaviourally:
//   * cached rows show at once: placeholders appear ONLY when there is no list
//     yet (first-ever open), never over a cached list while it refreshes;
//   * search text, initials and the second line are worked out once per fetch
//     (the React Query `select`); typing filters on the precomputed text and
//     never touches the raw name again; an empty query keeps the same array;
//   * fixed 60pt rows, offsets counted below the measured list header;
//   * the recipients key is per user, removed on logout / account switch and
//     never persisted without a user id.
//
// FAILS-ON-REVERT: making shareRecipientListPhase return 'placeholder' while a
// fetch is in flight (the old `recipientsLoading ? skeletons` rule), filtering on
// `displayName.toLocaleLowerCase()` per row, or dropping the user id from
// contentShareRecipientKeys.list fails here.

import {
  SHARE_RECIPIENT_ROW_HEIGHT,
  filterShareRecipients,
  indexShareRecipients,
  normalizeShareSearch,
  shareRecipientItemLayout,
  shareRecipientListPhase,
} from "../shareRecipientsModel.ts";
import { contentShareRecipientKeys } from "../../../hooks/queryKeys.ts";
import {
  shouldDehydrateMinglaQuery,
  shouldRemoveForAuthChange,
} from "../../../utils/queryPersistence.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const recipient = (key: string, displayName: string, extra = {}) => ({
  key,
  targetKind: "direct",
  targetId: `t-${key}`,
  personUserId: null,
  displayName,
  username: null,
  avatarUrl: null,
  conversationId: `c-${key}`,
  participantCount: null,
  recipientTier: 1,
  meaningfulActivityAt: "2026-11-01T10:00:00Z",
  conversationCreatedAt: null,
  ...extra,
});

const USER = "8f0e4b8e-6a43-4c55-9d4f-0c7b9f2b1a11";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

Deno.test("cached rows render at once; placeholders only on a first-ever open", () => {
  // Reopen: a cached list exists and a background refresh is running.
  assertEquals(
    shareRecipientListPhase({ hasData: true, totalCount: 5, visibleCount: 5, fetching: true, failed: false }),
    "list",
    "a cached list is shown while it refreshes — no placeholder flash",
  );
  // First-ever open: nothing cached, fetch in flight.
  assertEquals(
    shareRecipientListPhase({ hasData: false, totalCount: 0, visibleCount: 0, fetching: true, failed: false }),
    "placeholder",
    "placeholder rows only when there is no list at all yet",
  );
  // First-ever open that failed: the error row (in the header) stands alone.
  assertEquals(
    shareRecipientListPhase({ hasData: false, totalCount: 0, visibleCount: 0, fetching: false, failed: true }),
    "error-only",
    "a failed first load shows the error, not endless placeholders",
  );
  assertEquals(
    shareRecipientListPhase({ hasData: true, totalCount: 0, visibleCount: 0, fetching: true, failed: false }),
    "empty",
    "a cached empty list keeps its empty-state copy while refreshing",
  );
  assertEquals(
    shareRecipientListPhase({ hasData: true, totalCount: 4, visibleCount: 0, fetching: false, failed: false }),
    "no-results",
    "a search with no match shows the no-results row",
  );
});

Deno.test("indexing runs once per fetch: search text, initials and second line precomputed", () => {
  const rows = indexShareRecipients([
    recipient("a", "Ada Okafor", { username: "AdaO" }),
    recipient("g", "Friday crew", { targetKind: "group", participantCount: 6 }),
    recipient("f", "Tolu B", { targetKind: "friend", conversationId: null }),
    recipient("d", "Kemi", { conversationId: null }),
  ]);
  assertEquals(rows.map((row) => row.searchText), ["ada okafor adao", "friday crew ", "tolu b ", "kemi "], "search text");
  assertEquals(rows.map((row) => row.initials), ["AO", "FC", "TB", "K"], "initials");
  assertEquals(
    rows.map((row) => row.metaLabel),
    ["Recent chat", "Group chat · 6", "Friend · chat starts when sent", "Direct chat"],
    "second line keeps today's copy",
  );
  assert(rows[0].key === "a" && rows[0].targetId === "t-a", "the recipient fields are kept for sending");
});

Deno.test("typing filters on the precomputed text and never re-reads the raw name", () => {
  const rows = indexShareRecipients([recipient("a", "Ada Okafor"), recipient("b", "Bayo")]);
  let rawReads = 0;
  const watched = rows.map((row) => {
    const copy = { ...row };
    const name = row.displayName;
    Object.defineProperty(copy, "displayName", { get: () => { rawReads += 1; return name; } });
    Object.defineProperty(copy, "username", { get: () => { rawReads += 1; return null; } });
    return copy;
  });
  for (const query of ["a", "ad", "ada", "bay", ""]) filterShareRecipients(watched, normalizeShareSearch(query));
  assertEquals(rawReads, 0, "per-keystroke filtering must not lowercase names again");
  assertEquals(filterShareRecipients(rows, normalizeShareSearch("  ADA ")).map((row) => row.key), ["a"], "case/space-insensitive match");
  assert(filterShareRecipients(rows, normalizeShareSearch("")) === rows, "an empty query keeps the SAME array (list data identity)");
});

Deno.test("fixed 60pt rows, offsets below the measured header", () => {
  assertEquals(SHARE_RECIPIENT_ROW_HEIGHT, 60, "design: 60pt rows");
  assertEquals(shareRecipientItemLayout(0, 420), { length: 60, offset: 420, index: 0 }, "first row sits under the header");
  assertEquals(shareRecipientItemLayout(3, 420), { length: 60, offset: 600, index: 3 }, "rows stack at 60pt");
});

Deno.test("recipients are cached per user and cleared on logout / account switch", () => {
  const key = contentShareRecipientKeys.list(USER);
  assertEquals(key, ["contentShareRecipients", "list", USER], "one key per user, from the factory");
  assert(shouldRemoveForAuthChange(key, null), "logout removes the cached people and chats");
  assert(shouldRemoveForAuthChange(key, OTHER), "switching account removes the other person's list");
  assert(!shouldRemoveForAuthChange(key, USER), "the same user keeps the list");
  const settled = { status: "success", fetchStatus: "idle", data: [] };
  assert(shouldDehydrateMinglaQuery({ queryKey: key, state: settled }, USER), "persisted for its own user (instant reopen)");
  assert(!shouldDehydrateMinglaQuery({ queryKey: key, state: settled }, OTHER), "never persisted under another user");
  assert(
    !shouldDehydrateMinglaQuery({ queryKey: contentShareRecipientKeys.list("signed-out"), state: settled }, null),
    "a list with no user id is never written to disk",
  );
});
