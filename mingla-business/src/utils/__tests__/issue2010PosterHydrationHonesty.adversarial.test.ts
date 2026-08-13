import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import {
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const migration = readFileSync(
  join(
    REPO_ROOT,
    "supabase/migrations/20270402002010_issue_2010_management_event_poster_hydration.sql",
  ),
  "utf8",
);
const priorMigration = readFileSync(
  join(
    REPO_ROOT,
    "supabase/migrations/20270116000869_issue_868_cover_gallery_read_layer.sql",
  ),
  "utf8",
);
const businessEventsSource = readFileSync(
  join(REPO_ROOT, "mingla-business/src/services/businessEvents.ts"),
  "utf8",
);

const event = (poster: string | null | undefined): LiveEvent =>
  ({
    id: "event-2010",
    brandId: "brand-2010",
    eventSlug: "poster-honesty",
    name: "Poster honesty",
    description: "An adversarial editor fixture",
    visibility: "hidden",
    coverMediaPosterUrl: poster,
    coverMediaUrl: "https://cdn.usemingla.com/cover.mp4",
    coverMediaType: "video",
    coverMediaProvider: "upload",
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: "Gallery preview",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    city: null,
    locationGeo: null,
    pricingSwitches: {
      passTax: null,
      passMinglaFee: null,
      passServiceFee: null,
    },
    rsvpCapacity: null,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpDiscoverable: false,
    rsvpContributionEnabled: false,
    rsvpContributionSuggestedCents: null,
    rsvpContributionMinCents: null,
  }) as unknown as LiveEvent;

const posterDiffs = (original: LiveEvent, edited: DraftEvent) =>
  computeRichFieldDiffs(original, edited).filter(
    ({ fieldKey }) => fieldKey === "coverMediaPosterUrl",
  );

const managementSelect = (sql: string): string[] => {
  const match = sql.match(
    /CREATE OR REPLACE VIEW public\.business_management_events_view[\s\S]*?AS\s+SELECT([\s\S]*?)FROM public\.events e/,
  );
  if (match === null) throw new Error("management projection not found");
  return match[1]
    .replace(/--[^\n]*/g, "")
    .split(",")
    .map((column) => column.replace(/\s+/g, " ").trim())
    .filter(Boolean);
};

const executableSql = migration.replace(/--[^\n]*/g, "");

describe("#2010 tester adversarial — authoritative poster round trip", () => {
  test.each<[string, string | null | undefined]>([
    ["omitted", undefined],
    ["SQL null", null],
    ["admitted empty string", ""],
    ["authoritative URL", "https://cdn.usemingla.com/poster.jpg"],
  ])("%s remains a no-op after editor projection", (_label, poster) => {
    const original = event(poster);
    const edited = liveEventToEditableDraft(original);

    expect(editableDraftToPatch(original, edited)).toEqual({});
    expect(posterDiffs(original, edited)).toEqual([]);
    expect(edited.coverMediaPosterUrl).toBe(poster ?? null);
  });

  test.each<[string, string | null, string | null, string | null]>([
    [
      "add",
      null,
      "https://cdn.usemingla.com/added.jpg",
      "https://cdn.usemingla.com/added.jpg",
    ],
    [
      "replace",
      "https://cdn.usemingla.com/old.jpg",
      "https://cdn.usemingla.com/new.jpg",
      "https://cdn.usemingla.com/new.jpg",
    ],
    ["clear", "https://cdn.usemingla.com/old.jpg", null, null],
  ])(
    "a real %s produces exactly one poster patch and one summary row",
    (_label, before, after, expected) => {
      const original = event(before);
      const edited = {
        ...liveEventToEditableDraft(original),
        coverMediaPosterUrl: after,
      };
      const patch = editableDraftToPatch(original, edited);

      expect(patch).toEqual({ coverMediaPosterUrl: expected });
      expect(posterDiffs(original, edited)).toHaveLength(1);
    },
  );

  test("poster normalization cannot fabricate or swallow an unrelated visibility edit", () => {
    const original = event(undefined);
    const edited = {
      ...liveEventToEditableDraft(original),
      visibility: "public" as const,
    };

    expect(editableDraftToPatch(original, edited)).toEqual({
      visibility: "public",
    });
    expect(
      computeRichFieldDiffs(original, edited).map(({ fieldKey }) => fieldKey),
    ).toEqual(["visibility"]);
  });
});

describe("#2010 tester adversarial — management projection is additive and isolated", () => {
  test("the #868 column sequence is an exact prefix and poster is appended last", () => {
    const before = managementSelect(priorMigration);
    const after = managementSelect(migration);

    expect(after.slice(0, -1)).toEqual(before);
    expect(after.at(-1)).toBe("e.cover_media_poster_url");
    expect(
      after.filter((column) => column === "e.cover_media_poster_url"),
    ).toHaveLength(1);
  });

  test("security, grants, filters and public/Explorer/share exclusions stay pinned", () => {
    expect(executableSql).toContain("WITH (security_invoker = true)");
    expect(executableSql).toContain(
      "GRANT SELECT ON public.business_management_events_view TO authenticated, service_role",
    );
    expect(executableSql).toContain(
      "REVOKE SELECT ON public.business_management_events_view FROM anon",
    );
    expect(executableSql).toContain("WHERE e.deleted_at IS NULL");
    expect(executableSql).toContain("AND b.deleted_at IS NULL");
    expect(executableSql).toContain(
      "AND e.status IN ('scheduled', 'live', 'ended', 'cancelled')",
    );
    expect(executableSql).not.toMatch(
      /business_public_events_view|pg_public_|social|share|explorer/i,
    );
    expect(executableSql).not.toMatch(
      /\b(?:ALTER TABLE|UPDATE|INSERT|DELETE|DROP)\b/i,
    );
  });

  test("both Business hydration paths map the authoritative column honestly", () => {
    expect(businessEventsSource).toMatch(
      /coverMediaPosterUrl:\s*asStringOrNull\(row\.cover_media_poster_url\)/,
    );
    expect(businessEventsSource).toMatch(
      /cover_media_poster_url:\s*response\.event\.cover_media_poster_url\s*\?\?\s*null/,
    );
  });
});
