import type { ThemeInput } from "@mingla/offering-rendering";

/**
 * #1022 — THE canonical offering-theme column contract.
 *
 * One module owns the three `public.events` theme override columns, the
 * normaliser, and the standalone columnar write. Every mount (4 create
 * wizards + 2 edit surfaces) reads and writes through this file.
 *
 * Why columns and not the `theme` JSONB blob:
 *   - `trg_events_sync_departure` is scoped `BEFORE INSERT OR UPDATE OF theme`,
 *     so a JSONB write fires a trigger a column write does not (B-9).
 *   - Draft / event / RSVP / trip / experience rows are ALL rows in
 *     `public.events`, so one column contract serves every offering type.
 *
 * I-PROPOSED-1022-OFFERING-THEME-COLUMNS-ONLY
 * I-PROPOSED-1022-THEME-SINGLE-WRITE-PATH
 */

/** The three DB column names, in one place. */
export const THEME_OVERRIDE_COLUMNS = [
  "theme_color_override",
  "theme_font_override",
  "theme_animation_override",
] as const satisfies readonly ["theme_color_override", "theme_font_override", "theme_animation_override"];

/** Row shape carrying the three columns (all optional — legacy rows may lack them). */
export interface OfferingThemeColumns {
  theme_color_override?: string | null;
  theme_font_override?: string | null;
  theme_animation_override?: string | null;
}

/** The three theme axes, in canonical order. */
export type ThemeAxis = "color" | "font" | "animation";

/**
 * THE normaliser (I-PROPOSED-1022-THEME-EMPTY-NORMALISED).
 *
 * `undefined` | `null` | `{null,null,null}` | any all-null permutation -> `null`.
 * Otherwise returns a NEW object with every axis explicitly present (null for
 * an inherited axis). Never mutates its input.
 *
 * The null shape is load-bearing: `null` (everything inherited) must stay
 * distinguishable from `{ color:"#eb7825", font:null, animation:null }`
 * (colour overridden, font+motion inherited). Legacy drafts carry `undefined`;
 * `undefined` and `null` are treated identically at every read site.
 */
export const normalizeThemeOverrides = (
  t: ThemeInput | null | undefined,
): ThemeInput | null => {
  if (t === null || t === undefined) {
    return null;
  }

  const color = t.color ?? null;
  const font = t.font ?? null;
  const animation = t.animation ?? null;

  if (color === null && font === null && animation === null) {
    return null;
  }

  return { color, font, animation };
};

/** Row columns -> domain. Applies normalizeThemeOverrides. */
export const themeOverridesFromColumns = (
  row: OfferingThemeColumns | null | undefined,
): ThemeInput | null => {
  if (row === null || row === undefined) {
    return null;
  }

  return normalizeThemeOverrides({
    color: row.theme_color_override ?? null,
    font: row.theme_font_override ?? null,
    animation: row.theme_animation_override ?? null,
  });
};

/**
 * Domain -> row columns. Always returns all three keys (null for inherited),
 * so a partial commit explicitly clears the axes it does not set.
 */
export const themeOverridesToColumns = (
  t: ThemeInput | null | undefined,
): Required<OfferingThemeColumns> => {
  const normalized = normalizeThemeOverrides(t);

  return {
    theme_color_override: normalized?.color ?? null,
    theme_font_override: normalized?.font ?? null,
    theme_animation_override: normalized?.animation ?? null,
  };
};

/**
 * Per-axis inheritance, read from the RAW override — never from a resolved
 * theme. Comparing a resolved value is precisely how the old
 * `ThemeEditorSection` marked Inter/None falsely selected (C-1).
 */
export const themeAxisIsInherited = (
  t: ThemeInput | null | undefined,
  axis: ThemeAxis,
): boolean => {
  const normalized = normalizeThemeOverrides(t);
  if (normalized === null) {
    return true;
  }
  return normalized[axis] === null;
};

export interface PatchOfferingThemeInput {
  offeringId: string;
  themeOverrides: ThemeInput | null;
}

/**
 * THE standalone columnar write. Offering-type-neutral: `.eq("id")` uniquely
 * identifies the row, so no event_type filter is needed or wanted.
 *
 * Used by Trip (after updateBasicsMutation), Experience (after ensureDraft and
 * after publish) and EditPublishedScreen's save flow. Event/RSVP drafts do NOT
 * use this — their columns ride the wizard's own row UPDATE via
 * `draftToServer{Insert,Update}`, because an unpromoted `d_*` draft has no
 * server row to patch and a standalone write would race the autosave echo.
 *
 * Throws Error("patch_offering_theme_failed" | "patch_offering_theme_no_rows").
 */
export const patchOfferingTheme = async (
  input: PatchOfferingThemeInput,
): Promise<void> => {
  // The supabase client is imported LAZILY, inside this already-async
  // function, so that the pure half of this module (the normaliser and the
  // column mapping) can be imported by pure utils — draftDirtyCheck,
  // draftEventPristine, liveEventAdapter, serverDraftEventMapper — without
  // dragging the client, and therefore expo-constants, into their import
  // graph. Those utils are covered by node-environment jest projects that
  // cannot parse expo's ESM; a top-level client import broke five existing
  // suites that are append-only and may not be edited.
  const { supabase } = await import("./supabase");
  // I-PROPOSED-I (MUTATION-ROWCOUNT-VERIFIED): chain .select() so a 0-row
  // no-op (RLS denial / wrong id / already-mutated) surfaces as an error
  // instead of a silent success. Fixes the violation ORCH-0964 (#220) left.
  // orch-strict-grep-allow events-type-filter — id-targeted UPDATE; the .select("id")
  // is a rowcount check (I-PROPOSED-I), not a content read, so an event_type
  // filter is irrelevant (the eq("id") already uniquely identifies the row).
  const { data, error } = await supabase
    .from("events")
    .update(themeOverridesToColumns(input.themeOverrides))
    .eq("id", input.offeringId)
    .select("id");

  if (error !== null) {
    throw new Error(error.message ?? "patch_offering_theme_failed");
  }
  if (data === null || data.length === 0) {
    throw new Error("patch_offering_theme_no_rows");
  }
};
