/**
 * #3393 umbrella — Add a venue fixes found while preparing the venue tutorials.
 *
 *   #3383 — the "Take reservations on Mingla" switch is saved once the venue
 *           exists (both arms), through the same write as the Settings switch.
 *   #3384 — the Review step no longer asks for a pitch the host cannot add.
 *   #3390 — the resume card counts steps from the real wizard step list.
 *
 * Behavioural first: the choice-saving contract runs with an injected writer,
 * the shared writer runs against a mocked Supabase client, the Review step is
 * RENDERED, and the resume progress is computed. The two wiring assertions at
 * the bottom exist because the wizard and the create route cannot mount under
 * this config; each one fails on a revert of its fix.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ── mocks ────────────────────────────────────────────────────────────────────

const mockUpsert = jest.fn(
  (_row: Record<string, unknown>, _opts: Record<string, unknown>) =>
    Promise.resolve({ error: null as null | { message: string } }),
);
const mockFrom = jest.fn((_table: string) => ({ upsert: mockUpsert }));

jest.mock("../../../services/supabase", () => ({
  __esModule: true,
  supabase: { from: (table: string) => mockFrom(table) },
}));

jest.mock("../../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1" } }),
}));

let mockDraft: Record<string, unknown>;
jest.mock("../../../store/draftVenueStore", () => ({
  __esModule: true,
  useDraftVenueStore: () => mockDraft,
}));

jest.mock("../../../hooks/useBrandDiscoveryCurrency", () => ({
  __esModule: true,
  useBrandDiscoveryCurrency: () => ({ data: { currencyCode: "USD" } }),
}));

jest.mock("../useVenueThemeControl", () => ({
  __esModule: true,
  useVenueThemeControl: () => ({
    value: null,
    onChange: () => undefined,
    brandTheme: null,
    brandThemeStatus: "ready",
  }),
}));

jest.mock("../../theme/ThemeControlRow", () => ({
  __esModule: true,
  ThemeControlRow: () => null,
}));

jest.mock("../../theme/ThemeSheet", () => ({
  __esModule: true,
  ThemeSheet: () => null,
}));

jest.mock("../../ui/Button", () => ({
  __esModule: true,
  Button: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("Button", props);
  },
}));

jest.mock("../../ui/EventCoverMedia", () => ({
  __esModule: true,
  EventCoverMedia: () => null,
}));

import { saveVenueReservationsEnabled } from "../../../hooks/useVenueReservationSettings";
import { VenueStep7Review } from "../VenueStep7Review";
import { saveWizardReservationsChoice } from "../venueWizardReservationsChoice";
import {
  venueWizardResumeProgress,
  venueWizardSteps,
} from "../venueWizardValidation";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: TestInstance;
    unmount: () => void;
  };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

function textOf(node: TestInstance): string {
  const children = node.props.children;
  const parts = Array.isArray(children) ? children : [children];
  return parts
    .map((part) => (typeof part === "string" || typeof part === "number" ? String(part) : ""))
    .join("");
}

function allText(root: TestInstance): string[] {
  return root
    .findAll((node) => node.type === "Text")
    .map((node) => textOf(node));
}

async function renderReview(description: string): Promise<TestInstance> {
  mockDraft = {
    activeBrandId: "brand-1",
    coverChoice: null,
    galleryUrls: [],
    description,
    contactEmail: "",
    contactPhone: "",
    website: "",
    discoveryPriceMinInput: "",
    discoveryPriceMaxInput: "",
    displayName: "Rooftop Kitchen",
    venueCategory: "restaurant",
    formattedAddress: "1 Main St",
    wantsReservations: true,
  };
  let tree!: { root: TestInstance };
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <VenueStep7Review
        submitting={false}
        submitError={null}
        onSubmit={() => undefined}
      />,
    );
  });
  return tree.root;
}

beforeEach(() => {
  mockUpsert.mockClear();
  mockFrom.mockClear();
});

// ── #3383 ────────────────────────────────────────────────────────────────────

describe("#3383 — the Bookings switch reaches the venue's reservation settings", () => {
  test("switch ON writes enabled=true for exactly this venue", async () => {
    const save = jest.fn(
      (_brandId: string | null, _venueId: string | null, _enabled: boolean) =>
        Promise.resolve(),
    );
    const outcome = await saveWizardReservationsChoice(
      { brandId: "brand-1", venueId: "venue-1", wantsReservations: true },
      save,
    );
    expect(outcome).toBe("saved");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("brand-1", "venue-1", true);
  });

  test("switch OFF writes nothing", async () => {
    const save = jest.fn(() => Promise.resolve());
    const outcome = await saveWizardReservationsChoice(
      { brandId: "brand-1", venueId: "venue-1", wantsReservations: false },
      save,
    );
    expect(outcome).toBe("not_requested");
    expect(save).not.toHaveBeenCalled();
  });

  test("a failed write never throws — the submitted venue still opens", async () => {
    const save = jest.fn(() => Promise.reject(new Error("rls_denied")));
    await expect(
      saveWizardReservationsChoice(
        { brandId: "brand-1", venueId: "venue-1", wantsReservations: true },
        save,
      ),
    ).resolves.toBe("save_failed");
  });

  test("the shared writer upserts reservations_enabled on the venue row", async () => {
    await saveVenueReservationsEnabled("brand-1", "venue-1", true);
    expect(mockFrom).toHaveBeenCalledWith("venue_reservation_settings");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [row, opts] = mockUpsert.mock.calls[0];
    expect(row).toMatchObject({
      brand_id: "brand-1",
      venue_id: "venue-1",
      reservations_enabled: true,
    });
    expect(opts).toEqual({ onConflict: "venue_id" });
  });

  test("the shared writer refuses without a venue and surfaces server errors", async () => {
    await expect(
      saveVenueReservationsEnabled("brand-1", null, true),
    ).rejects.toThrow("venue_required");
    mockUpsert.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "denied" } }),
    );
    await expect(
      saveVenueReservationsEnabled("brand-1", "venue-1", true),
    ).rejects.toEqual({ message: "denied" });
  });

  test("the wizard saves the switch before handing off on BOTH arms", () => {
    const src = readFileSync(join(__dirname, "..", "VenueCreatorWizard.tsx"), "utf8");
    const saveAt = src.indexOf("await saveWizardReservationsChoice(");
    expect(saveAt).toBeGreaterThan(-1);
    const call = src.slice(saveAt, src.indexOf(");", saveAt));
    expect(call).toContain("wantsReservations: st.wantsReservations");
    expect(call).toContain("saveVenueReservationsEnabled");
    const claimHandoff = src.indexOf(
      "onDone(null, venueId, st.displayName.trim(), true);",
    );
    const createHandoff = src.indexOf(
      "onDone(null, venueId, st.displayName.trim(), false);",
    );
    expect(claimHandoff).toBeGreaterThan(saveAt);
    expect(createHandoff).toBeGreaterThan(saveAt);
  });
});

// ── #3384 ────────────────────────────────────────────────────────────────────

describe("#3384 — the Review step never asks for a pitch the wizard can't take", () => {
  test("an empty pitch renders the honest Mingla-writes-it copy", async () => {
    const root = await renderReview("");
    const texts = allText(root);
    expect(texts).toContain("Mingla writes your pitch when your venue is approved");
    expect(texts.some((t) => /add a pitch/i.test(t))).toBe(false);
    const pending = root.findAll(
      (node) => node.props.testID === "venue-review-pitch-pending",
    );
    expect(pending.length).toBeGreaterThan(0);
  });

  test("a pitch that exists is still shown as the value", async () => {
    const root = await renderReview("Wood-fired plates on a rooftop.");
    const texts = allText(root);
    expect(texts).toContain("Wood-fired plates on a rooftop.");
    expect(texts).not.toContain(
      "Mingla writes your pitch when your venue is approved",
    );
  });
});

// ── #3390 ────────────────────────────────────────────────────────────────────

describe("#3390 — the resume card counts the wizard's real steps", () => {
  test("total is the step list length on both arms (9 today, never 10)", () => {
    expect(venueWizardResumeProgress(0, true).total).toBe(
      venueWizardSteps(true).length,
    );
    expect(venueWizardResumeProgress(0, false).total).toBe(
      venueWizardSteps(false).length,
    );
    expect(venueWizardResumeProgress(0, true).total).toBe(9);
  });

  test("current is 1-based and clamped into 1..total", () => {
    expect(venueWizardResumeProgress(0, true)).toEqual({ current: 1, total: 9 });
    expect(venueWizardResumeProgress(4, true)).toEqual({ current: 5, total: 9 });
    expect(venueWizardResumeProgress(8, true)).toEqual({ current: 9, total: 9 });
    expect(venueWizardResumeProgress(12, true)).toEqual({ current: 9, total: 9 });
    expect(venueWizardResumeProgress(-2, true)).toEqual({ current: 1, total: 9 });
    expect(venueWizardResumeProgress(Number.NaN, true)).toEqual({
      current: 1,
      total: 9,
    });
  });

  test("the create route prints the computed count, not a literal", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "..", "..", "app", "venue", "create.tsx"),
      "utf8",
    );
    expect(src).toContain("venueWizardResumeProgress(draftStep, true)");
    expect(src).toContain("{resumeProgress.total}");
    expect(src).not.toMatch(/of\s+10\b/);
  });
});
