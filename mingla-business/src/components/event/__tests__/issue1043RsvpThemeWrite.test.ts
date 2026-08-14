/**
 * #1043 — implementor regression test: editing a published RSVP's theme must
 * actually persist. + #1039 completeness: the publish response must forward the
 * real theme overrides instead of hardcoding null.
 *
 * PROVEN root cause (#1043): in `EditPublishedScreen.handleConfirmSave`, the
 * `if (rsvpMode) { … }` branch ends with `return;` BEFORE the only theme write
 * (`patchPublishedEventTheme`, in the non-RSVP continuation). Neither
 * `buildRsvpUpdatePayloadDiff` nor `biz_update_live_rsvp` carries a theme, so an
 * organiser's theme change on a published RSVP was silently dropped
 * (non-destructive — the DB keeps its prior value; the new value never lands).
 *
 * Fix (#1043): add the SAME offering-neutral `patchPublishedEventTheme` write
 * into the `rsvpMode` branch, before its return — RSVPs are `public.events`
 * rows, so the `.eq("id")` columnar write targets them correctly with no RPC or
 * migration. Gated on `patch.themeOverrides !== undefined` so an RSVP edit that
 * didn't touch the theme emits no needless write.
 *
 * Fix (#1039 completeness): `eventFromPublishResponse` forwards
 * `response.event.theme_*_override` (the publish RPC returns `to_jsonb(v_event)`)
 * instead of hardcoding null, so publish -> immediately-edit shows the chosen
 * colour.
 *
 * fails-on-revert: the source is comment-stripped before every assertion (so the
 * protective comment blocks — which name the symbols — can never satisfy the
 * grep). Deleting the rsvp-branch theme write turns the #1043 assertions red;
 * reverting the forward to `theme_color_override: null` turns the #1039 ones red.
 */
import fs from "node:fs";
import path from "node:path";

const SCREEN_PATH = path.resolve(__dirname, "..", "EditPublishedScreen.tsx");
const SERVICE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "services",
  "businessEvents.ts",
);

/** Strip block + line comments so the protective comments never pollute greps. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("#1043 — RSVP save path writes the theme override columns", () => {
  const source = stripComments(fs.readFileSync(SCREEN_PATH, "utf8"));

  // The RSVP branch runs from `if (rsvpMode) {` up to the canonical non-RSVP
  // validation path. Any patchPublishedEventTheme( in this region is the RSVP
  // write; ticketed events now include theme in the atomic #1972 patch owner.
  const rsvpBranchStart = source.indexOf("if (rsvpMode) {");
  const eventPathMarker = source.indexOf(
    "const validation = validateLiveEventFieldUpdate",
  );

  test("source loads and both landmarks are locatable, in order", () => {
    expect(rsvpBranchStart).toBeGreaterThanOrEqual(0);
    expect(eventPathMarker).toBeGreaterThan(rsvpBranchStart);
  });

  test("FAILS-ON-REVERT: the rsvpMode branch calls patchPublishedEventTheme, gated on a theme patch", () => {
    const rsvpRegion = source.slice(rsvpBranchStart, eventPathMarker);
    // The load-bearing write — deleting it empties this assertion.
    expect(rsvpRegion).toContain("patchPublishedEventTheme(");
    // Gated so an RSVP edit that didn't touch the theme emits no write. This
    // exact `if (` form is unique to the RSVP branch.
    expect(rsvpRegion).toMatch(/if\s*\(\s*patch\.themeOverrides\s*!==\s*undefined\s*\)/);
    // Writes the edited overrides against the server event id.
    expect(rsvpRegion).toContain("eventId: liveEvent.serverEventId");
    expect(rsvpRegion).toContain("themeOverrides: patch.themeOverrides");
  });

  test("the rsvp-branch theme write is gated BEFORE it calls patchPublishedEventTheme", () => {
    const gateIdx = source.indexOf("if (patch.themeOverrides !== undefined)");
    const rsvpCallIdx = source.indexOf(
      "patchPublishedEventTheme(",
      rsvpBranchStart,
    );
    expect(gateIdx).toBeGreaterThan(rsvpBranchStart);
    expect(gateIdx).toBeLessThan(eventPathMarker);
    expect(rsvpCallIdx).toBeGreaterThan(gateIdx);
    expect(rsvpCallIdx).toBeLessThan(eventPathMarker);
  });

  test("no regression: the non-RSVP event path writes theme through the atomic owner", () => {
    const occurrences = source.match(/patchPublishedEventTheme\(/g) ?? [];
    expect(occurrences).toHaveLength(1);
    const eventRegion = source.slice(eventPathMarker);
    expect(eventRegion).toContain("atomicPatch.theme = patch.themeOverrides ?? null");
    expect(eventRegion).toContain("patchPublishedEventAtomically(");
  });
});

describe("#1039 — publish response forwards the real theme overrides (not hardcoded null)", () => {
  const source = stripComments(fs.readFileSync(SERVICE_PATH, "utf8"));

  const fnStart = source.indexOf("export const eventFromPublishResponse");
  const fnEnd = source.indexOf("export const publishBusinessEventDraft");
  const region = source.slice(fnStart, fnEnd);

  test("eventFromPublishResponse is locatable", () => {
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
  });

  test("FAILS-ON-REVERT: forwards response.event.theme_*_override, not null", () => {
    expect(region).toContain(
      "theme_color_override: response.event.theme_color_override",
    );
    expect(region).toContain(
      "theme_font_override: response.event.theme_font_override",
    );
    expect(region).toContain(
      "theme_animation_override: response.event.theme_animation_override",
    );
    // The pre-fix hardcode must be gone.
    expect(region).not.toContain("theme_color_override: null");
    expect(region).not.toContain("theme_font_override: null");
    expect(region).not.toContain("theme_animation_override: null");
  });
});
