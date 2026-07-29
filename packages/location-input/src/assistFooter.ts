/**
 * @mingla/location-input · assist-footer pure logic (Issue #1363 device-UX F2)
 *
 * Extracted, react-free helpers for the Tier-2 "Use '<address>'" free-text
 * ACTION row so its timing + accent styling are unit-testable in a node env
 * (mirrors the `computeDropdownMaxHeight` / `staticMapPixelToLngLat` pattern).
 *
 * F2 fixes two device-eyeball defects:
 *  1. TIMING — the row used to appear from the FIRST typed character, competing
 *     with the live suggestion list. It now NEVER shows while suggestions are
 *     loading or an active list is open; it shows on the "we couldn't find it"
 *     moment (`no_results`), plus the idle-after-typing full-address case.
 *  2. ACCENT — the row was styled with the muted `status.text` color (looked
 *     like passive "Searching…" text). When the host injects an `action` token
 *     it now renders as an accent, pill-bordered button; without it (consumer)
 *     it falls back to the exact muted styling → byte-identical.
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
 * Guarantees it NEVER overlaps a live suggestion list: false during
 * `loading_suggestions`, `suggestions_open`, and `fetching_details`. Shows on
 * `no_results` (the primary "use what you typed" moment) and on the
 * idle-after-typing full-address case (`idle` + trimmed length >= minQueryLength).
 * Hidden right after a pick (`justPicked`) and when the host hasn't opted in.
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
  // NEVER while suggestions are loading, a list is open, or a pick is resolving —
  // the action row must not compete with the live suggestion list.
  if (
    statusKind === "loading_suggestions" ||
    statusKind === "suggestions_open" ||
    statusKind === "fetching_details"
  ) {
    return false;
  }
  // Primary: the search came back empty.
  if (statusKind === "no_results") {
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
