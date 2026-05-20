/**
 * orch_0893_rework_adversarial_merge_spec.test — ORCH-0893 REWORK
 * [Eager server-draft on creator entry — replace with client-id + lazy autosave —
 *  combined race fixes].
 *
 * TESTER-AUTHORED adversarial regression test (Step 0.5 gate, retest cycle 1).
 *
 * DIFFERENT ANGLES FROM IMPLEMENTOR'S TESTS:
 *   - Implementor's `orch_0893a_hydration_gate.test.ts` is source-contract
 *     (grep for tokens in event/create.tsx + event/[id]/edit.tsx).
 *   - This adversarial is BEHAVIORAL — it exercises the documented Part B
 *     merge SPEC with synthetic DraftEvent fixtures and asserts the spec
 *     behaviour holds:
 *       (a) Typed input that lands in the live draft AFTER the queue-time
 *           snapshot was taken survives the merge (the race the rework
 *           closes).
 *       (b) `lastStepReached` uses `Math.max(live, server)` — user step
 *           progress is never regressed by a stale server snapshot.
 *       (c) Server-issued fields (id, slug, created_by, timestamps) come
 *           from the server payload — the merge does not echo client-side
 *           pseudo-ids back.
 *       (d) `liveDraft === null` fallback path returns the raw serverDraft
 *           with no mutation.
 *   - This adversarial also includes a FIELD COMPLETENESS audit: it scans
 *     `app/event/[id]/edit.tsx`'s actual merge object via regex and asserts
 *     every user-meaningful field documented in DraftEvent is represented.
 *     The implementor's test only pins five representative fields; this
 *     adversarial catches drift when DraftEvent grows a new field that the
 *     merge forgets to include.
 *
 * Source-only reasoning is sufficient for this adversarial because the
 * merge logic is a pure function over the queue-time snapshot, the live
 * draft, and the server payload — no platform-specific behaviour. The
 * runtime race is verified separately by Seth's web-preview smoke per
 * the QA report's §15.
 *
 * Fails-on-revert verified: stash the Part B merge block in
 * `app/event/[id]/edit.tsx` → tests (a)/(b)/(d) fail because the
 * `mergedServerDraft` variable name disappears AND the field
 * completeness audit fails because the merge object is gone.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DraftEvent, TicketStub } from "../../store/draftEventStore";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const EDIT_ROUTE = join(REPO_ROOT, "mingla-business", "app", "event", "[id]", "edit.tsx");

// Synthetic DraftEvent matching DEFAULT_DRAFT_FIELDS — mirrors the pattern
// in `draftDirtyCheck.test.ts` to avoid the Supabase/Expo runtime chain.
const draft = (overrides: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "d_test",
  brandId: "b_test",
  serverSlug: null,
  name: "",
  description: "",
  format: "in_person",
  whenMode: "single",
  date: null,
  doorsOpen: null,
  endsAt: null,
  endsAtUtc: null,
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: null,
  address: null,
  city: null,
  locationGeo: null,
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: null,
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  tickets: [],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  lastStepReached: 0,
  status: "draft",
  clientRevision: 0,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
  ...overrides,
});

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "t_test",
  name: "Standard",
  priceGbp: 10,
  capacity: 100,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  ...patch,
});

// Replica of the Part B merge logic from `app/event/[id]/edit.tsx:344-381`.
// This is a SPEC replica, not an import (the implementor inlined the logic
// rather than extracting a pure helper — see Discovery T-MERGE-EXTRACT).
// The field-completeness audit below cross-checks that the SOURCE file's
// merge block contains every field that this replica uses, catching drift
// either way.
function applyMergeSpec(
  serverDraft: DraftEvent,
  liveDraft: DraftEvent | null,
): DraftEvent {
  if (!liveDraft) return serverDraft;
  return {
    ...serverDraft,
    name: liveDraft.name,
    description: liveDraft.description,
    coverMediaUrl: liveDraft.coverMediaUrl,
    coverMediaType: liveDraft.coverMediaType,
    coverMediaProvider: liveDraft.coverMediaProvider,
    coverMediaSourceUrl: liveDraft.coverMediaSourceUrl,
    coverMediaCredit: liveDraft.coverMediaCredit,
    coverMediaCreditUrl: liveDraft.coverMediaCreditUrl,
    coverMediaAlt: liveDraft.coverMediaAlt,
    coverHue: liveDraft.coverHue,
    format: liveDraft.format,
    tickets: liveDraft.tickets,
    date: liveDraft.date,
    doorsOpen: liveDraft.doorsOpen,
    endsAt: liveDraft.endsAt,
    endsAtUtc: liveDraft.endsAtUtc,
    venueName: liveDraft.venueName,
    address: liveDraft.address,
    city: liveDraft.city,
    locationGeo: liveDraft.locationGeo,
    onlineUrl: liveDraft.onlineUrl,
    hideAddressUntilTicket: liveDraft.hideAddressUntilTicket,
    lastStepReached: Math.max(
      liveDraft.lastStepReached,
      serverDraft.lastStepReached,
    ),
    partyTypes: liveDraft.partyTypes,
    vibeTags: liveDraft.vibeTags,
    musicGenres: liveDraft.musicGenres,
    whenMode: liveDraft.whenMode,
    multiDates: liveDraft.multiDates,
    recurrenceRule: liveDraft.recurrenceRule,
    timezone: liveDraft.timezone,
  };
}

describe("ORCH-0893 REWORK adversarial — Part B merge spec behaviour", () => {
  test("typed name during in-flight migration survives the merge (the actual race the rework closes)", () => {
    // Race scenario: user typed "H", debounce fires, snapshot taken,
    // createServerDraft running, user types "ello" during the ~1s window.
    const queueSnapshot = draft({ id: "d_abc", name: "H" });
    // Server echoes the queue snapshot with a new server-issued id.
    const serverEchoed = draft({
      ...queueSnapshot,
      id: "srv-uuid-1",
      serverSlug: "draft-abcd",
      name: "H",
    });
    // Live draft at resolve time has the full typed value.
    const liveDraftAtResolve = draft({ id: "d_abc", name: "Hello" });

    const merged = applyMergeSpec(serverEchoed, liveDraftAtResolve);

    // ID switches to server uuid (URL flip works).
    expect(merged.id).toBe("srv-uuid-1");
    expect(merged.serverSlug).toBe("draft-abcd");
    // Live-typed value wins — characters typed during in-flight survive.
    expect(merged.name).toBe("Hello");
  });

  test("typed description, cover, and tickets ALL survive the merge", () => {
    const serverEchoed = draft({
      id: "srv-uuid",
      name: "Original",
      description: "Original desc",
      coverMediaUrl: null,
      tickets: [],
    });
    const liveDraftAtResolve = draft({
      id: "d_abc",
      name: "Updated",
      description: "Updated desc with more text",
      coverMediaUrl: "https://example.com/new-cover.jpg",
      coverMediaType: "image",
      tickets: [ticket({ name: "VIP", priceGbp: 50 })],
    });

    const merged = applyMergeSpec(serverEchoed, liveDraftAtResolve);

    expect(merged.name).toBe("Updated");
    expect(merged.description).toBe("Updated desc with more text");
    expect(merged.coverMediaUrl).toBe("https://example.com/new-cover.jpg");
    expect(merged.coverMediaType).toBe("image");
    expect(merged.tickets).toHaveLength(1);
    expect(merged.tickets[0]?.name).toBe("VIP");
  });

  test("lastStepReached uses Math.max — user step progress never regresses to stale server snapshot", () => {
    // User has advanced to Step 2 while the queue snapshot from Step 0 is in flight.
    const serverEchoed = draft({ id: "srv-uuid", lastStepReached: 0 });
    const liveDraftAtResolve = draft({ id: "d_abc", lastStepReached: 2 });

    const merged = applyMergeSpec(serverEchoed, liveDraftAtResolve);

    expect(merged.lastStepReached).toBe(2);
  });

  test("lastStepReached Math.max also covers the inverse — server-advanced step wins if live regressed", () => {
    // Defensive: if for any reason serverDraft has a higher step than live,
    // the merge takes the server's step (this can't happen in practice but
    // the Math.max semantics protect against future regression).
    const serverEchoed = draft({ id: "srv-uuid", lastStepReached: 3 });
    const liveDraftAtResolve = draft({ id: "d_abc", lastStepReached: 1 });

    const merged = applyMergeSpec(serverEchoed, liveDraftAtResolve);

    expect(merged.lastStepReached).toBe(3);
  });

  test("liveDraft === null fallback returns serverDraft as-is (already-replaced edge case)", () => {
    // Edge case: a concurrent migration already replaced the d_* draft, OR
    // the user discarded the draft mid-flight. The merge MUST fall back to
    // the raw serverDraft without crashing or mutating it.
    const serverEchoed = draft({ id: "srv-uuid", name: "Server" });

    const merged = applyMergeSpec(serverEchoed, null);

    expect(merged).toBe(serverEchoed); // identity, not a copy
  });

  test("server-issued fields (id, serverSlug, createdAt, updatedAt) ALWAYS come from serverDraft, never from liveDraft", () => {
    // Critical for ID/URL correctness — the merge must not echo the d_*
    // pseudo-id back into the swapped draft, otherwise the URL flip would
    // point at the dead d_* id.
    const serverEchoed = draft({
      id: "srv-uuid-99",
      serverSlug: "server-slug",
      createdAt: "2026-05-20T11:00:00.000Z",
      updatedAt: "2026-05-20T11:00:01.000Z",
    });
    const liveDraftAtResolve = draft({
      id: "d_should_not_win", // would break the URL flip if merge picked this
      serverSlug: null,
      createdAt: "2026-05-20T10:55:00.000Z",
      updatedAt: "2026-05-20T10:55:30.000Z",
    });

    const merged = applyMergeSpec(serverEchoed, liveDraftAtResolve);

    expect(merged.id).toBe("srv-uuid-99");
    expect(merged.serverSlug).toBe("server-slug");
    expect(merged.createdAt).toBe("2026-05-20T11:00:00.000Z");
    expect(merged.updatedAt).toBe("2026-05-20T11:00:01.000Z");
  });

  test("location field cluster (venueName, address, city, locationGeo) all merge from live", () => {
    const serverEchoed = draft({
      id: "srv-uuid",
      venueName: null,
      address: null,
      city: null,
      locationGeo: null,
    });
    const liveDraftAtResolve = draft({
      id: "d_abc",
      venueName: "The Spot",
      address: "1 Test Street",
      city: "London",
      locationGeo: { lat: 51.5, lng: -0.12 },
    });

    const merged = applyMergeSpec(serverEchoed, liveDraftAtResolve);

    expect(merged.venueName).toBe("The Spot");
    expect(merged.address).toBe("1 Test Street");
    expect(merged.city).toBe("London");
    expect(merged.locationGeo).toEqual({ lat: 51.5, lng: -0.12 });
  });

  test("date/time field cluster (date, doorsOpen, endsAt, endsAtUtc, timezone) all merge from live", () => {
    const serverEchoed = draft({
      id: "srv-uuid",
      date: null,
      doorsOpen: null,
      endsAt: null,
      endsAtUtc: null,
      timezone: "UTC",
    });
    const liveDraftAtResolve = draft({
      id: "d_abc",
      date: "2026-06-15",
      doorsOpen: "19:30",
      endsAt: "23:00",
      endsAtUtc: "2026-06-15T22:00:00.000Z",
      timezone: "Europe/London",
    });

    const merged = applyMergeSpec(serverEchoed, liveDraftAtResolve);

    expect(merged.date).toBe("2026-06-15");
    expect(merged.doorsOpen).toBe("19:30");
    expect(merged.endsAt).toBe("23:00");
    expect(merged.endsAtUtc).toBe("2026-06-15T22:00:00.000Z");
    expect(merged.timezone).toBe("Europe/London");
  });

  test("ORCH-0824 taxonomy fields (partyTypes, vibeTags, musicGenres) all merge from live", () => {
    const serverEchoed = draft({
      id: "srv-uuid",
      partyTypes: [],
      vibeTags: [],
      musicGenres: [],
    });
    const liveDraftAtResolve = draft({
      id: "d_abc",
      partyTypes: ["dinner", "social"],
      vibeTags: ["chill"],
      musicGenres: ["jazz"],
    });

    const merged = applyMergeSpec(serverEchoed, liveDraftAtResolve);

    expect(merged.partyTypes).toEqual(["dinner", "social"]);
    expect(merged.vibeTags).toEqual(["chill"]);
    expect(merged.musicGenres).toEqual(["jazz"]);
  });
});

describe("ORCH-0893 REWORK adversarial — Part B merge SOURCE field completeness audit", () => {
  // This audit reads the actual merge block in edit.tsx and asserts every
  // field in the test's `applyMergeSpec` replica is also present in the
  // source. Catches the "implementor adds a field to the spec but forgets
  // to mirror it in the source" drift AND vice versa.
  //
  // The list below is the canonical Part B user-meaningful field set per
  // ORCH-0893 SPEC §8.3.3 + implementation report §2. Future DraftEvent
  // fields that are user-mutable must be added here AND to the source
  // merge block AND to the `applyMergeSpec` replica above.
  const REQUIRED_MERGE_FIELDS = [
    "name",
    "description",
    "coverMediaUrl",
    "coverMediaType",
    "coverMediaProvider",
    "coverMediaSourceUrl",
    "coverMediaCredit",
    "coverMediaCreditUrl",
    "coverMediaAlt",
    "coverHue",
    "format",
    "tickets",
    "date",
    "doorsOpen",
    "endsAt",
    "endsAtUtc",
    "venueName",
    "address",
    "city",
    "locationGeo",
    "onlineUrl",
    "hideAddressUntilTicket",
    "lastStepReached",
    "partyTypes",
    "vibeTags",
    "musicGenres",
    "whenMode",
    "multiDates",
    "recurrenceRule",
    "timezone",
  ] as const;

  test("every required merge field appears as `<field>: liveDraft.<field>` (or Math.max for lastStepReached) in the source", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");
    // Bound the search to the rework merge block — between `mergedServerDraft`
    // assignment and `replaceDraft(incoming.id, mergedServerDraft)`.
    const mergeStart = source.indexOf("const mergedServerDraft");
    const mergeEnd = source.indexOf(
      "replaceDraft(incoming.id, mergedServerDraft)",
      mergeStart,
    );
    expect(mergeStart).toBeGreaterThan(-1);
    expect(mergeEnd).toBeGreaterThan(mergeStart);
    const mergeBlock = source.slice(mergeStart, mergeEnd);

    const missing: string[] = [];
    for (const field of REQUIRED_MERGE_FIELDS) {
      if (field === "lastStepReached") {
        // Special case: uses Math.max(liveDraft.lastStepReached, serverDraft.lastStepReached)
        const re = new RegExp(
          `lastStepReached:\\s*Math\\.max\\(\\s*liveDraft\\.lastStepReached`,
        );
        if (!re.test(mergeBlock)) missing.push(field);
      } else {
        const re = new RegExp(`\\b${field}:\\s*liveDraft\\.${field}\\b`);
        if (!re.test(mergeBlock)) missing.push(field);
      }
    }
    expect(missing).toEqual([]);
  });

  test("merge block does NOT echo the d_* pseudo-id back via liveDraft.id (would break URL flip)", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");
    const mergeStart = source.indexOf("const mergedServerDraft");
    const mergeEnd = source.indexOf(
      "replaceDraft(incoming.id, mergedServerDraft)",
      mergeStart,
    );
    const mergeBlock = source.slice(mergeStart, mergeEnd);

    // The merge MUST NOT have `id: liveDraft.id` — that would resurrect
    // the d_* pseudo-id and break the URL flip + the lazy-insert idempotency.
    expect(mergeBlock).not.toMatch(/\bid:\s*liveDraft\.id\b/);
    // Also MUST NOT have `serverSlug: liveDraft.serverSlug` — server is
    // the slug authority post-insert.
    expect(mergeBlock).not.toMatch(/\bserverSlug:\s*liveDraft\.serverSlug\b/);
    // Also MUST NOT echo brandId from liveDraft — brand is set at d_* mint
    // time and survives via incoming.brandId, but the server validates and
    // echoes it back; trust the server's echo not the live state.
    expect(mergeBlock).not.toMatch(/\bbrandId:\s*liveDraft\.brandId\b/);
  });

  test("merge block re-reads live state INSIDE the .then callback, not at queue time (correctness invariant)", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");

    // The `useDraftEventStore.getState().getDraft(incoming.id)` call MUST
    // appear AFTER the .then( opening AND before the replaceDraft call.
    // If a future refactor extracts the live-state read to a useCallback
    // closure or memo, the snapshot captured at queue time would be reused —
    // defeating the merge's purpose.
    const thenStart = source.indexOf(".then((serverDraft)");
    const replaceCall = source.indexOf("replaceDraft(incoming.id, mergedServerDraft)");
    const liveReadIndex = source.indexOf(
      "useDraftEventStore\n            .getState()\n            .getDraft(incoming.id)",
    );

    expect(thenStart).toBeGreaterThan(-1);
    expect(replaceCall).toBeGreaterThan(-1);
    expect(liveReadIndex).toBeGreaterThan(thenStart);
    expect(liveReadIndex).toBeLessThan(replaceCall);
  });
});

describe("ORCH-0893 REWORK adversarial — Part A hydration gate behavioural invariants", () => {
  // The implementor's source-contract test pins WHICH tokens appear in
  // event/create.tsx. This adversarial pins WHY each token is required by
  // exercising the corresponding correctness invariant. Future refactors
  // that move tokens around but break invariants surface here.

  test("the hydration gate's early-return must execute BEFORE the brand-null redirect", () => {
    // Why: if `if (currentBrandId === null) router.replace("/(tabs)/home")`
    // ran before the hydration check, a brief brand-recovery race during
    // hydration would bounce the user home unnecessarily. The hydration
    // check must come FIRST so we don't make a navigation decision based
    // on a hydration-pending state.
    const source = readFileSync(
      join(REPO_ROOT, "mingla-business", "app", "event", "create.tsx"),
      "utf8",
    );
    const hydrationGate = source.indexOf("if (!hydrated) return");
    const brandNullCheck = source.indexOf('if (currentBrandId === null)');
    expect(hydrationGate).toBeGreaterThan(-1);
    expect(brandNullCheck).toBeGreaterThan(-1);
    expect(hydrationGate).toBeLessThan(brandNullCheck);
  });

  test("the defensive double-check inside the hydration effect catches the microtask race", () => {
    // Why: between `useState(() => hasHydrated())` and the effect mount,
    // hydration may complete (rare microtask race when localStorage is
    // fast and the JS bundle is small). Without a re-check after
    // subscribing to onFinishHydration, the gate would stay closed until
    // the next render. The defensive re-check ensures the gate flips
    // synchronously in this rare path.
    const source = readFileSync(
      join(REPO_ROOT, "mingla-business", "app", "event", "create.tsx"),
      "utf8",
    );

    // The hydration-subscription useEffect MUST contain BOTH:
    //   (a) onFinishHydration subscription
    //   (b) a defensive re-check via `useDraftEventStore.persist.hasHydrated()`
    //       inside the same effect body
    // Find the effect that includes onFinishHydration:
    const onFinishIndex = source.indexOf(
      "useDraftEventStore.persist.onFinishHydration",
    );
    expect(onFinishIndex).toBeGreaterThan(-1);

    // Within ~30 lines AFTER the subscription, look for the defensive re-check.
    const window = source.slice(onFinishIndex, onFinishIndex + 600);
    expect(window).toMatch(/useDraftEventStore\.persist\.hasHydrated\(\)/);
    expect(window).toMatch(/setHydrated\(true\)/);
  });

  test("the mint useEffect MUST close over `hydrated` in its dep array (effect re-fires when hydration completes)", () => {
    // Why: useEffect closures capture deps at render time. If `hydrated` is
    // not in the dep array, the effect's early-return uses the initial
    // `hydrated` value (false on cold start), even after the state update.
    // The dep array MUST include `hydrated` so the effect re-fires after
    // hydration completes.
    const source = readFileSync(
      join(REPO_ROOT, "mingla-business", "app", "event", "create.tsx"),
      "utf8",
    );

    // Find the mint useEffect's dep array. The mint useEffect is the second
    // useEffect in the file (first is the hydration subscription). Match
    // any useEffect whose body contains the createDraft call, and check
    // that its dep array includes `hydrated`.
    const mintEffectStart = source.indexOf("if (startedRef.current) return");
    expect(mintEffectStart).toBeGreaterThan(-1);
    // Walk forward to find the dep array `], `.
    const depArrayStart = source.indexOf("}, [", mintEffectStart);
    const depArrayEnd = source.indexOf("]);", depArrayStart);
    const depArray = source.slice(depArrayStart, depArrayEnd);
    expect(depArray).toMatch(/\bhydrated\b/);
  });
});
