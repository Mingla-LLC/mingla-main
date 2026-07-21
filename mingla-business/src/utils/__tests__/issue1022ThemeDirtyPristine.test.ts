import { describe, expect, jest, test } from "@jest/globals";

/**
 * #1022 Group 3 — theme must participate in dirty / pristine.
 *
 * Covers SPEC test cases T-8 (isDraftDirty) and T-9 (isDraftEventPristine).
 *
 * Why it matters, in Seth's terms — this is the "state issue" class:
 *   - NOT dirty  => the lazy server-insert never fires => a theme-only draft
 *                   produces no server row at all and the pick is lost.
 *   - pristine   => tapping the chrome X hard-deletes the draft SILENTLY,
 *                   with no discard confirmation (A/F-4).
 *
 * Fails-on-revert target: delete the themeOverrides clause from either
 * draftDirtyCheck.ts or draftEventPristine.ts and this suite goes red.
 */

jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import { isDraftDirty } from "../draftDirtyCheck";
import { isDraftEventPristine } from "../draftEventPristine";
import type { DraftEvent } from "../../store/draftEventStore";
import type { ThemeInput } from "@mingla/offering-rendering";

/** A cold-default draft, exactly as buildDraftEvent(brandId) produces it. */
const coldDraft = (themeOverrides: ThemeInput | null = null): DraftEvent =>
  ({
    id: "d_cold",
    brandId: "00000000-0000-4000-8000-000000000002",
    name: "",
    description: "",
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    date: null,
    doorsOpen: null,
    endsAt: null,
    venueName: null,
    address: null,
    city: null,
    locationGeo: null,
    onlineUrl: null,
    tickets: [],
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    format: "in_person",
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    lastStepReached: 0,
    themeOverrides,
  } as unknown as DraftEvent);

describe("T-8 — isDraftDirty", () => {
  test("a cold draft with no theme is NOT dirty", () => {
    expect(isDraftDirty(coldDraft(null))).toBe(false);
  });

  test("a draft whose ONLY change is a colour IS dirty", () => {
    expect(
      isDraftDirty(coldDraft({ color: "#16a34a", font: null, animation: null })),
    ).toBe(true);
  });

  test("a font-only change is dirty", () => {
    expect(
      isDraftDirty(coldDraft({ color: null, font: "poppins", animation: null })),
    ).toBe(true);
  });

  test("a motion-only change is dirty", () => {
    expect(
      isDraftDirty(coldDraft({ color: null, font: null, animation: "confetti" })),
    ).toBe(true);
  });

  test("an all-null override is NOT dirty (it is semantically no theme)", () => {
    expect(
      isDraftDirty(coldDraft({ color: null, font: null, animation: null })),
    ).toBe(false);
  });

  test("undefined themeOverrides is NOT dirty (legacy drafts)", () => {
    expect(isDraftDirty(coldDraft(undefined as unknown as null))).toBe(false);
  });
});

describe("T-9 — isDraftEventPristine", () => {
  test("a cold draft with no theme IS pristine", () => {
    expect(isDraftEventPristine(coldDraft(null))).toBe(true);
  });

  test("a draft whose ONLY change is a colour is NOT pristine", () => {
    expect(
      isDraftEventPristine(
        coldDraft({ color: "#16a34a", font: null, animation: null }),
      ),
    ).toBe(false);
  });

  test("a font-only change is not pristine", () => {
    expect(
      isDraftEventPristine(
        coldDraft({ color: null, font: "lora", animation: null }),
      ),
    ).toBe(false);
  });

  test("a motion-only change is not pristine", () => {
    expect(
      isDraftEventPristine(
        coldDraft({ color: null, font: null, animation: "sparkles" }),
      ),
    ).toBe(false);
  });

  test("an all-null override stays pristine", () => {
    expect(
      isDraftEventPristine(
        coldDraft({ color: null, font: null, animation: null }),
      ),
    ).toBe(true);
  });
});

describe("dirty and pristine stay mutually consistent for theme", () => {
  test.each([
    ["colour", { color: "#dc2626", font: null, animation: null }],
    ["font", { color: null, font: "anton", animation: null }],
    ["motion", { color: null, font: null, animation: "hearts" }],
  ])("a %s-only draft is dirty AND not pristine", (_label, theme) => {
    const draft = coldDraft(theme as ThemeInput);
    expect(isDraftDirty(draft)).toBe(true);
    expect(isDraftEventPristine(draft)).toBe(false);
  });
});
