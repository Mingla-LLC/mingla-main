import { readFileSync } from "fs";
import path from "path";

import { describe, expect, jest, test } from "@jest/globals";

/**
 * #1022 A/F-1 — the theme must survive the draft round-trip.
 *
 * Before this build, `themeOverrides` was written by NEITHER draftToServer
 * builder and read by NEITHER serverRowToDraft nor EVENT_DRAFT_SELECT. The
 * autosave echo replaces the local draft wholesale with the server projection
 * (draftEventStore.ts:950-954), so a colour picked in the wizard was silently
 * deleted roughly one 700ms round-trip after being set.
 *
 * Covers SPEC test cases T-1 (round-trip) and T-2 (select completeness).
 *
 * Fails-on-revert targets — ALL THREE legs are load-bearing:
 *   1. remove the EVENT_DRAFT_SELECT entry  -> red (T-2)
 *   2. remove either builder leg            -> red (T-1)
 *   3. remove the serverRowToDraft read leg -> red (T-1)
 */

jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import {
  draftToServerInsert,
  draftToServerUpdate,
  serverRowToDraft,
  type ServerDraftEventRow,
} from "../serverDraftEventMapper";
import type { DraftEvent } from "../../store/draftEventStore";
import type { ThemeInput } from "@mingla/offering-rendering";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const draftWith = (themeOverrides: ThemeInput | null): DraftEvent =>
  ({
    id: "d_local_1",
    brandId: "00000000-0000-4000-8000-000000000002",
    name: "Rooftop Sessions",
    description: "",
    format: "in_person",
    whenMode: "single",
    date: "2026-06-01",
    doorsOpen: "18:00",
    endsAt: "22:00",
    timezone: "Europe/London",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Main Hall",
    address: "1 High Street",
    onlineUrl: null,
    coverMediaUrl: null,
    coverMediaType: null,
    currency: "GBP",
    tickets: [],
    visibility: "public",
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    city: null,
    locationGeo: null,
    themeOverrides,
  } as unknown as DraftEvent);

/** Project a builder's column output back onto a server row shape. */
const rowFrom = (columns: Record<string, unknown>): ServerDraftEventRow =>
  ({
    id: "00000000-0000-4000-8000-000000000009",
    brand_id: "00000000-0000-4000-8000-000000000002",
    created_by: "00000000-0000-4000-8000-000000000003",
    slug: "draft-abcd",
    is_online: false,
    is_recurring: false,
    is_multi_date: false,
    recurrence_rules: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    published_at: null,
    deleted_at: null,
    ...columns,
  } as unknown as ServerDraftEventRow);

describe("T-2 — EVENT_DRAFT_SELECT completeness", () => {
  const select = repoFile("src/services/eventDrafts.ts");

  test.each([
    "theme_color_override",
    "theme_font_override",
    "theme_animation_override",
  ])("EVENT_DRAFT_SELECT requests %s", (column) => {
    const match = select.match(/const EVENT_DRAFT_SELECT\s*=\s*\n?\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match?.[1].split(",")).toContain(column);
  });
});

describe("T-1 — draft theme round-trip through the UPDATE builder", () => {
  test("a colour-only override survives builder -> row -> mapper", () => {
    const input: ThemeInput = { color: "#16a34a", font: null, animation: null };
    const update = draftToServerUpdate(draftWith(input), {});
    const back = serverRowToDraft(rowFrom(update as unknown as Record<string, unknown>));

    expect(back.themeOverrides).toEqual(input);
  });

  test("a fully specified theme survives all three axes", () => {
    const input: ThemeInput = {
      color: "#2563eb",
      font: "poppins",
      animation: "confetti",
    };
    const update = draftToServerUpdate(draftWith(input), {});
    const back = serverRowToDraft(rowFrom(update as unknown as Record<string, unknown>));

    expect(back.themeOverrides).toEqual(input);
  });

  test("the UPDATE builder writes the three columns, not the theme JSONB", () => {
    const update = draftToServerUpdate(
      draftWith({ color: "#16a34a", font: null, animation: null }),
      {},
    ) as unknown as Record<string, unknown>;

    expect(update.theme_color_override).toBe("#16a34a");
    expect(update.theme_font_override).toBeNull();
    expect(update.theme_animation_override).toBeNull();
    // B-9 — the JSONB blob must not carry theme overrides. A `theme` write
    // also fires trg_events_sync_departure, which a column write does not.
    expect(JSON.stringify(update.theme)).not.toContain("#16a34a");
  });

  test("an unthemed draft round-trips as null, never {null,null,null}", () => {
    const update = draftToServerUpdate(draftWith(null), {});
    const back = serverRowToDraft(rowFrom(update as unknown as Record<string, unknown>));

    expect(back.themeOverrides).toBeNull();
  });
});

describe("T-1 — draft theme round-trip through the INSERT builder (promotion)", () => {
  test("the INSERT builder carries the theme through d_* promotion", () => {
    const input: ThemeInput = { color: "#9333ea", font: "lora", animation: null };
    const insert = draftToServerInsert(
      draftWith(input),
      "00000000-0000-4000-8000-000000000003",
      "draft-abcd",
    ) as unknown as Record<string, unknown>;

    expect(insert.theme_color_override).toBe("#9333ea");
    expect(insert.theme_font_override).toBe("lora");
    expect(insert.theme_animation_override).toBeNull();

    const back = serverRowToDraft(rowFrom(insert));
    expect(back.themeOverrides).toEqual(input);
  });

  test("an unthemed new draft inserts three explicit nulls", () => {
    const insert = draftToServerInsert(
      draftWith(null),
      "00000000-0000-4000-8000-000000000003",
      "draft-abcd",
    ) as unknown as Record<string, unknown>;

    expect(insert.theme_color_override).toBeNull();
    expect(insert.theme_font_override).toBeNull();
    expect(insert.theme_animation_override).toBeNull();
  });
});

describe("T-1 — the autosave echo cannot erase a set theme", () => {
  test("simulating the echo (build -> server row -> replace local draft) keeps the colour", () => {
    const picked: ThemeInput = { color: "#dc2626", font: null, animation: null };

    // user picks a colour; autosave builds the PATCH body
    const body = draftToServerUpdate(draftWith(picked), {}) as unknown as Record<
      string,
      unknown
    >;
    // server returns the updated row; the store replaces the local draft wholesale
    const echoed = serverRowToDraft(rowFrom(body));

    expect(echoed.themeOverrides).toEqual(picked);
  });
});
