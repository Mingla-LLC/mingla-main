import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import type { ThemeInput } from "@mingla/offering-rendering";

import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import { normalizeThemeOverrides } from "../../../services/offeringTheme";
import {
  themeResetLabel,
  themeValueLine,
} from "../../theme/themeColorModel";

/**
 * issue #1564 [venue-colours] — a venue can carry its own colours.
 *
 * THE ONE RULE THIS FILE GUARDS: override-vs-inherit is decided PER AXIS, and
 * it is decided in exactly ONE place for guests — `venue_public_view`'s SELECT
 * list — which must agree with `resolveTheme`, the one place it is decided for
 * the operator's preview. Two resolution points that disagree would mean the
 * wizard shows one palette and the public page renders another.
 *
 * The SQL half is asserted against the migration TEXT (jest cannot run
 * Postgres); the migration was separately applied to a real local Postgres 17
 * and the row-level behaviour recorded on the issue. The text assertions here
 * are what stop a later edit from quietly reverting it.
 */

const MIGRATION = "supabase/migrations/20270214001564_issue_1564_venue_theme_overrides.sql";
const REPO_ROOT = path.join(process.cwd(), "..");

const sql = ((): string => {
  const text = readFileSync(path.join(REPO_ROOT, MIGRATION), "utf8");
  // Vacuity guard: every assertion below is a substring test, and a substring
  // test over an empty (or wrong) file is trivially satisfiable in the negative
  // direction. Prove we loaded the real migration before trusting any of them.
  expect(text.length).toBeGreaterThan(2000);
  expect(text).toContain("CREATE OR REPLACE VIEW public.venue_public_view");
  return text;
})();

// ─── The model the view implements, expressed once ─────────────────────────
// `COALESCE(venue_override, brand_value)` per axis, exactly as the SELECT list
// spells it. Written here as a plain function so the SAME matrix can be pushed
// through it and through `resolveTheme`, and the two compared.
const viewCoalesce = (
  venue: ThemeInput | null,
  brand: ThemeInput | null,
): { color: string | null; font: string | null; animation: string | null } => ({
  color: venue?.color ?? brand?.color ?? null,
  font: venue?.font ?? brand?.font ?? null,
  animation: venue?.animation ?? brand?.animation ?? null,
});

const BRAND: ThemeInput = {
  color: "#2563eb",
  font: "lora",
  animation: "snowfall",
};

const VENUE_FULL: ThemeInput = {
  color: "#eb7825",
  font: "bebas_neue",
  animation: "sparkles",
};

/** Every per-axis combination of set/unset, so no case is assumed. */
const AXIS_MATRIX: Array<{ label: string; venue: ThemeInput | null }> = [
  { label: "nothing set (every venue today)", venue: null },
  {
    label: "colour only",
    venue: { color: VENUE_FULL.color, font: null, animation: null },
  },
  {
    label: "font only",
    venue: { color: null, font: VENUE_FULL.font, animation: null },
  },
  {
    label: "motion only",
    venue: { color: null, font: null, animation: VENUE_FULL.animation },
  },
  {
    label: "colour + font",
    venue: { color: VENUE_FULL.color, font: VENUE_FULL.font, animation: null },
  },
  {
    label: "colour + motion",
    venue: {
      color: VENUE_FULL.color,
      font: null,
      animation: VENUE_FULL.animation,
    },
  },
  {
    label: "font + motion",
    venue: {
      color: null,
      font: VENUE_FULL.font,
      animation: VENUE_FULL.animation,
    },
  },
  { label: "all three", venue: VENUE_FULL },
];

describe("#1564 — the venue's values override the brand's PER AXIS", () => {
  test("the matrix is the whole matrix (vacuity guard)", () => {
    // 3 axes, set-or-unset = 8 combinations. A silently-shrunk matrix would
    // make every test.each below pass on fewer cases without anyone noticing.
    expect(AXIS_MATRIX).toHaveLength(8);
    const seen = new Set(
      AXIS_MATRIX.map((c) =>
        [
          c.venue?.color === undefined || c.venue?.color === null ? "0" : "1",
          c.venue?.font === undefined || c.venue?.font === null ? "0" : "1",
          c.venue?.animation === undefined || c.venue?.animation === null
            ? "0"
            : "1",
        ].join(""),
      ),
    );
    expect(seen.size).toBe(8);
  });

  test.each(AXIS_MATRIX)(
    "$label — the view's COALESCE and resolveTheme agree on every axis",
    ({ venue }) => {
      const viaView = viewCoalesce(venue, BRAND);
      // The clients map the view's three columns into ONE ThemeInput and hand
      // it to the page as the already-resolved theme. That is what the second
      // argument being `null` models: nothing is left to resolve client-side.
      const rendered = resolveTheme(
        {
          color: viaView.color,
          font: viaView.font,
          animation: viaView.animation,
        },
        null,
      );
      // The operator's preview resolves the RAW override against the brand.
      const previewed = resolveTheme(BRAND, venue);

      expect(rendered.color).toBe(previewed.color);
      expect(rendered.font).toBe(previewed.font);
      expect(rendered.animation).toBe(previewed.animation);
      // Falsifiable: at least one axis must carry a REAL value, never the
      // silent Mingla fallback for all three.
      expect(rendered.color).not.toBe("");
    },
  );

  test("an unset axis really does render the BRAND's value, not Mingla's", () => {
    const colourOnly: ThemeInput = {
      color: "#16a34a",
      font: null,
      animation: null,
    };
    const rendered = resolveTheme(viewCoalesce(colourOnly, BRAND), null);
    expect(rendered.color).toBe("#16a34a");
    // The two assertions that make this test falsifiable: the inherited axes
    // must equal the BRAND's, and must NOT equal Mingla's default (`inter` /
    // `none`) — which is what a broken COALESCE or a swapped resolveTheme
    // argument order would produce.
    expect(rendered.font).toBe("lora");
    expect(rendered.animation).toBe("snowfall");
    expect(rendered.font).not.toBe("inter");
    expect(rendered.animation).not.toBe("none");
  });

  test("a brand with several venues — restyling one changes only that one", () => {
    const fineDining: ThemeInput | null = null;
    const beachBar: ThemeInput = {
      color: "#eb7825",
      font: null,
      animation: null,
    };
    const before = viewCoalesce(fineDining, BRAND);
    const after = viewCoalesce(beachBar, BRAND);
    expect(after.color).toBe("#eb7825");
    // The sibling's resolution is a pure function of ITS OWN row plus the
    // brand — the beach bar's override is not an input to it at all.
    expect(viewCoalesce(fineDining, BRAND)).toEqual(before);
    expect(before.color).toBe(BRAND.color);
    expect(before.color).not.toBe(after.color);
  });

  test("clearing the override returns the venue to inheriting", () => {
    const overridden = viewCoalesce(VENUE_FULL, BRAND);
    const cleared = viewCoalesce(normalizeThemeOverrides({
      color: null,
      font: null,
      animation: null,
    }), BRAND);
    expect(overridden.color).toBe("#eb7825");
    expect(cleared.color).toBe(BRAND.color);
    expect(cleared.font).toBe(BRAND.font);
    expect(cleared.animation).toBe(BRAND.animation);
  });
});

describe("#1564 — the migration is the single resolution point, and only that", () => {
  test("the SELECT list COALESCEs each axis onto the brand's column", () => {
    expect(sql).toContain(
      "COALESCE(v.theme_color_override, b.theme_color) AS theme_color",
    );
    expect(sql).toContain(
      "COALESCE(v.theme_font_override, b.theme_font) AS theme_font",
    );
    expect(sql).toContain(
      "COALESCE(v.theme_animation_override, b.theme_animation) AS theme_animation",
    );
    // The defect being fixed: the bare `b.theme_color` list must be GONE, or
    // the venue's own value would still be unreachable.
    expect(sql).not.toContain("b.theme_color, b.theme_font, b.theme_animation");
  });

  test("THREE columns, and only three, are added to any table", () => {
    const added = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map(
      (m) => m[1],
    );
    expect(added).toEqual([
      "theme_color_override",
      "theme_font_override",
      "theme_animation_override",
    ]);
    // One ALTER TABLE, on one table.
    const alters = [...sql.matchAll(/ALTER TABLE\s+public\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(new Set(alters)).toEqual(new Set(["venue_listings"]));
  });

  test("the vocabularies are byte-identical to the events overrides", () => {
    const events = readFileSync(
      path.join(
        REPO_ROOT,
        "supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql",
      ),
      "utf8",
    );
    expect(events.length).toBeGreaterThan(2000); // vacuity guard

    const fonts = (text: string): string[] => {
      const block = /theme_font(?:_override)?\s+IN\s+\(([^)]*)\)/.exec(text);
      expect(block).not.toBeNull();
      return (block?.[1] ?? "")
        .split(",")
        .map((s) => s.trim().replace(/'/g, ""))
        .filter((s) => s.length > 0);
    };
    const motions = (text: string): string[] => {
      const block = /theme_animation(?:_override)?\s+IN\s+\(([^)]*)\)/.exec(
        text,
      );
      expect(block).not.toBeNull();
      return (block?.[1] ?? "")
        .split(",")
        .map((s) => s.trim().replace(/'/g, ""))
        .filter((s) => s.length > 0);
    };

    expect(fonts(sql).length).toBe(14);
    expect(motions(sql).length).toBe(10);
    expect(fonts(sql)).toEqual(fonts(events));
    expect(motions(sql)).toEqual(motions(events));
    expect(sql).toContain("theme_color_override ~* '^#[0-9a-f]{6}$'");
  });

  test("the view is REPLACED, never dropped — #1431 depends on it", () => {
    // `ad_public_stay_destinations_view` SELECTs from this view. A bare DROP
    // errors; a DROP CASCADE silently deletes the ad-attribution view.
    expect(sql).toContain("CREATE OR REPLACE VIEW public.venue_public_view");
    // Executable statements only — the header comment names DROP/CASCADE to
    // explain why they are refused, and matching that prose would be vacuous.
    const statements = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.length).toBeGreaterThan(1000); // vacuity guard
    expect(statements).toMatch(/CREATE OR REPLACE VIEW/);
    expect(statements).not.toMatch(/DROP\s+VIEW/i);
    expect(statements).not.toMatch(/CASCADE/i);
  });

  test("the anon scope is untouched — pending_review stays invisible", () => {
    expect(sql).toContain("WHERE v.claim_status = 'verified'");
    expect(sql).toContain(
      "ALTER VIEW public.venue_public_view SET (security_invoker = false)",
    );
    expect(sql).toContain(
      "GRANT SELECT ON public.venue_public_view TO anon, authenticated",
    );
    // No new grant, and nothing granted to anon that was not already.
    const anonGrants = [...sql.matchAll(/GRANT[^;]*TO[^;]*anon/gi)];
    expect(anonGrants).toHaveLength(1);
  });

  test("the RPC gains three appended, defaulted params — an old client still resolves", () => {
    expect(sql).toContain("p_theme_color text DEFAULT ''");
    expect(sql).toContain("p_theme_font text DEFAULT ''");
    expect(sql).toContain("p_theme_animation text DEFAULT ''");
    // Appended AFTER the pre-existing last param, so positional callers are
    // unaffected and named 18-arg callers bind by name.
    const sig = /CREATE OR REPLACE FUNCTION public\.biz_create_venue_listing \(([\s\S]*?)\) RETURNS uuid/.exec(
      sql,
    );
    expect(sig).not.toBeNull();
    const params = (sig?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("p_"))
      .map((l) => l.split(/[\s,]/)[0]);
    expect(params.length).toBe(21);
    expect(params.slice(-3)).toEqual([
      "p_theme_color",
      "p_theme_font",
      "p_theme_animation",
    ]);
    expect(params[17]).toBe("p_coordinate_precision");
    // DROP FUNCTION of the OLD 18-arg signature must precede the CREATE —
    // Postgres cannot CREATE OR REPLACE a changed argument list.
    expect(sql.indexOf("DROP FUNCTION IF EXISTS public.biz_create_venue_listing")).
      toBeLessThan(sql.indexOf("CREATE OR REPLACE FUNCTION public.biz_create_venue_listing"));
  });

  test("the RPC normalises each axis SEPARATELY — a bad font keeps a good colour", () => {
    // Three independent guards, never one combined `IF ... THEN all := NULL`.
    expect(sql).toContain("v_theme_color := NULL;");
    expect(sql).toContain("v_theme_font := NULL;");
    expect(sql).toContain("v_theme_animation := NULL;");
    const body = sql.slice(sql.indexOf("v_theme_color := nullif"));
    // Each axis is assigned from its OWN param.
    expect(body).toContain("nullif(trim(coalesce(p_theme_color, '')), '')");
    expect(body).toContain("nullif(trim(coalesce(p_theme_font, '')), '')");
    expect(body).toContain("nullif(trim(coalesce(p_theme_animation, '')), '')");
  });

  test("the migration prefix is monotonic above #1562's", () => {
    expect(Number("20270214001564")).toBeGreaterThan(Number("20270213001562"));
    expect(MIGRATION).toContain("20270214001564");
  });
});

describe("#1564 — the copy the operator reads", () => {
  test("an inherited venue reads as INHERITED, never as empty", () => {
    const line = themeValueLine(null, "venue", BRAND);
    expect(line.startsWith("Brand default")).toBe(true);
    // It names the brand's REAL font and motion, not Mingla's defaults —
    // otherwise the row would be lying about what the page looks like.
    expect(line).toContain("Lora");
    expect(line).toContain("Snowfall");
    expect(line).not.toContain("Custom colour");
  });

  test("an overridden venue reads as CUSTOM", () => {
    const line = themeValueLine(VENUE_FULL, "venue", BRAND);
    expect(line.startsWith("Custom colour")).toBe(true);
    expect(line).toContain("Bebas Neue");
    expect(line).toContain("Sparkles");
  });

  test("a partially-overridden venue still names the brand's inherited axes", () => {
    const line = themeValueLine(
      { color: "#16a34a", font: null, animation: null },
      "venue",
      BRAND,
    );
    expect(line).toBe("Custom colour · Lora · Snowfall");
  });

  test("the way back says what it does", () => {
    expect(themeResetLabel("venue", "colour")).toBe("Use the brand's colours");
    expect(themeResetLabel("venue", "font")).toBe("Use the brand's font");
    expect(themeResetLabel("venue", "motion")).toBe("Use the brand's motion");
  });

  test("no other scope's wording moved", () => {
    for (const scope of ["offering", "brand"] as const) {
      expect(themeResetLabel(scope, "colour")).toBe("Reset colour");
      expect(themeResetLabel(scope, "font")).toBe("Reset font");
      expect(themeResetLabel(scope, "motion")).toBe("Reset motion");
    }
  });
});
