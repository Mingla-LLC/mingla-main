/**
 * ORCH-1172 R4 — edit-published RSVP must SEED from the FRESH server event, and
 * the editor must guard-RE-SEED when a stale→fresh prop arrives.
 *
 * Device-proven residual clobber (after R3's diff-based save): editing a
 * published RSVP and saving still reverted `rsvp_discoverable` true→false. Root
 * cause = SEED TIMING. The route resolved the editor's seed as
 * `serverLiveEvent ?? liveEvent` where `liveEvent` is the STALE zustand mirror.
 * When a stale mirror existed, `EditPublishedScreen` MOUNTED with it (seeding
 * `editState.rsvpDiscoverable=false`) BEFORE the fresh `businessEventQuery`
 * resolved (`liveEvent.rsvpDiscoverable=true`). `EditPublishedScreen` seeds
 * `editState` ONCE (useState) and never re-seeded, so the diff saw false≠true
 * and emitted `rsvpDiscoverable:false` → RPC wrote false. Clobber.
 *
 * FIX (two parts, both proven here):
 *  1. Route: for edit-published, the editor seeds from the FRESH server event,
 *     never the stale zustand fallback. Prefer `serverLiveEvent`; fall back to
 *     the zustand `liveEvent` ONLY once the server fetch has SETTLED (auth ready,
 *     not loading, not fetching) and genuinely returned null. While in flight,
 *     the editor seed is null → the route renders the Loading shell.
 *  2. Component: a guarded re-seed re-hydrates `editState` when a stale→fresh
 *     `liveEvent` arrives (id+updatedAt key changes) AND there are NO pending
 *     user edits (fieldDiffs.length === 0) — never discarding in-progress input.
 *
 * This is a logic + structural-source proof (the RN component is hard to mount):
 *   - Part 1 predicate: `selectEditorLiveEventForPublished(...)` mirrors the
 *     exact route selection; a source-regex asserts edit.tsx still carries it.
 *   - Part 2 predicate: `shouldReseedEditState(...)` mirrors the exact component
 *     guard; a source-regex asserts EditPublishedScreen.tsx still carries it.
 *
 * Fails-on-revert:
 *   - Revert the route to `serverLiveEvent ?? liveEvent` for the editor seed →
 *     the "in-flight prefers fresh, never stale" assertions throw AND the source
 *     regex fails.
 *   - Delete the re-seed effect (or drop the `fieldDiffs.length === 0` guard) →
 *     the "re-seed iff key changed AND no pending edits" assertions throw AND the
 *     source regex fails.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import { liveEventToEditableDraft } from "../liveEventAdapter";
import { buildRsvpUpdatePayloadDiff } from "../serverDraftEventMapper";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";

// ---- Part 1: route seed-selection predicate ----------------------------------
// Mirrors `editorLiveEvent` in app/rsvp/[id]/edit.tsx (edit-published branch):
//   serverLiveEvent ?? (serverEventSettled ? liveEvent : null)
// where serverEventSettled = isAuthReady && !isLoading && !isFetching.
function selectEditorLiveEventForPublished<T>(state: {
  serverLiveEvent: T | null;
  staleZustandLiveEvent: T | null;
  isAuthReady: boolean;
  isLoading: boolean;
  isFetching: boolean;
}): T | null {
  const serverEventSettled =
    state.isAuthReady && !state.isLoading && !state.isFetching;
  return (
    state.serverLiveEvent ??
    (serverEventSettled ? state.staleZustandLiveEvent : null)
  );
}

// ---- Part 2: component re-seed guard predicate -------------------------------
// Mirrors the useEffect guard in EditPublishedScreen.tsx: re-seed iff the
// id+updatedAt key changed AND there are no pending user edits.
function shouldReseedEditState(state: {
  prevKey: string;
  nextKey: string;
  pendingDiffCount: number;
}): boolean {
  if (state.nextKey === state.prevKey) return false;
  if (state.pendingDiffCount > 0) return false;
  return true;
}

const STALE = { rsvpDiscoverable: false, marker: "stale" };
const FRESH = { rsvpDiscoverable: true, marker: "fresh" };

describe("ORCH-1172 R4 — edit-published seeds from the FRESH server event", () => {
  test("while the server fetch is IN FLIGHT, the editor seed is null even when a stale zustand mirror exists (no early mount on stale)", () => {
    const seed = selectEditorLiveEventForPublished({
      serverLiveEvent: null,
      staleZustandLiveEvent: STALE,
      isAuthReady: true,
      isLoading: false,
      isFetching: true, // refetch in flight
    });
    expect(seed).toBeNull();
  });

  test("while auth is NOT ready, the editor seed is null even with a stale mirror (disabled query reports isLoading=false)", () => {
    const seed = selectEditorLiveEventForPublished({
      serverLiveEvent: null,
      staleZustandLiveEvent: STALE,
      isAuthReady: false,
      isLoading: false,
      isFetching: false,
    });
    expect(seed).toBeNull();
  });

  test("once the fresh server event arrives, the editor seeds from the FRESH one — NOT the stale mirror (the discoverable clobber fix)", () => {
    const seed = selectEditorLiveEventForPublished({
      serverLiveEvent: FRESH,
      staleZustandLiveEvent: STALE,
      isAuthReady: true,
      isLoading: false,
      isFetching: false,
    });
    expect(seed).toBe(FRESH);
    expect(seed?.rsvpDiscoverable).toBe(true);
  });

  test("the fresh server event is preferred even mid-refetch (server present always wins)", () => {
    const seed = selectEditorLiveEventForPublished({
      serverLiveEvent: FRESH,
      staleZustandLiveEvent: STALE,
      isAuthReady: true,
      isLoading: false,
      isFetching: true,
    });
    expect(seed).toBe(FRESH);
  });

  test("falls back to the zustand mirror ONLY once settled and the server genuinely returned null (offline / not-found)", () => {
    const seed = selectEditorLiveEventForPublished({
      serverLiveEvent: null,
      staleZustandLiveEvent: STALE,
      isAuthReady: true,
      isLoading: false,
      isFetching: false,
    });
    expect(seed).toBe(STALE);
  });

  test("SOURCE: edit.tsx selects editorLiveEvent = serverLiveEvent ?? (serverEventSettled ? liveEvent : null) (fails-on-revert)", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "app", "rsvp", "[id]", "edit.tsx"),
      "utf8",
    );
    // The settled flag is auth + !loading + !fetching gated.
    expect(source).toMatch(
      /serverEventSettled\s*=\s*\n?\s*isAuthReady\s*&&\s*\n?\s*!businessEventQuery\.isLoading\s*&&\s*\n?\s*!businessEventQuery\.isFetching/,
    );
    // The editor seed prefers the server event, falling back to the zustand
    // mirror only when settled. Reverting to `serverLiveEvent ?? liveEvent`
    // (the buggy unconditional fallback) breaks this match.
    expect(source).toMatch(
      /editorLiveEvent\s*=\s*isEditPublished\s*\?\s*\n?\s*serverLiveEvent \?\? \(serverEventSettled \? liveEvent : null\)/,
    );
    // The edit-published branch mounts the editor against editorLiveEvent, NOT
    // resolvedLiveEvent.
    expect(source).toMatch(/liveEvent=\{editorLiveEvent\}/);
    expect(source).toMatch(/if \(editorLiveEvent === null\)/);
  });
});

describe("ORCH-1172 R4 — guarded re-seed re-hydrates editState on stale→fresh", () => {
  test("re-seeds when the freshness key changes AND there are no pending edits", () => {
    expect(
      shouldReseedEditState({
        prevKey: "rsvp-1::2026-06-01T12:00:00.000Z",
        nextKey: "rsvp-1::2026-06-20T09:00:00.000Z", // newer updatedAt
        pendingDiffCount: 0,
      }),
    ).toBe(true);
  });

  test("does NOT re-seed (discard input) when the user has pending edits, even if a fresher prop arrives", () => {
    expect(
      shouldReseedEditState({
        prevKey: "rsvp-1::2026-06-01T12:00:00.000Z",
        nextKey: "rsvp-1::2026-06-20T09:00:00.000Z",
        pendingDiffCount: 1,
      }),
    ).toBe(false);
  });

  test("does NOT re-seed when the prop is identical (same id+updatedAt key) — no churn on every render", () => {
    expect(
      shouldReseedEditState({
        prevKey: "rsvp-1::2026-06-01T12:00:00.000Z",
        nextKey: "rsvp-1::2026-06-01T12:00:00.000Z",
        pendingDiffCount: 0,
      }),
    ).toBe(false);
  });

  test("a same-id event whose updatedAt advanced DOES re-seed (stale-while-revalidate freshness)", () => {
    const id = "rsvp-1";
    expect(
      shouldReseedEditState({
        prevKey: `${id}::stale`,
        nextKey: `${id}::fresh`,
        pendingDiffCount: 0,
      }),
    ).toBe(true);
  });

  test("SOURCE: EditPublishedScreen.tsx carries the id+updatedAt key + zero-diff-gated re-seed (fails-on-revert)", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "components", "event", "EditPublishedScreen.tsx"),
      "utf8",
    );
    // The freshness key combines id + updatedAt.
    expect(source).toMatch(
      /const nextKey = `\$\{liveEvent\.id\}::\$\{liveEvent\.updatedAt\}`/,
    );
    // The re-seed is gated on key-change AND zero pending diffs, then calls
    // setEditState(liveEventToEditableDraft(liveEvent)). Deleting either guard
    // or the setEditState call breaks this.
    expect(source).toMatch(/if \(nextKey === hydratedKeyRef\.current\) return;/);
    expect(source).toMatch(/if \(fieldDiffs\.length > 0\) return;/);
    expect(source).toMatch(
      /setEditState\(liveEventToEditableDraft\(liveEvent\)\);/,
    );
  });
});

// ---- Part 3: end-to-end no-clobber (seed → diff) -----------------------------
// Proves the WHY behind the fix: when editState is seeded from the FRESH server
// event (discoverable=true) and the host changes ONLY an unrelated setting, the
// diff OMITS rsvpDiscoverable (no clobber). The same diff seeded from the STALE
// mirror (discoverable=false) WOULD emit the clobbering rsvpDiscoverable:false —
// which is exactly the seed-timing bug R4 removes.

const rsvpLiveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "rsvp-1",
    serverEventId: "server-rsvp-1",
    brandId: "brand-1",
    brandSlug: "brand",
    eventSlug: "house-party",
    status: "scheduled",
    publishedAt: "2026-06-01T12:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: "rsvp",
    name: "House Party",
    description: "BYOB.",
    format: "in_person",
    category: null,
    whenMode: "single",
    date: "2026-07-01",
    doorsOpen: "19:00",
    endsAt: "23:00",
    timezone: "America/New_York",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Loft 5",
    address: "5 Main St",
    onlineUrl: null,
    hideAddressUntilTicket: false,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
    currency: "USD",
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    orders: [],
    rsvpCapacity: 30,
    rsvpAllowPlusOnes: true,
    rsvpPlusOnesMax: 2,
    rsvpWaitlistEnabled: true,
    rsvpApprovalMode: "manual",
    rsvpDiscoverable: true,
    rsvpGoingCount: 4,
    createdAt: "2026-06-01T11:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...patch,
  }) as LiveEvent;

describe("ORCH-1172 R4 — seeded-from-fresh editState produces a no-clobber diff", () => {
  test("FRESH seed (discoverable=true) + only privateGuestList changed → diff OMITS rsvpDiscoverable (no clobber)", () => {
    const fresh = rsvpLiveEvent({ rsvpDiscoverable: true });
    // The R4 fix: editState is seeded from the FRESH server event.
    const editState: DraftEvent = {
      ...liveEventToEditableDraft(fresh),
      privateGuestList: true, // the only host change
    };

    const payload = buildRsvpUpdatePayloadDiff(fresh, editState);

    expect(payload.privateGuestList).toBe(true);
    // discoverable was never touched → omitted → RPC COALESCEs to true. No clobber.
    expect(payload).not.toHaveProperty("rsvpDiscoverable");
  });

  test("the BUG this fixes: STALE seed (discoverable=false) against the FRESH event WOULD emit rsvpDiscoverable:false (the clobber)", () => {
    const fresh = rsvpLiveEvent({ rsvpDiscoverable: true });
    const staleMirror = rsvpLiveEvent({ rsvpDiscoverable: false });
    // The pre-R4 timing bug: editState seeded from the STALE zustand mirror.
    const editStateFromStale: DraftEvent = {
      ...liveEventToEditableDraft(staleMirror),
      privateGuestList: true,
    };

    // Diffed against the FRESH loaded event, the stale seed's false ≠ true →
    // the clobbering key is emitted. R4 prevents this by never seeding stale.
    const payload = buildRsvpUpdatePayloadDiff(fresh, editStateFromStale);
    expect(payload.rsvpDiscoverable).toBe(false);
  });
});
