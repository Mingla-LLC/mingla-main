import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

/**
 * issue #1564 [venue-colours] — the four mounts.
 *
 * The gap this closes, stated as a measurement rather than an opinion: every
 * OTHER cover step in the product carries the Theme row on the way to
 * publishing — `CreatorStep4Cover`, `ExperienceCoverStep`,
 * `TripCreatorStep1Basics`, `RsvpStep7Preview`, `BrandEditView` — and
 * `VenueCoverStep` carried ZERO references to it. This file re-measures that
 * on every run, so the venue can never silently fall out of the set again.
 *
 * Approved placement, not to be widened: the existing 56pt `ThemeControlRow`
 * at create s4/s9 and claim c4/c9. A dedicated "Appearance" module was
 * rejected, and the test below fails if one appears.
 */

const src = (rel: string): string => {
  const text = readFileSync(path.join(process.cwd(), rel), "utf8");
  // Vacuity guard — a `toContain` over an empty string is a test that cannot
  // fail in the direction we care about.
  expect(text.length).toBeGreaterThan(400);
  return text;
};

/** The four approved mounts, and nothing else. */
const MOUNTS: Array<{ label: string; file: string; variant: "row" | "review" }> = [
  {
    label: "create s4 — VenueCoverStep",
    file: "src/components/venue/VenueCoverStep.tsx",
    variant: "row",
  },
  {
    label: "create s9 — VenueStep7Review",
    file: "src/components/venue/VenueStep7Review.tsx",
    variant: "review",
  },
  {
    label: "claim c4 — ClaimStepCover",
    file: "src/components/venue/claim/ClaimStepCover.tsx",
    variant: "row",
  },
  {
    label: "claim c9 — ClaimStepReview",
    file: "src/components/venue/claim/ClaimStepReview.tsx",
    variant: "review",
  },
];

/** The steps that already had it — the parity argument, re-measured. */
const PRIOR_ART = [
  "src/components/event/CreatorStep4Cover.tsx",
  "src/components/experience/ExperienceCoverStep.tsx",
  "src/components/trip/TripCreatorStep1Basics.tsx",
  "src/components/rsvp/RsvpStep7Preview.tsx",
  "src/components/brand/BrandEditView.tsx",
];

describe("#1564 — four mounts, one existing component", () => {
  test("the mount list is four (vacuity guard)", () => {
    expect(MOUNTS).toHaveLength(4);
    expect(new Set(MOUNTS.map((m) => m.file)).size).toBe(4);
  });

  test.each(MOUNTS)("$label mounts the row AND its sheet", ({ file }) => {
    const s = src(file);
    expect(s).toContain("<ThemeControlRow");
    expect(s).toContain("<ThemeSheet");
    // Both must be REAL imports, not a string that happens to appear in a
    // comment — an unimported JSX tag would not compile, but a commented-out
    // one would still satisfy a naive toContain.
    expect(s).toMatch(
      /import \{ ThemeControlRow \} from "\.\.\/(?:\.\.\/)?theme\/ThemeControlRow";/,
    );
    expect(s).toMatch(
      /import \{ ThemeSheet \} from "\.\.\/(?:\.\.\/)?theme\/ThemeSheet";/,
    );
  });

  test.each(MOUNTS)("$label declares scope=\"venue\", never offering", ({ file }) => {
    const s = src(file);
    const venueScopes = [...s.matchAll(/scope="venue"/g)];
    // Exactly two: the row and the sheet. One would mean the sheet resolves
    // inheritance differently from the row that opened it.
    expect(venueScopes).toHaveLength(2);
    expect(s).not.toContain('scope="offering"');
    expect(s).not.toContain('scope="brand"');
  });

  test.each(MOUNTS.filter((m) => m.variant === "review"))(
    "$label uses the review variant",
    ({ file }) => {
      expect(src(file)).toContain('variant="review"');
    },
  );

  test.each(MOUNTS)(
    "$label reads and writes through the ONE shared control",
    ({ file }) => {
      const s = src(file);
      expect(s).toContain("useVenueThemeControl");
      // No mount may reach past the shared hook into the store or the brand
      // query for theme — that is how four mounts become four behaviours.
      expect(s).not.toContain("themeOverrides:");
      expect(s).not.toContain("brandQuery");
    },
  );

  test("the prior art really did have it — the parity claim is measured, not asserted", () => {
    for (const file of PRIOR_ART) {
      const s = src(file);
      expect(s).toContain("<ThemeControlRow");
    }
    // And the count that made the venue an outlier: the git history claim is
    // "the others carry 4 references each". Re-derive it rather than trust it.
    for (const file of PRIOR_ART) {
      const refs = [...src(file).matchAll(/ThemeControlRow|ThemeSheet/g)];
      expect(refs.length).toBeGreaterThanOrEqual(4);
    }
  });

  test("NO new Appearance module was created — the placement stands", () => {
    const shared = src("src/components/venue/useVenueThemeControl.ts");
    expect(shared).toContain("NOT a new UI module");
    // The rejected design was a MODULE — a venue-suite pane alongside Menu /
    // Tables / Reservations. If one ever appears, the registry names it.
    const modules = src("src/components/venue/venueModules.ts");
    expect(modules.toLowerCase()).not.toContain("appearance");
    // And no mount may render a heading that turns the row into a section.
    for (const m of MOUNTS) {
      expect(src(m.file)).not.toMatch(/>\s*Appearance\s*</);
    }
    // The venue folder gained exactly ONE new file, and it is a hook.
    expect(
      readFileSync(
        path.join(process.cwd(), "src/components/venue/useVenueThemeControl.ts"),
        "utf8",
      ),
    ).toContain("export const useVenueThemeControl");
  });
});

describe("#1564 — the draft carries the venue's theme to the submit", () => {
  test("the store field exists and defaults to inheriting", () => {
    const store = src("src/store/draftVenueStore.ts");
    expect(store).toContain("themeOverrides?: ThemeInput | null;");
    expect(store).toContain("themeOverrides: null,");
    // It must survive the per-brand stash/restore, or switching brands
    // mid-draft would silently drop the operator's colour.
    expect(store).toContain("themeOverrides: s.themeOverrides ?? null,");
  });

  test("the wizard hands it to the create RPC for BOTH paths", () => {
    const wizard = src("src/components/venue/VenueCreatorWizard.tsx");
    // ONE call site — `createVenueRecord` serves create and claim alike, which
    // is exactly why one line covers both wizards.
    const passes = [...wizard.matchAll(/themeOverrides:\s*st\.themeOverrides/g)];
    expect(passes).toHaveLength(1);
  });

  test("the service normalises and splits it into three RPC params", () => {
    const service = src("src/services/venueListingsService.ts");
    expect(service).toContain("normalizeThemeOverrides(input.themeOverrides)");
    expect(service).toContain('p_theme_color: theme?.color ?? ""');
    expect(service).toContain('p_theme_font: theme?.font ?? ""');
    expect(service).toContain('p_theme_animation: theme?.animation ?? ""');
  });
});

describe("#1564 — the sheet treats a venue like an offering, not like a brand", () => {
  test("the brand swatch is offered to a venue too", () => {
    const sheet = src("src/components/theme/ThemeSheet.tsx");
    // Was `scope === "offering" && brandTheme?.color`, which would have hidden
    // "Use my brand colour" from the one scope that most needs it.
    expect(sheet).toContain('scope !== "brand" && brandTheme?.color');
    expect(sheet).not.toContain('scope === "offering" && brandTheme?.color');
  });

  test('"venue" is a real member of the scope union', () => {
    const model = src("src/components/theme/themeColorModel.ts");
    expect(model).toContain(
      'export type ThemeControlScope = "offering" | "brand" | "venue";',
    );
  });
});
