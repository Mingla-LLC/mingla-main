/**
 * @mingla/location-input · assist-footer pure logic (Issue #1363)
 *
 * React-free helpers for the exact free-text fallback row. Business hosts opt in;
 * consumer hosts omit the mode and retain the existing picker unchanged.
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
}): boolean {
  const {
    allowFreeText,
    hasOnFreeText,
    justPicked,
    statusKind,
    trimmedLength,
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
  return trimmedLength >= 1 && (
    statusKind === "no_results" ||
    statusKind === "suggestions_open" ||
    statusKind === "idle" ||
    statusKind === "offline" ||
    statusKind === "pick_error"
  );
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
