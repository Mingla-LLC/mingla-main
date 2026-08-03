/**
 * #1026 [chip-in-draft-persist] — TESTER ADVERSARIAL regression suite.
 *
 * DIFFERENT ANGLE than the implementor's mapper-round-trip (T-1..T-4 in
 * serverDraftEventMapper.test.ts, which assert serverRowToDraft's RETURN VALUE
 * in isolation). This file attacks the FULL STORE ECHO path that actually
 * blanked chip-in in production:
 *
 *     serverRowToDraft (read leg)
 *   → upsertServerDraft accept-guard  (shouldApplyServerDraft:
 *       serverRevision >= localRevision → ACCEPT)
 *   → WHOLESALE store replace  (draftEventStore.ts:951-954
 *       s.drafts.map(d => d.id === draft.id ? draft : d)  — the whole object,
 *       NOT a field merge)
 *
 * The bug: the ~700ms autosave echo re-read the row, but serverRowToDraft
 * omitted the three chip-in reads, so the projection that wholesale-REPLACED
 * the local draft carried chip-in as `undefined`. The host's just-set chip-in
 * was blanked in the store, the next autosave persisted the blank, and the
 * draft published with chip-in OFF (lost host revenue). Proving the mapper's
 * return value in isolation does NOT prove the value survives the store's
 * wholesale replacement — that is the gap this suite closes.
 *
 * TA-1 (fails-on-revert): a local draft with chip-in ON is wholesale-REPLACED
 *   by the autosave echo through the REAL store; the accept-guard fires
 *   (accepted === true, i.e. the replace genuinely happened, not a no-op skip)
 *   and chip-in SURVIVES the replacement.
 * TA-2 (legacy / no undefined): a blob lacking the three chip-in keys hydrates
 *   AND echoes through the store to false/null as own-properties present on the
 *   stored draft — the exact values RsvpStep5Setup reads
 *   (draft.rsvpContributionEnabled / draft.rsvpContributionSuggestedCents /
 *   draft.rsvpContributionMinCents) with NO `undefined` reaching the consumer.
 *
 * Runtime code is byte-identical to the fix — this suite imports the REAL
 * store and the REAL mapper and only asserts. Append-only NEW file. Runs under
 * the stock mingla-business/jest.config.cjs. Wired into
 * .github/workflows/issue-1022-theme-control-tests.yml.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

// The store imports convertDraftToLiveEvent from ../utils/liveEventConverter;
// stub it so importing the store in the node/ts-jest env is side-effect-free.
jest.mock("../liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";
import {
  draftToServerInsert,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../serverDraftEventMapper";

const BRAND_ID = "64cb8e35-5b53-4633-8780-d7769bead244";
const DRAFT_ID = "f1ba5ee0-6a6b-4bb8-8a4c-7a89ea8b46d2";

// A fully-valid RSVP draft with chip-in ON, revision 0 (matches the "host just
// set chip-in, first autosave echo" scenario where server/local revisions are
// equal so the accept-guard replaces wholesale).
const rsvpDraftWithChipIn = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  ...buildDraftEvent(BRAND_ID, DRAFT_ID, "2026-05-08T08:00:00.000Z"),
  name: "Friday Supper",
  isRsvp: true,
  clientRevision: 0,
  rsvpContributionEnabled: true,
  rsvpContributionSuggestedCents: 2500,
  rsvpContributionMinCents: 500,
  ...patch,
});

// Build the server row the autosave echo re-reads. The theme.business_draft
// blob is produced by the REAL write leg (draftToServerInsert), so the write
// and read legs are exercised against the SAME blob — no hand-mocked keys.
const rowFromDraft = (
  source: DraftEvent,
  themeOverride?: Record<string, unknown>,
): ServerDraftEventRow => {
  const theme =
    themeOverride ??
    (draftToServerInsert(source, "user-1", "draft-echo").theme as Record<
      string,
      unknown
    >);
  return {
    id: source.id,
    brand_id: source.brandId,
    created_by: "user-1",
    title: source.name.trim().length > 0 ? source.name : "Untitled draft",
    description: source.description,
    slug: source.serverSlug ?? "draft-echo",
    location_text: null,
    online_url: source.onlineUrl,
    cover_media_url: source.coverMediaUrl,
    cover_media_type: source.coverMediaType,
    cover_media_provider: source.coverMediaProvider ?? null,
    cover_media_source_url: source.coverMediaSourceUrl ?? null,
    cover_media_credit: source.coverMediaCredit ?? null,
    cover_media_credit_url: source.coverMediaCreditUrl ?? null,
    cover_media_alt: source.coverMediaAlt ?? null,
    currency: source.currency ?? "GBP",
    is_online: source.format === "online",
    is_recurring: source.whenMode === "recurring",
    is_multi_date: source.whenMode === "multi_date",
    recurrence_rules: source.recurrenceRule,
    theme,
    visibility: "draft",
    status: "draft",
    timezone: source.timezone,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
    published_at: null,
    deleted_at: null,
    party_types: source.partyTypes ?? [],
    vibe_tags: source.vibeTags ?? [],
    music_genres: source.musicGenres ?? [],
  };
};

beforeEach(() => {
  // Isolate the persisted store between tests (drafts + edit-meta).
  useDraftEventStore.setState({ drafts: [], draftEditMeta: {} });
});

describe("#1026 — chip-in survives the full autosave store-echo (tester adversarial)", () => {
  // TA-1 — the production defect, end-to-end through the REAL store.
  test("chip-in ON survives the wholesale store replace performed by the autosave echo", () => {
    const store = useDraftEventStore.getState();
    const local = rsvpDraftWithChipIn();

    // 1) Host has chip-in ON locally.
    store.upsertDraft(local);
    expect(useDraftEventStore.getState().getDraft(DRAFT_ID)?.rsvpContributionEnabled).toBe(
      true,
    );

    // 2) ~700ms later the autosave echo re-reads the row and hydrates it.
    const echoProjection = serverRowToDraft(rowFromDraft(local));

    // 3) upsertServerDraft runs the accept-guard then WHOLESALE-replaces.
    const accepted = useDraftEventStore.getState().upsertServerDraft(echoProjection);

    // The guard MUST accept (equal revisions) — otherwise "survives" would be a
    // false pass caused by the echo being rejected and the local left untouched.
    expect(accepted).toBe(true);

    // 4) After the wholesale replace, chip-in is STILL set on the stored draft.
    const stored = useDraftEventStore.getState().getDraft(DRAFT_ID);
    expect(stored?.rsvpContributionEnabled).toBe(true);
    expect(stored?.rsvpContributionSuggestedCents).toBe(2500);
    expect(stored?.rsvpContributionMinCents).toBe(500);
  });

  // TA-2 — a legacy (pre-ORCH-1291) blob lacking the three keys must echo
  // through the store to false/null present-as-own-properties, never undefined.
  test("legacy blob without chip-in keys echoes through the store to false/null (no undefined reaches RsvpStep5Setup)", () => {
    const store = useDraftEventStore.getState();
    // A fresh RSVP draft with chip-in OFF is what the wizard opens.
    const local = rsvpDraftWithChipIn({
      rsvpContributionEnabled: false,
      rsvpContributionSuggestedCents: null,
      rsvpContributionMinCents: null,
    });
    store.upsertDraft(local);

    // Strip the three chip-in keys from the blob to simulate a legacy row.
    const insert = draftToServerInsert(local, "user-1", "draft-legacy");
    const theme = insert.theme as Record<string, unknown>;
    const businessDraft = theme.business_draft as Record<string, unknown>;
    delete businessDraft.rsvpContributionEnabled;
    delete businessDraft.rsvpContributionSuggestedCents;
    delete businessDraft.rsvpContributionMinCents;

    const echoProjection = serverRowToDraft(rowFromDraft(local, theme));
    const accepted = useDraftEventStore.getState().upsertServerDraft(echoProjection);
    expect(accepted).toBe(true);

    const stored = useDraftEventStore.getState().getDraft(DRAFT_ID);

    // Exactly the values RsvpStep5Setup reads — clean booleans/nulls, never
    // undefined (undefined would be dropped by JSON.stringify on the next
    // autosave and re-wipe the DB column).
    expect(stored?.rsvpContributionEnabled).toBe(false);
    expect(stored?.rsvpContributionSuggestedCents).toBeNull();
    expect(stored?.rsvpContributionMinCents).toBeNull();
    expect(stored?.rsvpContributionEnabled).not.toBeUndefined();
    expect(stored?.rsvpContributionSuggestedCents).not.toBeUndefined();
    expect(stored?.rsvpContributionMinCents).not.toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(stored, "rsvpContributionEnabled"),
    ).toBe(true);

    // The consumer's own expressions (RsvpStep5Setup.tsx:169-173) stay well-typed
    // and OFF — no undefined comparison, no crash.
    const contributionOn = stored?.rsvpContributionEnabled;
    const minExceedsSuggested =
      (stored?.rsvpContributionMinCents ?? null) !== null &&
      (stored?.rsvpContributionSuggestedCents ?? null) !== null &&
      (stored?.rsvpContributionMinCents ?? 0) >
        (stored?.rsvpContributionSuggestedCents ?? 0);
    expect(contributionOn).toBe(false);
    expect(minExceedsSuggested).toBe(false);
  });
});
