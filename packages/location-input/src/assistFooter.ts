/**
 * @mingla/location-input · assist-footer pure logic (Issue #1363 device-UX F2)
 *
 * Extracted, react-free helpers for the Tier-2 "Use '<address>'" free-text
 * ACTION row so its timing + accent styling are unit-testable in a node env
 * (mirrors the `computeDropdownMaxHeight` / `staticMapPixelToLngLat` pattern).
 *
 * F2 fixes two device-eyeball defects:
 *  1. TIMING — the row used to appear from the FIRST typed character, competing
 *     with the live suggestion list. It shows on the "we couldn't find it"
 *     moment (`no_results`), plus the idle-after-typing full-address case. It
 *     NEVER shows while suggestions are LOADING or a pick is resolving.
 *  2. ACCENT — the row was styled with the muted `status.text` color (looked
 *     like passive "Searching…" text). When the host injects an `action` token
 *     it now renders as an accent, pill-bordered button; without it (consumer)
 *     it falls back to the exact muted styling → byte-identical.
 *
 * Issue #1363 (CHANGE 1 — free-text-on-suggestions): the row ALSO shows WHILE a
 * live suggestion list is open, as long as the typed text is full-length. Mapbox
 * cannot resolve granular Nigerian addresses (it keyword-matches the city and
 * returns junk suggestions), so the brand must ALWAYS be able to commit what they
 * typed — even when a list is on screen. The host frames it as a clearly-separated
 * "or use what you typed" alternative BELOW the list so it never reads as one of
 * the suggestions. Still hidden during `loading_suggestions` (transient) and
 * `fetching_details` (a pick resolving).
 */

import type { LocationInputAction } from "./types";

/** The field's status-machine kinds (mirrors the component's local `Status`). */
export type AssistFooterStatusKind =
  | "idle"
  | "loading_suggestions"
  | "suggestions_open"
  | "no_results"
  | "offline"
  | "fetching_details"
  | "pick_error";

/**
 * Should the Tier-2 free-text ACTION row be shown?
 *
 * Shows on `no_results` (the primary "use what you typed" moment), on the
 * idle-after-typing full-address case (`idle` + trimmed length >= minQueryLength),
 * AND — Issue #1363 CHANGE 1 — WHILE a live suggestion list is open
 * (`suggestions_open`) when the typed text is full-length, so an un-indexed NG
 * address is always committable even when Mapbox returns junk suggestions. Stays
 * false during `loading_suggestions` (transient) and `fetching_details` (a pick
 * resolving) so the row never flickers or races a resolving pick. Hidden right
 * after a pick (`justPicked`) and when the host hasn't opted in.
 */
export function computeShowFreeTextRow(params: {
  allowFreeText: boolean;
  hasOnFreeText: boolean;
  justPicked: boolean;
  statusKind: AssistFooterStatusKind;
  trimmedLength: number;
  minQueryLength: number;
}): boolean {
  const {
    allowFreeText,
    hasOnFreeText,
    justPicked,
    statusKind,
    trimmedLength,
    minQueryLength,
  } = params;

  // Host must opt in; never re-offer a just-picked address.
  if (!allowFreeText || !hasOnFreeText || justPicked) {
    return false;
  }
  // NEVER while suggestions are LOADING (transient) or a pick is resolving
  // (`fetching_details`) — the row would flicker or race a resolving pick.
  if (
    statusKind === "loading_suggestions" ||
    statusKind === "fetching_details"
  ) {
    return false;
  }
  // Primary: the search came back empty.
  if (statusKind === "no_results") {
    return true;
  }
  // Issue #1363 (CHANGE 1) — ALSO show while a live suggestion list is open, as
  // long as the typed text is full-length. Mapbox routinely returns junk
  // suggestions for un-indexed NG addresses (it keyword-matches the city and
  // ignores the rest), so the brand must always be able to commit what they
  // typed. The host frames this row as a clearly-separated "or use what you
  // typed" alternative BELOW the list so it never reads as a suggestion.
  // Issue #1363 (CHANGE 1) — ALSO show while a live suggestion list is open, as
  // long as the typed text is full-length. Mapbox routinely returns junk
  // suggestions for un-indexed NG addresses (it keyword-matches the city and
  // ignores the rest), so the brand must always be able to commit what they
  // typed. The host frames this row as a clearly-separated "or use what you
  // typed" alternative BELOW the list so it never reads as a suggestion.
  if (statusKind === "suggestions_open" && trimmedLength >= minQueryLength) {
    return true;
  }
  // Secondary: idle-after-typing with a full-length address.
  if (statusKind === "idle" && trimmedLength >= minQueryLength) {
    return true;
  }
  return false;
}

/** Resolved visual style for the free-text ACTION row (spreadable, react-free). */
export interface FreeTextRowStyle {
  textColor: string;
  iconColor: string;
  fontWeight: "400" | "600";
  /** Pill chrome when an accent token is present; `null` = muted fallback. */
  pill: {
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
    paddingHorizontal: number;
  } | null;
}

/**
 * Resolve the free-text row's colors. With an `action` token → accent text +
 * icon, "600" weight, and a subtle tinted/bordered pill. Without it → the exact
 * muted fallback (`status.text` / leading-icon color, "400", no pill) so hosts
 * that pass no `action` render byte-identically to the pre-F2 field.
 */
export function resolveFreeTextRowStyle(
  action: LocationInputAction | undefined,
  fallback: { text: string; icon: string },
): FreeTextRowStyle {
  if (action) {
    return {
      textColor: action.text,
      iconColor: action.text,
      fontWeight: "600",
      pill: {
        backgroundColor: action.bg ?? "transparent",
        borderColor: action.border ?? action.text,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
      },
    };
  }
  return {
    textColor: fallback.text,
    iconColor: fallback.icon,
    fontWeight: "400",
    pill: null,
  };
}
