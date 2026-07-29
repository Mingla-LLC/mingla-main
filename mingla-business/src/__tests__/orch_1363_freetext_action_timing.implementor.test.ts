/**
 * Issue #1363 (device-UX F2) — IMPLEMENTOR happy-path regression test for the
 * Tier-2 free-text ACTION row's TIMING + ACCENT styling (RUNTIME EYEBALL F2).
 *
 * Seth's Samsung eyeball found the "Use '<address>'" row (a) looked like passive
 * muted status text and (b) appeared from the FIRST typed character, competing
 * with the live Mapbox suggestion list. This pins both fixes via the pure,
 * react-free helpers the shared field now drives (imported through the package
 * symlink so no react-native is pulled into this node-env suite):
 *
 *   computeShowFreeTextRow  — TIMING: never during loading_suggestions /
 *                             suggestions_open / fetching_details; shown on
 *                             no_results (primary) + idle-after-typing full addr.
 *   resolveFreeTextRowStyle — ACCENT: accent text + icon + pill when an `action`
 *                             token is injected (business); exact muted fallback
 *                             when absent (consumer) → byte-identical.
 *
 * FAILS-ON-REVERT:
 *  - Delete the `no_results → true` branch in computeShowFreeTextRow ⇒ the
 *    "shown on no_results" assertion FAILS.
 *  - Delete the accent branch in resolveFreeTextRowStyle ⇒ the "accent applied
 *    when the action token is passed" assertion FAILS.
 *  - Reverting the whitelist to the old `trimmedLength >= 1` any-status rule ⇒
 *    the "hidden during loading_suggestions / suggestions_open" assertions FAIL.
 */

// Imported via a filesystem-relative path (NOT the `@mingla/location-input`
// specifier): the business node_modules symlink resolves `@mingla/*` to the
// ANCHOR checkout, so a bare-specifier import would read stale package source.
// The relative path lands on THIS worktree's helper, which type-imports only
// ./types (no react-native) so it loads cleanly under this node-env suite.
import {
  computeShowFreeTextRow,
  resolveFreeTextRowStyle,
  type AssistFooterStatusKind,
} from "../../../packages/location-input/src/assistFooter";

const base = {
  allowFreeText: true,
  hasOnFreeText: true,
  justPicked: false,
  trimmedLength: 20, // a full typed address, well over minQueryLength
  minQueryLength: 3,
};

const show = (over: Partial<typeof base> & { statusKind: AssistFooterStatusKind }) =>
  computeShowFreeTextRow({ ...base, ...over });

describe("Issue #1363 F2 — free-text ACTION row TIMING (never competes with suggestions)", () => {
  it("is HIDDEN while suggestions are loading", () => {
    expect(show({ statusKind: "loading_suggestions" })).toBe(false);
  });

  it("is HIDDEN while an active suggestion list is open", () => {
    expect(show({ statusKind: "suggestions_open" })).toBe(false);
  });

  it("is HIDDEN while a picked place's details are being fetched", () => {
    expect(show({ statusKind: "fetching_details" })).toBe(false);
  });

  it("is SHOWN when the search comes back empty (no_results — the primary moment)", () => {
    expect(show({ statusKind: "no_results" })).toBe(true);
  });

  it("is SHOWN when idle-after-typing with a full-length address", () => {
    expect(show({ statusKind: "idle", trimmedLength: 3 })).toBe(true);
  });

  it("is HIDDEN when idle but the address is below minQueryLength", () => {
    expect(show({ statusKind: "idle", trimmedLength: 2 })).toBe(false);
  });

  it("is HIDDEN right after a pick (justPicked), even on no_results", () => {
    expect(show({ statusKind: "no_results", justPicked: true })).toBe(false);
  });

  it("is HIDDEN when the host did not opt in (allowFreeText / onFreeText absent)", () => {
    expect(show({ statusKind: "no_results", allowFreeText: false })).toBe(false);
    expect(show({ statusKind: "no_results", hasOnFreeText: false })).toBe(false);
  });
});

describe("Issue #1363 F2 — free-text ACTION row ACCENT styling", () => {
  const fallback = { text: "#8a8a8a", icon: "#6b6b6b" };
  const action = {
    text: "#eb7825",
    bg: "rgba(235, 120, 37, 0.28)",
    border: "rgba(235, 120, 37, 0.55)",
  };

  it("applies the ACCENT (text + icon + pill, 600 weight) when the action token is passed", () => {
    const style = resolveFreeTextRowStyle(action, fallback);
    expect(style.textColor).toBe(action.text);
    expect(style.iconColor).toBe(action.text);
    expect(style.fontWeight).toBe("600");
    expect(style.pill).not.toBeNull();
    expect(style.pill?.backgroundColor).toBe(action.bg);
    expect(style.pill?.borderColor).toBe(action.border);
    expect(style.pill?.borderWidth).toBe(1);
    // Distinct from the muted fallback — this is the whole point of F2.
    expect(style.textColor).not.toBe(fallback.text);
  });

  it("falls back to the exact MUTED styling (no pill, 400 weight) when action is absent — byte-identical consumer render", () => {
    const style = resolveFreeTextRowStyle(undefined, fallback);
    expect(style.textColor).toBe(fallback.text);
    expect(style.iconColor).toBe(fallback.icon);
    expect(style.fontWeight).toBe("400");
    expect(style.pill).toBeNull();
  });
});
