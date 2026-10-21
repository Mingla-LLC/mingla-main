/**
 * issue #3827 going-box — implementor happy-path proof for the host half.
 *
 * Every test EXECUTES the real code (mocked transport only):
 *   H-1  the client cap equals the SQL cap (helper, CHECK, leaf guard, live RSVP)
 *   H-2  asExtraGuestCount accepts whole 0..5000 only
 *   H-3  setEventGuestPrivacy sends p_extra_guest_count ONLY when the host set it
 *        (forward-compatible), and trusts the server echo
 *   H-4  buildDraftPreviewSocialProof: null for no extras / private, else exact
 *   H-5  the ticketed live editor treats extras as a SAFE key and patches it
 *        only when changed; an event saved before the field shows no diff
 *   H-6  the RSVP live diff carries extras only when changed
 *   H-7  host copy (label, helpers, error, lock line) is byte-exact
 *   H-8  the extras error matcher recognises both server refusals
 *
 * FAILS-ON-REVERT: send p_extra_guest_count unconditionally -> H-3a fails; drop
 * the `?? 0` normalisation in computeRichFieldDiffs -> H-5c fails; remove the key
 * from SAFE_KEYS -> H-5a fails; change the cap on one side -> H-1 fails.
 */

import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../services/supabase", () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

import { supabase } from "../../services/supabase";
import { setEventGuestPrivacy } from "../../services/businessEvents";
import {
  EXTRA_GUESTS_ERROR,
  EXTRA_GUESTS_LABEL,
  EXTRA_GUEST_COUNT_MAX,
  HIDE_REMAINING_LOCKED_SUB,
  asExtraGuestCount,
  extraGuestsHelper,
  isExtraGuestCountError,
} from "../../constants/guestListPrivacy";
import {
  buildDraftPreviewSocialProof,
  draftTicketCapacity,
} from "../draftPreviewSocialProof";
import {
  SAFE_KEYS,
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft as liveEventToEditable,
} from "../liveEventAdapter";
import { buildRsvpUpdatePayloadDiff as buildRsvpLiveEditPayloadDiff } from "../serverDraftEventMapper";

type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = supabase.rpc as unknown as jest.Mock<
  (name: string, args: Record<string, unknown>) => Promise<RpcResult>
>;

const MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20271128003827_issue_3827_going_box_privacy_extra_guests.sql",
);

beforeEach(() => {
  rpc.mockReset();
});

describe("H-1 / H-2 the cap", () => {
  test("H-1 EXTRA_GUEST_COUNT_MAX equals every 5000 in the migration's guards", () => {
    expect(EXTRA_GUEST_COUNT_MAX).toBe(5000);
    const sql = fs.readFileSync(MIGRATION, "utf8");
    // helper, CHECK constraint, leaf guard, live RSVP guard.
    expect(sql.match(/> 5000/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toMatch(/> (?!5000\b)\d{3,} THEN/);
  });

  test("H-2 asExtraGuestCount: whole numbers 0..5000 only", () => {
    expect(asExtraGuestCount(0)).toBe(0);
    expect(asExtraGuestCount(42)).toBe(42);
    expect(asExtraGuestCount(5000)).toBe(5000);
    for (const bad of [5001, -1, 4.5, Number.NaN, "12", null, undefined, true]) {
      expect(asExtraGuestCount(bad)).toBe(0);
    }
  });
});

describe("H-3 setEventGuestPrivacy", () => {
  test("H-3a a privacy-only save does NOT send p_extra_guest_count (old servers keep working)", async () => {
    rpc.mockResolvedValue({
      data: { privateGuestList: true, hideRemainingCount: true },
      error: null,
    });
    const echo = await setEventGuestPrivacy("evt-1", { privateGuestList: true, hideRemainingCount: true });
    expect(rpc).toHaveBeenCalledWith("biz_set_event_guest_privacy", {
      p_event_id: "evt-1",
      p_private_guest_list: true,
      p_hide_remaining_count: true,
    });
    expect(echo).toEqual({ privateGuestList: true, hideRemainingCount: true, extraGuestCount: 0 });
  });

  test("H-3b an extras save sends p_extra_guest_count and trusts the echo", async () => {
    rpc.mockResolvedValue({
      data: { privateGuestList: false, hideRemainingCount: false, extraGuestCount: 40 },
      error: null,
    });
    const echo = await setEventGuestPrivacy("evt-1", { extraGuestCount: 40 });
    expect(rpc).toHaveBeenCalledWith("biz_set_event_guest_privacy", {
      p_event_id: "evt-1",
      p_private_guest_list: null,
      p_hide_remaining_count: null,
      p_extra_guest_count: 40,
    });
    expect(echo.extraGuestCount).toBe(40);
  });

  test("H-3c a refusal throws with the server code, which the matcher recognises", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "invalid_extra_guest_count" } });
    await expect(setEventGuestPrivacy("evt-1", { extraGuestCount: 9000 })).rejects.toThrow(
      "invalid_extra_guest_count",
    );
  });
});

describe("H-4 the host draft preview box", () => {
  const base = {
    eventId: "draft-1",
    entityType: "event" as const,
    privateGuestList: false,
    hideRemainingCount: false,
    capacity: 100,
  };

  test("no extras, or a private list → no box at all", () => {
    expect(buildDraftPreviewSocialProof({ ...base, extraGuestCount: 0 })).toBeNull();
    expect(buildDraftPreviewSocialProof({ ...base, extraGuestCount: undefined })).toBeNull();
    expect(buildDraftPreviewSocialProof({ ...base, extraGuestCount: 40, privateGuestList: true })).toBeNull();
  });

  test("extras → the exact extras-only payload buyers will get", () => {
    expect(buildDraftPreviewSocialProof({ ...base, extraGuestCount: 7, hideRemainingCount: true })).toEqual({
      eventId: "draft-1",
      entityType: "event",
      goingCount: 0,
      extraGuestCount: 7,
      capacity: 100,
      privateGuestList: false,
      hideRemainingCount: true,
      sample: [],
      capacityFull: false,
    });
    expect(buildDraftPreviewSocialProof({ ...base, extraGuestCount: 7, capacity: null })?.capacity).toBeNull();
  });

  test("draftTicketCapacity: Σ capacities, null when any tier is unlimited", () => {
    expect(draftTicketCapacity([{ capacity: 60 }, { capacity: 40 }])).toBe(100);
    expect(draftTicketCapacity([{ capacity: 60 }, { capacity: null, isUnlimited: true }])).toBeNull();
    expect(draftTicketCapacity([])).toBeNull();
  });
});

describe("H-5 / H-6 the live editors", () => {
  // The minimum LiveEvent shape these pure functions read; cast through unknown
  // like the sibling issue_3827_live_edit_diff suite.
  const live = (over: Record<string, unknown> = {}) =>
    ({
      id: "le-1",
      name: "Going box night",
      description: "",
      tickets: [],
      privateGuestList: false,
      hideRemainingCount: false,
      ...over,
    }) as unknown as Parameters<typeof liveEventToEditable>[0];

  test("H-5a extraGuestCount is a SAFE key (no buyer is told)", () => {
    expect(SAFE_KEYS).toContain("extraGuestCount");
  });

  test("H-5b the patch carries extras only when they changed", () => {
    const original = live({ extraGuestCount: 4 });
    const same = liveEventToEditable(original);
    expect(editableDraftToPatch(original, same)).not.toHaveProperty("extraGuestCount");
    const edited = { ...liveEventToEditable(original), extraGuestCount: 12 };
    expect(editableDraftToPatch(original, edited)).toMatchObject({ extraGuestCount: 12 });
  });

  test("H-5c an event saved before the field existed shows no phantom change", () => {
    // The stored event has no key; the editor's copy carries the 0 it projects.
    const original = live({});
    expect(original).not.toHaveProperty("extraGuestCount");
    const edited = liveEventToEditable(original);
    expect(edited.extraGuestCount).toBe(0);
    expect(computeRichFieldDiffs(original, edited).map((d) => d.fieldKey)).not.toContain("extraGuestCount");
    expect(editableDraftToPatch(original, edited)).not.toHaveProperty("extraGuestCount");
  });

  test("H-6 the RSVP live payload carries extras only when they changed", () => {
    const original = live({ extraGuestCount: 0 });
    const unchanged = liveEventToEditable(original);
    expect(buildRsvpLiveEditPayloadDiff(original, unchanged)).not.toHaveProperty("extraGuestCount");
    const edited = { ...unchanged, extraGuestCount: 25 };
    expect(buildRsvpLiveEditPayloadDiff(original, edited)).toMatchObject({ extraGuestCount: 25 });
  });
});

describe("H-7 / H-8 copy", () => {
  test("H-7 host copy is byte-exact", () => {
    expect(EXTRA_GUESTS_LABEL).toBe("Guests on your own list");
    expect(extraGuestsHelper(false)).toBe(
      "People you invited yourself who aren't on Mingla. We add them to your going count. They don't use up your spots.",
    );
    expect(extraGuestsHelper(true)).toBe(
      "Your guest list is private, so guests won't see a going count. We'll add these when you show it.",
    );
    expect(extraGuestsHelper(false, "booked")).toBe(
      "People you booked yourself who aren't on Mingla. We add them to your booked count. They don't use up your spots.",
    );
    expect(EXTRA_GUESTS_ERROR).toBe("Enter a number from 0 to 5,000.");
    expect(HIDE_REMAINING_LOCKED_SUB).toBe("On while your guest list is private.");
  });

  test("H-8 both server refusals are recognised; others are not", () => {
    expect(isExtraGuestCountError(new Error("invalid_extra_guest_count"))).toBe(true);
    expect(
      isExtraGuestCountError({
        message: 'new row for relation "events" violates check constraint "events_extra_guest_count_valid"',
      }),
    ).toBe(true);
    expect(isExtraGuestCountError(new Error("not_authorized"))).toBe(false);
  });
});

describe("H-9 the settings steps stay off the boot path", () => {
  // CreatorStep6Settings and RsvpStep5Setup are shared by two lazy route chunks
  // (create wizard + EditPublishedScreen); one static import hoists them into
  // the eager __common chunk. Every importer must use lazySettingsSteps.tsx.
  const SRC = path.resolve(__dirname, "../..");
  const APP = path.resolve(__dirname, "../../../app");
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : walk(p);
      return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });

  test("no production file statically imports either step", () => {
    const offenders = [...walk(SRC), ...walk(APP)].filter((file) => {
      if (file.endsWith("lazySettingsSteps.tsx")) return false;
      const text = fs.readFileSync(file, "utf8");
      return /^import [^;]*from "[^"]*\/(CreatorStep6Settings|RsvpStep5Setup)";/m.test(text);
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  test("the three importers render the lazy wrappers", () => {
    const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf8");
    expect(read("components/event/EditPublishedScreen.tsx")).toContain("<CreatorStep6SettingsLazy");
    expect(read("components/event/EditPublishedScreen.tsx")).toContain("<RsvpStep5SetupLazy");
    expect(read("components/event/EventCreatorWizard.tsx")).toContain("<CreatorStep6SettingsLazy");
    expect(read("components/rsvp/RsvpCreatorWizard.tsx")).toContain("<RsvpStep5SetupLazy");
  });
});
